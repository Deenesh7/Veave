const postcss = require('postcss');
const logger = require('../../utils/logger');

/**
 * Validate-and-repair loop for pages rebuilt from a captured website.
 *
 *   render the clone -> measure it against the REAL site (same in-page snapshot on both) -> list what differs
 *   -> the AI writes CSS overrides for exactly those differences -> render again -> keep them only if the page got closer.
 *
 * Nothing is assumed about the site: differences are measured (missing/invisible/collapsed images, text colour, font, size,
 * backgrounds, page height), and the model decides the CSS from the measured facts and the existing rules it is shown.
 * The model can only add CSS in one marked block of the captured stylesheet, so it can never break the build or touch code.
 */

const SITE_CSS_PATH = 'src/styles/captured-site.css';
const START = '/* veave-ai-repairs:start';
const END = 'veave-ai-repairs:end */';
const SCOPE = '.veave-fallback';
const MAX_BLOCK_BYTES = 16 * 1024;

const WEIGHT = { asset: 3, layout: 2, overlap: 2, typography: 1, color: 1, minor: 0.5 };
const categoryOf = (issue) => issue.category || (/image/.test(issue.kind || '') ? 'asset' : /scroll/.test(issue.kind || '') ? 'layout' : /overlap|clipped/.test(issue.kind || '') ? 'overlap' : 'minor');
const scoreOf = (issues) => issues.reduce((sum, issue) => sum + (WEIGHT[categoryOf(issue)] ?? 1), 0);

/** Runs inside the rendered page: what the elements behind each issue actually are (class chain, computed look). */
/* eslint-disable no-undef */
function describeElements(items) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const root = document.querySelector('.veave-fallback') || document.body;
  const labelOf = (el) => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
    return { tag: el.tagName.toLowerCase(), classes: cls };
  };
  const look = (el) => { const s = getComputedStyle(el); return { color: s.color, background: s.backgroundColor, fontFamily: s.fontFamily.slice(0, 60), fontSize: s.fontSize, fontWeight: s.fontWeight, opacity: s.opacity, visibility: s.visibility, display: s.display, width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) }; };
  const chainOf = (el) => { const chain = []; for (let n = el; n && n !== root.parentElement && chain.length < 5; n = n.parentElement) chain.push({ ...labelOf(n), ...(chain.length < 3 ? { style: look(n) } : {}) }); return chain; };
  const out = [];
  for (const item of items) {
    let found = null;
    if (item.image) {
      const want = norm(item.text);
      found = [...root.querySelectorAll('img')].find((img) => (want && norm(img.alt) === want) || (item.src && String(img.getAttribute('src') || '').includes(item.src)));
    } else {
      const want = norm(item.text).slice(0, 40);
      if (want.length >= 3) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        for (let n = walker.currentNode; n; n = walker.nextNode()) {
          const own = [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ');
          if (norm(own).startsWith(want)) { found = n; break; }
        }
      }
    }
    out.push({ key: item.key, found: Boolean(found), chain: found ? chainOf(found) : [] });
  }
  return out;
}
/* eslint-enable no-undef */

// One parse of the captured stylesheet (it can be several MB, with huge base64 fonts): class -> short rules that matter.
// Never regex-scan the raw text per class; that is quadratic on such files.
let indexCache = { key: '', value: null };
function ruleIndex(css) {
  const key = `${css.length}:${css.slice(0, 64)}:${css.slice(-64)}`;
  if (indexCache.key === key) return indexCache.value;
  const byClass = new Map();
  let root;
  try { root = postcss.parse(css); } catch { root = null; }
  if (root) {
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /font-face|keyframes/i.test(rule.parent.name)) return;
      const selector = rule.selector || '';
      if (selector.length > 300) return;
      const body = rule.nodes?.filter((n) => n.type === 'decl' && /^(?:opacity|color|font|font-family|font-size|font-weight|background|background-color|width|height|display|visibility|max-width|min-height|transform)$/.test(n.prop)).map((n) => `${n.prop}:${String(n.value).slice(0, 80)}`).join(';');
      if (!body) return;
      const text = `${selector}{${body}}`;
      if (text.length > 420) return;
      for (const m of selector.matchAll(/\.([\w-]+)/g)) {
        const list = byClass.get(m[1]) || [];
        if (list.length < 8) list.push(text);
        byClass.set(m[1], list);
      }
    });
  }
  indexCache = { key, value: byClass };
  return byClass;
}

