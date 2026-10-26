// Completeness checks for NEW websites, against what a site must contain regardless of whether it builds:
// a working navigation, several linked pages, real page length, a footer and (when a reference site set the look)
// a page background that matches it. The build/browser gate cannot see any of this: a single-page, navigation-less,
// dark stub passes it. Issues are phrased as instructions so they can be handed straight to the repair model.
const SOURCE = /\.(?:jsx?|tsx?)$/i;
const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const IMPORT_RE = /import\s+(?:[\w*${},\s]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;
const EXT = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js', '/index.tsx', '/index.ts'];

// Requests that legitimately are one screen: do not demand extra pages for them.
const SINGLE_SCREEN_REQUEST = /\b(single[- ]page|one[- ]page|landing page|one[- ]pager|widget|component|calculator|form|login page|sign[- ]?in page|dashboard|admin panel|game|todo|to-do)\b/i;

function resolveImport(from, spec, byPath) {
  const parts = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  const base = parts.join('/');
  return EXT.map((ext) => base + ext).find((candidate) => byPath.has(candidate)) || null;
}

function localImports(file, byPath) {
  return [...textOf(file).matchAll(IMPORT_RE)].map((match) => resolveImport(file.path, match[1], byPath)).filter(Boolean);
}

function reachable(entry, byPath, depth = 2) {
  const seen = new Set([entry.path]);
  let frontier = [entry];
  for (let level = 0; level < depth; level++) {
    const next = [];
    for (const file of frontier) {
      for (const path of localImports(file, byPath)) {
        if (!seen.has(path) && SOURCE.test(path)) { seen.add(path); next.push(byPath.get(path)); }
      }
    }
    frontier = next;
  }
  return [...seen].map((path) => byPath.get(path));
}

function visibleWords(source) {
  const jsxText = [...source.matchAll(/>([^<>{}]{3,})</g)].map((match) => match[1]);
  const strings = [...source.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){20,})\1/g)].map((match) => match[2]).filter((value) => /\s/.test(value) && !/^[\w./:#@-]+$/.test(value));
  return [...jsxText, ...strings].join(' ').split(/\s+/).filter((word) => /[a-z]{2,}/i.test(word)).length;
}

function luminance(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * @param {Array<{path:string,content:string}>} files
 * @param {{prompt?:string, spec?:{pages?:Array}, prototypeBg?:string|null}} context
 * @returns {Array<{category:'completeness', path:string, message:string, kind:string}>}
 */
function checkCompleteness(files, { prompt = '', spec = null, prototypeBg = null } = {}) {
  const issues = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const app = byPath.get('src/App.jsx') || byPath.get('src/App.tsx') || byPath.get('src/App.js');
  if (!app) return issues; // the static gate already reports a missing App
  const add = (kind, message, path = app.path) => issues.push({ category: 'completeness', kind, path, message });
  const singleScreen = SINGLE_SCREEN_REQUEST.test(prompt) && !/\b(website|web ?site|multi[- ]?page)\b/i.test(prompt);

  const tree = reachable(app, byPath, 3);
  const treeSource = tree.map(textOf).join('\n');

  // 1. Navigation that is really rendered and links somewhere.
  const navFiles = tree.filter((file) => file.path !== app.path && /(?:nav|header|menu|topbar)/i.test(file.path.split('/').pop()));
  const rendersNav = /<nav[\s>]/i.test(treeSource) || navFiles.length > 0;
  const linkCount = (treeSource.match(/<(?:Link|NavLink|a)\b[^>]*\b(?:to|href)\s*=/g) || []).length;
  const navButtons = (treeSource.match(/onClick\s*=\s*\{[^}]*(?:setPage|setActive|setView|setRoute|setTab|navigate)/g) || []).length;
  if (!rendersNav) {
    add('navigation', 'The site has no navigation bar. Create src/components/Navbar.jsx (brand on the left, links to every page, a mobile menu button) and render it at the top of the app on every page.');
  } else if (linkCount + navButtons < 3) {
    add('navigation', 'The navigation bar has fewer than 3 working links. Give it a link (react-router <Link to="/path"> or <NavLink>) to every page of the site.');
  }

  // 2. Several real pages, unless the request is genuinely one screen.
  const routePaths = new Set([...treeSource.matchAll(/<Route\b[^>]*\bpath\s*=\s*["'{`]+([^"'`}]*)/g)].map((match) => match[1]));
  const pageFiles = tree.filter((file) => /(?:^|\/)(?:pages?|views?|screens?|routes?)\//.test(file.path));
  const pageCount = Math.max(routePaths.size, pageFiles.length, 1);
  const wanted = Array.isArray(spec?.pages) ? spec.pages.filter((page) => page?.route).length : 0;
  const minimumPages = singleScreen ? 1 : Math.min(Math.max(wanted || 4, 3), 6);
  if (pageCount < minimumPages) {
    const planned = Array.isArray(spec?.pages) && spec.pages.length
      ? ` The plan lists these pages: ${spec.pages.map((page) => `${page.name} (${page.route})`).join(', ')}.`
      : '';
    add('pages', `The site has ${pageCount || 1} page(s) but needs at least ${minimumPages}.${planned} Create one component per page in src/pages/, register each with <Route path="..."> inside a <BrowserRouter><Routes> in src/App.jsx (react-router-dom), and link them all from the navigation bar and footer.`);
  }
  if (!singleScreen && pageCount >= 2 && !/react-router-dom/.test(treeSource) && !/\buseState\b/.test(textOf(app))) {
    add('routing', 'The pages are not routed. Use react-router-dom (BrowserRouter, Routes, Route) in src/App.jsx so each page has its own URL.');
  }

  // 3. Page length: the home page and the components it is made of.
  const home = (() => {
    const routedHome = pageFiles.find((file) => /(?:^|\/)(?:home|index|landing|main|overview)\w*\.(?:jsx?|tsx?)$/i.test(file.path));
    return routedHome || (pageFiles[0]) || app;
  })();
  const homeTree = reachable(home, byPath, 2);
  const homeSource = homeTree.map(textOf).join('\n');
  const sections = (homeSource.match(/<section\b/gi) || []).length;
  const words = visibleWords(homeSource);
  const minimumSections = singleScreen ? 4 : 6;
  if (sections < minimumSections || words < (singleScreen ? 150 : 350)) {
    add('length', `The home page is too short (${sections} section(s), about ${words} words). Make it a full-length page with at least ${minimumSections} distinct <section> blocks (hero, key features, detailed content, statistics or timeline, testimonials or highlights, call to action) and real, specific copy of at least ${singleScreen ? 150 : 350} words. No placeholders.`, home.path);
  }

  // 4. Footer.
  if (!/<footer[\s>]/i.test(treeSource)) add('footer', 'The site has no footer. Add a footer with the brand, links to every page and contact details, rendered on every page.');

  // 5. The look of a reference website: do not hard-code the opposite theme over the reference's background.
  const bgLum = luminance(prototypeBg);
  if (bgLum !== null) {
    const hardDark = /className\s*=\s*["'`][^"'`]*\bbg-(?:black|slate-9\d\d|zinc-9\d\d|gray-9\d\d|neutral-9\d\d|stone-9\d\d)\b/;
    const rootSource = textOf(app);
    if (bgLum > 0.7 && hardDark.test(rootSource)) {
      add('theme', `The reference website has a light page background (${prototypeBg}) but src/App.jsx forces a dark one. Remove the dark background classes from the app wrapper and use the reference palette (bg-proto-bg, text-proto-text, text-proto-primary) for the page; use dark sections only where the reference does.`);
    }
  }
  return issues;
}

module.exports = { checkCompleteness, SINGLE_SCREEN_REQUEST, visibleWords };
