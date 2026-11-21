/**
 * Validation of a regenerated page, in independent stages. Every problem is reported as
 *   { stage, path, route, message, cause, action }
 * (what failed where, the exact error, why, and what the repair should do), so it can be shown to the user and sent to the model
 * unchanged. Stages: scope, code, website, asset, regression. The slow stage, the production build and browser test of every
 * route, is `runBuildGate` and uses the same gate (validateAndRepair, Docker runner, local browser) as the rest of Veave.
 */
const crypto = require('node:crypto');
const aiProtocol = require('../ai/aiProtocol');
const pageDistinctness = require('../ai/pageDistinctness');
const store = require('./siteFileStore');

const SOURCE = /\.(?:jsx?|tsx?)$/i;
const BUILTIN_PACKAGES = new Set(['react', 'react-dom', 'react-router-dom', 'react/jsx-runtime']);
const CREATE_PREFIXES = ['src/components/', 'src/data/'];
// Pictures the page's images are saved as (never replaces an existing file: the name is the content hash).
const ASSET_PREFIX = 'public/assets/images/';
const MIN_PAGE_WORDS = 25;

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const issue = (stage, message, { path = null, route = null, cause = '', action = '' } = {}) => ({ stage, path, route, message, cause, action });

/* ------------------------------------------------ scope: what this page may touch ------------------------------------------------ */

/**
 * The files a regeneration of `page` may change: the page's component and the files only it uses. The shared components, the
 * routing and navigation, the configuration and every other page (and what they use) are out of scope.
 */
/**
 * A prompt that is about the whole website (menu, footer, logo, site name, "everywhere", rebranding) or that names a shared component
 * (e.g. "remove the search tabs") cannot be done inside one page file. Those prompts get a wider scope: see pageScope.
 */
const SITE_WIDE_WORDS = /\b(nav(?:bar|igation)?|menu|header|footer|logo|brand(?:ing)?|re-?brand|site[ -]?name|site[ -]?wide|whole (?:web)?site|entire (?:web)?site|all (?:the )?pages|every page|other pages|across (?:the )?(?:web)?site|throughout|everywhere|all references|favicon|page title|tagline)\b/i;
function wantsSiteWide(instruction, files = []) {
  const text = ownerWords(instruction);
  if (SITE_WIDE_WORDS.test(text)) return true;
  // "remove/replace/rename X" where X also lives in the shared parts of the site (menu, footer, shared components, site data).
  if (/\b(remove|delete|get rid of|replace|rename|drop|eliminate|references?)\b/i.test(text)) {
    const stop = new Set(['remove', 'delete', 'replace', 'rename', 'with', 'this', 'that', 'page', 'pages', 'section', 'sections', 'from', 'about', 'make', 'instead', 'add', 'and', 'the', 'all', 'references', 'reference', 'lot', 'unique', 'features', 'home', 'text', 'content', 'there', 'which', 'them', 'they', 'into', 'then', 'also', 'more']);
    const shared = files.filter((file) => /^(?:src\/(?:components|data)\/|index\.html$)/.test(file.path) && typeof file.content === 'string');
    const words = [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => !stop.has(word)))];
    for (const word of words) {
      const stem = word.length > 6 ? word.slice(0, word.length - 2) : word.length > 4 ? word.slice(0, 4) : word;
      const pattern = new RegExp(`\\b${stem.replace(/[^a-z]/g, '')}`, 'i');
      if (shared.some((file) => pattern.test(file.content))) return true;
    }
  }
  const squashed = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return files.some((file) => /^src\/components\/[A-Za-z0-9]+\.jsx?$/.test(file.path) && (() => {
    const name = file.path.split('/').pop().replace(/\.jsx?$/, '').toLowerCase();
    return name.length >= 6 && squashed.includes(name);
  })());
}

