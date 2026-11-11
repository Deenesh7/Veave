/**
 * Multi-page distinctness checks for generated websites.
 *
 * A multi-page site is only correct when every route has its own page component AND that page has its own content. The
 * failures this finds are the ones that build, render and pass a "does it show something" smoke test:
 *   - several routes registered to the same component (with the same props), so every URL shows the same page,
 *   - separate page files whose text is (almost) the same, copied from Home,
 *   - a page that is a stub with hardly any content of its own,
 *   - navigation links that point at a URL the router does not know (they land on Home or a 404).
 *
 * Nothing here knows any page or site name: routes, labels and purposes come from the generated project itself.
 */

const SOURCE = /\.(?:jsx?|tsx?)$/i;
const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const CHROME = /(?:^|\/)(?:navbar|nav|header|footer|layout|menu|sidebar|topbar|scrolltotop|seo|helmet|toaster|cookie)[^/]*\.(?:jsx?|tsx?)$/i;
const EXT = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js', '/index.tsx', '/index.ts'];

function resolveImport(from, spec, byPath) {
  if (!spec.startsWith('.')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  const base = parts.join('/');
  return EXT.map((ext) => base + ext).find((candidate) => byPath.has(candidate)) || null;
}

/** name -> file path for default/named/lazy imports of local files. */
function importMap(file, byPath) {
  const map = new Map();
  const source = textOf(file);
  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]/g)) {
    const target = resolveImport(file.path, match[2], byPath);
    if (target) map.set(match[1], target);
  }
  for (const match of source.matchAll(/import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveImport(file.path, match[2], byPath);
    if (!target) continue;
    for (const part of match[1].split(',')) {
      const [original, alias] = part.trim().split(/\s+as\s+/);
      if (original) map.set((alias || original).trim(), target);
    }
  }
  for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = resolveImport(file.path, match[2], byPath);
    if (target) map.set(match[1], target);
  }
  return map;
}

/** The end index of a JSX opening tag that starts at `start` (handles `=>` and braces inside attributes). */
function tagEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (ch === quote && source[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0 && source[i - 1] !== '=') return i;
  }
  return -1;
}

