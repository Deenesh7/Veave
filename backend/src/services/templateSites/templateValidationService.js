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
function pageScope({ files, page, pages, template }) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const locked = new Set([...(template?.scaffold?.sharedFiles || []), ...(template?.scaffold?.protectedFiles || []), ...(template?.scaffold?.requiredFiles || []), 'src/App.jsx', 'src/main.jsx', 'src/data/site.js', 'src/index.css', 'package.json', 'index.html']);
  const usedElsewhere = new Set();
  for (const other of pages.filter((item) => String(item._id) !== String(page._id))) {
    for (const path of pageDistinctness.reachableFiles(other.componentPath, byPath, 2)) usedElsewhere.add(path);
  }
  const reachable = pageDistinctness.reachableFiles(page.componentPath, byPath, 2).filter((path) => byPath.has(path) && SOURCE.test(path));
  const owned = reachable.filter((path) => path === page.componentPath || (!locked.has(path) && !usedElsewhere.has(path) && path.startsWith('src/')));
  const shared = reachable.filter((path) => !owned.includes(path));
  return { owned: new Set(owned), ownedList: owned, sharedList: shared, locked, canCreate: (path) => CREATE_PREFIXES.some((prefix) => path.startsWith(prefix)) && !byPath.has(path) && SOURCE.test(path) };
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
function checkCandidate({ baseline, candidate, scope, page, pages, template, changedPaths, attachments = [] }) {
  const problems = [];
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
    if (locked === 'package.json') continue;
    const before = baseline.find((file) => file.path === locked);
    const after = candidate.find((file) => file.path === locked);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `${locked} is locked and was changed.`, { path: locked, cause: 'Locked files are part of the template.', action: 'Leave it unchanged.' }));
  }
  for (const sharedPath of template?.scaffold?.sharedFiles || []) {
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

module.exports = { finalSiteChecks, pageScope, filterOperations, checkCandidate, imageProblems, runBuildGate, pageWords, issue, sha, MIN_PAGE_WORDS };
