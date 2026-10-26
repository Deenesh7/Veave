// Every captured route must end up in the clone, registered and visibly rendered. Guard rails may refuse the AI's
// version of a page (syntax error, failed render checks, timeouts), but they must never leave the route missing or blank.
// This module turns such routes into pages built deterministically from the captured source (its sanitized, localized
// HTML) and registers them in App.jsx, and reports exactly which pages were rebuilt and why.
const path = require('node:path');
const {
  isBlankRoute, findRouteComponentPath, sanitizeCapturedHtml, FALLBACK_CSS, stripTags, capturedTextLength
} = require('./blankPageFallback');
const capturedCss = require('../clone/capturedCss');

const SITE_CSS_PATH = 'src/styles/captured-site.css';
// With the site's own stylesheet the page needs no layout of its own; without it, a readable column is the best we can do.
// The project's Tailwind "preflight" resets browser defaults (box-sizing, heading sizes, list styles, margins, image display, link
// colours ...). A captured page was written against the browser's own defaults, so inside the rebuilt page they are restored
// with `revert`. Specificity (0,1,x) beats preflight's but loses to the site's own scoped rules, which come later.
const RESTORE_BROWSER_DEFAULTS = `
.veave-fallback { font-family: initial; line-height: normal; font-size: 16px; -webkit-text-size-adjust: auto; }
.veave-fallback *, .veave-fallback *::before, .veave-fallback *::after { box-sizing: revert; border-color: currentColor; }
.veave-fallback blockquote, .veave-fallback dl, .veave-fallback dd, .veave-fallback h1, .veave-fallback h2, .veave-fallback h3, .veave-fallback h4, .veave-fallback h5, .veave-fallback h6, .veave-fallback hr, .veave-fallback figure, .veave-fallback p, .veave-fallback pre { margin: revert; }
.veave-fallback h1, .veave-fallback h2, .veave-fallback h3, .veave-fallback h4, .veave-fallback h5, .veave-fallback h6 { font-size: revert; font-weight: revert; }
.veave-fallback ol, .veave-fallback ul, .veave-fallback menu { list-style: revert; margin: revert; padding: revert; }
.veave-fallback a { color: revert; text-decoration: revert; }
.veave-fallback img, .veave-fallback svg, .veave-fallback video, .veave-fallback canvas, .veave-fallback audio, .veave-fallback iframe, .veave-fallback embed, .veave-fallback object { display: revert; vertical-align: revert; }
.veave-fallback table { border-collapse: revert; text-indent: revert; }
.veave-fallback button, .veave-fallback input, .veave-fallback optgroup, .veave-fallback select, .veave-fallback textarea { font: revert; color: revert; margin: revert; padding: revert; letter-spacing: revert; }
`;
const STYLED_BASE_CSS = `\n/* Rebuilt pages use the site's own CSS (src/styles/captured-site.css) */${RESTORE_BROWSER_DEFAULTS}.veave-fallback { overflow-wrap: anywhere; position: relative; isolation: isolate; }\n.veave-fallback img, .veave-fallback video { max-width: 100%; }\n`;

// <html class="..."> and <body class="..."> carry state the site's CSS keys on (body.home, html.js ...). They live on the wrapper.
function rootClasses(html) {
  const classes = [];
  for (const tag of ['html', 'body']) {
    const match = String(html).match(new RegExp(`<${tag}\\b[^>]*?\\bclass=["']([^"']*)["']`, 'i'));
    if (match) classes.push(...match[1].split(/\s+/).filter((name) => /^[\w-]+$/.test(name)));
  }
  return [...new Set(classes)].slice(0, 60).join(' ');
}

function buildComponent(html, { wrapperClass = '', cssImport = null } = {}) {
  return `// Rebuilt from the captured source page because the generated version could not be used.\n${cssImport ? `import '${cssImport}';\n` : ''}const html = ${JSON.stringify(html)};\n\nexport default function CapturedPage() {\n  return <section className=${JSON.stringify(`veave-fallback ${wrapperClass}`.trim())} dangerouslySetInnerHTML={{ __html: html }} />;\n}\n`;
}

const MIN_VISIBLE_TEXT = 80;
// Text that deterministic stand-ins (auto-created modules, quarantined broken components) render.
const PLACEHOLDER_MARKERS = [/This section is being prepared/i, /VeaveRemovedSection/];

/** True when the route's component, or a module it imports directly, is only a placeholder. */
function usesPlaceholder(files, componentPath) {
  if (!componentPath) return false;
  const aiProtocol = require('./aiProtocol');
  const paths = [componentPath, ...aiProtocol.relatedRepairPaths(files, new Set([componentPath]), { maxImports: 30, maxImporters: 0 })];
  return paths.some((filePath) => {
    const file = files.find((item) => item.path === filePath);
    return file && file.encoding !== 'base64' && PLACEHOLDER_MARKERS.some((marker) => marker.test(String(file.content || '')));
  });
}

function pascal(routePath) {
  const words = String(routePath).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('') || 'Home';
  return /^[0-9]/.test(name) ? `Page${name}` : name;
}

const isAppFile = (file) => /^src\/App\.(?:jsx?|tsx?)$/i.test(file.path || '');

function registrationStyle(source, routePath) {
  const quoted = new RegExp(`['"\`]${routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}['"\`]`);
  return { registered: quoted.test(source) };
}