/** The captured rules that mention the element's classes: what the model must override. */
function rulesFor(css, chain, limit = 6) {
  const index = ruleIndex(css);
  const found = [];
  for (const cls of [...new Set(chain.flatMap((c) => c.classes || []))].filter((c) => /^[\w-]+$/.test(c)).slice(0, 10)) {
    for (const rule of index.get(cls) || []) { if (!found.includes(rule)) found.push(rule); if (found.length >= limit) return found; }
  }
  return found;
}

/** The AI's reply must be plain CSS: parse it, scope every selector, and drop anything that is not a style rule. */
function sanitizeCss(raw) {
  const text = String(raw || '').replace(/```(?:css)?/gi, '').trim();
  if (!text) return { css: '', rules: 0, dropped: 0 };
  let root;
  try { root = postcss.parse(text); } catch (error) { return { css: '', rules: 0, dropped: 0, error: error.message }; }
  let dropped = 0;
  const keepDecl = (decl) => !/expression\s*\(|behavior\s*:|javascript:/i.test(decl.value) && !(/url\(/i.test(decl.value) && !/url\(\s*["']?(?:\/assets\/|data:image\/)/i.test(decl.value));
  root.walkDecls((decl) => { if (!keepDecl(decl)) { decl.remove(); dropped += 1; } });
  root.walkAtRules((rule) => { if (!/^(media|supports)$/i.test(rule.name)) { rule.remove(); dropped += 1; } });
  root.walkComments((c) => c.remove());
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    const selectors = rule.selectors.map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith(SCOPE) ? s : `${SCOPE} ${s.replace(/^(?:html|body|:root)\s*/i, '')}`.trim()));
    if (!selectors.length) { rule.remove(); dropped += 1; return; }
    rule.selector = selectors.join(', ');
  });
  root.walkRules((rule) => { if (!rule.nodes?.length) rule.remove(); });
  const css = root.toString().trim();
  return { css, rules: (css.match(/\{/g) || []).length, dropped };
}

const withBlock = (css, rules) => {
  const a = css.indexOf(START);
  const base = (a >= 0 ? css.slice(0, a) : css).replace(/\s+$/, '');
  return rules.trim() ? `${base}\n\n${START} (written by the validation loop; recomputed on every build) */\n${rules.trim()}\n/* ${END}\n` : `${base}\n`;
};
const currentBlock = (css) => { const a = css.indexOf(START); if (a < 0) return ''; const body = css.slice(css.indexOf('*/', a) + 2); return body.slice(0, body.indexOf(`/* ${END}`)).trim(); };

function buildMessages({ route, issues, described, css, previousCss }) {
  const items = issues.map((issue, i) => {
    const info = described.find((d) => d.key === i);
    const next = issue.otherText ? described.find((d) => d.key === `${i}:next`) : null;
    return { n: i + 1, kind: issue.kind, category: categoryOf(issue), ...(issue.viewport ? { viewportWidth: issue.viewport } : {}), what: issue.detail, real: issue.real, clone: issue.project, element: info?.found ? info.chain : 'not found in the clone', ...(next?.found ? { elementAfterTheGap: next.chain } : {}), capturedRules: [...new Set([...(info?.found ? rulesFor(css, info.chain) : []), ...(next?.found ? rulesFor(css, next.chain) : [])])].slice(0, 10) };
  });
  return [
    { role: 'system', content: `You repair visual differences between a website rebuilt from a captured copy and the REAL website, by writing CSS overrides.
The rebuilt page is the captured HTML of the real site WITHOUT the real site's JavaScript. So things the script normally did are missing: fading images in (opacity:0 until loaded), marking items as shown, sizing containers, choosing fonts and theme colours.
You receive measured differences (real vs clone), the clone's element class chain with its computed style, and the captured CSS rules that currently apply.
Reply with ONLY CSS in one \`\`\`css block. Rules:
- Fix only the listed differences. Use the class names given in the element chains; prefer the most specific chain so you change nothing else.
- An "extra-space" issue means the page has more empty space than the real page between two texts. The cause is in the sizing of the elements between them (fixed min-height/height, aspect-ratio padding set by the source's script, large margins/padding, empty spacers). Look at both element chains and the rules shown, and set those sizes to what the real page shows (the real distance is given), for example height:auto, min-height:0, padding-bottom or margin reduced.
- Override captured rules with !important where their specificity requires it. Make hidden images visible (opacity:1; visibility:visible), give collapsed containers a real width (width:100%), set the real colour/font/size where the real site differs.
- An issue with viewportWidth below 768 happens only on phones: fix it inside @media (max-width: 767px) so the desktop page is unchanged. A control the source's script would normally show or hide by screen size (menu buttons, mobile-only blocks) may be hidden when it is not meant to be visible at that width.
- Never hide real page content, never use @import, never use external urls, no JavaScript. Write at most 60 rules.
- If an issue is not CSS-fixable or you are unsure, skip it.` },
    { role: 'user', content: `Route: ${route}\n\nMEASURED DIFFERENCES (${items.length}):\n${JSON.stringify(items, null, 1).slice(0, 60000)}\n${previousCss ? `\nOVERRIDES ALREADY APPLIED (keep them; add only what is still needed):\n${previousCss.slice(0, 6000)}\n` : ''}\nReturn the additional CSS.` }
  ];
}

/**
 * @param {object} p
 * @param {Array}  p.files      project files (text + base64 binaries)
 * @param {string[]} p.routes   routes to check (home first)
 * @param {Function} p.render   async (files, { routePath, viewport, inspect, argument }) => value
 * @param {Function} p.reference async (routePath) => { url, snapshot }
 * @param {Function} p.ask      async (messages) => { content, usage? }   the model call (billed by the caller)
 * @param {object}   p.validation { defectInspector, compareWithReference, BLOCKING_KINDS }  from incrementalValidation
 * @param {object}   p.fidelity { pageSnapshot, compareStyles }
 */
const withTimeout = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms).unref())]);

