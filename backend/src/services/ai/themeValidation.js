'use strict';

/**
 * Request-intent validation for theme changes ("change to light theme", "dark mode", "blue theme").
 *
 * Three independent pieces, all used by incrementalValidation:
 *  - extractThemeRequest: what the user asked for.
 *  - themeInspector / verifyThemeRequest: what the RENDERED page looks like (computed styles, not source text).
 *  - analyzeReach / themeSuspects: whether the files an edit touched are consumed by the running app at all, and which
 *    consumed files still hard-code the opposite theme (evidence for the repair model).
 */

const { reachableFromEntry } = require('./incrementalEditor');

const NAMED_COLORS = {
  red: [220, 38, 38], orange: [234, 88, 12], yellow: [234, 179, 8], green: [22, 163, 74], teal: [13, 148, 136],
  blue: [37, 99, 235], indigo: [79, 70, 229], purple: [147, 51, 234], violet: [124, 58, 237], pink: [219, 39, 119],
  brown: [120, 72, 40], gray: [107, 114, 128], grey: [107, 114, 128]
};

/** { mode: 'light' | 'dark' } or { mode: 'custom', color: {r,g,b}, label } when the request is a site-wide theme change, else null. */
function extractThemeRequest(prompt = '') {
  const text = String(prompt || '').toLowerCase();
  if (/\b(?:dark|night)\s+(?:theme|mode|look)\b|\b(?:theme|mode)\s+(?:to\s+)?dark\b|\bblack\s+(?:theme|background)\b/.test(text)) return { mode: 'dark' };
  if (/\b(?:light|day|white)\s+(?:theme|mode|look|background)\b|\b(?:theme|mode)\s+(?:to\s+)?(?:light|white)\b/.test(text)) return { mode: 'light' };
  const hex = text.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/);
  const named = text.match(new RegExp(`\\b(${Object.keys(NAMED_COLORS).join('|')})\\b`));
  const themeWord = /\b(?:theme|palette|colou?r\s+scheme)\b/.test(text);
  if (themeWord && (hex || named)) {
    let rgb;
    if (hex) {
      const value = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
      rgb = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
    } else rgb = NAMED_COLORS[named[1]];
    return { mode: 'custom', color: { r: rgb[0], g: rgb[1], b: rgb[2] }, label: hex ? `#${hex[1]}` : named[1] };
  }
  return null;
}

/* eslint-disable no-undef */
/**
 * Runs inside the rendered page (must stay self-contained). Measures what is actually painted:
 *  - the backdrop colour behind a grid of points over the whole page (media such as images/video/svg and elements with
 *    a background photo are excluded, so a dark logo or photograph never counts as a "dark page"),
 *  - large opaque surfaces, with their selector, colour and share of the page,
 *  - text whose colour has too little contrast against its real backdrop.
 */
