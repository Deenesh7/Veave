// "Make the footer black with white text": finds the region on the page the user is looking at (not a file with a similar
// name), styles exactly that element through one scoped rule, and verifies colours, readability and that nothing else moved
// or changed colour, in a real browser. Escalates specificity and clears conflicting descendant backgrounds when needed.
const { inspectRenderedPreview } = require('../ai/targetRenderVerifier');
const { parseStyleRequest, rgbOf } = require('./styleIntent');
const { appendBeforeManagedBlocks } = require('./minimalPatchGenerator');
const { resolveSource } = require('./sourceLocationResolver');

const STATES = Object.freeze({ DIAGNOSIS_PENDING: 'DIAGNOSIS_PENDING', CAUSE_IDENTIFIED: 'CAUSE_IDENTIFIED', PATCH_APPLIED: 'PATCH_APPLIED', BUILD_PASSED: 'BUILD_PASSED', RENDER_VERIFIED: 'RENDER_VERIFIED', REGRESSION_PASSED: 'REGRESSION_PASSED', VERIFICATION_FAILED: 'VERIFICATION_FAILED' });

/** In the page: the best element for the named region (semantic tag/role first, then id, then class) and a selector for it. */
function findTargetInPage({ word }) {
  const root = document.querySelector('#root') || document.body;
  const roles = { footer: 'contentinfo', header: 'banner', nav: 'navigation', banner: 'banner', sidebar: 'complementary', menu: 'menu' };
  const tags = { footer: ['FOOTER'], header: ['HEADER'], nav: ['NAV'], sidebar: ['ASIDE'], menu: ['NAV'], banner: [], hero: [] };
  const wordRe = new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i');
  const depthOf = (n) => { let d = 0; while (n.parentElement) { n = n.parentElement; d += 1; } return d; };
  const scored = [];
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 10) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed' && r.height < 20) continue;
    let score = 0;
    if ((tags[word] || []).includes(el.tagName)) score = 100;
    else if (el.getAttribute('role') === roles[word]) score = 90;
    else if (wordRe.test(el.id || '')) score = 70;
    else if (wordRe.test(String(el.getAttribute('class') || '').split(/\s+/).join(' '))) score = 50;
    if (score) scored.push({ el, score, depth: depthOf(el), area: r.width * r.height });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.depth - b.depth || b.area - a.area);
  const el = scored[0].el;
  const uniq = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const scoped = Boolean(el.closest('.veave-fallback'));
  let selector = '';
  if (el.id && uniq(`#${CSS.escape(el.id)}`)) selector = `#${CSS.escape(el.id)}`;
  else {
    const classes = [...el.classList].filter((c) => /^[\w-]+$/.test(c) && !/\d{4,}/.test(c));
    const base = el.tagName.toLowerCase() + classes.map((c) => `.${CSS.escape(c)}`).join('');
    selector = `${scoped ? '.veave-fallback ' : ''}${base}`;
    if (!uniq(selector)) {
      const parts = []; for (let n = el; n && n !== root; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i += 1; parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`); }
      selector = `#root > ${parts.join(' > ')}`;
    }
  }
  const r = el.getBoundingClientRect();
  return { tag: el.tagName.toLowerCase(), id: el.id, cls: String(el.getAttribute('class') || ''), selector, scoped, score: scored[0].score, alternatives: scored.length, rect: { top: Math.round(r.top + scrollY), height: Math.round(r.height), width: Math.round(r.width) }, text: (el.innerText || '').trim().slice(0, 80) };
}