function pageScope({ files, page, pages, template, siteWide = false }) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const locked = new Set([...(template?.scaffold?.sharedFiles || []), ...(template?.scaffold?.protectedFiles || []), ...(template?.scaffold?.requiredFiles || []), 'src/App.jsx', 'src/main.jsx', 'src/data/site.js', 'src/index.css', 'package.json', 'index.html']);
  const usedElsewhere = new Set();
  for (const other of pages.filter((item) => String(item._id) !== String(page._id))) {
    for (const path of pageDistinctness.reachableFiles(other.componentPath, byPath, 2)) usedElsewhere.add(path);
  }
  const reachable = pageDistinctness.reachableFiles(page.componentPath, byPath, 2).filter((path) => byPath.has(path) && SOURCE.test(path));
  const owned = reachable.filter((path) => path === page.componentPath || (!locked.has(path) && !usedElsewhere.has(path) && path.startsWith('src/')));
  if (siteWide) {
    // Site-wide prompt: the shared components, shared data, site data and the HTML shell may change too. Other pages, the router, config and styles may not.
    const otherPageFiles = new Set(pages.filter((item) => String(item._id) !== String(page._id)).map((item) => item.componentPath));
    const hard = new Set(['src/App.jsx', 'src/main.jsx', 'src/index.css', 'package.json', 'package-lock.json']);
    for (const file of files) {
      const path = file.path;
      if (owned.includes(path) || otherPageFiles.has(path) || hard.has(path) || file.encoding === 'base64') continue;
      if (path === 'index.html' || path === 'src/data/site.js' || (/^src\/(?:components|data)\//.test(path) && SOURCE.test(path))) owned.push(path);
    }
  }
  const shared = reachable.filter((path) => !owned.includes(path));
  return { siteWide, owned: new Set(owned), ownedList: owned, sharedList: shared, locked, canCreate: (path) => CREATE_PREFIXES.some((prefix) => path.startsWith(prefix)) && !byPath.has(path) && SOURCE.test(path) };
}

/** Splits operations into those inside the scope and those that are dropped (with the reason, which goes into the repair prompt). */
function filterOperations(operations, scope) {
  const allowed = [];
  const dropped = [];
  for (const op of operations) {
    const operation = String(op.operation || 'modify').toLowerCase();
    let reason = null;
    if (['rename', 'delete'].includes(operation)) reason = `${operation} is not allowed in a page regeneration`;
    else if (scope.owned.has(op.path)) reason = null;
    else if (operation === 'create' && scope.canCreate(op.path)) reason = null;
    else reason = scope.locked.has(op.path) ? 'it is a shared or locked file' : scope.canCreate(op.path) === false && operation === 'create' ? 'new files may only be created under src/components/ or src/data/' : 'it belongs to another page or to the shared site';
    if (reason) dropped.push({ path: op.path, operation, reason }); else allowed.push(op);
  }
  return { allowed, dropped };
}

/* ------------------------------------------------ the checks ------------------------------------------------ */

function bareImports(files) {
  const found = new Map();
  for (const file of files.filter((item) => SOURCE.test(item.path))) {
    for (const match of textOf(file).matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"./][^'"]*)['"]/g)) {
      const name = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1].split('/')[0];
      (found.get(name) || found.set(name, []).get(name)).push(file.path);
    }
  }
  return found;
}

function installedPackages(files) {
  try {
    const pkg = JSON.parse(textOf(files.find((file) => file.path === 'package.json')) || '{}');
    return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}), ...BUILTIN_PACKAGES]);
  } catch { return new Set(BUILTIN_PACKAGES); }
}

/** The page's own words (its component and what only it uses), for the "is this still a real, distinct page" checks. */
function pageWords(files, componentPath) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const source = pageDistinctness.pageSource(componentPath, byPath, 2);
  const text = pageDistinctness.visibleText(source);
  return { text, words: text.split(/\s+/).filter((word) => /[a-z]{2,}/i.test(word)).length, set: new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 2)) };
}

/**
 * Static checks of a candidate against the files before the change. Returns the list of problems (empty = acceptable).
 * @param {object} p  { baseline, candidate, scope, page, pages, template, changedPaths }
 */
/**
 * "Add images / use these photos" is a picture-only edit: the words of the page must stay. A rewrite, a removal or a new subject is
 * not picture-only, so the instruction must name pictures and must not ask for any change of the text.
 */