function themeInspector(options) {
  const target = options && options.target;
  const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG', 'PICTURE', 'IFRAME', 'OBJECT', 'EMBED']);
  const parse = (value) => {
    const m = String(value).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrast = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const selectorOf = (el) => {
    const cls = String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`.slice(0, 80);
  };
  // The first opaque background behind an element, or "media" when a photo/image sits there.
  const backdrop = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (MEDIA.has(node.tagName.toUpperCase())) return { media: true };
      const style = getComputedStyle(node);
      if (/url\(/.test(style.backgroundImage || '')) return { media: true };
      const color = parse(style.backgroundColor);
      if (color && color.a > 0.5) return { color, owner: node };
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 }, owner: document.documentElement, implicit: true };
  };
  const docWidth = Math.max(document.documentElement.scrollWidth, innerWidth);
  const docHeight = Math.max(document.documentElement.scrollHeight, innerHeight);
  const originalY = scrollY;

  const samples = [];
  let media = 0;
  for (let row = 0; row < 8; row += 1) {
    const y = Math.min(docHeight - 1, Math.round(((row + 0.5) / 8) * docHeight));
    scrollTo(0, Math.max(0, y - innerHeight / 2));
    for (let col = 0; col < 6; col += 1) {
      const x = Math.round(((col + 0.5) / 6) * innerWidth);
      const hit = document.elementFromPoint(x, Math.min(innerHeight - 1, Math.max(0, y - scrollY)));
      if (!hit) continue;
      const found = backdrop(hit);
      if (found.media) { media += 1; continue; }
      samples.push({ l: lum(found.color), r: found.color.r, g: found.color.g, b: found.color.b });
    }
  }
  scrollTo(0, originalY);

  // Large opaque surfaces (cards, sections, containers): who paints them and in what colour.
  const surfaces = [];
  let scanned = 0;
  for (const el of document.querySelectorAll('body, body *')) {
    if (++scanned > 1500) break;
    if (MEDIA.has(el.tagName.toUpperCase())) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || /url\(/.test(style.backgroundImage || '')) continue;
    const color = parse(style.backgroundColor);
    if (!color || color.a < 0.5) continue;
    const rect = el.getBoundingClientRect();
    const share = (rect.width * rect.height) / (docWidth * docHeight);
    if (share >= 0.04) surfaces.push({ selector: selectorOf(el), color: `rgb(${color.r}, ${color.g}, ${color.b})`, l: lum(color), share: Math.round(share * 100) / 100 });
  }
  surfaces.sort((a, b) => b.share - a.share);

  // Text that cannot be read against what is behind it.
  const unreadable = [];
  let textNodes = 0;
  let textChecked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode() && textNodes < 400) {
    const node = walker.currentNode;
    if (!node.nodeValue || node.nodeValue.trim().length < 2) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
    seen.add(el);
    textNodes += 1;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0) continue;
    const fg = parse(style.color);
    const back = backdrop(el);
    if (!fg || back.media) continue;
    textChecked += 1;
    const ratio = contrast({ r: fg.r, g: fg.g, b: fg.b }, back.color);
    if (ratio < 3) unreadable.push({ selector: selectorOf(el), text: node.nodeValue.trim().slice(0, 40), color: `rgb(${fg.r}, ${fg.g}, ${fg.b})`, background: `rgb(${back.color.r}, ${back.color.g}, ${back.color.b})`, ratio: Math.round(ratio * 10) / 10 });
  }

  // Prominent controls painted in the requested colour (for custom colour themes).
  let controlsInTarget = 0;
  if (target) {
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      const color = parse(getComputedStyle(el).backgroundColor);
      if (color && color.a > 0.5 && Math.hypot(color.r - target.r, color.g - target.g, color.b - target.b) < 100) controlsInTarget += 1;
    }
  }

  const count = samples.length;
  return {
    samples: count, media,
    darkShare: count ? samples.filter((s) => s.l < 0.18).length / count : 0,
    lightShare: count ? samples.filter((s) => s.l > 0.5).length / count : 0,
    targetShare: target && count ? samples.filter((s) => Math.hypot(s.r - target.r, s.g - target.g, s.b - target.b) < 100).length / count : 0,
    controlsInTarget,
    surfaces: surfaces.slice(0, 12),
    textChecked, unreadableCount: unreadable.length, unreadable: unreadable.slice(0, 8)
  };
}
/* eslint-enable no-undef */

const pct = (value) => `${Math.round(value * 100)}%`;
const describeSurfaces = (surfaces, test) => surfaces.filter(test).slice(0, 3).map((item) => `${item.selector} ${item.color} (${pct(item.share)} of the page)`).join('; ');

/** Judges one route's measurement against the request. Pure, so it can be tested without a browser. */
function verifyThemeRequest(requested, measured) {
  if (!measured) return { ok: true, skipped: true, detail: 'the page colours could not be measured' };
  if (!measured.samples) return { ok: true, skipped: true, detail: 'the page is made only of images or media, so no surface colour could be measured', measured };
  const problems = [];
  if (requested.mode === 'light') {
    if (!(measured.lightShare >= 0.6 && measured.darkShare <= 0.25)) {
      const dark = describeSurfaces(measured.surfaces || [], (item) => item.l < 0.18);
      problems.push(`${pct(measured.darkShare)} of the sampled page area still has a dark background and ${pct(measured.lightShare)} a light one${dark ? `; dark surfaces: ${dark}` : ''}`);
    }
  } else if (requested.mode === 'dark') {
    if (!(measured.darkShare >= 0.6 && measured.lightShare <= 0.25)) {
      const light = describeSurfaces(measured.surfaces || [], (item) => item.l > 0.5);
      problems.push(`${pct(measured.lightShare)} of the sampled page area still has a light background and ${pct(measured.darkShare)} a dark one${light ? `; light surfaces: ${light}` : ''}`);
    }
  } else if (requested.mode === 'custom') {
    if (!(measured.targetShare >= 0.25 || measured.controlsInTarget >= 3)) {
      problems.push(`the requested colour ${requested.label} is barely present: ${pct(measured.targetShare)} of the sampled page area and ${measured.controlsInTarget} button/link surfaces use it`);
    }
  }
  // Readability: a theme that leaves text unreadable has not been applied correctly, whichever theme it is.
  if (measured.unreadableCount >= 3 && measured.unreadableCount / Math.max(1, measured.textChecked) > 0.1) {
    problems.push(`${measured.unreadableCount} of ${measured.textChecked} text elements are unreadable (contrast below 3:1), e.g. ${(measured.unreadable || []).slice(0, 3).map((item) => `"${item.text}" in ${item.selector}: ${item.color} on ${item.background} (${item.ratio}:1)`).join('; ')}`);
  }
  return { ok: problems.length === 0, measured, detail: problems.length ? problems.join('. ') : `the rendered page matches the requested ${requested.mode === 'custom' ? requested.label : requested.mode} theme` };
}

/** Combines per-route verdicts: the theme only passes when every measured route passes. */
function summarizeThemeRoutes(requested, perRoute) {
  const measured = perRoute.filter((entry) => !entry.skipped);
  if (!measured.length) return { ok: true, skipped: true, routes: perRoute, detail: perRoute[0]?.detail || 'no route could be measured' };
  const failing = measured.filter((entry) => !entry.ok);
  const label = requested.mode === 'custom' ? requested.label : requested.mode;
  const detail = failing.length
    ? `The rendered website is not ${label} on ${failing.length} of ${measured.length} route(s). ${failing.map((entry) => `${entry.route}: ${entry.detail}`).join(' | ')}${measured.length > failing.length ? ` Routes that already match: ${measured.filter((entry) => entry.ok).map((entry) => entry.route).join(', ')}.` : ''}`
    : `all ${measured.length} measured route(s) render the requested ${label} theme (${measured.map((entry) => entry.route).join(', ')})`;
  return { ok: failing.length === 0, routes: perRoute, failingRoutes: failing.map((entry) => entry.route), detail };
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Does an edited file reach the running app?                                                                     */
/* -------------------------------------------------------------------------------------------------------------- */

const normalize = (list) => (Array.isArray(list) ? list : []).filter((file) => file && typeof file.path === 'string');
const isText = (file) => file && file.encoding !== 'base64' && typeof file.content === 'string';
const CONFIG_FILE = /^(?:tailwind|postcss|vite|webpack|next|craco|svelte|nuxt)\.config\.[cm]?[jt]s$|^index\.html$/i;
// Files that are served or read by tooling regardless of imports, so an edit to them is never "ineffective".
const ALWAYS_CONSUMED = /^(?:package(?:-lock)?\.json|(?:ts|js)config[\w.-]*\.json|manifest\.json|\.[\w.-]+|public\/.*|README\.md)$/i;
const DYNAMIC_LOADER = /import\.meta\.glob\s*\(|require\.context\s*\(/;

function resolveRelative(fromPath, spec, paths) {
  const clean = String(spec).split(/[?#]/)[0];
  const candidates = [];
  if (clean.startsWith('.')) {
    const parts = fromPath.split('/').slice(0, -1);
    for (const segment of clean.split('/')) { if (segment === '.' || segment === '') continue; if (segment === '..') parts.pop(); else parts.push(segment); }
    candidates.push(parts.join('/'));
  } else if (clean.startsWith('/')) {
    const rooted = clean.replace(/^\/+/, '');
    candidates.push(`public/${rooted}`, rooted, `src/${rooted}`);
  } else return null;
  for (const candidate of candidates) {
    for (const suffix of ['', '.json', '.css', '.scss']) if (paths.has(candidate + suffix)) return candidate + suffix;
  }
  return null;
}

/**
 * Which files the running application really consumes: everything reachable by import from the entry files, plus
 * stylesheets pulled in by @import / url(), and JSON/CSS/assets named by a reachable file, the build config or index.html.
 * A JSON file that is imported under a name but never used is NOT consumed.
 */
function consumedPaths(files) {
  const all = normalize(files);
  const reachable = reachableFromEntry(all);
  if (!reachable) return null;
  const byPath = new Map(all.map((file) => [file.path, file]));
  const paths = new Set(byPath.keys());
  const consumed = new Set(reachable);
  let dynamic = false;
  const queue = [...consumed];
  for (const file of all) if (CONFIG_FILE.test(file.path) && !consumed.has(file.path)) { consumed.add(file.path); queue.push(file.path); }

  const unusedJson = new Map(); // target JSON -> files that import it under a name they never use
  const ref = /['"`(]\s*((?:\.{1,2}\/|\/)[\w@./~-]+\.(?:json|css|scss|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf))(?:[?#][^'"`)\s]*)?\s*['"`)]/g;
  const cssImport = /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g;
  const addReference = (from, spec) => {
    const target = resolveRelative(from, spec, paths);
    if (target && !consumed.has(target)) { consumed.add(target); queue.push(target); }
  };
  while (queue.length) {
    const file = byPath.get(queue.pop());
    if (!isText(file)) continue;
    if (DYNAMIC_LOADER.test(file.content)) dynamic = true;
    for (const match of file.content.matchAll(ref)) {
      // import tokens from './tokens.json': counts only when the imported name is used somewhere else in the file.
      if (/\.json$/i.test(match[1])) {
        const target = resolveRelative(file.path, match[1], paths);
        const bound = file.content.match(new RegExp(`import\\s+(?:\\*\\s+as\\s+)?([A-Za-z_$][\\w$]*)\\s+from\\s+['"]${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        if (target && bound) {
          const withoutImports = file.content.replace(/^\s*import\s[^;\n]*;?/gm, '');
          const uses = (withoutImports.match(new RegExp(`\\b${bound[1].replace(/\$/g, '\\$')}\\b`, 'g')) || []).length;
          if (uses === 0) { if (!unusedJson.has(target)) unusedJson.set(target, new Set()); unusedJson.get(target).add(file.path); continue; }
        }
      }
      addReference(file.path, match[1]);
    }
    if (/\.s?css$/i.test(file.path)) for (const match of file.content.matchAll(cssImport)) addReference(file.path, match[1].startsWith('.') || match[1].startsWith('/') ? match[1] : `./${match[1]}`);
  }
  for (const [target, unusedImporters] of unusedJson) {
    // An unused import does not make the file consumed unless something else (another importer or the config) uses it.
    const usedElsewhere = all.some((file) => isText(file) && file.path !== target && consumed.has(file.path) && !unusedImporters.has(file.path) && file.content.includes(target.split('/').pop()));
    if (!usedElsewhere) consumed.delete(target);
  }
  return { consumed, reachable, dynamic };
}

/**
 * Do the files this edit changed influence the running app? Returns the verdict with the evidence.
 * 'skipped' when it cannot be known (no entry file, nothing relevant changed, or files loaded by a dynamic glob).
 */
function analyzeReach(beforeFiles, afterFiles, changedPaths = []) {
  const before = new Map(normalize(beforeFiles).map((file) => [file.path, file.content]));
  const after = new Map(normalize(afterFiles).map((file) => [file.path, file.content]));
  const changed = [...new Set(changedPaths)].filter((filePath) => before.get(filePath) !== after.get(filePath));
  const relevant = changed.filter((filePath) => /\.(?:jsx?|tsx?|css|scss|json)$/i.test(filePath) && !ALWAYS_CONSUMED.test(filePath));
  if (!relevant.length) return { status: 'skipped', detail: 'no application code, stylesheet or data file was changed', ineffective: [], effective: [] };
  const info = consumedPaths(afterFiles);
  if (!info) return { status: 'skipped', detail: 'no entry file found', ineffective: [], effective: [] };
  const effective = relevant.filter((filePath) => info.consumed.has(filePath));
  const ineffective = relevant.filter((filePath) => !info.consumed.has(filePath));
  if (effective.length) {
    return { status: 'passed', detail: `the changed file(s) ${effective.join(', ')} are part of the running app${ineffective.length ? `; ${ineffective.join(', ')} ${ineffective.length === 1 ? 'is' : 'are'} not used by it` : ''}`, effective, ineffective };
  }
  if (info.dynamic && ineffective.every((filePath) => /\.(?:json|css|scss)$/i.test(filePath))) {
    return { status: 'skipped', detail: `${ineffective.join(', ')} may be loaded through a dynamic import (import.meta.glob / require.context), so its effect cannot be verified statically`, effective, ineffective };
  }
  return {
    status: 'failed',
    detail: `${ineffective.join(', ')} ${ineffective.length === 1 ? 'is' : 'are'} not imported, referenced or read by the running app, so the edit changes nothing the user sees`,
    effective, ineffective,
    paintingFiles: [...info.consumed].filter((filePath) => /\.(?:jsx|tsx|css|scss)$/i.test(filePath) || filePath === 'index.html').slice(0, 30)
  };
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Evidence for the repair model: consumed files that still hard-code the old theme                               */
/* -------------------------------------------------------------------------------------------------------------- */

const SHADES = 'gray|zinc|slate|neutral|stone';
const DARK_PATTERNS = [
  new RegExp(`\\bbg-(?:black|(?:${SHADES})-(?:[6-9]00|950))\\b`, 'g'),
  /\bbg-\[#(?:[0-3][0-9a-f]{5}|[0-3][0-9a-f]{2})\]/gi,
  /\btext-white\b/g,
  /\btext-\[#(?:[e-f][0-9a-f]{5})\]/gi,
  /(?:background(?:-color)?)\s*:\s*(?:#(?:[0-3][0-9a-f]){3}|#[0-3][0-9a-f]{2}\b|black|rgb\(\s*[0-5]?\d\s*,)/gi,
  /(?<![\w-])color\s*:\s*(?:#(?:[e-f][0-9a-f]){3}|white)/gi
];
const LIGHT_PATTERNS = [
  new RegExp(`\\bbg-(?:white|(?:${SHADES})-(?:50|100|200))\\b`, 'g'),
  /\bbg-\[#(?:[e-f][0-9a-f]{5})\]/gi,
  new RegExp(`\\btext-(?:black|(?:${SHADES})-(?:700|800|900|950))\\b`, 'g'),
  /(?:background(?:-color)?)\s*:\s*(?:#(?:[e-f][0-9a-f]){3}|white)/gi
];

/** Files the running app consumes that still hard-code the colours of the OLD theme, with counts and examples. */
function themeSuspects(files, requested) {
  if (!requested || requested.mode === 'custom') return [];
  const info = consumedPaths(files);
  const patterns = requested.mode === 'light' ? DARK_PATTERNS : LIGHT_PATTERNS;
  const suspects = [];
  for (const file of normalize(files)) {
    if (!isText(file) || !/\.(?:jsx|tsx|js|css|scss|html)$/i.test(file.path)) continue;
    if (info && !info.consumed.has(file.path)) continue;
    const found = patterns.flatMap((pattern) => file.content.match(pattern) || []);
    if (found.length) suspects.push({ path: file.path, count: found.length, examples: [...new Set(found.map((item) => item.trim()))].slice(0, 4) });
  }
  return suspects.sort((a, b) => b.count - a.count).slice(0, 10);
}

module.exports = { extractThemeRequest, themeInspector, verifyThemeRequest, summarizeThemeRoutes, consumedPaths, analyzeReach, themeSuspects };
