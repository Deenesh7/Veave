/**
 * Deep generation worker (new sites only): builds a complete, detailed website from the plan instead of asking for the whole project in
 * one response.
 *
 *   shell      Navbar, Footer and the stylesheet, written once so every page shares navigation and design tokens
 *   sections   every planned section is its own component file, written in small batches page by page (pages run side by side);
 *              a cut-off answer keeps the sections it finished and only the unfinished ones are asked for again
 *   pages      each page file and src/App.jsx are assembled deterministically from the plan, so routes and navigation can never disagree
 *   checks     compile/import checks, content depth and repeated-text checks, then requirement coverage; whatever fails becomes a new
 *              task for exactly that section (or a new section for a requirement nothing covers) and the loop runs again
 *
 * Progress is a plain state object (deep/deepState.js) written through `persist` after every task, so a retry, a worker restart or a
 * recovered job continues with the pending tasks only. The worker never edits job state or the project and never marks anything
 * complete by itself: it returns the verdict (`status`, uncovered requirements) and the orchestrator decides.
 */
const aiProtocol = require('../aiProtocol');
const generationPipeline = require('../generationPipeline');
const planner = require('../composition/compositionPlanner');
const { TOKENS } = require('../composition/layoutCatalog');
const deepState = require('../deep/deepState');
const deepPlanner = require('../deep/deepPlanner');
const depth = require('../deep/depthChecks');
const coverage = require('../deep/requirementCoverage');
const contentCoverage = require('../knowledge/contentCoverageValidator');
const requirementMapper = require('../knowledge/requirementMapper');
const adaptiveLayout = require('../composition/adaptiveLayout');
const { generateWithRetry: generateWithRetryBase, isProviderStop } = require('../jobSupport/retry');
const { completeOpenRouterResponse } = require('../jobSupport/completion');
const { mergeOpenRouterUsage } = require('../jobSupport/usage');

const int = (name, fallback) => { const value = Number.parseInt(process.env[name], 10); return Number.isFinite(value) && value > 0 ? value : fallback; };
const config = () => ({
  sectionTokens: int('DEEP_SECTION_MAX_TOKENS', 12000), shellTokens: int('DEEP_SHELL_MAX_TOKENS', 12000), batch: int('DEEP_BATCH_SECTIONS', 3),
  concurrency: int('DEEP_PAGE_CONCURRENCY', 3), taskRetries: int('DEEP_TASK_RETRIES', 3), coverageRounds: int('DEEP_COVERAGE_ROUNDS', 2),
  fixRounds: int('DEEP_FIX_ROUNDS', 2), timeout: int('OPENROUTER_GENERATION_TIMEOUT_MS', 300000)
});

const SECTION_RULES = `You write ONE part of a multi-page React website: separate section components. The sitemap, layouts, spacing tokens and pictures below are decided; follow them.
OUTPUT: only complete <FILE path="..." operation="create"> blocks, one per requested file, each closed with </FILE>. No commentary, no markdown fences.
EACH FILE: a self-contained React component with a default export whose name is exactly the file's base name. It renders ONE <section> (with aria-labelledby pointing at its heading). The first section of a page (layout page-intro or a hero) holds the page's single <h1>; every other section uses <h2> and <h3> inside it. Allowed imports: react, react-router-dom, lucide-react. No data fetching, no other local imports, no CSS files.
NO FILLER: never write navigation-style or promotional filler such as "Explore the institution's story", "Find the course information available on this site", "Learn more about our...", "Discover our..." in place of information. Every sentence states something a visitor can learn; when the sources gave nothing for a point, leave the point out instead of describing the act of looking for it.
CONTENT (MANDATORY): write real, specific, useful copy at the planned length: informational sections carry roughly 60-150 words of substance in paragraphs of 2-4 sentences plus the structure the layout calls for (cards, timeline entries, lists, profiles, FAQ items) with their own text. Every card, list item and timeline entry says something different. Never repeat a sentence, fact or card from another section (the other sections are listed for that purpose), never pad, never write lorem ipsum, "coming soon", placeholders or instructions. State only facts present in the request, the researched facts or general knowledge about the subject that is certainly true; never invent names, dates, figures, prices, awards, rankings or quotations, and where a specific is not given describe the subject in general terms (the "missing information" list shows what must not be invented).
LINKS: internal links use <Link to="..."> and only to the routes listed in SITE ROUTES. No external links except mailto: / tel: when the request gives that contact detail.
PICTURES: use an <img> only for a picture listed for that exact section, with its exact src and alt, loading="lazy", inside an aspect-ratio frame with w-full object-cover. Never write another image URL and never use a picture for a section it was not listed for.
STYLE: Tailwind utility classes; colours only through the theme tokens (bg-bg, bg-surface, bg-surface-2, border-line, text-fg, text-muted, bg-brand-600 with text-on-brand); the spacing, container and type classes from the composition plan; responsive from mobile up; no min-h-screen or fixed heights; no animations that hide content.`;