const PICTURE_WORDS = /\b(images?|photos?|pictures?|photographs?|gallery|banner|logo)s?\b/i;
const TEXT_CHANGE_WORDS = /\b(rewrite|re-?write|remove|delete|replace the (?:text|heading|content|copy)|(?:change|edit|update|shorten|lengthen|translate) the (?:text|heading|title|content|copy|wording)|text|heading|title|content|copy|wording|about|instead|for (?:a|an|the|my) |turn|convert|transform|redesign|rebuild|new section)\b/i;
function isPictureOnlyEdit(instruction, attachments = []) {
  const text = ownerWords(instruction);
  if (TEXT_CHANGE_WORDS.test(text.replace(/\b(image|photo|picture)s? (?:and|or) (?:text|content)\b/gi, ''))) return false;
  return PICTURE_WORDS.test(text) || (attachments.length > 0 && text.split(/\s+/).length <= 30);
}
const REWRITE_WORDS = /\b(rewrite|re-?write|redo|redesign|rebuild|recreate|revamp|overhaul|start over|from scratch|transform|convert|turn (?:this|the|it)|(?:make|change) (?:this|the) (?:page|website|site) (?:for|into|about)|for (?:a|an|the|my) [\p{L} ]{2,40}(?:website|site|college|school|hospital|company|business)|all (?:the )?(?:sections|content|text)|whole page|entire page|every section|across (?:all )?sections)\b/iu;
/**
 * How much of the page's existing wording must survive an instruction. A picture-only instruction keeps almost everything; any other
 * edit keeps most of the page (it may change what it names, not the rest); a selected section leaves the other sections alone.
 * A rewrite, a website-wide change or a change of subject is allowed to replace the content.
 */
function keepRatioFor({ instruction, attachments = [], siteWide = false, rewrite = false }) {
  if (siteWide || rewrite || REWRITE_WORDS.test(ownerWords(instruction))) return null;
  if (isPictureOnlyEdit(instruction, attachments)) return 0.9;
  return /The owner ticked only the section/.test(String(instruction || '')) || selectedSectionNumbers(instruction).length ? 0.8 : 0.7;
}

/**
 * The part of an instruction the owner actually asked for. The section popup adds reference material after it (what the section shows
 * now, what was typed by hand); those words describe the page, so they must never decide what kind of change this is.
 */