/** Adds `import Name from path` after the last import line. */
function addImport(source, name, importPath) {
  // Never declare the same identifier twice (a duplicate import is a syntax error that breaks every page).
  if (new RegExp(`^import\\s+${name}\\s*(?:,|from)`, 'm').test(source) || new RegExp(`^import\\s+[^;\\n]*\\b${name}\\b[^;\\n]*from\\s+['"][^'"]+['"]`, 'm').test(source)) return source;
  const line = `import ${name} from '${importPath}';`;
  const imports = [...source.matchAll(/^import[^\n]*\n/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports.at(-1);
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}${line}\n${source.slice(at)}`;
}


/** Finds `<Route path="X" ... />` (attributes may contain JSX, so braces and quotes are tracked). */
function findSelfClosingRoute(source, routePath) {
  const opener = new RegExp(`<Route\\b(?=[^]*?\\bpath\\s*=\\s*["'\`]${routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}["'\`])`, 'g');
  for (const match of source.matchAll(opener)) {
    let depth = 0;
    let quote = null;
    for (let i = match.index + 6; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) { if (ch === quote && source[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (depth === 0 && ch === '/' && source[i + 1] === '>') {
        const span = { start: match.index, end: i + 2 };
        // the path attribute must belong to THIS tag, not to a later Route
        if (new RegExp(`\\bpath\\s*=\\s*["'\`]${routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}["'\`]`).test(source.slice(span.start, span.end))) return span;
        break;
      } else if (depth === 0 && ch === '>') break; // not self-closing
    }
  }
  return null;
}


/**
 * Replaces the VALUE of a route-table entry ('/x': <anything>) with `name`, whatever the value is (a component name, an
 * arrow function with props, JSX with commas in its props...). The value ends at the first comma/closing brace that is
 * not nested in brackets, braces, parentheses or strings. Returns the new source, or null when there is no such entry.
 * A table that kept an old entry AFTER a newly inserted one would silently ignore the new component (the last duplicate
 * key wins), which is why every existing entry for the route is replaced rather than another one added.
 */
function replaceTableEntry(source, routePath, name) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const key = new RegExp(`(?<=[{,]\\s*)(['"\`]${escaped}['"\`]\\s*:\\s*)`, 'g');
  let result = source;
  let replaced = 0;
  // Work from the last occurrence backwards so earlier offsets stay valid.
  const matches = [...source.matchAll(key)].reverse();
  for (const match of matches) {
    const start = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = start; i < result.length; i += 1) {
      const ch = result[i];
      if (quote) { if (ch === quote && result[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      else if (ch === '}') { if (depth === 0) { end = i; break; } depth -= 1; }
      else if (ch === ',' && depth === 0) { end = i; break; }
    }
    if (end < 0) continue;
    result = `${result.slice(0, start)}${name}${result.slice(end)}`;
    replaced += 1;
  }
  return replaced ? result : null;
}

/** A route key that appears more than once in the same table: the later one silently wins. */
function hasDuplicateTableKey(source, routePath) {
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  return [...source.matchAll(new RegExp(`(?<=[{,]\\s*)['"\`]${escaped}['"\`]\\s*:`, 'g'))].length > 1;
}


/** Index of the bracket/brace that closes the one opened at `openAt` (strings and nesting tracked), or -1. */
function matchingClose(source, openAt) {
  const open = source[openAt];
  const close = { '[': ']', '{': '}', '(': ')' }[open];
  let depth = 0;
  let quote = null;
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (ch === quote && source[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level `{ ... }` entries of an array literal: [{ start, end }] (end exclusive). */
function arrayEntries(source, openAt, closeAt) {
  const entries = [];
  for (let i = openAt + 1; i < closeAt; i += 1) {
    const ch = source[i];
    if (ch === '{') { const end = matchingClose(source, i); if (end < 0 || end > closeAt) break; entries.push({ start: i, end: end + 1 }); i = end; }
    else if (ch === '"' || ch === "'" || ch === '`') { const quote = ch; i += 1; while (i < closeAt && !(source[i] === quote && source[i - 1] !== '\\')) i += 1; }
  }
  return entries;
}

/** Replaces the value of `key:` inside one object literal text; null when the key is not there. */
function replaceObjectValue(entry, key, value) {
  const match = entry.match(new RegExp(`(\\b${key}\\s*:\\s*)`));
  if (!match) return null;
  const start = match.index + match[0].length;
  let depth = 0;
  let quote = null;
  let end = entry.length - 1;
  for (let i = start; i < entry.length; i += 1) {
    const ch = entry[i];
    if (quote) { if (ch === quote && entry[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === '}') { if (depth === 0) { end = i; break; } depth -= 1; }
    else if (ch === ',' && depth === 0) { end = i; break; }
  }
  const joined = `${entry.slice(0, start)}${value}${entry.slice(end)}`;
  return joined.replace(/\s*\}$/, ' }');
}

/**
 * Registers a route in an array of route objects the way that array already does it: entries that use `component: Name`
 * get `component: Name`, entries that use `element: <Name />` get that. An existing entry for the path is changed in place
 * (a second entry would never be reached by `.find`), a new one is appended at the END (the first entry is often the
 * fallback page). Returns null when there is no such array.
 */
function registerArrayRoute(source, routePath, name) {
  const decl = source.match(/(?:const|let|var)\s+[\w$]*(?:ROUTES|Routes|routes)\s*=\s*\[/);
  if (!decl) return null;
  const openAt = decl.index + decl[0].length - 1;
  const closeAt = matchingClose(source, openAt);
  if (closeAt < 0) return null;
  const entries = arrayEntries(source, openAt, closeAt);
  const texts = entries.map((entry) => source.slice(entry.start, entry.end));
  const usesComponent = texts.some((text) => /\bcomponent\s*:/.test(text));
  const value = usesComponent ? { key: 'component', value: name } : { key: 'element', value: `<${name} />` };
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const pathPattern = new RegExp(`\\bpath\\s*:\\s*['"\`]${escaped}['"\`]`);
  const index = texts.findIndex((text) => pathPattern.test(text));
  if (index >= 0) {
    let entry = replaceObjectValue(texts[index], value.key, value.value);
    if (entry === null) entry = replaceObjectValue(texts[index], usesComponent ? 'element' : 'component', value.value);
    if (entry === null) entry = texts[index].replace(/\s*\}$/, `, ${value.key}: ${value.value} }`);
    return `${source.slice(0, entries[index].start)}${entry}${source.slice(entries[index].end)}`;
  }
  const sample = texts.find((text) => /\btitle\s*:/.test(text));
  const extra = sample ? `, title: ${JSON.stringify(routePath)}` : '';
  const before = source.slice(0, closeAt).replace(/\s*$/, '');
  const comma = /[,\[]$/.test(before) ? '' : ',';
  return `${before}${comma}\n  { path: '${routePath}'${extra}, ${value.key}: ${value.value} },\n${source.slice(closeAt)}`;
}

/**
 * Registers a route in App.jsx. Supports <Routes>/<Route>, an object route table ({ '/a': A }) and an array of route
 * objects. Returns the new source, or null if the file uses a routing style this cannot extend safely.
 */
function registerRoute(source, routePath, name) {
  const jsxRoute = `<Route path="${routePath}" element={<${name} />} />`;
  // The route may already be registered with something that renders nothing (an empty element, a placeholder). Point
  // that registration at the new component instead of adding a second one, which would never match.
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const span = findSelfClosingRoute(source, routePath);
  if (span) return `${source.slice(0, span.start)}${jsxRoute}${source.slice(span.end)}`;
  const tableReplaced = replaceTableEntry(source, routePath, name);
  if (tableReplaced) return tableReplaced;
  if (/<\/Routes>/.test(source)) {
    // keep a catch-all (path="*") last
    const catchAll = source.search(/<Route\b[^>]*\bpath\s*=\s*["']\*["']/);
    const close = source.lastIndexOf('</Routes>');
    const at = catchAll >= 0 && catchAll < close ? catchAll : close;
    return `${source.slice(0, at)}${jsxRoute}\n        ${source.slice(at)}`;
  }
  const table = source.match(/(?:const|let|var)\s+[A-Za-z_]*(?:ROUTES|Routes|routes|PAGES|Pages|pages)\s*=\s*\{/);
  if (table) {
    const at = table.index + table[0].length;
    return `${source.slice(0, at)}\n  '${routePath}': ${name},${source.slice(at)}`;
  }
  // A catch-all entry in an array is never reached by `.find(path === current)` and would become the fallback page; skip it.
  if (routePath === '*') return null;
  const listed = registerArrayRoute(source, routePath, name);
  if (listed) return listed;
  return null;
}

function capturedHtmlOf(page) {
  return (page.extraction?.html || '') || (page.extraction?.htmlSections || []).map((section) => section.html).join('\n');
}

/** Gives image containers back the height they had on the source page (see data-veave-h in the capture) as a minimum. */
function applyMeasuredBoxes(html) {
  return String(html).replace(/<([a-z][a-z0-9]*)\b[^>]*\bdata-veave-h=["'](\d+)["'][^>]*>/gi, (tag, name, height) => {
    const rule = `min-height:${Math.min(Number(height), 5000)}px;`;
    return /\sstyle=(["'])/i.test(tag)
      ? tag.replace(/\sstyle=(["'])/i, (match, quote) => ` style=${quote}${rule}`)
      : tag.replace(new RegExp(`<${name}\\b`, 'i'), `<${name} style="${rule}"`);
  });
}

/**
 * Makes captured HTML safe to embed in a clone: no document-level tags, and no image/media that is not a downloaded local
 * asset (remote URLs and assets that were never captured would break the clone's own asset rules).
 */
function cleanCapturedHtml(html, assets = []) {
  const local = new Set(assets.map((asset) => asset.publicPath).filter(Boolean));
  const isLocal = (value) => local.has(String(value || '').split(/[?#]/)[0]) || /^data:image\//i.test(value || '');
  let out = String(html)
    .replace(/<(?:link|meta|base)\b[^>]*>/gi, '')
    .replace(/<title\b[\s\S]*?<\/title>/gi, '');
  // <img>/<source>/<video> whose source is not a local asset are removed.
  out = out.replace(/<(img|source|video|audio)\b[^>]*?>/gi, (tag) => {
    const src = (tag.match(/\b(?:src|poster)\s*=\s*["']([^"']*)["']/i) || [])[1];
    return !src || isLocal(src) ? tag : '';
  });
  // remote or missing images referenced from inline styles
  out = out.replace(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi, (match, ref) => (isLocal(ref) ? match : 'none'));
  // links into the original site's static folders are not pages
  out = out.replace(/\bhref\s*=\s*["'](\/assets\/[^"']*)["']/gi, (match, ref) => (isLocal(ref) ? match : 'href="#"'));
  return out.replace(/\b(?:src|poster)\s*=\s*["'](https?:\/\/[^"']+)["']/gi, '');
}

/**
 * Does the application shell (App and the layout components it renders, not the pages) draw its own header, navigation or
 * footer? If it does, a rebuilt page must not repeat them; if it does not, the page keeps the original ones.
 */
function shellHasChrome(files) {
  const chrome = /<(?:Header|SiteHeader|TopBar|Navbar|NavBar|Navigation|MainNav|Footer|SiteFooter)\b/;
  const app = files.find(isAppFile);
  if (!app) return false;
  const aiProtocol = require('./aiProtocol');
  const layoutPaths = aiProtocol.relatedRepairPaths(files, new Set([app.path]), { maxImports: 40, maxImporters: 0 })
    .filter((filePath) => !/^src\/pages\//.test(filePath));
  return [app.path, ...layoutPaths].some((filePath) => {
    const file = files.find((item) => item.path === filePath);
    return file && file.encoding !== 'base64' && chrome.test(String(file.content || ''));
  });
}

/** True when the component file renders exactly one route and is not a stand-in. */
function isDedicatedComponent(files, componentPath) {
  if (/Placeholder|NotCloned/i.test(componentPath)) return false;
  const app = files.find(isAppFile);
  if (!app) return true;
  const source = String(app.content || '');
  const base = path.posix.basename(componentPath).replace(/\.[^.]+$/, '');
  const name = (source.match(new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"][^'"]*/${base}['"]`)) || [])[1] || base;
  // JSX uses (<Name .../>) and route-table uses ('/x': Name) both count: a component serving several routes is shared.
  const jsxUses = (source.match(new RegExp(`<${name}[\\s/>]`, 'g')) || []).length;
  const identifierUses = (source.match(new RegExp(`(?<![\\w$.'"/<])${name}(?![\\w$'"/])`, 'g')) || []).length - 1; // minus the import line
  return Math.max(jsxUses, identifierUses) <= 1;
}

/** Creates (or replaces) the page component for a route from the captured source and registers it. */
function buildCapturedRoute(files, page, { localize = (html) => html, assets = [], siteCss = null } = {}) {
  const rawHtml = capturedHtmlOf(page);
  let html = cleanCapturedHtml(localize(sanitizeCapturedHtml(applyMeasuredBoxes(rawHtml), { keepChrome: Boolean(siteCss) && !shellHasChrome(files) })), assets);
  // Same renaming as the site CSS received (see capturedCss.CLASS_PREFIX), so the two keep matching and Tailwind cannot interfere.
  if (siteCss) html = capturedCss.prefixHtmlClasses(html);
  if (stripTags(html).length < 120) return { files, applied: false, reason: 'captured content too small' };
  let existing = findRouteComponentPath(files, page.path);
  // Several routes can render one component (a shared placeholder, a generic page with a title prop). Rewriting that file
  // for one route would replace the others' content, so such routes each get a component of their own.
  if (existing && !isDedicatedComponent(files, existing)) existing = null;
  let componentPath = existing;
  let next;
  let appSource = null;
  if (!existing) {
    const name = `${pascal(page.path)}CapturedPage`;
    componentPath = `src/pages/${name}.jsx`;
    const app = files.find(isAppFile);
    if (!app) return { files, applied: false, reason: 'src/App not found' };
    appSource = registerRoute(addImport(String(app.content || ''), name, `./pages/${name}`), page.path, name);
    if (!appSource) return { files, applied: false, reason: 'App route table style is not supported' };
  }
  const cssImport = siteCss ? path.posix.relative(path.posix.dirname(componentPath), SITE_CSS_PATH) : null;
  const component = buildComponent(html, { wrapperClass: siteCss ? capturedCss.prefixClassList(rootClasses(rawHtml)) : rootClasses(rawHtml), cssImport: cssImport && !cssImport.startsWith('.') ? `./${cssImport}` : cssImport });
  if (existing) next = files.map((file) => (file.path === existing ? { ...file, content: component } : file));
  else {
    next = [...files.filter((file) => file.path !== componentPath), { path: componentPath, content: component, language: 'javascript', encoding: 'utf8' }]
      .map((file) => (isAppFile(file) ? { ...file, content: appSource } : file));
  }
  if (siteCss && !next.some((file) => file.path === SITE_CSS_PATH)) next = [...next, { path: SITE_CSS_PATH, content: siteCss, language: 'css', encoding: 'utf8' }];
  const baseCss = siteCss ? STYLED_BASE_CSS : FALLBACK_CSS;
  const css = next.find((file) => file.path === 'src/index.css');
  if (css && !String(css.content).includes('.veave-fallback')) next = next.map((file) => (file === css ? { ...file, content: `${css.content}\n${baseCss}` } : file));
  else if (!css) next = [...next, { path: 'src/index.css', content: baseCss, language: 'css', encoding: 'utf8' }];
  return { files: next, applied: true, componentPath, created: !existing, styled: Boolean(siteCss) };
}

/** The site's CSS made local and scoped to rebuilt pages, or null when none was captured. */
function buildSiteCss(stylesheets = [], { assets = [], localizeCss = (css) => css } = {}) {
  if (!stylesheets.length) return null;
  const css = capturedCss.buildScopedCss(stylesheets, { localize: localizeCss, localPaths: new Set(assets.map((asset) => asset.publicPath).filter(Boolean)), classPrefix: capturedCss.CLASS_PREFIX });
  return css.trim() ? `${css}\n${capturedCss.revealOverrides()}` : null;
}

/**
 * Decides which captured routes need the deterministic page and applies it.
 * `metrics` maps route -> { textLength } from a real render (missing/null = the route did not render at all).
 */
function ensureCapturedRoutes(files, pages, { metrics = new Map(), localize, assets = [], siteCss = null } = {}) {
  let working = files;
  const report = [];
  const app = files.find(isAppFile);
  for (const page of pages.filter((item) => item.captureStatus === 'captured')) {
    const appSource = String(app?.content || '');
    const registered = registrationStyle(appSource, page.path).registered || (page.path === '/' && /path\s*=\s*["']\/["']|index\b/.test(appSource));
    const component = findRouteComponentPath(working, page.path);
    const rendered = metrics.get(page.path);
    const textLength = rendered?.textLength ?? null;
    let reason = null;
    if (!registered && !component) reason = 'route-missing';
    else if (usesPlaceholder(working, component)) reason = 'placeholder';
    else if (textLength === null) reason = 'did-not-render';
    else if (textLength < MIN_VISIBLE_TEXT && capturedTextLength(page) >= MIN_VISIBLE_TEXT) reason = 'blank';
    else if (isBlankRoute(page, textLength)) reason = 'mostly-blank';
    if (!reason) continue;
    const result = buildCapturedRoute(working, page, { localize, assets, siteCss });
    report.push({ route: page.path, reason, renderedTextLength: textLength, capturedTextLength: capturedTextLength(page), applied: result.applied, created: Boolean(result.created), styled: Boolean(result.styled), component: result.componentPath || null, failure: result.applied ? null : result.reason });
    if (result.applied) working = result.files;
  }
  return { files: working, report };
}

/** Rebuilds the named routes from the captured source whatever they currently render (used when a page does not match the original). */
function rebuildRoutes(files, pages, routes, { localize, assets = [], siteCss = null, originUrl } = {}) {
  // An app already under the engine route layer is not table-style: registering a route in it would put an object into its
  // list of known paths and the page would never show. Such apps take the page as an override of that route instead.
  const appFile = files.find(isAppFile);
  if (appFile && String(appFile.content || '').includes(ENGINE_MARK)) {
    const overridden = overrideRoutes(files, pages, routes, { localize, assets, siteCss, originUrl, allRoutes: [] });
    return { files: overridden.files, report: overridden.report.map((item) => ({ ...item, reason: 'low-fidelity', failure: item.applied ? null : item.failure })) };
  }
  let working = files;
  const report = [];
  for (const page of pages.filter((item) => item.captureStatus === 'captured' && routes.includes(item.path))) {
    const result = buildCapturedRoute(working, page, { localize, assets, siteCss });
    report.push({ route: page.path, reason: 'low-fidelity', applied: result.applied, created: Boolean(result.created), styled: Boolean(result.styled), component: result.componentPath || null, failure: result.applied ? null : result.reason });
    if (result.applied) working = result.files;
  }
  return { files: working, report };
}

const hasCatchAll = (source) => /<Route\b[^>]*\bpath\s*=\s*["'`{]+\*["'`}]/.test(source) || /['"]\*['"]\s*:/.test(source) || /path:\s*['"]\*['"]/.test(source);

/**
 * A clone contains only the pages that were captured, but its navigation still links to the rest of the original site.
 * Those links must land on a page that says so and leads to the real page, never on an empty screen (an unknown route in
 * React Router renders nothing, which both visitors and the validator see as a blank page).
 */
/**
 * A route TABLE ({ '/': Home, '*': NotCloned }) only helps if the lookup falls back to its '*' entry. A lookup like
 * `table[path] || HomePage` ignores it, so every unknown or uncloned link silently showed a copy of the home page.
 */
function honourTableCatchAll(source) {
  const lookup = /(\b[A-Za-z_$][\w$]*)\[\s*([A-Za-z_$][\w$.]*)\s*\]\s*(?:\|\||\?\?)\s*([A-Za-z_$][\w$]*)/;
  const match = String(source).match(lookup);
  if (!match) return null;
  const [whole, table, key, fallback] = match;
  if (fallback === table || new RegExp(`${table}\\[\\s*['"]\\*['"]\\s*\\]`).test(source)) return null;
  if (!new RegExp(`${table}\\s*=\\s*\\{[\\s\\S]*?['"]\\*['"]\\s*:`).test(source)) return null;
  return source.replace(whole, `${table}[${key}] || ${table}['*'] || ${fallback}`);
}

function notClonedComponentSource(originUrl) {
  let origin = '';
  try { origin = new URL(originUrl).origin; } catch { /* no original site to send visitors to */ }
  return `// A page of the original website that is not part of this clone (or that could not be shown): send the visitor to the
// original website. Automated checks (webdriver) only render this page and keep the message, they never leave the site.
import { useEffect, useState } from 'react';
const ORIGINAL_SITE = ${JSON.stringify(origin)};

// Self-contained on purpose: this page must work even when no other helper file exists or exports what is expected.
function currentPage() {
  try {
    const raw = typeof window.__veavePathname === 'function' ? window.__veavePathname() : window.location.pathname;
    return String(raw || '/').split(/[?#]/)[0].replace(/\\/+$/, '') || '/';
  } catch (error) { return '/'; }
}

export default function NotClonedPage() {
  const path = currentPage();
  const original = ORIGINAL_SITE && typeof window !== 'undefined' ? ORIGINAL_SITE + path + window.location.search : '';
  const [waiting, setWaiting] = useState(Boolean(original));
  useEffect(() => {
    if (!original || (typeof navigator !== 'undefined' && navigator.webdriver)) { setWaiting(false); return undefined; }
    try { window.location.replace(original); } catch (error) { /* navigation blocked: the link below stays available */ }
    const timer = setTimeout(() => setWaiting(false), 2000);
    return () => clearTimeout(timer);
  }, [original]);
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '120px 24px 80px', textAlign: 'center', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>{waiting ? 'Opening the original page...' : 'This page is not part of the cloned pages'}</h1>
      <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{waiting ? 'This page is shown on the original website.' : 'Only the main pages of the website were cloned. You can open this page on the original website, or go back to the home page.'}</p>
      <p style={{ marginTop: 24 }}>
        {original ? <a href={original} style={{ textDecoration: 'underline', marginRight: 16 }}>Open on the original website</a> : null}
        <a href="/" style={{ textDecoration: 'underline' }}>Back to the home page</a>
      </p>
    </main>
  );
}
`;
}

/**
 * A catch-all that exists but renders the HOME page (its '*' entry / <Route path="*"> points at the same component as '/')
 * is retargeted to the not-cloned page, so an unknown link no longer shows a copy of Home.
 */
function retargetHomeCatchAll(files, { originUrl } = {}) {
  const app = files.find(isAppFile);
  if (!app) return null;
  const source = String(app.content || '');
  const { findRouteComponentPath } = require('./blankPageFallback');
  const star = findRouteComponentPath(files, '*');
  const home = findRouteComponentPath(files, '/');
  if (!star || !home || star !== home) return null;
  const name = 'NotClonedPage';
  const componentPath = `src/pages/${name}.jsx`;
  const registered = registerRoute(addImport(source, name, `./pages/${name}`), '*', name);
  if (!registered || registered === source) return null;
  const next = [...files.filter((file) => file.path !== componentPath), { path: componentPath, content: notClonedComponentSource(originUrl), language: 'javascript', encoding: 'utf8' }]
    .map((file) => (isAppFile(file) ? { ...file, content: registered } : file));
  return { files: next, applied: true, reason: "the catch-all pointed at the home page; it now shows the not-cloned page", componentPath };
}


/**
 * Last resort that does not depend on how the app routes: App is wrapped so that a path that is not one of the site's
 * pages renders the not-cloned page instead of whatever the app falls back to (usually Home). The page list is the
 * clone's own captured routes. Skipped when the app cannot be wrapped safely.
 */
function wrapAppWithKnownRoutes(files, { routes = [], originUrl } = {}) {
  const layered = installRouteLayer(files, { routes, originUrl });
  if (layered.applied) {
    const withHelper = layered.files.some((file) => file.path === CURRENT_PATH_FILE) ? layered.files : [...layered.files, { path: CURRENT_PATH_FILE, content: CURRENT_PATH_SOURCE, language: 'javascript', encoding: 'utf8' }];
    return { files: withHelper, applied: true, reason: 'App now shows the not-cloned page for any path that is not one of the cloned pages', componentPath: 'src/pages/NotClonedPage.jsx' };
  }
  if (layered.reason === 'no list of pages') return null;
  const app = files.find(isAppFile);
  const known = [...new Set(routes.map((route) => String(route).split(/[?#]/)[0].replace(/\/+$/, '') || '/'))].filter((route) => route && !/[*:]/.test(route));
  if (!app || !known.length) return null;
  const source = String(app.content || '');
  if (/VEAVE_KNOWN_ROUTES/.test(source)) return null;
  const name = 'NotClonedPage';
  const wrapper = `\nconst VEAVE_KNOWN_ROUTES = ${JSON.stringify(known)};\n\nexport default function App() {\n  const raw = typeof window === 'undefined' ? '/' : (typeof window.__veavePathname === 'function' ? window.__veavePathname() : window.location.pathname);\n  const path = String(raw || '/').split(/[?#]/)[0].replace(/\\/+$/, '') || '/';\n  if (!VEAVE_KNOWN_ROUTES.includes(path)) return <${name} />;\n  return <VeaveRoutedApp />;\n}\n`;
  let next = null;
  if (/function\s+VeaveRoutedApp\b/.test(source) && /export\s+default\s+function\s+App\s*\(/.test(source)) {
    // the inner component already has its final name; only the default export is replaced
    const at = source.search(/export\s+default\s+function\s+App\s*\(/);
    const open = source.indexOf('{', source.indexOf(')', at));
    const close = open >= 0 ? matchingClose(source, open) : -1;
    if (close > 0) next = source.slice(0, at) + source.slice(close + 1).replace(/^\s*\n?/, '') + wrapper;
  } else if (/export\s+default\s+function\s+App\s*\(/.test(source)) next = source.replace(/export\s+default\s+function\s+App\s*\(/, 'function VeaveRoutedApp(') + wrapper;
  else if (/\bfunction\s+App\s*\([^)]*\)\s*\{/.test(source) && /export\s+default\s+App\s*;?/.test(source)) next = source.replace(/function\s+App\s*\(/, 'function VeaveRoutedApp(').replace(/export\s+default\s+App\s*;?/, '') + wrapper;
  else if (/\bconst\s+App\s*=/.test(source) && /export\s+default\s+App\s*;?/.test(source)) next = source.replace(/\bconst\s+App\s*=/, 'const VeaveRoutedApp =').replace(/export\s+default\s+App\s*;?/, '') + wrapper;
  if (!next) return null;
  next = addImport(next, name, `./pages/${name}`);
  const componentPath = `src/pages/${name}.jsx`;
  const files2 = [...files.filter((file) => file.path !== componentPath), { path: componentPath, content: notClonedComponentSource(originUrl), language: 'javascript', encoding: 'utf8' }]
    .map((file) => (isAppFile(file) ? { ...file, content: next } : file));
  return { files: files2, applied: true, reason: 'App now shows the not-cloned page for any path that is not one of the cloned pages', componentPath };
}

function ensureCatchAllRoute(files, { originUrl, routes = [], force = false } = {}) {
  if (files.some((file) => isAppFile(file) && /VEAVE_KNOWN_ROUTES/.test(String(file.content || '')))) return { files, applied: false, reason: 'already wrapped' };
  if (force) { const wrapped = wrapAppWithKnownRoutes(files, { routes, originUrl }); if (wrapped) return wrapped; }
  const app = files.find(isAppFile);
  if (app && hasCatchAll(String(app.content || ''))) {
    const fixed = honourTableCatchAll(String(app.content || ''));
    const honoured = fixed ? files.map((file) => (file === app ? { ...file, content: fixed } : file)) : files;
    const retargeted = retargetHomeCatchAll(honoured, { originUrl });
    if (fixed && !retargeted) return { files: honoured, applied: true, reason: "the route table's '*' entry is now used for unknown pages" };
    if (retargeted) return retargeted;
  }
  if (!app || hasCatchAll(String(app.content || ''))) return { files, applied: false, reason: app ? 'already present' : 'src/App not found' };
  const name = 'NotClonedPage';
  const componentPath = `src/pages/${name}.jsx`;
  const component = notClonedComponentSource(originUrl);
  let registered = registerRoute(addImport(String(app.content || ''), name, `./pages/${name}`), '*', name);
  if (!registered) {
    const wrapped = wrapAppWithKnownRoutes(files, { routes, originUrl });
    return wrapped || { files, applied: false, reason: 'App route table style is not supported' };
  }
  registered = honourTableCatchAll(registered) || registered; // a table entry is useless if the lookup falls back to Home
  const next = [...files.filter((file) => file.path !== componentPath), { path: componentPath, content: component, language: 'javascript', encoding: 'utf8' }]
    .map((file) => (isAppFile(file) ? { ...file, content: registered } : file));
  return { files: next, applied: true, componentPath };
}


/* ------------------------------------------------------------------------------------------------------------------ */
/* Simple, uniform routing for window.location based apps                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

const CURRENT_PATH_FILE = 'src/lib/currentPath.js';
const CURRENT_PATH_SOURCE = `// One place that answers "which page is showing?" so every component agrees, in the published site AND in the sandboxed
// editor preview (which cannot change window.location and keeps a virtual path instead).
import { useEffect, useRef, useState } from 'react';

export function getCurrentPath() {
  const raw = typeof window === 'undefined' ? '/' : (typeof window.__veavePathname === 'function' ? window.__veavePathname() : window.location.pathname);
  return String(raw || '/').split(/[?#]/)[0].replace(/\\/+$/, '') || '/';
}

// Re-renders when the page changes (link clicks that use history.pushState, back/forward).
export function usePathname() {
  const [path, setPath] = useState(getCurrentPath);
  useEffect(() => {
    const update = () => setPath(getCurrentPath());
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    window.addEventListener('veave:navigate', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); window.removeEventListener('veave:navigate', update); };
  }, []);
  return path;
}

// A new page opens at its top (like a real page load); a link to an #anchor keeps the browser's own scrolling.
export function scrollToTopOnNavigate(path) {
  if (typeof window === 'undefined') return;
  if (window.location.hash && window.location.hash.length > 1) return;
  try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
  if (document.documentElement) document.documentElement.scrollTop = 0;
  if (document.body) document.body.scrollTop = 0;
  const scrollers = document.querySelectorAll('body *');
  for (let i = 0; i < scrollers.length && i < 3000; i += 1) {
    const el = scrollers[i];
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTop = 0;
  }
}

// Call once at the top of App: whenever the path changes, show the new page from its top.
export function useScrollToTop(path) {
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current === path) return;
    previous.current = path;
    scrollToTopOnNavigate(path);
  }, [path]);
}

// Router libraries change the address with history.pushState without any event; announce it so usePathname follows.
if (typeof window !== 'undefined' && typeof history !== 'undefined' && !window.__veaveHistoryAnnounced) {
  window.__veaveHistoryAnnounced = true;
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function announced(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('veave:navigate'));
      return result;
    };
  }
}
`;

function relativeImport(fromPath, toPath) {
  const rel = path.posix.relative(path.posix.dirname(fromPath), toPath.replace(/\.[^.]+$/, ''));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function addNamedImport(source, names, importPath) {
  const line = `import { ${names.join(', ')} } from '${importPath}';`;
  const imports = [...source.matchAll(/^import[^\n]*\n/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports.at(-1);
  const at = last.index + last[0].length;
  return `${source.slice(0, at)}${line}\n${source.slice(at)}`;
}

/**
 * Makes the routing of an app that reads window.location.pathname uniform and simple:
 *  1. every `window.location.pathname` becomes getCurrentPath() (the virtual path in sandboxed previews, the real one elsewhere),
 *  2. App re-renders whenever the page changes (usePathname) and shows the not-cloned page for any path that is not one of
 *     the site's pages. Apps that use a router library are left alone.
 * Idempotent.
 */
function normalizeWindowLocationRouting(files, { routes = [], originUrl, force = false } = {}) {
  const app = files.find(isAppFile);
  if (!app) return { files, applied: false, reason: 'src/App not found' };
  const sources = files.filter((file) => file.encoding !== 'base64' && /^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) && typeof file.content === 'string');
  if (!force && !String(app.content || '').includes(ENGINE_MARK) && sources.some((file) => /from\s+['"]react-router(?:-dom)?['"]/.test(file.content))) return { files, applied: false, reason: 'the app uses a router library' };
  // 1. the engine owns the top level (generated App moves aside unchanged)
  const layer = installRouteLayer(files, { routes, originUrl });
  if (!layer.applied && !layer.files.some((file) => file.path === ORIGINAL_APP_PATH)) return { files, applied: false, reason: layer.reason };
  let next = layer.files.filter((file) => file.path !== CURRENT_PATH_FILE);
  // 2. every read of window.location.pathname (also in the moved app and in pages created above) goes through the one helper
  const changed = [];
  next = next.map((file) => {
    if (file.encoding === 'base64' || !/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) || typeof file.content !== 'string' || !/\bwindow\.location\.pathname\b/.test(file.content)) return file;
    let content = file.content.replace(/\bwindow\.location\.pathname\b/g, 'getCurrentPath()');
    if (!/\bgetCurrentPath\b[^;(]*from\s+['"][^'"]*currentPath['"]/.test(content)) content = addNamedImport(content, ['getCurrentPath'], relativeImport(file.path, CURRENT_PATH_FILE));
    changed.push(file.path);
    return { ...file, content };
  });
  next.push({ path: CURRENT_PATH_FILE, content: CURRENT_PATH_SOURCE, language: 'javascript', encoding: 'utf8' });
  return { files: next, applied: true, changedFiles: [...new Set([...changed, app.path, ORIGINAL_APP_PATH, CURRENT_PATH_FILE])], reason: layer.reason };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Engine-owned route layer                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------ */
// Whatever the model wrote in App.jsx (a route table, <Routes>, a find() over an array, a switch, its own render logic),
// the engine does not try to edit it. The generated app is moved aside UNCHANGED (src/AppOriginal.jsx) and a small
// engine-written App.jsx owns the top level:
//   - a path that is not one of the site's pages shows the not-cloned page,
//   - a page that the generated app does not render correctly is shown by a complete captured page instead (override),
//   - everything else is rendered by the generated app.
// The engine file is regenerated from scratch every time, so nothing depends on how the generated code is written.

const ENGINE_MARK = '// veave-engine-router';
const ORIGINAL_APP_PATH = 'src/AppOriginal.jsx';

function readOverrides(source) {
  const line = String(source).match(/^\/\/ veave-overrides: (\{.*\})$/m);
  if (!line) return {};
  try { return JSON.parse(line[1]); } catch { return {}; }
}

/** The engine-owned path helper must exist and export everything the route layer imports; a missing or partial copy is replaced. */
function ensureCurrentPathHelper(files) {
  const existing = files.find((file) => file.path === CURRENT_PATH_FILE);
  const complete = existing && ['getCurrentPath', 'usePathname', 'useScrollToTop'].every((name) => new RegExp(`export\\s+(?:function|const)\\s+${name}\\b`).test(String(existing.content || '')));
  if (complete) return { files, changed: false };
  const file = { path: CURRENT_PATH_FILE, content: CURRENT_PATH_SOURCE, language: 'javascript', encoding: 'utf8' };
  return { files: existing ? files.map((f) => (f.path === CURRENT_PATH_FILE ? file : f)) : [...files, file], changed: true };
}

const ROUTE_GUARD_MARK = '// veave-route-guard';

function engineAppSource({ known, overrides, hasNotCloned }) {
  const entries = Object.entries(overrides);
  const names = entries.map(([route, file]) => ({ route, file, name: `${pascal(route === '/' ? 'home' : route)}Route` }));
  const lines = [
    ENGINE_MARK,
    '// This file is written by the engine. The generated application lives, unchanged, in AppOriginal.jsx.',
    `// veave-overrides: ${JSON.stringify(overrides)}`,
    ...(hasNotCloned ? [ROUTE_GUARD_MARK] : []),
    ...(hasNotCloned ? [`import { Component } from 'react';`] : []),
    `import OriginalApp from './AppOriginal';`,
    ...(hasNotCloned ? [`import NotClonedPage from './pages/NotClonedPage';`] : []),
    `import { usePathname, useScrollToTop } from './lib/currentPath';`,
    ...names.map(({ name, file }) => `import ${name} from './${file.replace(/^src\//, '').replace(/\.[^.]+$/, '')}';`),
    `export * from './AppOriginal';`,
    '',
    `const VEAVE_KNOWN_ROUTES = ${JSON.stringify(known)};`,
    `const VEAVE_ROUTE_OVERRIDES = {${names.length ? `\n${names.map(({ route, name }) => `  ${JSON.stringify(route)}: ${name},`).join('\n')}\n` : ''}};`,
    '',
    ...(hasNotCloned ? [
      '// A page that throws while rendering is replaced by the not-cloned page, which sends the visitor to the original website.',
      '// The error is still reported to the editor preview (so repairs and diagnostics see it) and to the console.',
      'class RouteGuard extends Component {',
      '  constructor(props) { super(props); this.state = { failed: false }; }',
      '  static getDerivedStateFromError() { return { failed: true }; }',
      '  componentDidCatch(error) {',
      '    console.error(error);',
      "    try { window.parent.postMessage({ type: 'preview-error', error: { message: String((error && error.message) || error) } }, '*'); } catch (e) { /* no listener */ }",
      '  }',
      '  componentDidUpdate(previous) { if (previous.path !== this.props.path && this.state.failed) this.setState({ failed: false }); }',
      '  render() { return this.state.failed ? <NotClonedPage /> : this.props.children; }',
      '}',
      ''
    ] : []),
    'export default function App() {',
    '  const path = usePathname();',
    '  useScrollToTop(path);',
    hasNotCloned ? '  if (!VEAVE_KNOWN_ROUTES.includes(path)) return <NotClonedPage />;' : '  // (no not-cloned page)',
    '  const Override = VEAVE_ROUTE_OVERRIDES[path];',
    ...(hasNotCloned ? [
      '  return (',
      '    <RouteGuard path={path}>',
      '      {Override ? <Override key={path} /> : <OriginalApp key={path} />}',
      '    </RouteGuard>',
      '  );'
    ] : [
      '  if (Override) return <Override key={path} />;',
      '  return <OriginalApp key={path} />;'
    ]),
    '}',
    ''
  ];
  return lines.join('\n');
}

/**
 * Brings an older engine route layer up to date (redirect to the original website for pages that are missing or fail), keeping
 * its page list and overrides. Returns only the files that changed; a project without an engine router is left alone.
 */
function upgradeRouteLayer(files, { originUrl } = {}) {
  const app = files.find(isAppFile);
  if (!app || !String(app.content || '').includes(ENGINE_MARK)) return { files, changed: [], applied: false };
  const notCloned = files.find((file) => file.path === 'src/pages/NotClonedPage.jsx');
  const current = String(notCloned?.content || '');
  const hasRedirect = current.includes('window.location.replace') && !/from\s+['"][^'"]*currentPath['"]/.test(current);
  const hasGuard = String(app.content).includes(ROUTE_GUARD_MARK);
  const helperCheck = ensureCurrentPathHelper(files);
  if (hasRedirect && hasGuard && !helperCheck.changed) return { files, changed: [], applied: false };
  const known = (String(app.content).match(/const VEAVE_KNOWN_ROUTES = (\[[^\]]*\]);/) || [])[1];
  let list = []; try { list = JSON.parse(known); } catch { /* keep empty */ }
  let origin = originUrl;
  if (!origin && current) origin = (current.match(/const ORIGINAL_SITE = ("[^"]*")/) || [])[1] && JSON.parse(current.match(/const ORIGINAL_SITE = ("[^"]*")/)[1]);
  if (!origin) return { files, changed: [], applied: false, reason: 'the original website is unknown' };
  const nextApp = { ...app, content: engineAppSource({ known: list, overrides: readOverrides(app.content), hasNotCloned: true }) };
  const nextNotCloned = { path: 'src/pages/NotClonedPage.jsx', content: notClonedComponentSource(origin), language: 'javascript', encoding: 'utf8' };
  const changed = [nextApp, nextNotCloned, ...(helperCheck.changed ? [helperCheck.files.find((file) => file.path === CURRENT_PATH_FILE)] : [])];
  const touched = new Set(changed.map((file) => file.path));
  const next = [...files.filter((file) => !touched.has(file.path)), ...changed];
  return { files: next, changed, applied: true };
}

/**
 * Installs (or refreshes) the engine route layer. `overrides` maps route -> component file that fully renders that page.
 * Idempotent; keeps the overrides that are already installed.
 */
function installRouteLayer(files, { routes = [], originUrl, overrides = {} } = {}) {
  const app = files.find(isAppFile);
  if (!app) return { files, applied: false, reason: 'src/App not found' };
  const known = [...new Set(routes.map((route) => String(route).split(/[?#]/)[0].replace(/\/+$/, '') || '/'))].filter((route) => route && !/[*:]/.test(route));
  const installed = String(app.content || '').includes(ENGINE_MARK);
  if (!known.length && !installed) return { files, applied: false, reason: 'no list of pages' };
  const existing = installed ? readOverrides(app.content) : {};
  const merged = { ...existing, ...overrides };
  let next = files;
  if (!installed) {
    // The generated app moves aside byte for byte (its own relative imports keep working: same folder).
    next = [...files.filter((file) => file.path !== ORIGINAL_APP_PATH), { path: ORIGINAL_APP_PATH, content: app.content, language: app.language || 'javascript', encoding: 'utf8' }];
  }
  const priorKnown = installed ? (String(app.content).match(/const VEAVE_KNOWN_ROUTES = (\[[^\]]*\]);/) || [])[1] : null;
  let list = known;
  if (!list.length && priorKnown) { try { list = JSON.parse(priorKnown); } catch { list = []; } }
  const hasNotCloned = next.some((file) => file.path === 'src/pages/NotClonedPage.jsx') || Boolean(originUrl) || installed;
  if (hasNotCloned && !next.some((file) => file.path === 'src/pages/NotClonedPage.jsx')) next = [...next, { path: 'src/pages/NotClonedPage.jsx', content: notClonedComponentSource(originUrl), language: 'javascript', encoding: 'utf8' }];
  const content = engineAppSource({ known: list, overrides: merged, hasNotCloned });
  next = next.map((file) => (isAppFile(file) ? { ...file, content } : file));
  const helper = ensureCurrentPathHelper(next); next = helper.files;
  return { files: next, applied: helper.changed || !installed || JSON.stringify(existing) !== JSON.stringify(merged) || list.length !== (priorKnown ? JSON.parse(priorKnown).length : -1), reason: installed ? 'route layer refreshed' : 'the app now sits under an engine-owned router (unknown pages, overrides)', overrides: merged };
}

/**
 * Gives each named route a complete page of its own, taken from the captured source (chrome included, so it does not
 * depend on the generated app's layout), and mounts it through the engine route layer. Nothing in the generated app is edited.
 */
function overrideRoutes(files, pages, routes, { localize = (html) => html, assets = [], siteCss = null, originUrl, allRoutes = [] } = {}) {
  let working = files;
  const report = [];
  const overrides = {};
  for (const page of pages.filter((item) => item.captureStatus === 'captured' && routes.includes(item.path))) {
    const rawHtml = capturedHtmlOf(page);
    let html = cleanCapturedHtml(localize(sanitizeCapturedHtml(applyMeasuredBoxes(rawHtml), { keepChrome: true })), assets);
    if (siteCss) html = capturedCss.prefixHtmlClasses(html);
    if (stripTags(html).length < 60) { report.push({ route: page.path, applied: false, failure: 'captured content too small' }); continue; }
    const name = `${pascal(page.path === '/' ? 'home' : page.path)}Route`;
    const componentPath = `src/routes/${name}.jsx`;
    const cssImport = siteCss ? path.posix.relative(path.posix.dirname(componentPath), SITE_CSS_PATH) : null;
    const component = buildComponent(html, { wrapperClass: siteCss ? capturedCss.prefixClassList(rootClasses(rawHtml)) : rootClasses(rawHtml), cssImport: cssImport && !cssImport.startsWith('.') ? `./${cssImport}` : cssImport });
    working = [...working.filter((file) => file.path !== componentPath), { path: componentPath, content: component, language: 'javascript', encoding: 'utf8' }];
    overrides[page.path] = componentPath;
    report.push({ route: page.path, applied: true, component: componentPath, created: true, styled: Boolean(siteCss) });
  }
  if (!Object.keys(overrides).length) return { files, report };
  if (siteCss && !working.some((file) => file.path === SITE_CSS_PATH)) working = [...working, { path: SITE_CSS_PATH, content: siteCss, language: 'css', encoding: 'utf8' }];
  const baseCss = siteCss ? STYLED_BASE_CSS : FALLBACK_CSS;
  const css = working.find((file) => file.path === 'src/index.css');
  if (css && !String(css.content).includes('.veave-fallback')) working = working.map((file) => (file === css ? { ...file, content: `${css.content}\n${baseCss}` } : file));
  else if (!css) working = [...working, { path: 'src/index.css', content: baseCss, language: 'css', encoding: 'utf8' }];
  const layer = installRouteLayer(working, { routes: allRoutes, originUrl, overrides });
  if (!layer.files.some((file) => file.path === CURRENT_PATH_FILE)) layer.files.push({ path: CURRENT_PATH_FILE, content: CURRENT_PATH_SOURCE, language: 'javascript', encoding: 'utf8' });
  return { files: layer.files, report };
}

/** Adds the "show what the source revealed with JavaScript" rules to the captured stylesheet. */
function appendRevealRules(files, selectors) {
  const rules = capturedCss.revealRulesFor(selectors);
  if (!rules) return { files, added: 0 };
  return { files: files.map((file) => (file.path === SITE_CSS_PATH ? { ...file, content: `${file.content}\n/* shown by the rebuilt page (hidden until a script ran on the source site) */\n${rules}\n` } : file)), added: rules.split('\n').length };
}

module.exports = { installRouteLayer, upgradeRouteLayer, overrideRoutes, normalizeWindowLocationRouting, wrapAppWithKnownRoutes, retargetHomeCatchAll, replaceTableEntry, hasDuplicateTableKey, honourTableCatchAll, appendRevealRules, applyMeasuredBoxes, shellHasChrome, buildSiteCss, ensureCatchAllRoute, hasCatchAll, usesPlaceholder, cleanCapturedHtml, ensureCapturedRoutes, rebuildRoutes, buildCapturedRoute, registerRoute, addImport, pascal, MIN_VISIBLE_TEXT };
