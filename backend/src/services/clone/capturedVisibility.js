const capturedCss = require('./capturedCss');

/**
 * Guard for pages rebuilt from a captured copy of a source website (`.veave-fallback` + src/styles/captured-site.css).
 * The captured HTML runs without the source site's JavaScript, and that script is what made some content visible: it fades
 * images in, marks gallery tiles as shown, and sizes image containers. Without it the images load but stay invisible or 0px wide.
 *
 * This guard RENDERS the pages, finds images that loaded but cannot be seen, and writes CSS that shows them. It is idempotent
 * (one marked block that is recomputed each time) and is only kept when a second render proves it helped.
 */

const SITE_CSS_PATH = 'src/styles/captured-site.css';
const START = '/* veave-visibility-guard:start';
const END = 'veave-visibility-guard:end */';

const hasCapturedPages = (files) => files.some((f) => f.path === SITE_CSS_PATH) && files.some((f) => typeof f.content === 'string' && f.content.includes('veave-fallback') && /\.(?:jsx?|tsx?)$/.test(f.path));

function routesToCheck(files) {
  const app = files.find((f) => f.path === 'src/App.jsx');
  const known = String(app?.content || '').match(/VEAVE_KNOWN_ROUTES\s*=\s*(\[[^\]]*\])/);
  try { const list = known ? JSON.parse(known[1]) : []; if (list.length) return list.slice(0, 12); } catch { /* fall through */ }
  return ['/'];
}

/** Runs inside the rendered page: images that loaded but are invisible or collapsed, with the class selectors to repair. */
function inspectImages() {
  const root = document.querySelector('.veave-fallback');
  if (!root) return { hidden: [], collapsed: [], hiddenCount: 0, collapsedCount: 0 };
  const intended = /(modal|menu|dropdown|popup|overlay|lightbox|tooltip|search|cart|drawer|cookie|mobile|hamburger|folder|subnav|skip|sr-only|screen-reader|hidden-)/i;
  const selectorOf = (el) => {
    const classes = [...el.classList].filter((n) => /^[\w-]+$/.test(n) && !/[0-9]{4,}/.test(n));
    return classes.length && !intended.test(classes.join(' ')) ? classes.slice(0, 3).map((n) => `.${CSS.escape(n)}`).join('') : null;
  };
  const hidden = new Set();
  const collapsed = new Set();
  let hiddenCount = 0;
  let collapsedCount = 0;
  for (const img of root.querySelectorAll('img')) {
    if (!(img.naturalWidth > 0)) continue; // really broken images are a different problem
    // Anything intentionally not displayed (other breakpoints, closed menus) is left alone.
    let el = img; let displayNone = false;
    while (el && el !== root.parentElement) { if (getComputedStyle(el).display === 'none') { displayNone = true; break; } el = el.parentElement; }
    if (displayNone) continue;
    const rect = img.getBoundingClientRect();
    // 1) hidden by opacity/visibility on the image or an ancestor
    let node = img; let culprit = null;
    while (node && node !== root.parentElement) { const s = getComputedStyle(node); if (s.opacity === '0' || s.visibility === 'hidden') { culprit = node; break; } node = node.parentElement; }
    if (culprit) {
      hiddenCount += 1;
      const sel = selectorOf(culprit);
      if (sel && !(culprit.closest('[aria-hidden="true"],[hidden]'))) hidden.add(sel);
      continue;
    }
    // 2) laid out with no width: the zero-width chain between the image and the first ancestor that has room
    if (rect.width < 2 && rect.height > 2) {
      collapsedCount += 1;
      node = img;
      while (node && node !== root && node.getBoundingClientRect().width < 2) { const sel = selectorOf(node); if (sel) collapsed.add(sel); node = node.parentElement; }
    }
  }
  return { hidden: [...hidden].slice(0, 300), collapsed: [...collapsed].slice(0, 120), hiddenCount, collapsedCount };
}

function guardBlock({ hidden, collapsed }) {
  const lines = [];
  const reveal = capturedCss.revealRulesFor(hidden);
  if (reveal) lines.push('/* shown: images the source site faded in with JavaScript */', reveal);
  const sizes = [...new Set(collapsed)].filter((s) => /^(?:\.[\w\\-]+)+$/.test(s));
  if (sizes.length) lines.push('/* sized: image containers the source site measured with JavaScript */', ...sizes.map((s) => `.veave-fallback ${s} { width: 100% !important; max-width: 100% !important; }`), '.veave-fallback img { height: auto; }');
  return lines.length ? `${START} (generated; recomputed on every build) */\n${lines.join('\n')}\n/* ${END}\n` : '';
}

const withBlock = (css, block) => {
  const a = css.indexOf(START);
  const base = (a >= 0 ? css.slice(0, a) : css).replace(/\s+$/, '');
  return block ? `${base}\n\n${block}` : `${base}\n`;
};

function sum(results) {
  return results.reduce((t, r) => ({ hiddenCount: t.hiddenCount + r.hiddenCount, collapsedCount: t.collapsedCount + r.collapsedCount, hidden: [...t.hidden, ...r.hidden], collapsed: [...t.collapsed, ...r.collapsed] }), { hiddenCount: 0, collapsedCount: 0, hidden: [], collapsed: [] });
}

/**
 * @param files project files (text files with content; binaries as base64)
 * @param render async (files, route) => result of inspectImages (injectable for tests); defaults to the real preview renderer
 * @returns {{files, applied:boolean, before, after, routes}}
 */
async function ensureCapturedContentVisible(files, { signal, render = null, routes = null } = {}) {
  if (!hasCapturedPages(files)) return { files, applied: false, skipped: 'no captured pages' };
  const run = render || ((list, routePath) => require('../ai/targetRenderVerifier').inspectRenderedPreview(list, { signal, routePath, inspect: inspectImages }));
  const list = routes || routesToCheck(files);
  const measure = async (candidate) => {
    const results = [];
    for (const route of list) { signal?.throwIfAborted(); results.push(await run(candidate, route)); }
    return sum(results);
  };
  const cssOf = (candidate) => candidate.find((f) => f.path === SITE_CSS_PATH);
  // Measure WITHOUT any earlier guard block so stale rules are recomputed from the real page.
  const cleaned = files.map((f) => (f.path === SITE_CSS_PATH ? { ...f, content: withBlock(f.content, '') } : f));
  const before = await measure(cleaned);
  if (!before.hiddenCount && !before.collapsedCount) {
    const unchanged = cssOf(files).content === cssOf(cleaned).content;
    return { files: unchanged ? files : cleaned, applied: false, before, after: before, routes: list };
  }
  const block = guardBlock(before);
  if (!block) return { files, applied: false, before, after: before, routes: list, skipped: 'nothing could be targeted by class' };
  const repaired = cleaned.map((f) => (f.path === SITE_CSS_PATH ? { ...f, content: withBlock(f.content, block) } : f));
  const after = await measure(repaired);
  // Keep the rules only when they genuinely reduced the problem.
  if (after.hiddenCount + after.collapsedCount < before.hiddenCount + before.collapsedCount) return { files: repaired, applied: true, before, after, routes: list };
  return { files, applied: false, before, after, routes: list, skipped: 'rules did not improve the render' };
}

module.exports = { ensureCapturedContentVisible, inspectImages, guardBlock, hasCapturedPages, routesToCheck, SITE_CSS_PATH };
