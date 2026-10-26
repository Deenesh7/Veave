// Collects layout evidence from the real rendered DOM. collectInPage runs inside the browser (it must stay self-contained);
// collectLayout renders the project files and returns a structured snapshot plus an optional screenshot.
const { inspectRenderedPreview } = require('../ai/targetRenderVerifier');

const BREAKPOINTS = [['2xl', 1536], ['xl', 1280], ['lg', 1024], ['md', 768], ['sm', 640], ['base', 0]];
const breakpointFor = (width) => (BREAKPOINTS.find(([, min]) => width >= min) || BREAKPOINTS.at(-1))[0];

/** Runs in the page. Returns plain JSON: one record per visible element with rect (document coordinates) and computed styles. */
function collectInPage(options) {
  const maxElements = (options && options.maxElements) || 4000;
  const root = document.querySelector('#root') || document.body;
  const sx = window.scrollX; const sy = window.scrollY;
  const STYLE_KEYS = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderBottomWidth', 'height', 'minHeight', 'maxHeight', 'width', 'minWidth', 'maxWidth', 'display', 'position', 'top', 'bottom', 'left', 'visibility', 'opacity', 'overflowX', 'overflowY', 'rowGap', 'columnGap', 'transform', 'flexDirection', 'flexGrow', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'alignSelf', 'gridTemplateRows', 'gridAutoRows', 'aspectRatio', 'boxSizing', 'float', 'backgroundImage', 'backgroundColor', 'borderLeftWidth', 'borderRightWidth'];
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|LINK|META|TITLE|HEAD|TEMPLATE|BR|WBR)$/;
  const records = []; const indexOf = new Map(); const pathCache = new Map();
  const pathOf = (el) => {
    if (el === root) return 'root';
    if (pathCache.has(el)) return pathCache.get(el);
    const parent = el.parentElement; let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) n += 1;
    const value = `${parent ? pathOf(parent) : ''}>${el.tagName.toLowerCase()}:${n}`;
    pathCache.set(el, value); return value;
  };
  const all = root.querySelectorAll('*');
  for (const el of all) {
    if (records.length >= maxElements) break;
    if (SKIP.test(el.tagName) || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const style = {}; for (const key of STYLE_KEYS) style[key] = cs[key];
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    const replaced = /^(IMG|SVG|VIDEO|CANVAS|INPUT|SELECT|TEXTAREA|IFRAME|PICTURE|OBJECT|EMBED)$/i.test(el.tagName);
    const hidden = cs.visibility === 'hidden' || Number(cs.opacity) === 0 || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true' && cs.opacity === '0';
    let parentIndex = -1;
    for (let p = el.parentElement; p; p = p.parentElement) { if (indexOf.has(p)) { parentIndex = indexOf.get(p); break; } if (p === root) break; }
    const rect = { x: r.left + sx, y: r.top + sy, width: r.width, height: r.height, top: r.top + sy, left: r.left + sx, right: r.right + sx, bottom: r.bottom + sy };
    // The part of the element a viewer can actually see: its box intersected with every ancestor that clips overflow.
    // Frames that crop an image (overflow:hidden + aspect-ratio) are normal; only real loss of content counts as clipping.
    let clipped = false; let vis = null;
    if (!hidden && (ownText || replaced || cs.backgroundImage !== 'none')) {
      let v = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
        const b = p.getBoundingClientRect();
        if (ps.overflowX !== 'visible') { v.left = Math.max(v.left, b.left); v.right = Math.min(v.right, b.right); }
        if (ps.overflowY !== 'visible') { v.top = Math.max(v.top, b.top); v.bottom = Math.min(v.bottom, b.bottom); }
      }
      const full = r.width * r.height;
      const shown = Math.max(0, v.right - v.left) * Math.max(0, v.bottom - v.top);
      const lost = full > 0 ? 1 - shown / full : 0;
      clipped = ownText ? lost > 0.02 : lost > 0.35;
      vis = { top: v.top + sy, bottom: v.bottom + sy, left: v.left + sx, right: v.right + sx, width: Math.max(0, v.right - v.left), height: Math.max(0, v.bottom - v.top) };
    }
    indexOf.set(el, records.length);
    records.push({
      id: records.length, parent: parentIndex, path: pathOf(el), tag: el.tagName.toLowerCase(),
      cls: el.getAttribute('class') || '', domId: el.id || '', testId: el.getAttribute('data-testid') || '',
      label: (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || '').slice(0, 80),
      text: ownText.slice(0, 80), textLength: ownText.length, hasText: ownText.length > 0, replaced,
      paintsImage: cs.backgroundImage !== 'none', hidden, pending: el.tagName === 'IMG' && (!el.complete || el.naturalWidth === 0),
      inline: el.getAttribute('style') || '', rect, vis, style, clipped, childCount: el.children.length,
      busy: el.getAttribute('aria-busy') === 'true' || /skeleton|placeholder|loading|shimmer/i.test(el.getAttribute('class') || '')
    });
  }
  const doc = document.documentElement;
  return { viewport: { width: window.innerWidth, height: window.innerHeight }, scroll: { x: sx, y: sy }, docHeight: Math.max(doc.scrollHeight, document.body.scrollHeight), docWidth: Math.max(doc.scrollWidth, document.body.scrollWidth), elements: records };
}

/** Renders the project at one route/viewport and returns { snapshot, screenshot, errors }. */
async function collectLayout(files, { route = '/', viewport = { width: 1440, height: 900 }, signal, screenshot = false, maxElements } = {}) {
  let image = null;
  const errors = [];
  const snapshot = await inspectRenderedPreview(files, {
    signal, routePath: route, viewport, inspect: collectInPage, argument: { maxElements },
    onPage: async (page) => {
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      if (screenshot) image = await page.screenshot({ fullPage: true, type: 'png' }).catch(() => null);
    }
  });
  snapshot.route = route;
  snapshot.breakpoint = breakpointFor(snapshot.viewport.width);
  snapshot.errors = errors;
  return { snapshot, screenshot: image };
}

module.exports = { collectInPage, collectLayout, breakpointFor, BREAKPOINTS };
