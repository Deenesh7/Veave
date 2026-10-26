// The site's own stylesheets, collected while a page is captured, so that a page rebuilt from the capture looks like the
// original and not like unstyled HTML. Linked sheets on other origins cannot be read from the page, so they are fetched
// (public addresses only, size-capped). The result is made safe and local: asset URLs point at the downloaded copies,
// anything that would load from the original site is removed, and every selector is scoped so the rules cannot restyle
// the rest of the cloned application.
const postcss = require('postcss');
const { createHash } = require('node:crypto');

const MAX_SHEET_BYTES = 1.5 * 1024 * 1024;
const MAX_SHEETS_PER_PAGE = 40;

function absolutizeUrls(css, baseHref) {
  if (!baseHref) return css;
  return css.replace(/url\(\s*(["']?)(?!data:|https?:|\/\/|#|blob:)([^"')]+)\1\s*\)/gi, (match, quote, ref) => {
    try { return `url("${new URL(ref.trim(), baseHref).href}")`; } catch { return match; }
  }).replace(/url\(\s*(["']?)\/\/([^"')]+)\1\s*\)/gi, (match, quote, rest) => {
    try { return `url("${new URL(`//${rest}`, baseHref).href}")`; } catch { return match; }
  });
}

/** Runs in the captured page: every stylesheet as text where the browser lets us read it, else its URL to fetch. */
function readSheetsInPage() {
  const out = [];
  for (const sheet of [...document.styleSheets].slice(0, 120)) {
    const media = sheet.media?.mediaText || '';
    if (media && !/^(?:all|screen|)$/i.test(media.trim()) && !/min-width|max-width|screen/i.test(media)) continue; // print etc.
    let text = null;
    try { text = [...sheet.cssRules].map((rule) => rule.cssText).join('\n'); } catch { /* cross-origin: fetched below */ }
    out.push({ href: sheet.href || null, base: sheet.href || document.baseURI, text, media });
  }
  return out;
}

/**
 * @param page      the Playwright page that was just captured
 * @param fetchText async (href) => string|null  (validated, size-capped fetch supplied by the crawler)
 */
async function collectPageStylesheets(page, fetchText) {
  const sheets = await page.evaluate(readSheetsInPage).catch(() => []);
  const collected = [];
  for (const sheet of sheets.slice(0, MAX_SHEETS_PER_PAGE)) {
    let text = sheet.text;
    if ((text === null || text === '') && sheet.href) text = await fetchText(sheet.href).catch(() => null);
    if (!text || text.length > MAX_SHEET_BYTES * 2) continue;
    text = absolutizeUrls(text, sheet.base);
    collected.push({ href: sheet.href, key: createHash('sha1').update(sheet.href || text).digest('hex').slice(0, 16), text });
  }
  return collected;
}


// The project is styled with Tailwind, which generates a utility for every class name it finds in the sources. A captured
// page uses the original site's class names (columns-12, container, hidden, row ...) and some of them ARE Tailwind
// utilities, which silently re-style the page (columns-12 made a 12-column layout and collapsed every image to 0px wide).
// Every captured class is therefore renamed with a prefix, in the HTML and in the CSS alike, so nothing can collide.
const CLASS_PREFIX = 'cx-';

/** ".foo .bar:hover" -> ".cx-foo .cx-bar:hover" (strings and attribute selectors are handled, class attribute matches included). */
function prefixSelectorClasses(selector, prefix = CLASS_PREFIX) {
  let out = '';
  let i = 0;
  const text = String(selector);
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== char) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (char === '[') {
      let j = i + 1;
      let quote = null;
      while (j < text.length && (quote || text[j] !== ']')) {
        if (quote) { if (text[j] === quote) quote = null; } else if (text[j] === '"' || text[j] === "'") quote = text[j];
        j += 1;
      }
      const attribute = text.slice(i, j + 1);
      const match = attribute.match(/^\[\s*class\s*([~|^$*]?=)\s*(["']?)([^"'\]]*)\2\s*(?:[is]\s*)?\]$/i);
      if (match) {
        const [, operator, quote2, value] = match;
        if (operator === '=') out += `[class=${quote2}${value.split(/\s+/).filter(Boolean).map((name) => prefix + name).join(' ')}${quote2}]`;
        else if (operator === '~=') out += `[class~=${quote2}${prefix}${value}${quote2}]`;
        else if (operator === '^=') out += `[class*=${quote2}${value}${quote2}]`; // the class no longer starts with the value
        else out += attribute;
      } else out += attribute;
      i = j + 1;
      continue;
    }
    if (char === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (char === '.' && /[A-Za-z_\\\-\u0080-\uffff]/.test(text[i + 1] || '') && !/[0-9]/.test(text[i - 1] || '')) {
      let j = i + 1;
      while (j < text.length && (/[\w\-\u0080-\uffff]/.test(text[j]) || text[j] === '\\')) j += text[j] === '\\' ? 2 : 1;
      out += `.${prefix}${text.slice(i + 1, j)}`;
      i = j;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Renames the classes of every element in captured HTML. */
function prefixHtmlClasses(html, prefix = CLASS_PREFIX) {
  return String(html).replace(/(\sclass\s*=\s*)(["'])([\s\S]*?)\2/gi, (match, before, quote, value) =>
    `${before}${quote}${value.split(/\s+/).filter(Boolean).map((name) => (name.startsWith(prefix) ? name : prefix + name)).join(' ')}${quote}`);
}

function prefixClassList(value, prefix = CLASS_PREFIX) {
  return String(value || '').split(/\s+/).filter(Boolean).map((name) => prefix + name).join(' ');
}

// "a, b > c" -> ["a", "b > c"] without splitting inside :is(a, b) or [attr="a,b"].
function splitSelectors(selector) {
  const parts = [];
  let depth = 0; let quote = null; let current = '';
  for (const char of selector) {
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// "body.home .hero" -> ".veave-fallback.home .hero": the page's <body>/<html> classes live on the wrapper element.
function scopeSelector(selector, scope) {
  let rest = selector.trim();
  let attached = '';
  let touchedRoot = false;
  for (let i = 0; i < 3; i += 1) {
    const match = rest.match(/^(?:html|body|:root)((?:[.#][\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*)(?=\s|[>+~]|$)/i);
    if (!match) break;
    touchedRoot = true;
    attached += match[1];
    rest = rest.slice(match[0].length).trim();
  }
  if (touchedRoot) return `${scope}${attached}${rest ? ` ${rest}` : ''}`;
  if (selector.startsWith(scope)) return selector;
  return `${scope} ${selector}`;
}

/**
 * Builds the stylesheet for rebuilt pages from collected sheets.
 * @param {Array<{text:string}>} sheets
 * @param {{ scope?: string, localize?: (css:string)=>string, localPaths?: Set<string>, maxBytes?: number }} options
 */
function buildScopedCss(sheets, { scope = '.veave-fallback', localize = (value) => value, localPaths = new Set(), maxBytes = 2.5 * 1024 * 1024, classPrefix = '' } = {}) {
  const isLocalUrl = (value) => /^data:/i.test(value) || localPaths.has(String(value).split(/[?#]/)[0]);
  const out = [];
  let size = 0;
  const seen = new Set();
  for (const sheet of sheets) {
    if (seen.has(sheet.key)) continue;
    seen.add(sheet.key);
    let root;
    try { root = postcss.parse(localize(sheet.text)); } catch { continue; }
    root.walkAtRules('import', (rule) => rule.remove());
    root.walkAtRules('charset', (rule) => rule.remove());
    root.walkAtRules('font-face', (rule) => {
      // Keep only the sources that were downloaded; a font with none left is removed (the page falls back to a system font).
      let kept = 0;
      rule.walkDecls('src', (decl) => {
        const sources = decl.value.split(/,(?![^()]*\))/).map((item) => item.trim()).filter((item) => {
          const urls = [...item.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1]);
          return urls.length > 0 && urls.every(isLocalUrl);
        });
        kept += sources.length;
        decl.value = sources.join(', ');
      });
      if (!kept) rule.remove();
    });
    root.walkDecls((decl) => {
      // A font that is not shipped (typekit, Google, custom) must fall back to something readable, not to a serif default.
      if (/^font-family$/i.test(decl.prop) && !/\b(?:sans-serif|serif|monospace|system-ui|cursive|fantasy|inherit|initial|unset)\b|var\(/i.test(decl.value)) {
        decl.value = `${decl.value}, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
      }
      if (!/url\(/i.test(decl.value)) return;
      decl.value = decl.value.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (match, ref) => (isLocalUrl(ref) ? match : 'none'));
      if (/^(?:background|background-image|border-image(?:-source)?|list-style(?:-image)?|mask(?:-image)?|content|cursor)$/i.test(decl.prop) && /^\s*(?:none[\s,]*)+$/i.test(decl.value)) decl.value = 'none';
    });
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent?.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
      if (parent?.type === 'atrule' && /^font-face$/i.test(parent.name)) return;
      rule.selector = splitSelectors(rule.selector).map((selector) => scopeSelector(classPrefix ? prefixSelectorClasses(selector, classPrefix) : selector, scope)).join(', ');
    });
    const css = root.toString();
    if (size + css.length > maxBytes) break;
    size += css.length;
    out.push(css);
  }
  return out.join('\n');
}

// Pages that fade content in on scroll, show a loader, or start elements invisible must not look empty once rebuilt.
function revealOverrides(scope = '.veave-fallback') {
  // Only explicit "starts hidden" markers and loaders. Elements with an inline opacity:0 are NOT forced visible here: many are
  // decorative overlays that must stay transparent (forcing them opaque covered a whole hero image). Hidden content that
  // really holds an image or text is found by rendering the page (findHiddenContent) and revealed by selector.
  return `
${scope} [data-aos], ${scope} .${CLASS_PREFIX}aos-init, ${scope} .${CLASS_PREFIX}elementor-invisible, ${scope} .${CLASS_PREFIX}wow { opacity: 1 !important; visibility: visible !important; transform: none !important; }
${scope} [class*="preloader"], ${scope} [class*="page-loader"], ${scope} [class*="loading-overlay"] { display: none !important; }
${scope} *, ${scope} *::before, ${scope} *::after { animation: none !important; transition: none !important; }
`;
}

/** CSS that shows content the original page only revealed with JavaScript, for the selectors found hidden in a render. */
function revealRulesFor(selectors, scope = '.veave-fallback') {
  return [...new Set(selectors)].filter((selector) => /^(?:\.[\w\\-]+)+$/.test(selector)).slice(0, 400)
    .map((selector) => `${scope} ${selector} { opacity: 1 !important; visibility: visible !important; transform: none !important; }`).join('\n');
}

module.exports = { CLASS_PREFIX, prefixSelectorClasses, prefixHtmlClasses, prefixClassList, revealRulesFor, collectPageStylesheets, buildScopedCss, revealOverrides, splitSelectors, scopeSelector, absolutizeUrls };