const CONTEXT_MARK = /\n\n(?:SECTION CONTENT|\(The owner already typed)/;
const ownerWords = (instruction) => { const text = String(instruction || ''); const at = text.search(CONTEXT_MARK); return at >= 0 ? text.slice(0, at) : text; };

/** The section numbers the owner ticked: the panel sends 'In section 02 ("Name"), section 05 ("Name"): ...'. */
function selectedSectionNumbers(instruction) {
  const lead = String(instruction || '').match(/^In ((?:and |, )?section \d+ \("[^"]*"\)(?:,? ?(?:and )?)?)+:/i);
  return lead ? [...new Set([...lead[0].matchAll(/section (\d+) \("/gi)].map((m) => Number(m[1])))] : [];
}

/**
 * The sections the owner did NOT tick must be exactly as they were. Returns a problem for the ones that changed, or null.
 * Only checked when the page has recognisable sections (the same ones the panel lists).
 */
function untouchedSectionProblem({ baselineSource, candidateSource, numbers, page }) {
  if (!numbers.length) return null;
  const blocks = require('./templatePageService').sectionBlocks(baselineSource);
  const total = blocks.reduce((sum, block) => sum + block.numbers.length, 0);
  if (!blocks.length || numbers.some((n) => n > total)) return null;
  const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const after = squash(candidateSource);
  const changed = blocks.filter((block) => !block.numbers.some((n) => numbers.includes(n)) && !after.includes(squash(block.source)));
  if (!changed.length) return null;
  const names = changed.slice(0, 6).map((block) => `${String(block.number).padStart(2, '0')} "${block.name}"`).join(', ');
  return issue('preserve', `Section${changed.length > 1 ? 's' : ''} ${names} ${changed.length > 1 ? 'were' : 'was'} changed, but the owner selected only section${numbers.length > 1 ? 's' : ''} ${numbers.map((n) => String(n).padStart(2, '0')).join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Sections that were not ticked must stay exactly as they are.', action: `Start again from the ORIGINAL page code. Change ONLY section${numbers.length > 1 ? 's' : ''} ${numbers.map((n) => String(n).padStart(2, '0')).join(', ')}; copy every other section character for character (same JSX, same text, same images).` });
}

/**
 * Does the owner want the website itself to answer visitors with AI ("open a popup where AI generates content", "ask AI box")?
 * Then the page must call the platform's assistant (window.VEAVE_AI); a fixed written popup is not what was asked for.
 */
function wantsAiAnswers(instruction) {
  const text = ownerWords(instruction);
  if (/\b(images?|photos?|pictures?|logo|illustrations?|background)\b/i.test(text)) return false;
  // AI + something that is produced for a visitor + a place where the visitor meets it (a pop-up, a box, a button, a question).
  return /\b(ai|a\.i\.|artificial intelligence|chat ?bot|assistant|gpt|llm)\b/i.test(text) && /\b(generate[sd]?|generating|answers?|replies|reply|respond|responds?|response|explain|ask|content|tell)\b/i.test(text) && /\b(pop-?up|poopup|pop ?up|box|modal|dialog|chat|chatbot|assistant|ask|visitors?|click(?:ed|s)?|button|tab|typed?|question|questions)\b/i.test(text);
}
const callsAssistant = (files) => files.some((file) => typeof file.content === 'string' && /window\.VEAVE_AI\b|VEAVE_AI\.ask/.test(file.content) && /^src\//.test(file.path));

function checkCandidate({ baseline, candidate, scope, page, pages, template, changedPaths, attachments = [], instruction = '', siteWide = false, rewrite = false }) {
  const problems = [];
  // ai: an AI answer box must really call the assistant
  if (wantsAiAnswers(instruction) && !callsAssistant(candidate)) {
    problems.push(issue('ai', 'The page was asked to show AI-generated content, but nothing calls the website assistant, so the box would only show fixed text.', { path: page.componentPath, route: page.route, cause: 'The AI content was written into the page instead of being asked for.', action: 'Make the box call window.VEAVE_AI.ask(question, { topic }) (it returns a Promise of a plain-text answer): open the pop-up at once with a loading line, put the answer in it when the Promise resolves, and show a short written fallback if it fails. Do not write the answer text into the page.' }));
  }
  // preserve: ticked sections only
  const ticked = selectedSectionNumbers(instruction);
  if (ticked.length) {
    const text = (files) => (files.find((file) => file.path === page.componentPath) || {}).content;
    const locked = untouchedSectionProblem({ baselineSource: text(baseline), candidateSource: text(candidate), numbers: ticked, page });
    if (locked) problems.push(locked);
  }
  // preserve: the instruction may change what it names, not the rest of the page
  const keepRatio = keepRatioFor({ instruction, attachments, siteWide, rewrite });
  if (keepRatio) {
    const before = pageWords(baseline, page.componentPath);
    const after = pageWords(candidate, page.componentPath);
    if (before.set.size >= 40) {
      const kept = [...before.set].filter((word) => after.set.has(word)).length / before.set.size;
      if (kept < keepRatio) {
        problems.push(issue('preserve', `Only ${Math.round(kept * 100)}% of the page's existing wording is still there (${before.words} words before, ${after.words} now); this instruction should change only what it mentions.`, { path: page.componentPath, route: page.route, cause: 'Parts of the page the instruction did not mention were removed or rewritten.', action: 'Start again from the ORIGINAL page code. Change only the parts the instruction names; keep every other section, heading, paragraph, button, card and image exactly as it was. Use small exact "patch" edits.' }));
      }
    }
  }
  // scope: nothing outside the page was changed
  const baselinePaths = new Set(baseline.map((file) => file.path));
  for (const path of changedPaths) {
    if (scope.owned.has(path)) continue;
    if (path === 'package-lock.json') continue;
    if (!baselinePaths.has(path) && (CREATE_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.startsWith(ASSET_PREFIX))) continue;
    problems.push(issue('scope', `${path} was changed but is outside this page.`, { path, cause: 'Only the page and the files only it uses may change.', action: 'Undo that change.' }));
  }
  // asset: every photo the user attached must really be placed on this page, with its exact path
  const pageSourceText = pageDistinctness.pageSource(page.componentPath, new Map(candidate.map((file) => [file.path, file])), 2);
  for (const photo of attachments) {
    if (!pageSourceText.includes(photo.path)) {
      problems.push(issue('asset', `The photo you attached ("${photo.name}") is not used on the page.`, { path: page.componentPath, route: page.route, cause: 'The attached picture was left out.', action: `Place <img src="${photo.path}" alt="..."> where it fits the instruction.` }));
    }
  }
  // code: the build must not get worse
  for (const found of store.newProblems(baseline, candidate)) {
    problems.push(issue('code', `${found.path}: ${String(found.message).slice(0, 240)}`, { path: found.path, cause: found.category === 'import' ? 'An import does not resolve.' : 'The code does not compile.', action: 'Fix this exact error in this file.' }));
  }
  const installed = installedPackages(candidate);
  for (const [name, paths] of bareImports(candidate.filter((file) => changedPaths.includes(file.path)))) {
    if (!installed.has(name)) problems.push(issue('code', `${paths[0]} imports "${name}", which is not installed in this project.`, { path: paths[0], cause: 'Packages cannot be added by a page regeneration.', action: `Remove the use of "${name}" or replace it with plain React and Tailwind.` }));
  }
  // website: the route still renders this page's component, and the page is a real, distinct page
  const routes = pageDistinctness.extractRoutes(candidate).filter((route) => route.path === page.route);
  if (!routes.length || (routes[0].target && routes[0].target !== page.componentPath)) {
    problems.push(issue('website', `The route ${page.route} no longer renders ${page.componentPath}.`, { route: page.route, path: page.componentPath, cause: 'The page component was renamed, removed or its default export changed.', action: `Keep ${page.componentPath} with its default export.` }));
  }
  const mine = pageWords(candidate, page.componentPath);
  if (mine.words < MIN_PAGE_WORDS) problems.push(issue('website', `${page.name} has only ${mine.words} words of content; it would be nearly blank.`, { path: page.componentPath, route: page.route, cause: 'The page lost its content.', action: 'Keep or rewrite the real content of the page; do not empty it.' }));
  for (const other of pages.filter((item) => String(item._id) !== String(page._id))) {
    const theirs = pageWords(candidate, other.componentPath);
    if (mine.set.size >= MIN_PAGE_WORDS && theirs.set.size >= MIN_PAGE_WORDS && pageDistinctness.jaccard(mine.set, theirs.set) >= 0.85) {
      problems.push(issue('website', `${page.name} now repeats the content of ${other.name} (${Math.round(pageDistinctness.jaccard(mine.set, theirs.set) * 100)}% the same text).`, { path: page.componentPath, route: page.route, cause: 'The page was copied from another page.', action: `Write content that fits the "${page.name}" page and is different from "${other.name}".` }));
    }
  }
  // regression: locked and shared files are exactly as the template defines them / as they were
  for (const locked of template?.scaffold?.protectedFiles || []) {
    if (locked === 'package.json' || scope.owned.has(locked)) continue;
    const before = baseline.find((file) => file.path === locked);
    const after = candidate.find((file) => file.path === locked);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `${locked} is locked and was changed.`, { path: locked, cause: 'Locked files are part of the template.', action: 'Leave it unchanged.' }));
  }
  for (const sharedPath of template?.scaffold?.sharedFiles || []) {
    if (scope.owned.has(sharedPath)) continue;
    const before = baseline.find((file) => file.path === sharedPath);
    const after = candidate.find((file) => file.path === sharedPath);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `The shared file ${sharedPath} was changed.`, { path: sharedPath, cause: 'Shared components are used by every page.', action: 'Leave it unchanged.' }));
  }
  const unchangedPages = pages.filter((item) => String(item._id) !== String(page._id));
  for (const other of unchangedPages) {
    const before = baseline.find((file) => file.path === other.componentPath);
    const after = candidate.find((file) => file.path === other.componentPath);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `The ${other.name} page (${other.componentPath}) was changed.`, { path: other.componentPath, route: other.route, cause: 'A regeneration may only change its own page.', action: 'Undo that change.' }));
  }
  return problems;
}