const normalizeRoute = (value) => (String(value).split(/[?#]/)[0].replace(/\/+$/, '') || '/');

/**
 * Every route the project registers, whatever the routing style: <Route> elements, route objects (createBrowserRouter),
 * lookup tables and switch cases keyed by path.
 * @returns {Array<{path:string, component:string|null, element:string, file:string}>}
 */
function extractRoutes(files = []) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const routes = [];
  const add = (route) => { if (route.path && !routes.some((item) => item.path === route.path && item.file === route.file)) routes.push(route); };
  for (const file of files.filter((item) => SOURCE.test(item.path) && /^src\//.test(item.path))) {
    const source = textOf(file);
    const imports = importMap(file, byPath);
    const resolve = (name) => (name ? imports.get(name) || (new RegExp(`(?:function|const|class)\\s+${name}\\b`).test(source) ? file.path : null) : null);

    for (const match of source.matchAll(/<Route\b/g)) {
      const end = tagEnd(source, match.index);
      if (end < 0) continue;
      const tag = source.slice(match.index, end + 1);
      const isIndex = /\bindex\b(?!\s*=\s*\{?\s*false)/.test(tag) && !/\bpath\s*=/.test(tag);
      const pathMatch = /\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/.exec(tag);
      let element = (/\belement\s*=\s*\{\s*(<[\s\S]*?\/>|<[A-Za-z][\s\S]*?<\/[A-Za-z.]+>)\s*\}/.exec(tag) || [])[1] || '';
      let name = (/\belement\s*=\s*\{\s*<\s*([A-Z][\w.]*)/.exec(tag) || /\b(?:component|Component)\s*=\s*\{\s*([A-Z][\w.]*)/.exec(tag) || [])[1] || null;
      if (!name && !tag.endsWith('/>')) {
        const child = /^\s*<\s*([A-Z][\w.]*)/.exec(source.slice(end + 1));
        if (child) { name = child[1]; element = source.slice(end + 1, end + 200).split(/<\/Route>/)[0]; }
      }
      const routePath = isIndex ? '/' : (pathMatch ? pathMatch[1] : null);
      if (routePath === null) continue;
      add({ path: routePath.startsWith('/') ? normalizeRoute(routePath) : routePath, component: name, element: element.replace(/\s+/g, ' ').trim(), file: file.path, target: resolve(name) });
    }
    for (const match of source.matchAll(/\bpath\s*:\s*['"`]([^'"`]*)['"`]\s*,\s*(?:element|component|Component)\s*:\s*(?:<\s*)?([A-Z][\w.]*)([^,}\n]*)/g)) {
      add({ path: match[1].startsWith('/') ? normalizeRoute(match[1]) : match[1], component: match[2], element: `${match[2]}${match[3]}`.replace(/\s+/g, ' ').trim(), file: file.path, target: resolve(match[2]) });
    }
    for (const match of source.matchAll(/(?:element|component|Component)\s*:\s*(?:<\s*)?([A-Z][\w.]*)([^,}\n]*)\s*,\s*path\s*:\s*['"`]([^'"`]*)['"`]/g)) {
      add({ path: match[3].startsWith('/') ? normalizeRoute(match[3]) : match[3], component: match[1], element: `${match[1]}${match[2]}`.replace(/\s+/g, ' ').trim(), file: file.path, target: resolve(match[1]) });
    }
    for (const match of source.matchAll(/(?:^|[\s{,])['"`](\/[A-Za-z0-9_\-/]*)['"`]\s*:\s*(?:\(\s*\)\s*=>\s*\(?\s*)?<?\s*([A-Z][\w]*)([^,}\n]*)/g)) {
      add({ path: normalizeRoute(match[1]), component: match[2], element: `${match[2]}${match[3]}`.replace(/\s+/g, ' ').trim(), file: file.path, target: resolve(match[2]) });
    }
    for (const match of source.matchAll(/case\s+['"`](\/[A-Za-z0-9_\-/]*)['"`]\s*:\s*return\s*\(?\s*<\s*([A-Z][\w]*)([^>]*)/g)) {
      add({ path: normalizeRoute(match[1]), component: match[2], element: `${match[2]}${match[3]}`.replace(/\s+/g, ' ').trim(), file: file.path, target: resolve(match[2]) });
    }
  }
  return routes;
}

const humanize = (route) => {
  const last = String(route).split('/').filter(Boolean).pop() || 'home';
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/** Navigation labels: route -> link text, from <Link to="/x">Label</Link> and <a href="/x">Label</a>. */
function navLabels(files = []) {
  const labels = new Map();
  const links = [];
  for (const file of files.filter((item) => SOURCE.test(item.path) && /^src\//.test(item.path))) {
    const source = textOf(file);
    for (const match of source.matchAll(/<(?:Link|NavLink|a)\b[^>]*?\b(?:to|href)\s*=\s*(?:\{\s*)?["'`](\/[^"'`#?]*)["'`][^>]*>([^<>{}]{2,40})</g)) {
      const route = normalizeRoute(match[1]);
      if (!labels.has(route)) labels.set(route, match[2].replace(/\s+/g, ' ').trim());
    }
    for (const match of source.matchAll(/<(?:Link|NavLink|a)\b[^>]*?\b(?:to|href)\s*=\s*(?:\{\s*)?["'`](\/[^"'`#?]*)["'`]/g)) links.push({ route: normalizeRoute(match[1]), file: file.path });
    // data-driven menus: { label: 'Story', path: '/story' } / { name: 'Story', to: '/story' }
    for (const match of source.matchAll(/\b(?:label|name|title|text)\s*:\s*['"`]([^'"`]{2,40})['"`]\s*,\s*(?:path|to|href|link|route)\s*:\s*['"`](\/[^'"`#?]*)['"`]/g)) {
      const route = normalizeRoute(match[2]);
      if (!labels.has(route)) labels.set(route, match[1].trim());
      links.push({ route, file: file.path });
    }
    for (const match of source.matchAll(/\b(?:path|to|href|link|route)\s*:\s*['"`](\/[^'"`#?]*)['"`]\s*,\s*(?:label|name|title|text)\s*:\s*['"`]([^'"`]{2,40})['"`]/g)) {
      const route = normalizeRoute(match[1]);
      if (!labels.has(route)) labels.set(route, match[2].trim());
      links.push({ route, file: file.path });
    }
  }
  return { labels, links };
}

function visibleText(source) {
  const jsxText = [...source.matchAll(/>([^<>{}]{3,})</g)].map((match) => match[1]);
  const strings = [...source.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)].map((match) => match[2]).filter((value) => /\s/.test(value) && !/^[\w./:#@\-\s]*(?:className|px-|py-|flex|grid|text-|bg-)[\w./:#@\-\s]*$/.test(value) && !/^[\w./:#@-]+$/.test(value));
  return [...jsxText, ...strings].join(' ');
}

const wordsOf = (text) => new Set(String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 2));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** The page's own text: its file plus the local components it renders, minus the shared site chrome. */
function pageSource(filePath, byPath, depth = 2) {
  const seen = new Set([filePath]);
  let frontier = [filePath];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const current of frontier) {
      const file = byPath.get(current);
      if (!file) continue;
      for (const target of importMap(file, byPath).values()) {
        if (seen.has(target) || CHROME.test(target) || !SOURCE.test(target) || /\/(?:data|content|constants?|hooks?|utils?|lib|services?)\//i.test(target) && !/\/pages?\//i.test(target)) continue;
        seen.add(target);
        next.push(target);
      }
    }
    frontier = next;
  }
  return [...seen].map((path) => textOf(byPath.get(path))).join('\n');
}

/** Local files a component renders or imports, `depth` levels deep (the component itself first). */
function reachableFiles(filePath, byPath, depth = 2) {
  const seen = new Set([filePath]);
  let frontier = [filePath];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const current of frontier) {
      const file = byPath.get(current);
      if (!file) continue;
      for (const target of importMap(file, byPath).values()) {
        if (!seen.has(target) && SOURCE.test(target)) { seen.add(target); next.push(target); }
      }
    }
    frontier = next;
  }
  return [...seen];
}

const isDynamic = (route) => /[:*]/.test(route);

/**
 * @returns {Array<{category:'completeness', kind:string, path:string, message:string, routes?:string[]}>}
 * Kinds: page-shared-component and page-duplicate-content are blocking; page-thin and page-nav-broken are repaired when
 * possible and otherwise only reported.
 */
function findPageIssues(files = [], { spec = null } = {}) {
  const issues = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const all = extractRoutes(files).filter((route) => route.path.startsWith('/'));
  const routes = all.filter((route) => !isDynamic(route.path));
  const { labels, links } = navLabels(files);
  const labelOf = (route) => {
    const planned = Array.isArray(spec?.pages) ? spec.pages.find((page) => page?.route && normalizeRoute(page.route) === route) : null;
    return planned?.name || labels.get(route) || humanize(route);
  };
  const purposeOf = (route) => {
    const planned = Array.isArray(spec?.pages) ? spec.pages.find((page) => page?.route && normalizeRoute(page.route) === route) : null;
    return planned?.purpose || planned?.description || '';
  };
  const add = (kind, path, message, extra = {}) => issues.push({ category: 'completeness', kind, path, message, ...extra });
  if (routes.length < 2) return issues;
  const app = files.find((file) => /^src\/App\.(?:jsx?|tsx?)$/i.test(file.path));

  // 1. Several routes -> one component with the same props.
  const byElement = new Map();
  for (const route of routes) {
    if (!route.target) continue;
    const key = `${route.target}|${route.element.replace(/\s+/g, '')}`;
    (byElement.get(key) || byElement.set(key, []).get(key)).push(route);
  }
  const sharedHandled = new Set();
  for (const group of byElement.values()) {
    const distinct = [...new Map(group.map((route) => [route.path, route])).values()];
    if (distinct.length < 2) continue;
    distinct.forEach((route) => sharedHandled.add(route.path));
    const names = distinct.map((route) => `${labelOf(route.path)} (${route.path})`).join(', ');
    add('page-shared-component', distinct[0].file || app?.path, `The routes ${names} all render the same component ${distinct[0].component} (${distinct[0].target}), so every one of those URLs shows identical content. Give each route its OWN page component in src/pages/ with content written for that page's purpose (derived from its name and the site's subject), and register each route to its own component. Keep the shared Navbar and Footer, and keep the same design system.`, { routes: distinct.map((route) => route.path) });
  }

  // 2. Separate page files with (almost) the same text.
  const pages = [];
  for (const route of routes) {
    if (!route.target || sharedHandled.has(route.path) || pages.some((page) => page.target === route.target)) continue;
    const text = visibleText(pageSource(route.target, byPath));
    pages.push({ route: route.path, target: route.target, words: wordsOf(text), wordCount: text.split(/\s+/).filter((word) => /[a-z]{2,}/i.test(word)).length });
  }
  const duplicated = new Set();
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      const a = pages[i];
      const b = pages[j];
      if (duplicated.has(b.route) || a.words.size < 25 || b.words.size < 25) continue;
      const alike = jaccard(a.words, b.words);
      if (alike >= 0.85) {
        duplicated.add(b.route);
        const purpose = purposeOf(b.route);
        add('page-duplicate-content', b.target, `${labelOf(b.route)} (${b.route}, ${b.target}) repeats the content of ${labelOf(a.route)} (${a.route}, ${a.target}) (${Math.round(alike * 100)}% the same text). Rewrite ${b.target} completely as the ${labelOf(b.route)} page${purpose ? `: ${purpose}` : ''}: its own heading, its own sections for what a "${labelOf(b.route)}" page of this website should contain, its own copy and its own images. Do not copy sections from ${a.target}. Keep the shared Navbar, Footer and design system.`, { routes: [a.route, b.route] });
      }
    }
  }

  // 3. A page with next to no content of its own.
  for (const page of pages) {
    if (page.route === '/' || duplicated.has(page.route) || page.wordCount >= 60) continue;
    const purpose = purposeOf(page.route);
    add('page-thin', page.target, `${labelOf(page.route)} (${page.route}, ${page.target}) has only about ${page.wordCount} words of its own. Build it out as a complete ${labelOf(page.route)} page${purpose ? `: ${purpose}` : ''} with at least 3 distinct <section> blocks of real, specific content that fit this website's subject.`, { routes: [page.route] });
  }

  // 4. Navigation to a URL the router does not know.
  const patterns = all.map((route) => new RegExp(`^${route.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]\w*/g, '[^/]+').replace(/\*/g, '.*')}$`));
  const hasWildcard = all.some((route) => route.path === '/*' || route.path === '*');
  const reported = new Set();
  for (const link of links) {
    if (link.route === '/' || /\.[a-z0-9]{2,5}$/i.test(link.route) || reported.has(link.route)) continue;
    if (patterns.some((pattern) => pattern.test(link.route))) continue;
    if (hasWildcard && all.some((route) => route.path === '/*' && route.target && /(?:notfound|404|missing)/i.test(route.target))) { /* a real not-found page still means the link is broken */ }
    reported.add(link.route);
    add('page-nav-broken', app?.path || link.file, `The navigation links to ${link.route} (${labelOf(link.route)}) but no route is registered for it, so the link lands on the wrong page. Create src/pages/${humanize(link.route).replace(/\s+/g, '')}.jsx with content for the "${labelOf(link.route)}" page and register <Route path="${link.route}" element={<.../>}> in src/App.jsx, or point the link at an existing page.`, { routes: [link.route] });
  }
  return issues;
}

/** Issues a finished site must not keep: it would show one page under several URLs. */
const BLOCKING_KINDS = new Set(['page-shared-component', 'page-duplicate-content', 'page-rendered-duplicate']);

module.exports = { reachableFiles, extractRoutes, navLabels, findPageIssues, BLOCKING_KINDS, humanize, jaccard, visibleText, pageSource };