const SHELL_RULES = `You write the shared frame of a multi-page React website. OUTPUT: only complete <FILE path="..." operation="create"> blocks closed with </FILE>, no commentary.
FILES: src/components/Navbar.jsx (default export Navbar), src/components/Footer.jsx (default export Footer), src/index.css.
Navbar: brand name, a <NavLink> (react-router-dom) to every route in SITE ROUTES with active styling (when there are more than seven routes show the six most important plus a "More" disclosure menu that lists the rest), a working mobile menu (useState), sticky and compact. Footer: brand, a short line about the site, link columns grouping ALL routes, contact details only when the request gives them, copyright with the current year computed in code. Use only <Link>/<NavLink> to listed routes.
src/index.css: the @tailwind base/components/utilities directives and a :root block defining --bg, --surface, --surface-2, --line, --fg, --muted, --brand, --on-brand as space-separated RGB triplets (for example 255 255 255) for the site's palette, plus a body rule using them and the site's font. Default to a light theme unless the design direction says otherwise.
Allowed imports: react, react-router-dom, lucide-react. Style with Tailwind and the theme tokens (bg-bg, bg-surface, border-line, text-fg, text-muted, bg-brand-600, text-on-brand).`;

const ctxOf = (input, cfg) => ({ ...input, cfg, usage: null, aborted: () => input.signal?.throwIfAborted() });

/** One model call that survives truncation: closed FILE blocks are kept even when the continuation fails. */
async function callModel(ctx, messages, maxTokens, label) {
  ctx.aborted();
  const generate = (m, options) => generateWithRetryBase(m, options, { signal: ctx.signal });
  const completion = await generate(messages, { model: ctx.model, max_tokens: maxTokens, timeout: ctx.cfg.timeout, reasoning: { effort: 'low', exclude: true }, plugins: [{ id: 'context-compression' }], response_format: false });
  const first = String(completion?.content || '');
  const before = ctx.usage;
  ctx.usage = mergeOpenRouterUsage(before, completion?.usage, ctx.model);
  try {
    const done = await completeOpenRouterResponse(messages, completion, { model: ctx.model, structured: true, continuationInstruction: 'Continue exactly where the interrupted FILE block stopped. Do not repeat earlier output. Finish the file and close every FILE tag; then write any remaining requested files.' });
    if (done !== completion) ctx.usage = mergeOpenRouterUsage(before, done?.usage, ctx.model); // continued: the returned usage already adds the first call to the continuation calls
    return { text: String(done?.content || ''), truncated: false };
  } catch (error) {
    if (isProviderStop(error) || ctx.signal?.aborted) throw error;
    ctx.log?.warn(`${label}: the answer was cut off and could not be continued (${error.message}); keeping the files it completed.`);
    return { text: first, truncated: true };
  }
}