/** Remote image links in the changed files that could not be downloaded become asset problems. */
function imageProblems(failed = [], spare = []) {
  return failed.map((item) => issue('asset', `The image ${item.url} could not be downloaded (${item.reason || 'unreachable'}).`, {
    cause: 'The link is dead or not a public image.',
    action: spare.length ? `Use one of these verified pictures instead: ${spare.slice(0, 4).map((asset) => asset.url).join(', ')}.` : 'Use a different real, public image link, or remove that image.'
  }));
}

/* ------------------------------------------------ build + browser gate ------------------------------------------------ */

const PLAN_PATH = 'veave.validation.json';

/**
 * The production build and a browser test of every route, through the shared gate. `repair(files, diagnostics, history)` is the
 * page-scoped repair (it may only change this page's files). Returns { files, report }; throws a PipelineError when it still fails.
 */
async function runBuildGate(files, { routes, signal, onProgress, repair, maxRepairs }) {
  const { validateAndRepair } = require('../ai/validationGate');
  const { executeProject, isDockerAvailable } = require('../ai/executionRunner');
  const { verifyPreviewRuntime } = require('../ai/targetRenderVerifier');
  let useDocker;
  if (process.env.ENABLE_DOCKER_VALIDATION === 'true') useDocker = true;
  else if (process.env.ENABLE_DOCKER_VALIDATION === 'false') useDocker = false;
  else useDocker = await isDockerAvailable();
  const tests = routes.map((path) => ({ name: `Route ${path}`, path, viewports: ['desktop', 'mobile'], steps: [{ action: 'assert', selector: '#root', visible: true }] }));
  const withPlan = tests.length ? [...files.filter((file) => file.path !== PLAN_PATH), { path: PLAN_PATH, language: 'json', content: JSON.stringify({ version: 1, tests }, null, 2) }] : files;
  const validated = await validateAndRepair(withPlan, {
    signal, onProgress, repair, requireExecution: true, requireArtifacts: useDocker,
    maxRepairs: maxRepairs ?? (Number.parseInt(process.env.TEMPLATE_BUILD_REPAIRS, 10) || 3),
    run: useDocker
      ? async (current, options) => {
          const outcome = await executeProject(current, options);
          if (outcome?.infrastructure) {
            const local = await verifyPreviewRuntime(current, options);
            return { ...local, degradedExecution: true, infrastructure: outcome.diagnostics, checks: [{ name: 'build', status: 'skipped', reason: 'Isolated build runner unavailable; only the local browser runtime check ran.' }, ...(local.checks || [])] };
          }
          return outcome;
        }
      : (current, options) => verifyPreviewRuntime(current, options)
  });
  validated.report.validationMode = useDocker && validated.report.validationMode !== 'local-browser-fallback' ? 'docker-build' : 'local-browser-fallback';
  return { files: validated.files.filter((file) => file.path !== PLAN_PATH), report: validated.report };
}

