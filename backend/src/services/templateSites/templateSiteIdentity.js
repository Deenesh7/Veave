/**
 * The site-identity step: before any page is written, the parts of the template that carry ITS identity are rewritten for the
 * planned website: the brand, tagline, navigation, call to action and footer (src/data/site.js), the sample records of the
 * template (src/data/*.js), and the page title (index.html). A page job may never touch these files, which is why the template's
 * original name and menu used to stay on every page.
 *
 * The step has its own, narrow scope; the model's answer is checked against the plan (every planned link is there, nothing
 * from the template's original website is left) and corrected with the same repair loop the pages use.
 */
const aiProtocol = require('../ai/aiProtocol');
const generator = require('./templatePageGenerator');
const validation = require('./templateValidationService');
const semantic = require('./templateSemanticValidator');
const store = require('./siteFileStore');
const logger = require('../../utils/logger');

const SLOTS = ['hero', '1', '2', '3'];
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "ui-serif, Georgia, Cambria, 'Times New Roman', serif";

/**
 * The look the description asked for, written into the template's design tokens (the same mechanism the template uses for its own
 * colours): index.css variables and tokens.json. Pages use only the semantic colours, so the whole website follows. Deterministic: no model.
 */
function applyTheme(files, template, theme) {
  if (!theme?.colors) return files;
  const templateService = require('../templates/templateService');
  const c = theme.colors;
  const resolved = templateService.resolveTokens(template, { primary: c.brand, bg: c.bg, cardBg: c.surface, text: c.fg, border: c.line, secondary: c.muted, accent: c.accent, ...(theme.radius ? { radius: theme.radius } : {}) });
  const tokens = { ...resolved.tokens, surface2: c.surface2, onPrimary: c.onBrand, ...(theme.mood ? { mood: theme.mood } : {}) };
  let out = templateService.applyTokensToFiles(files, template, tokens);
  out = out.map((file) => (file.path === 'src/index.css' ? { ...file, content: file.content.replace(/(h1,\s*h2,\s*h3[^{]*\{[^}]*?font-family:\s*)[^;]+;/, `$1${theme.headingFont === 'sans' ? SANS : SERIF};`) } : file));
  return out;
}
const DATA_FILE = /^src\/data\/[A-Za-z0-9_-]+\.js$/;
const TEMPLATE_ART = /\/images\/(?:hero|card-\d)\.svg/;

/** A calm, neutral picture frame (no subject at all) for a photo the owner has not added yet. */
function slotSvg(label, tokens) {
  const colors = tokens?.colors || {};
  const bg = colors.surface2 || '#EFEDE8';
  const line = colors.line || '#DDD8CC';
  const ink = colors.muted || '#8A8478';
  // A quiet, compact stand-in: a small picture icon and a short caption in the middle of a plain, softly framed area.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800" role="img" aria-label="${label}">
  <rect width="1200" height="800" fill="${bg}"/>
  <rect x="1" y="1" width="1198" height="798" fill="none" stroke="${line}" stroke-width="2"/>
  <g transform="translate(600 380) scale(0.5)" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="0.45">
    <rect x="-100" y="-75" width="200" height="150" rx="14"/>
    <circle cx="-40" cy="-25" r="16"/>
    <path d="M-90 65 l55 -48 l40 34 l30 -26 l55 50"/>
  </g>
  <text x="600" y="470" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" fill="${ink}" opacity="0.7">Photo</text>
</svg>
`;
}

/** Adds the neutral photo slots the pages are told to use instead of the template's own pictures. */
function withSlotImages(files, template) {
  let next = files;
  for (const slot of SLOTS) {
    const path = `public/images/slot-${slot}.svg`;
    if (next.some((file) => file.path === path)) continue;
    next = [...next, { path, content: slotSvg(slot === 'hero' ? 'Hero photo' : `Photo ${slot}`, template.designTokens), language: 'svg', encoding: 'utf8' }];
  }
  return next;
}

const IDENTITY_SYSTEM = `You adapt the CONTENT DATA of a website template to a new website. The template is a design foundation; its names, menu, sample records and wording belong to a different website and must all be replaced.

You receive the website plan and the current content of the data files. Return the complete new content of EVERY listed file through the file-operations tool (operation "modify").

RULES
- Keep every file's exports, property names and structure exactly as they are (other code reads them). Change values only.
- src/data/site.js: name = the plan's website name; tagline = one sincere line for this website; email = a clear placeholder such as info@example.com (never a real address); nav = exactly the planned navigation (same labels, same routes, same order); cta = the planned call to action; footerGroups = the planned footer groups. Use only planned routes.
- Other src/data files (sample records): rewrite every record for this website (for example programs, departments, doctors' specialities, plans). Use generic, believable placeholders. Do NOT invent people's names, fees, dates, rankings, statistics, accreditation or achievements. Keep the same number of records and the same fields. Image fields use the pictures listed under SITE PICTURES, one per record in order; if there are none, the neutral slots /images/slot-1.svg, /images/slot-2.svg, /images/slot-3.svg (or /images/slot-hero.svg). Never /images/hero.svg or /images/card-N.svg.
- index.html: change only the <title> and the meta description for this website.
- Remove every word, name and record that belongs to the template's original website.`;

const brandOf = (name) => String(name || '').replace(/\s+/g, ' ').trim();

/** Does the rewritten identity match the plan, with nothing left of the template's original website? */
function identityProblems(files, plan, ownedPaths) {
  const problems = [];
  const text = (path) => String(files.find((file) => file.path === path)?.content || '');
  const siteSource = text('src/data/site.js');
  const issue = (message, path, action) => validation.issue('semantic', message, { path, cause: 'The site identity must match the website plan.', action });
  if (!siteSource) problems.push(issue('src/data/site.js is missing.', 'src/data/site.js', 'Return the complete src/data/site.js.'));
  else {
    if (!siteSource.includes(brandOf(plan.identity.name))) problems.push(issue(`The website name "${plan.identity.name}" is not in src/data/site.js.`, 'src/data/site.js', `Set name to "${plan.identity.name}".`));
    for (const item of plan.navigation) {
      if (!siteSource.includes(item.label) || !(siteSource.includes(`'${item.route}'`) || siteSource.includes(`"${item.route}"`))) problems.push(issue(`The navigation item "${item.label}" (${item.route}) is missing from src/data/site.js.`, 'src/data/site.js', `The nav list must be exactly: ${plan.navigation.map((entry) => `${entry.label} -> ${entry.route}`).join('; ')}.`));
    }
    const routes = new Set(plan.pages.map((page) => page.route));
    const unknown = [...siteSource.matchAll(/\bto:\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1].replace(/\/+$/, '') || '/').filter((route) => !routes.has(route));
    if (unknown.length) problems.push(issue(`src/data/site.js links to ${[...new Set(unknown)].map((route) => `"${route}"`).join(', ')}, which are not planned pages.`, 'src/data/site.js', `Link only to: ${[...routes].join(', ')}.`));
  }
  for (const path of ownedPaths) {
    const source = text(path);
    const leaked = semantic.findAvoided(path === 'index.html' ? source.replace(/<[^>]+>/g, ' ') : semantic.visibleText(source), plan.avoidTerms);
    if (leaked.length) problems.push(issue(`${path} still contains content from the template's original website: ${leaked.slice(0, 8).map((term) => `"${term}"`).join(', ')}.`, path, 'Rewrite those values for the new website.'));
    if (!plan.matchesTemplate && DATA_FILE.test(path) && TEMPLATE_ART.test(source)) problems.push(issue(`${path} still points at the template's own pictures.`, path, 'Use /images/slot-1.svg, /images/slot-2.svg, /images/slot-3.svg or /images/slot-hero.svg.'));
  }
  const cards = require('./templateSiteImages').cardPictures(plan);
  if (cards.length) {
    const dataText = ownedPaths.filter((path) => DATA_FILE.test(path) && path !== 'src/data/site.js').map(text).join('\n');
    if (/\bimage\s*:/.test(dataText) && !cards.some((card) => dataText.includes(card.path))) problems.push(issue('The sample records do not use the pictures that were made for them.', ownedPaths.find((path) => DATA_FILE.test(path) && path !== 'src/data/site.js'), `Set the image fields to: ${cards.map((card) => card.path).join(', ')}.`));
  }
  const html = text('index.html');
  if (html && !html.includes(brandOf(plan.identity.name))) problems.push(issue('The page title in index.html does not use the website name.', 'index.html', `Set the <title> to "${plan.identity.name}".`));
  return problems;
}

/**
 * Rewrites the template's identity files for the plan. Returns { files, changedPaths, usage }. Throws when the result cannot be made
 * to match the plan. The caller saves the result (nothing is written here).
 */
async function transformIdentity({ template, plan, files, deps = {}, signal, onState = () => {} }) {
  const callModel = deps.callModel || generator.defaultCallModel();
  // The same kind of website as the template: its sample records and pictures fit, so only the brand, menu and title change.
  let working = plan.matchesTemplate ? files : withSlotImages(files, template);
  working = applyTheme(working, template, plan.theme);
  const owned = working.filter((file) => (plan.matchesTemplate ? file.path === 'src/data/site.js' : DATA_FILE.test(file.path)) || file.path === 'index.html').map((file) => file.path);
  const scope = {
    owned: new Set(owned), ownedList: owned, sharedList: [], locked: new Set(),
    canCreate: (path) => DATA_FILE.test(path) && !working.some((file) => file.path === path)
  };
  const cards = require('./templateSiteImages').cardPictures(plan);
  const planText = JSON.stringify({ website: plan.identity, navigation: plan.navigation, cta: plan.cta, footerGroups: plan.footerGroups, pages: plan.pages.map((page) => ({ name: page.name, route: page.route, purpose: page.purpose })), terminology: plan.terminology, mustNotAppear: plan.avoidTerms }, null, 1);
  const fence = (file) => `// File: ${file.path}\n${file.content}`;
  let repair = null;
  let candidate = null;
  let usage = null;
  const rounds = Number.parseInt(process.env.TEMPLATE_REPAIR_ROUNDS, 10) >= 0 ? Number.parseInt(process.env.TEMPLATE_REPAIR_ROUNDS, 10) : 3;
  for (let round = 0; round <= rounds; round += 1) {
    signal?.throwIfAborted();
    onState(round === 0 ? 'Writing the website identity' : `Fixing the website identity (attempt ${round})`);
    const current = candidate || working;
    const messages = [
      { role: 'system', content: IDENTITY_SYSTEM },
      { role: 'user', content: [
        `WEBSITE PLAN:\n${planText}`,
        `THE USER'S DESCRIPTION:\n${plan.brief}`,
        cards.length ? `SITE PICTURES (real photographs already in the site, for the sample records, in order):\n${cards.map((item) => `- ${item.path} — ${item.subject}`).join('\n')}` : '',
        `FILES TO REWRITE (return ALL of them):\n${owned.map((path) => fence(current.find((file) => file.path === path))).join('\n\n')}`,
        repair ? `YOUR PREVIOUS ANSWER WAS REJECTED. Fix exactly these problems:\n${repair.map((item) => `- ${item}`).join('\n')}` : ''
      ].filter(Boolean).join('\n\n') }
    ];
    let applied;
    try {
      const response = await callModel(messages, { signal });
      usage = generator.sumUsage(usage, response.usage);
      applied = generator.applyAnswer(current, response, scope, { componentPath: 'src/data/site.js' });
    } catch (error) {
      if (signal?.aborted || error?.permanent || /OPENROUTER_(AUTH|INSUFFICIENT|RATE)/.test(error?.code || '')) throw error;
      repair = [`The answer could not be applied: ${error.message}`];
      if (round === rounds) throw Object.assign(new Error(`The website identity could not be written: ${error.message}`), { code: 'IDENTITY_FAILED' });
      continue;
    }
    candidate = applied.files;
    const problems = store.newProblems(working, candidate).map((item) => `${item.path}: ${String(item.message).slice(0, 200)}`).concat(identityProblems(candidate, plan, owned).map((item) => `${item.message} -> ${item.action}`));
    if (!problems.length) {
      const diff = store.diffFiles(files, candidate);
      return { files: candidate, changedPaths: diff.changed.map((item) => item.path), usage };
    }
    repair = problems.slice(0, 8);
    logger.warn(`Website identity attempt ${round + 1} rejected: ${repair[0]}`);
    if (round === rounds) throw Object.assign(new Error(`The website identity did not match the plan: ${repair.slice(0, 3).join(' | ')}`), { code: 'IDENTITY_FAILED' });
  }
  throw Object.assign(new Error('The website identity could not be written.'), { code: 'IDENTITY_FAILED' });
}

module.exports = { applyTheme, transformIdentity, identityProblems, withSlotImages, slotSvg };