/** The complete files of an answer: <FILE> blocks; a truncated answer only gives the blocks that were closed. */
function filesFromText(text, truncated) {
  const files = [];
  for (const match of String(text).matchAll(/<FILE\s+([^>]*)>([\s\S]*?)<\/FILE>/gi)) {
    const attributes = /path\s*=\s*["']([^"']+)["']/i.exec(match[1]);
    if (attributes) files.push({ path: attributes[1].trim().replace(/^\.?\//, ''), content: match[2].replace(/^\r?\n/, '').replace(/\s+$/, '\n') });
  }
  if (files.length || truncated) return files;
  try { return (aiProtocol.parseAIResponse(text, null).files || []).filter((file) => file.path && typeof file.content === 'string').map((file) => ({ path: String(file.path).replace(/^\.?\//, ''), content: file.content })); } catch { return []; }
}

const syntaxErrors = (file) => { try { return generationPipeline.validateGeneratedFiles([{ ...file, language: 'javascript', encoding: 'utf8' }]).filter((item) => item.category === 'syntax'); } catch { return []; } };

const componentName = (file) => file.split('/').pop().replace(/\.jsx$/, '');

/* ---------------------------------------------------------------- prompts ---------------------------------------------------------------- */

const tokenLines = (tokens = {}) => `DESIGN TOKENS: mood ${tokens.mood || 'clean'}; primary ${tokens.primary || '#18181B'}; secondary ${tokens.secondary || '#71717A'}; background ${tokens.bg || '#F8F9FA'}; card ${tokens.cardBg || '#FFFFFF'}; text ${tokens.text || '#111827'}; radius ${tokens.radius || '14px'}; font ${tokens.font || 'Inter, sans-serif'}.`;

const routesBlock = (state) => `SITE ROUTES (the only valid internal links):\n${state.pages.map((page) => `- ${page.route}  ${page.name}`).join('\n')}`;

const missingBlock = (state) => (state.missingInfo?.length ? `\nMISSING INFORMATION (never invent these; write around them in general terms):\n${state.missingInfo.map((item) => `- ${item}`).join('\n')}` : '');

function siteHeader(ctx, state) {
  const { plan } = ctx;
  return `ORIGINAL REQUEST:\n"${String(ctx.prompt).slice(0, 5000)}"\n\nSITE: ${state.siteName || 'the website'}${plan.industry ? ` (${plan.industry})` : ''}${plan.tone ? `; tone: ${plan.tone}` : ''}${plan.audience ? `; audience: ${plan.audience}` : ''}${plan.visualDirection ? `\nVISUAL DIRECTION: ${plan.visualDirection}` : ''}\n${tokenLines(ctx.designTokens)}\n${routesBlock(state)}${missingBlock(state)}`;
}

/** For a person's profile: the verified portrait to use, or the instruction to use a neutral design when none could be verified. */
function portraitNote(ctx, state, planSection) {
  const wants = state.requirements.filter((item) => (planSection.requirementIds || []).includes(item.id) && (item.requiredAssets || []).some((asset) => asset.type === 'person_portrait'));
  if (!wants.length) return '';
  const names = (ctx.knowledge?.entries || []).filter((entry) => entry.kind === 'person' && wants.some((item) => item.id === entry.requirementId)).map((entry) => entry.attributes?.name);
  const asset = (ctx.assets || []).find((item) => item.entityType === 'person' && names.some((name) => name && String(item.entity).toLowerCase() === name.toLowerCase()));
  if (asset) return `PORTRAIT: use ${asset.publicPath} alt="${asset.alt}" (verified picture of ${asset.entity}).`;
  return 'PORTRAIT: no verified photograph of this person exists. Do NOT show any photograph of anyone here (no stock person, doctor or student): use a neutral monogram (the initials in a rounded frame using theme colours) and never claim a picture is of them.';
}

function buildSectionMessages(ctx, state, statePage, batch, written) {
  const planPage = ctx.plan.pages.find((page) => page.id === statePage.id);
  const batchIds = new Set(batch.map((section) => section.id));
  const slice = { ...ctx.plan, pages: [{ ...planPage, sections: planPage.sections.filter((section) => batchIds.has(section.id)) }] };
  // The block describes a one-page site when it is given a single page; this is one page of a larger site.
  const block = planner.buildPromptBlock(slice, { assets: ctx.assets || [], entityAssets: ctx.entityAssets || [] }).replace(/\nONE-PAGE SITE:[^\n]*/, '');
  const labels = new Map(state.requirements.map((item) => [item.id, item.label]));
  const first = planPage.sections[0]?.id;
  const files = batch.map((section) => {
    const covers = section.requirementIds.map((id) => labels.get(id)).filter(Boolean);
    const planSection = planPage.sections.find((item) => item.id === section.id);
    return `- ${section.file} (default export ${componentName(section.file)}; section id "${section.id}"${section.id === first ? '; FIRST section of the page: contains the page\'s only <h1>' : ''}${planSection?.words ? `; about ${planSection.words === 'long' ? '220-300' : planSection.words === 'medium' ? '100-150' : '40-80'} words of copy` : ''})${covers.length ? `\n    must cover in depth: ${covers.join('; ')}` : ''}${section.note ? `\n    FIX THIS TIME: ${section.note}` : ''}`;
  }).join('\n');
  // What the sources verified for these sections (every course, the person, the dated facts) and what must not be invented.
  const verified = batch.map((section) => {
    const planSection = planPage.sections.find((item) => item.id === section.id);
    if (!planSection) return '';
    const content = requirementMapper.knowledgeBlockFor({ section: planSection, requirements: state.requirements, knowledge: ctx.knowledge });
    const portrait = portraitNote(ctx, state, planSection);
    return content || portrait ? `SECTION ${section.id}:\n${content}${portrait ? `\n  ${portrait}` : ''}` : '';
  }).filter(Boolean).join('\n');
  // The layout each section needs, computed from how many items it really has (columns, timeline mode, no empty slots).
  const layouts = batch.map((section) => {
    const planSection = planPage.sections.find((item) => item.id === section.id);
    const text = planSection ? adaptiveLayout.layoutInstruction(planSection) : '';
    return text ? `SECTION ${section.id}: ${text}` : '';
  }).filter(Boolean).join('\n');
  const existing = batch.filter((section) => section.note && state.files[section.file]).map((section) => `--- CURRENT ${section.file} (improve it; keep what is accurate)\n${state.files[section.file].slice(0, 9000)}`).join('\n');
  const writtenHere = written.length ? `\nALREADY WRITTEN ON THIS PAGE (do not repeat any of it):\n${written.map((item) => `- ${item.heading}: ${item.text.replace(/\s+/g, ' ').slice(0, 180)}`).join('\n')}` : '';
  const elsewhere = state.pages.filter((page) => page.id !== statePage.id).map((page) => `- ${page.name}: ${page.sections.map((section) => section.heading).join(' | ')}`).join('\n');
  return [
    { role: 'system', content: `${ctx.baseSystem}\n\n${SECTION_RULES}` },
    { role: 'user', content: `${siteHeader(ctx, state)}\n\nPAGE: ${statePage.name} (${statePage.route})${planPage.purpose ? ` - ${planPage.purpose}` : ''}\nWRITE THESE FILES NOW:\n${files}\n${layouts ? `\n${layouts}\n` : ''}${verified ? `\nVERIFIED CONTENT (retrieved from the organisation's own sources; this is the ground truth for these sections):\n${verified}\n` : ''}${writtenHere}\n\nOTHER PAGES' SECTIONS (their content must not be repeated here):\n${elsewhere || '(none)'}\n\n${block}${existing ? `\n\n${existing}` : ''}` }
  ];
}

/* ---------------------------------------------------------------- shell ---------------------------------------------------------------- */

/** A plain but complete frame, used only when the model could not produce a valid one after its retries. */
function fallbackShell(state) {
  const links = state.pages.map((page) => `    { to: ${JSON.stringify(page.route)}, label: ${JSON.stringify(page.name)} },`).join('\n');
  const name = JSON.stringify(state.siteName || 'Home');
  return [
    { path: 'src/components/Navbar.jsx', content: `import React, { useState } from 'react';\nimport { NavLink, Link } from 'react-router-dom';\n\nconst links = [\n${links}\n];\n\nexport default function Navbar() {\n  const [open, setOpen] = useState(false);\n  return (\n    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">\n      <nav className="${TOKENS.container.wide} flex items-center justify-between py-3" aria-label="Main">\n        <Link to="/" className="text-lg font-semibold text-fg">{${name}}</Link>\n        <button type="button" className="md:hidden rounded-md border border-line px-3 py-1.5 text-sm text-fg" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>\n        <ul className="hidden md:flex flex-wrap items-center gap-x-5 gap-y-1">\n          {links.map((link) => (\n            <li key={link.to}><NavLink to={link.to} end={link.to === '/'} className={({ isActive }) => \`text-sm \${isActive ? 'font-semibold text-brand-600' : 'text-muted hover:text-fg'}\`}>{link.label}</NavLink></li>\n          ))}\n        </ul>\n      </nav>\n      {open && (\n        <ul className="md:hidden border-t border-line bg-bg px-4 py-2">\n          {links.map((link) => (\n            <li key={link.to}><NavLink to={link.to} end={link.to === '/'} onClick={() => setOpen(false)} className="block py-2 text-sm text-fg">{link.label}</NavLink></li>\n          ))}\n        </ul>\n      )}\n    </header>\n  );\n}\n`, language: 'javascript', encoding: 'utf8' },
    { path: 'src/components/Footer.jsx', content: `import React from 'react';\nimport { Link } from 'react-router-dom';\n\nconst links = [\n${links}\n];\n\nexport default function Footer() {\n  return (\n    <footer className="border-t border-line bg-surface">\n      <div className="${TOKENS.container.wide} py-10">\n        <p className="text-lg font-semibold text-fg">{${name}}</p>\n        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">\n          {links.map((link) => (<li key={link.to}><Link to={link.to} className="text-sm text-muted hover:text-fg">{link.label}</Link></li>))}\n        </ul>\n        <p className="mt-6 text-sm text-muted">&copy; {new Date().getFullYear()} {${name}}. All rights reserved.</p>\n      </div>\n    </footer>\n  );\n}\n`, language: 'javascript', encoding: 'utf8' },
    { path: 'src/index.css', content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  --bg: 255 255 255;\n  --surface: 248 250 252;\n  --surface-2: 241 245 249;\n  --line: 226 232 240;\n  --fg: 15 23 42;\n  --muted: 100 116 139;\n  --brand: 37 99 235;\n  --on-brand: 255 255 255;\n}\n\nbody {\n  background-color: rgb(var(--bg));\n  color: rgb(var(--fg));\n  font-family: Inter, system-ui, sans-serif;\n}\n`, language: 'css', encoding: 'utf8' }
  ];
}

async function runShell(ctx, state, save) {
  if (state.shell.status === deepState.DONE) return;
  const all = ['src/components/Navbar.jsx', 'src/components/Footer.jsx', 'src/index.css'];
  let wanted = all.filter((path) => !state.files[path]);
  state.shell.status = 'running';
  while (state.shell.retries < ctx.cfg.taskRetries) {
    ctx.onProgress?.({ stepName: 'Building the shared navigation, footer and design tokens...' });
    try {
      const messages = [{ role: 'system', content: `${ctx.baseSystem}\n\n${SHELL_RULES}` }, { role: 'user', content: `${siteHeader(ctx, state)}\n\n${ctx.plan.design ? `DESIGN DIRECTION (${ctx.plan.design.name}): headings: ${ctx.plan.design.headings}. Shapes: ${ctx.plan.design.shape}. Colour: ${ctx.plan.design.palette}.\n` : ''}Write exactly these files: ${wanted.join(', ')}.` }];
      const answer = await callModel(ctx, messages, ctx.cfg.shellTokens, 'shell');
      const files = filesFromText(answer.text, answer.truncated).filter((file) => wanted.includes(file.path));
      const bad = wanted.filter((path) => { const file = files.find((item) => item.path === path); return !file || (/\.jsx$/.test(path) && (!/export\s+default\b/.test(file.content) || syntaxErrors(file).length)) || (path.endsWith('.css') && !/@tailwind\s+base/.test(file.content)); });
      for (const file of files) if (!bad.includes(file.path)) state.files[file.path] = file.content; // valid files are kept even when others failed
      if (!bad.length) { state.shell.status = deepState.DONE; state.shell.error = ''; await save(state); return; }
      state.shell.error = `missing or invalid: ${bad.join(', ')}`;
    } catch (error) {
      if (isProviderStop(error) || ctx.signal?.aborted) throw error;
      state.shell.error = error.message;
    }
    state.shell.retries += 1; state.retries += 1;
    state.failedTasks.push({ task: 'shell', error: state.shell.error, at: new Date().toISOString() });
    await save(state);
    // Only the files still missing are asked for again.
    wanted = all.filter((path) => !state.files[path]);
    if (!wanted.length) break;
  }
  const missing = all.filter((path) => !state.files[path]);
  for (const file of fallbackShell(state).filter((item) => missing.includes(item.path))) state.files[file.path] = file.content;
  state.shell.status = deepState.DONE;
  await save(state);
}

/* ---------------------------------------------------------------- sections and pages ---------------------------------------------------------------- */

function pageSource(ctx, state, statePage) {
  const planPage = ctx.plan.pages.find((page) => page.id === statePage.id);
  const sections = statePage.sections.filter((section) => state.files[section.file]);
  const name = componentName(statePage.file);
  const description = String(planPage?.purpose || `${statePage.name} - ${state.siteName || ''}`).replace(/\s+/g, ' ').trim().slice(0, 158);
  const imports = sections.map((section) => `import ${componentName(section.file)} from '../components/sections/${componentName(section.file)}';`).join('\n');
  return `import React from 'react';\nimport useSeo from '../hooks/useSeo';\n${imports}\n\nexport default function ${name}() {\n  useSeo({ title: ${JSON.stringify(`${statePage.name}${state.siteName ? ` | ${state.siteName}` : ''}`)}, description: ${JSON.stringify(description)} });\n  return (\n    <>\n${sections.map((section) => `      <${componentName(section.file)} />`).join('\n')}\n    </>\n  );\n}\n`;
}

function appSource(state) {
  const pages = state.pages.filter((page) => state.files[page.file]).map((page) => ({ name: componentName(page.file), route: page.route }));
  const imports = pages.map((page) => `import ${page.name} from './pages/${page.name}';`).join('\n');
  const routes = pages.map((page) => `            <Route path=${JSON.stringify(page.route)} element={<${page.name} />} />`).join('\n');
  return `import React, { useEffect } from 'react';\nimport { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';\nimport Navbar from './components/Navbar';\nimport Footer from './components/Footer';\n${imports}\n\nfunction ScrollToTop() {\n  const { pathname } = useLocation();\n  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);\n  return null;\n}\n\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <ScrollToTop />\n      <div className="flex min-h-screen flex-col bg-bg text-fg">\n        <Navbar />\n        <main className="flex-1">\n          <Routes>\n${routes}\n            <Route path="*" element={<Navigate to="/" replace />} />\n          </Routes>\n        </main>\n        <Footer />\n      </div>\n    </BrowserRouter>\n  );\n}\n`;
}

/** Writes the sections of one page (in batches, retrying only what is unfinished) and then assembles the page file. */
async function runPage(ctx, state, statePage, save) {
  const planPage = ctx.plan.pages.find((page) => page.id === statePage.id);
  if (!planPage) return;
  statePage.status = 'running';
  let batchSize = ctx.cfg.batch;
  for (let guard = 0; guard < 60; guard += 1) {
    ctx.aborted();
    const pending = statePage.sections.filter((section) => section.status !== deepState.DONE && section.status !== 'failed');
    if (!pending.length) break;
    const batch = pending.slice(0, batchSize);
    batch.forEach((section) => { section.status = 'running'; });
    const written = statePage.sections.filter((section) => section.status === deepState.DONE && state.files[section.file]).map((section) => ({ heading: section.heading, text: depth.visibleText(state.files[section.file]) }));
    const done = state.pages.reduce((sum, page) => sum + page.sections.filter((section) => section.status === deepState.DONE).length, 0);
    ctx.onProgress?.({ stepName: `Writing ${statePage.name}: ${batch.map((section) => section.heading).join(', ')} (${done} of ${deepState.allSections(state).length} sections done)` });
    let produced = new Set();
    try {
      const answer = await callModel(ctx, buildSectionMessages(ctx, state, statePage, batch, written), ctx.cfg.sectionTokens, `${statePage.name} sections`);
      const files = filesFromText(answer.text, answer.truncated);
      for (const section of batch) {
        const file = files.find((item) => item.path === section.file);
        if (!file) { section.error = answer.truncated ? 'the answer was cut off before this section' : 'the section file was not returned'; continue; }
        const errors = syntaxErrors(file);
        if (errors.length) { section.error = `syntax error: ${errors[0].message}`; continue; }
        const check = depth.sectionProblems({ ...(planPage.sections.find((item) => item.id === section.id) || {}), id: section.id, heading: section.heading }, file.content);
        const hard = check.problems.filter((problem) => ['export', 'placeholder', 'heading'].includes(problem.kind));
        const thin = check.problems.filter((problem) => problem.kind === 'thin' || problem.kind === 'filler');
        // A thin section is kept (so nothing already written is lost) but asked for again while retries remain.
        state.files[section.file] = file.content;
        section.words = check.words;
        if (hard.length) { section.error = hard.map((problem) => problem.message).join('; '); delete state.files[section.file]; continue; }
        produced.add(section.id);
        if (thin.length && section.retries < ctx.cfg.taskRetries - 1) { section.note = `the last version had ${thin[0].message}; write the full planned depth with specific, non-repetitive substance.`; section.retries += 1; state.retries += 1; section.status = 'pending'; continue; }
        section.status = deepState.DONE; section.note = ''; section.error = '';
      }
    } catch (error) {
      if (isProviderStop(error) || ctx.signal?.aborted) throw error;
      batch.forEach((section) => { section.error = error.message; });
    }
    for (const section of batch) {
      if (section.status === deepState.DONE || (section.status === 'pending' && produced.has(section.id))) continue;
      section.retries += 1; state.retries += 1;
      state.failedTasks.push({ task: `${statePage.id}/${section.id}`, error: section.error || 'no usable output', at: new Date().toISOString() });
      section.status = section.retries >= ctx.cfg.taskRetries ? 'failed' : 'pending';
      // After a failure ask for fewer sections at a time: smaller answers are less likely to be cut off.
      batchSize = 1;
      if (section.error) section.note = `the previous attempt failed (${section.error}); return this section complete and valid`;
    }
    await save(state);
  }
  const written = statePage.sections.filter((section) => state.files[section.file]);
  if (written.length) { state.files[statePage.file] = pageSource(ctx, state, statePage); }
  statePage.status = statePage.sections.every((section) => section.status === deepState.DONE) ? deepState.DONE : 'incomplete';
  await save(state);
}

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const item = items[next]; next += 1; await work(item); } }));
}

async function runPages(ctx, state, save) {
  const todo = state.pages.filter((page) => page.sections.some((section) => section.status !== deepState.DONE && section.status !== 'failed') || !state.files[page.file]);
  await pool(todo, ctx.cfg.concurrency, (page) => runPage(ctx, state, page, save));
}

/* ---------------------------------------------------------------- assembly and checks ---------------------------------------------------------------- */

const fileObject = (path, content) => ({ path, content, language: path.endsWith('.css') ? 'css' : 'javascript', encoding: 'utf8' });

function assemble(ctx, state) {
  const files = Object.entries(state.files).filter(([path]) => path !== 'src/App.jsx').map(([path, content]) => fileObject(path, content));
  files.push(fileObject('src/App.jsx', appSource(state)));
  return files;
}

/** Compile / import problems of the assembled project mapped back to the section or shell task that wrote the file. */
function reopenBroken(state, diagnostics, cfg) {
  const byFile = new Map(allWritten(state).map((item) => [item.file, item]));
  let reopened = 0;
  for (const item of diagnostics) {
    const owner = byFile.get(item.path);
    if (owner?.section && owner.section.retries < cfg.taskRetries + cfg.fixRounds) {
      owner.section.status = 'pending'; owner.section.retries += 1; owner.section.note = `fix this compile problem: ${String(item.message).slice(0, 240)}`; owner.page.status = 'pending'; reopened += 1; state.retries += 1;
    }
  }
  return reopened;
}

const allWritten = (state) => deepState.allSections(state).map(({ page, section }) => ({ file: section.file, section, page }));

async function verifyBuild(ctx, state, save) {
  let files = assemble(ctx, state);
  for (let round = 0; round <= ctx.cfg.fixRounds; round += 1) {
    let remaining = '';
    let fixed = null;
    const salvaged = ctx.deps.salvagePartialProject(files, (text, repaired) => { remaining = text; fixed = repaired; });
    if (salvaged) return salvaged;
    const diagnostics = generationPipeline.validateGeneratedFiles(fixed || files).filter((item) => ['import', 'export', 'syntax', 'entry'].includes(item.category));
    if (round === ctx.cfg.fixRounds || !reopenBroken(state, diagnostics, ctx.cfg)) { ctx.log?.warn(`deep generation: compile problems left for the validation stage:\n${remaining}`); return fixed || files; }
    ctx.onProgress?.({ stepName: 'Fixing sections that did not compile...' });
    await runPages(ctx, state, save);
    files = assemble(ctx, state);
  }
  return files;
}

/** Sections that are thin, placeholder-like or repeat another section's text, found without a model. */
function depthIssues(ctx, state) {
  const issues = [];
  const entries = [];
  for (const { page, section } of deepState.allSections(state)) {
    const source = state.files[section.file];
    if (!source) continue;
    const planSection = ctx.plan.pages.find((item) => item.id === page.id)?.sections.find((item) => item.id === section.id) || { id: section.id, heading: section.heading, words: 'medium' };
    const check = depth.sectionProblems(planSection, source);
    section.words = check.words;
    entries.push({ key: `${page.id}/${section.id}`, text: check.text });
    for (const problem of check.problems.filter((item) => item.kind === 'thin' || item.kind === 'placeholder' || item.kind === 'filler')) issues.push({ page, section, kind: problem.kind, message: problem.message });
  }
  // The same picture file in two sections is only allowed for a small logo or a person's portrait: otherwise the later section is rewritten.
  const usedAt = new Map();
  for (const { page, section } of deepState.allSections(state)) {
    const source = state.files[section.file] || '';
    for (const match of new Set(source.match(/\/assets\/images\/[\w./-]+\.(?:webp|jpe?g|png|avif)/gi) || [])) {
      const asset = (ctx.assets || []).find((item) => item.publicPath === match);
      if (asset && (asset.entityType === 'person' || asset.pictureKind === 'logo' || asset.category === 'logo')) continue;
      const first = usedAt.get(match);
      if (!first) usedAt.set(match, { page, section });
      else if (first.section.file !== section.file) {
        const free = (ctx.assets || []).filter((item) => !deepState.allSections(state).some(({ section: other }) => (state.files[other.file] || '').includes(item.publicPath)) && !item.entity).map((item) => `${item.publicPath} (${item.alt})`).slice(0, 4);
        issues.push({ page, section, kind: 'duplicate-image', message: `uses ${match}, which is already shown in "${first.section.heading}" on ${first.page.name}. A picture is used once: ${free.length ? `use one of these unused verified pictures if it fits this section's subject: ${free.join('; ')}; otherwise` : ''} remove the picture and lay the section out text-led (no empty image frame)` });
      }
    }
  }
  const repeated = depth.findRepeatedText(entries);
  for (const { page, section } of deepState.allSections(state)) {
    const passages = repeated.get(`${page.id}/${section.id}`);
    if (passages) issues.push({ page, section, kind: 'repeated', message: `repeats text already used in another section ("${passages[0]}")` });
  }
  return issues;
}

function reopenSection(state, page, section, note, cfg) {
  if (section.retries >= cfg.taskRetries + cfg.coverageRounds) return false;
  section.status = 'pending'; section.retries += 1; section.note = note; page.status = 'pending'; state.retries += 1;
  return true;
}

const missingNote = (requirement) => (requirement.missingItems?.length ? ` These verified items are not on the page yet and MUST appear by their exact names: ${requirement.missingItems.slice(0, 60).join('; ')}.` : '');

/** Requirements the sitemap or the written text does not cover become tasks: a new section for a missing one, a deeper rewrite for a partial one. */
function scheduleCoverageWork(ctx, state, uncovered) {
  let scheduled = 0;
  for (const requirement of uncovered) {
    // The sections that cover it (as judged by the validator, when it names sections) or, failing that, the sections it was mapped to.
    const cited = String(requirement.evidence || '').split(',').map((key) => key.trim()).filter((key) => key.includes('/'));
    const mapped = [...new Set([...(cited.length ? cited : []), ...(requirement.sectionIds || [])])];
    const targets = mapped.map((key) => { const [pageId, sectionId] = key.split('/'); const page = state.pages.find((item) => item.id === pageId); const section = page?.sections.find((item) => item.id === sectionId); return page && section ? { page, section } : null; }).filter(Boolean);
    if (requirement.status === coverage.PARTIAL && targets.length && !targets[0].section.coverageTried) {
      const { page, section } = targets[0];
      section.coverageTried = true;
      if (reopenSection(state, page, section, `the request requires "${requirement.label}" to be covered in depth here; the current text covers it only ${requirement.note || 'partly'}. ${missingNote(requirement)} Cover every aspect with specific content.`, ctx.cfg)) scheduled += 1;
      continue;
    }
    // A section planned for it that has not been rewritten for it yet is rewritten first; the same section is never asked twice.
    if (targets.length && !targets[0].section.coverageTried) {
      const { page, section } = targets[0];
      section.coverageTried = true;
      if (reopenSection(state, page, section, `the request requires "${requirement.label}" and this section was planned to cover it, but the site does not yet address it. Write specific content about it.${missingNote(requirement)}`, ctx.cfg)) scheduled += 1;
      continue;
    }
    // Nothing on the site covers it: a new section on the page that fits it best.
    const key = deepPlanner.addRequirementSection(ctx.plan, requirement);
    const [pageId, sectionId] = key.split('/');
    const planSection = ctx.plan.pages.find((page) => page.id === pageId).sections.find((section) => section.id === sectionId);
    const added = deepState.addSectionToState(state, ctx.plan, pageId, planSection);
    if (added) { requirement.sectionIds = [key]; scheduled += 1; }
  }
  return scheduled;
}

/* ---------------------------------------------------------------- orchestration ---------------------------------------------------------------- */

/**
 * @param input { prompt, plan, deepPlan, baseSystem, designTokens, assets, entityAssets, model, ask, state?, persist, onProgress, log, signal }
 * @param deps  { salvagePartialProject }
 * @returns {{ ok: true, status: 'complete'|'incomplete', updatedFiles, generatedChanges, generatedAppCode, tokenUsage, state, summary, uncovered }
 *          | { ok: false, providerFailureReason, state }}
 */
async function generateDeepProject(input, deps) {
  const cfg = config();
  const ctx = { ...ctxOf(input, cfg), deps };
  const save = deepState.makePersister(input.persist);
  let state = input.state || deepState.createState({ prompt: input.prompt, plan: input.plan, requirements: input.deepPlan?.requirements || [], missingInfo: input.deepPlan?.missingInfo || [], siteName: input.deepPlan?.siteName || '' });
  if (!input.state) { state.siteName = state.siteName || input.plan.siteName || ''; }
  // A resumed run must write into the same sitemap: sections added by an earlier coverage round are restored into the plan.
  if (input.state) for (const page of state.pages) {
    const planPage = ctx.plan.pages.find((item) => item.id === page.id);
    if (!planPage) continue;
    for (const section of page.sections) if (!planPage.sections.some((item) => item.id === section.id)) planPage.sections.push({ id: section.id, purpose: section.note || section.heading, eyebrow: '', heading: section.heading, summary: section.heading, facts: [], factIds: [], words: 'medium', layout: 'editorial-image-right', spacing: 'major', width: 'standard', images: [], imageShortfall: 0, requirementIds: section.requirementIds });
  }
  await save(state);
  try {
    await runShell(ctx, state, save);
    await runPages(ctx, state, save);
    let files = await verifyBuild(ctx, state, save);

    for (let round = 0; ; round += 1) {
      ctx.onProgress?.({ stepName: 'Checking that every requirement of your request is covered...' });
      const issues = depthIssues(ctx, state);
      const { source } = ctx.knowledge
        ? await contentCoverage.validateCoverage({ requirements: state.requirements, state, knowledge: ctx.knowledge, assets: ctx.assets || [], ask: input.ask, minimumWords: 50 }).then((value) => { state.coverageReport = value.results; return value; })
        : await coverage.checkCoverage({ state, ask: input.ask, minimumWords: 50 });
      const uncovered = state.requirements.filter((item) => item.status !== coverage.COVERED && (item.importance === 'core' || item.status === coverage.MISSING));
      state.validation = { status: !uncovered.length && !issues.length ? 'passed' : 'pending', issues: issues.slice(0, 20).map((item) => `${item.page.name}/${item.section.heading}: ${item.message}`), coverageSource: source };
      await save(state);
      if ((!uncovered.length && !issues.length) || round >= cfg.coverageRounds) break;
      // More retrieval first: a requirement whose sourced items are missing gets one targeted search before it is rewritten.
      if (input.retrieve) for (const requirement of uncovered.filter((item) => !item.retrievalTried && item.status !== coverage.COVERED)) { requirement.retrievalTried = true; try { ctx.onProgress?.({ stepName: `Looking for more sources on ${requirement.label}...` }); await input.retrieve(requirement, ctx.knowledge); } catch (error) { if (ctx.signal?.aborted) throw error; } }
      let scheduled = scheduleCoverageWork(ctx, state, uncovered);
      // One rewrite per section carries every problem found in it (a duplicate picture and repeated text are fixed together, not one overwriting the other).
      const bySection = new Map();
      for (const item of issues) { const key = item.section.file; bySection.set(key, { item, messages: [...(bySection.get(key)?.messages || []), item.message] }); }
      for (const { item, messages } of bySection.values()) if (reopenSection(state, item.page, item.section, `${messages.join('. ALSO: ')}. Rewrite it with distinct, specific content.`, cfg)) scheduled += 1;
      if (!scheduled) break;
      state.coverageRounds += 1;
      await save(state);
      await runPages(ctx, state, save);
      files = await verifyBuild(ctx, state, save);
    }

    // Verdict: a core requirement nothing addresses, or a page that could not be written, keeps the site from being complete. A
    // requirement that is only partly covered is recorded (and was already rewritten once) but does not block delivery.
    const uncovered = state.requirements.filter((item) => item.status !== coverage.COVERED && item.importance === 'core');
    const blocking = uncovered.filter((item) => item.status === coverage.MISSING);
    const unfinished = state.pages.filter((page) => !state.files[page.file]).map((page) => page.name);
    const usable = state.pages.some((page) => state.files[page.file]) && state.shell.status === deepState.DONE;
    if (!usable) { state.status = 'failed'; await save(state); return { ok: false, providerFailureReason: 'deep generation produced no usable pages', state }; }
    state.status = !blocking.length && !unfinished.length ? 'complete' : 'incomplete';
    state.validation.status = state.status === 'complete' ? 'passed' : 'failed';
    await save(state);
    const appCode = files.find((file) => file.path === 'src/App.jsx')?.content || '';
    return { ok: true, status: state.status, updatedFiles: files, generatedChanges: files, generatedAppCode: appCode, tokenUsage: ctx.usage, state, summary: deepState.summarize(state), uncovered: uncovered.map((item) => item.label), blocking: blocking.map((item) => item.label), unfinished };
  } catch (error) {
    if (isProviderStop(error) || ctx.signal?.aborted) { await save(state); throw error; }
    ctx.log?.warn(`deep generation failed: ${error.message}`);
    state.status = 'failed'; state.failedTasks.push({ task: 'deep-generation', error: error.message, at: new Date().toISOString() });
    await save(state);
    return { ok: false, providerFailureReason: error.message, state };
  }
}

module.exports = { generateDeepProject, filesFromText, fallbackShell, appSource, pageSource, buildSectionMessages, SECTION_RULES };