/**
 * Checks the whole website once every page has been written. It never regenerates anything: it only reports which pages need a look.
 * Returns [{ pageId, message }] (a page may appear more than once).
 *   - the page's component file exists and its route is registered in the router
 *   - internal links on the page point at routes that exist
 *   - pictures the page shows (/assets/...) exist in the site
 */
function finalSiteChecks(files, pages) {
  const found = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const routes = pageDistinctness.extractRoutes(files);
  const known = new Set(routes.map((route) => route.path));
  known.add('/');
  for (const page of pages) {
    const file = byPath.get(page.componentPath);
    if (!file) { found.push({ pageId: String(page._id), message: `The page file ${page.componentPath} is missing.` }); continue; }
    if (!routes.some((route) => route.path === page.route && (!route.target || route.target === page.componentPath))) found.push({ pageId: String(page._id), message: `The route ${page.route} does not show this page.` });
    const source = pageDistinctness.pageSource(page.componentPath, byPath, 2);
    const seen = new Set();
    for (const match of source.matchAll(/\b(?:to|href)=["'](\/[^"'#?\s]*)["']/g)) {
      const target = match[1].replace(/\/+$/, '') || '/';
      if (seen.has(target) || /\.[a-z0-9]{2,5}$/i.test(target)) continue;
      seen.add(target);
      if (!known.has(target)) found.push({ pageId: String(page._id), message: `A link goes to ${target}, which is not a page of this website.` });
    }
    for (const match of source.matchAll(/(?:\bsrc=|\bimage\s*:\s*)["'](\/(?:assets|images)\/[^"']+)["']/g)) {
      if (!byPath.has(`public${match[1]}`) && !byPath.has(match[1].slice(1))) found.push({ pageId: String(page._id), message: `The picture ${match[1]} is not in the site.` });
    }
  }
  return found;
}

module.exports = { finalSiteChecks, pageScope, wantsSiteWide, ownerWords, filterOperations, checkCandidate, wantsAiAnswers, selectedSectionNumbers, untouchedSectionProblem, isPictureOnlyEdit, keepRatioFor, imageProblems, runBuildGate, pageWords, issue, sha, MIN_PAGE_WORDS };