/** In the page: computed colours of the region, its readable text with effective backgrounds, and a fingerprint of everything else. */
function inspectStyleInPage({ selector }) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const parse = (value) => { const m = String(value).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const effBg = (node) => { for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0.5) return { rgb: c.slice(0, 3), node: n }; } return { rgb: [255, 255, 255], node: null }; };
  const pathOf = (n) => { const parts = []; for (; n && n !== el.parentElement && n.parentElement; n = n.parentElement) { let i = 1; for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i += 1; parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`); } return parts.join(' > '); };
  // Every opaque layer inside the region that sits under a piece of text, found geometrically (hit testing would miss layers
  // with pointer-events:none, which is how decorative section backgrounds are usually made).
  const texts = []; const layers = new Map();
  const region = el.getBoundingClientRect(); const regionArea = Math.max(1, region.width * region.height);
  const all = [...el.querySelectorAll('*')];
  const opaque = all.map((n) => { const c = parse(getComputedStyle(n).backgroundColor); return c[3] > 0.5 ? { n, rgb: c.slice(0, 3), rect: n.getBoundingClientRect() } : null; }).filter((x) => x && x.rect.width > 0 && x.rect.height > 0);
  const candidates = all.filter((node) => [...node.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
  const step = Math.max(1, Math.ceil(candidates.length / 200));
  for (let i = 0; i < candidates.length; i += step) {
    const node = candidates[i];
    const r = node.getBoundingClientRect(); const cs = getComputedStyle(node);
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
    const under = opaque.filter((o) => cx >= o.rect.left && cx <= o.rect.right && cy >= o.rect.top && cy <= o.rect.bottom);
    const own = parse(getComputedStyle(el).backgroundColor);
    const painters = under.map((o) => ({ rgb: o.rgb, area: (o.rect.width * o.rect.height) / regionArea, n: o.n }));
    texts.push({ tag: node.tagName.toLowerCase(), text: node.textContent.trim().slice(0, 30), color: parse(cs.color).slice(0, 3), bg: painters.length ? painters[painters.length - 1].rgb : (own[3] > 0.5 ? own.slice(0, 3) : effBg(el).rgb), layers: painters.map((p) => ({ rgb: p.rgb, area: p.area })) });
    for (const p of painters) layers.set(p.n, { rgb: p.rgb, area: p.area });
  }
  const offenders = [];
  for (const [n, info] of layers) offenders.push({ selector: `${selector} ${pathOf(n)}`.replace(`${selector} ${pathOf(el)}`, selector), rgb: info.rgb, area: info.area });
  const outside = []; let hash = 5381;
  for (const node of document.querySelectorAll('#root *')) {
    if (el.contains(node) || node.contains(el)) continue;
    const cs = getComputedStyle(node); const s = `${node.tagName}${cs.color}${cs.backgroundColor}`;
    for (let i = 0; i < s.length; i += 1) hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  const cs = getComputedStyle(el);
  return { found: true, bg: parse(cs.backgroundColor), color: parse(cs.color).slice(0, 3), texts, offenders: [...offenders].slice(0, 40), outsideHash: hash, docHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), docWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), textCount: texts.length };
}

async function dominantColor(png) {
  if (!png) return null;
  try {
    const sharp = require('sharp');
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const buckets = new Map(); const total = info.width * info.height;
    for (let i = 0; i < data.length; i += 3 * 4) { const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4); const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n += 1; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; buckets.set(k, b); }
    const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    return { rgb: [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)], share: top.n / (total / 4) };
  } catch { return null; }
}
const near = (a, b, tol = 12) => a && b && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tol);
const lum = ([r, g, b]) => { const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** The rule for one attempt; `level` escalates only when the previous level measurably failed. */
function buildRule({ selector, background, color, level, offenders = [], derivedColor = null }) {
  const imp = level >= 1 ? ' !important' : '';
  const fg = color || derivedColor;
  const decl = [background && `background-color:${background}${imp}`, fg && `color:${fg}${imp}`].filter(Boolean).join(';');
  const rules = [`${selector}{${decl}}`];
  if (fg) rules.push(`${selector} *{color:${fg}${imp}}`);
  if (background && level >= 1 && offenders.length) rules.push(`${offenders.join(',')}{background-color:transparent !important}`);
  return rules.join('\n');
}

function pickStylesheet(files, descriptor) {
  const sheets = files.filter((f) => f.encoding !== 'base64' && /\.css$/i.test(f.path || ''));
  if (descriptor.scoped) { const captured = sheets.find((f) => f.path === 'src/styles/captured-site.css'); if (captured) return captured; }
  const css = resolveSource(files, { tag: descriptor.tag, cls: descriptor.cls, domId: descriptor.id, inline: '' }).css.filter((c) => !c.inline);
  const owner = css.length && sheets.find((f) => f.path === css[css.length - 1].file);
  return owner || sheets.find((f) => /(^|\/)(index|App|globals?|styles?)\.css$/i.test(f.path)) || sheets[0] || null;
}

async function runElementStyleEngine({ files, route = '/', request = '', intent = parseStyleRequest(request), viewport = { width: 1440, height: 900 }, maxAttempts = 3, signal, inspect = inspectRenderedPreview, onState = null } = {}) {
  const report = { status: 'unresolved', state: STATES.DIAGNOSIS_PENDING, transitions: [], route, request, intent, attempts: [], files, changes: [] };
  const move = (state, detail) => { report.state = state; report.transitions.push({ state, detail: detail || null }); if (onState) { try { onState(state, detail); } catch { /* reporting only */ } } };
  if (!intent) { report.status = 'not-a-style-request'; return report; }
  const render = (list, fn, argument) => inspect(list, { signal, routePath: route, viewport, inspect: fn, argument });
  move(STATES.DIAGNOSIS_PENDING, `looking for the ${intent.target} on ${route}`);
  let descriptor; let before;
  try {
    descriptor = await render(files, findTargetInPage, { word: intent.target });
    if (descriptor) before = await render(files, inspectStyleInPage, { selector: descriptor.selector });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    report.status = 'verification-unavailable'; report.reason = `The page could not be rendered, so the ${intent.target} could not be located or verified: ${error.message}`; move(STATES.VERIFICATION_FAILED, report.reason); return report;
  }
  if (!descriptor || !before?.found) { report.status = 'target-not-found'; report.reason = `No ${intent.target} was found on the rendered page ${route}.`; move(STATES.VERIFICATION_FAILED, report.reason); return report; }
  report.target = descriptor;
  move(STATES.CAUSE_IDENTIFIED, `${descriptor.tag}${descriptor.id ? `#${descriptor.id}` : ''} at ${descriptor.rect.top}px (${descriptor.selector})`);
  const sheet = pickStylesheet(files, descriptor);
  if (!sheet) { report.status = 'unresolved'; report.reason = 'the project has no stylesheet to carry the rule'; move(STATES.VERIFICATION_FAILED, report.reason); return report; }
  const wantBg = intent.background && rgbOf(intent.background); const wantFg = intent.color && rgbOf(intent.color);
  let offenders = []; let derivedColor = null;
  for (let level = 0; level < maxAttempts; level += 1) {
    signal?.throwIfAborted();
    const rule = buildRule({ selector: descriptor.selector, background: intent.background, color: intent.color, level, offenders, derivedColor });
    const block = `/* veave: ${intent.target} restyle (${[intent.background && `background ${intent.background}`, intent.color && `text ${intent.color}`].filter(Boolean).join(', ')}) */\n${rule}\n`;
    const patched = files.map((f) => (f.path === sheet.path ? { ...f, content: appendBeforeManagedBlocks(f.content, block) } : f));
    const attempt = { level, file: sheet.path, rule, status: 'pending' }; report.attempts.push(attempt);
    move(STATES.PATCH_APPLIED, `${sheet.path}: ${descriptor.selector} (specificity level ${level})`);
    let after;
    let shot = null;
    try { after = await inspect(patched, { signal, routePath: route, viewport, inspect: inspectStyleInPage, argument: { selector: descriptor.selector }, onPage: async (page) => { shot = await page.locator(descriptor.selector).first().screenshot().catch(() => null); } }); } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      attempt.status = 'rolled-back'; attempt.detail = `the patched project did not render: ${error.message}`; move(STATES.VERIFICATION_FAILED, attempt.detail); continue;
    }
    move(STATES.BUILD_PASSED);
    const checks = [];
    const add = (name, ok, detail) => checks.push({ name, status: ok ? 'passed' : 'failed', detail });
    if (wantBg) add('background-applied', near(after.bg.slice(0, 3), wantBg) && after.bg[3] > 0.9, `${intent.target} background is rgb(${after.bg.slice(0, 3).map(Math.round)})`);
    const wrongText = wantFg ? after.texts.filter((t) => !near(t.color, wantFg)) : [];
    if (wantFg) add('text-color-applied', after.textCount > 0 && !wrongText.length, `${after.textCount - wrongText.length}/${after.textCount} text elements have the requested colour${wrongText.length ? `, e.g. "${wrongText[0].text}"` : ''}`);
    const wrongBg = wantBg ? after.texts.filter((t) => t.layers.some((l) => !near(l.rgb, wantBg, 24))) : [];
    if (wantBg) add('no-light-patches', !wrongBg.length, wrongBg.length ? `${wrongBg.length} text element(s) sit on another background layer, e.g. "${wrongBg[0].text}"` : 'every text element sits on the requested background');
    if (wantBg) { const pix = await dominantColor(shot); if (pix) add('screenshot-background', pix.share >= 0.3 && near(pix.rgb, wantBg, 24), `the dominant colour of the rendered ${intent.target} is rgb(${pix.rgb}) (${Math.round(pix.share * 100)}% of its pixels)`); }
    const unreadable = after.texts.filter((t) => contrast(t.color, t.bg) < 3);
    add('text-readable', !unreadable.length, unreadable.length ? `${unreadable.length} text element(s) have contrast below 3:1, e.g. "${unreadable[0].text}"` : 'all text has at least 3:1 contrast');
    add('rest-of-page-unchanged', after.outsideHash === before.outsideHash, after.outsideHash === before.outsideHash ? 'colours outside the region are identical' : 'colours of elements outside the region changed');
    add('layout-unchanged', Math.abs(after.docHeight - before.docHeight) <= 4 && after.docWidth <= Math.max(before.docWidth, viewport.width + 1) + 2, `page height ${before.docHeight}px -> ${after.docHeight}px`);
    attempt.checks = checks;
    move(STATES.RENDER_VERIFIED, checks.filter((c) => c.status === 'passed').length + '/' + checks.length + ' checks');
    if (checks.every((c) => c.status === 'passed')) {
      attempt.status = 'verified'; report.files = patched; report.changes.push({ file: sheet.path, kind: 'css-append', selector: descriptor.selector, description: `${descriptor.selector}: ${block.split('\n')[0].replace(/\/\*|\*\//g, '').trim()}` });
      report.status = 'fixed'; move(STATES.REGRESSION_PASSED, 'colours verified, rest of the page unchanged'); return report;
    }
    attempt.status = 'rolled-back';
    const failed = checks.filter((c) => c.status === 'failed');
    attempt.detail = failed.map((c) => `${c.name}: ${c.detail}`).join('; ');
    if (failed.every((c) => c.name === 'rest-of-page-unchanged' || c.name === 'layout-unchanged')) break; // more specificity cannot fix a side effect
    // Layers that are large, or that the new text colour could not be read on, are the ones to clear.
    const textRgb = wantFg || (derivedColor && rgbOf(derivedColor)) || [255, 255, 255];
    const toClear = after.offenders.filter((o) => wantBg && !near(o.rgb, wantBg, 24) && (o.area >= 0.2 || contrast(textRgb, o.rgb) < 3)).map((o) => o.selector);
    offenders = [...new Set([...offenders, ...toClear])];
    if (!wantFg && unreadable.length) derivedColor = lum(wantBg || after.bg.slice(0, 3)) < 0.4 ? '#ffffff' : '#000000';
    move(STATES.VERIFICATION_FAILED, attempt.detail);
  }
  report.status = 'unresolved'; report.reason = 'no rule passed verification; the project was not changed';
  return report;
}

module.exports = { runElementStyleEngine, findTargetInPage, inspectStyleInPage, buildRule, pickStylesheet, contrast, STATES };