async function runCloneVisualRepair({ files, routes = ['/'], render, reference, ask, validation, fidelity, maxPasses = 2, maxIssues = 25, signal, onState = async () => {}, viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }], budgetMs = Number(process.env.CLONE_VISUAL_REPAIR_BUDGET_MS) || 6 * 60 * 1000 }) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > budgetMs;
  const cssFile = files.find((f) => f.path === SITE_CSS_PATH);
  if (!cssFile || !files.some((f) => typeof f.content === 'string' && f.content.includes('veave-fallback'))) return { files, skipped: 'no captured pages', passes: [] };
  const viewport = viewports[0];
  const realByRoute = new Map();
  const realFor = async (route) => {
    if (realByRoute.has(route)) return realByRoute.get(route);
    let real = null;
    try { real = (await withTimeout(reference(route), 90000, 'reading the real page')).snapshot || null; } catch (error) { if (signal?.aborted) throw error; real = null; }
    realByRoute.set(route, real);
    return real;
  };

  const measure = async (candidate) => {
    const issues = [];
    for (const route of routes) {
      signal?.throwIfAborted();
      const real = await realFor(route);
      // Broken, collapsed, overlapping or overflowing content is checked at every viewport (a mobile menu button that the source's
      // script normally hides is only visible at phone width); the comparison with the real page runs at the desktop width.
      for (const vp of viewports) {
        let defects = [];
        try { defects = (await render(candidate, { routePath: route, viewport: vp, inspect: validation.defectInspector, argument: { limit: 40 } })).defects; } catch (error) { if (signal?.aborted) throw error; continue; }
        for (const defect of defects.filter((d) => validation.BLOCKING_KINDS.has(d.kind))) issues.push({ ...defect, route, viewport: vp.width, source: 'render-defect' });
      }
      if (real) {
        try {
          const snapshot = await render(candidate, { routePath: route, viewport, inspect: fidelity.pageSnapshot, argument: { maxTexts: 2500, maxImages: 1500 } });
          for (const issue of validation.compareWithReference(real, snapshot, fidelity).issues) issues.push({ ...issue, route, source: 'real-site-comparison' });
        } catch (error) { if (signal?.aborted) throw error; }
      }
    }
    return issues;
  };

  const passes = [];
  let current = files;
  let issues = await measure(current);
  const initial = { issues: issues.length, score: scoreOf(issues) };
  let accepted = '';
  for (let pass = 1; pass <= maxPasses && issues.length; pass += 1) {
    signal?.throwIfAborted();
    if (outOfTime()) { passes.push({ pass, result: 'stopped: time budget reached' }); break; }
    await onState(`Comparing the clone with the real site and repairing ${issues.length} difference(s) (pass ${pass} of ${maxPasses})...`);
    const top = [...issues].sort((a, b) => (WEIGHT[categoryOf(b)] ?? 1) - (WEIGHT[categoryOf(a)] ?? 1)).slice(0, maxIssues);
    const route = top[0].route || routes[0];
    const css = current.find((f) => f.path === SITE_CSS_PATH).content;
    const probes = top.flatMap((issue, key) => [
      { key, text: issue.text || '', src: issue.realSrc ? String(issue.realSrc).split('/').pop().split('?')[0] : (issue.src || ''), image: /image/.test(issue.kind || '') },
      // Extra space lies BETWEEN two texts: the elements that create it are on the way from the first to the second.
      ...(issue.otherText ? [{ key: `${key}:next`, text: issue.otherText, src: '', image: false }] : [])
    ]);
    let described = [];
    try { described = await render(current, { routePath: route, viewport, inspect: describeElements, argument: probes }); } catch (error) { if (signal?.aborted) throw error; }
    const record = { pass, issues: top.map(({ kind, detail, route: r }) => ({ kind, detail: String(detail || '').slice(0, 160), route: r })), before: scoreOf(issues), added: 0, result: 'pending' };
    passes.push(record);
    let reply;
    try { reply = await withTimeout(ask(buildMessages({ route, issues: top, described, css, previousCss: accepted })), 150000, 'the model call'); } catch (error) { if (signal?.aborted) throw error; record.result = `model call failed: ${String(error.message).slice(0, 120)}`; break; }
    const clean = sanitizeCss(reply?.content || '');
    if (!clean.css) { record.result = clean.error ? `the reply was not valid CSS (${clean.error.slice(0, 80)})` : 'the model proposed no CSS'; break; }
    const merged = `${accepted}\n${clean.css}`.trim();
    if (Buffer.byteLength(merged) > MAX_BLOCK_BYTES) { record.result = 'proposed CSS exceeds the size limit'; break; }
    const candidate = current.map((f) => (f.path === SITE_CSS_PATH ? { ...f, content: withBlock(f.content, merged) } : f));
    const next = await measure(candidate);
    record.added = clean.rules;
    record.after = scoreOf(next);
    // Kept only when the page measurably moved closer to the real site.
    if (record.after < record.before) { current = candidate; accepted = merged; issues = next; record.result = next.length ? `${next.length} difference(s) remain` : 'matches the real site'; }
    else { record.result = 'rejected: the page did not get closer to the real site'; break; }
  }
  const final = { issues: issues.length, score: scoreOf(issues) };
  if (passes.length) logger.info(`Clone visual repair: ${initial.issues} -> ${final.issues} difference(s) (score ${initial.score} -> ${final.score}).`);
  return { files: current, passes, initial, final, remaining: issues.slice(0, 15).map(({ kind, detail, route }) => ({ kind, detail: String(detail || '').slice(0, 160), route })) };
}

module.exports = { runCloneVisualRepair, sanitizeCss, withBlock, currentBlock, rulesFor, scoreOf, describeElements, SITE_CSS_PATH };
