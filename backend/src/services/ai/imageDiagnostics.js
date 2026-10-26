/**
 * Why does an image that loads render with no width?
 *
 * The visual validator reports "collapsed-image" (natural size > 0, rendered width or height 0). That says WHAT is wrong, not
 * WHY, and a correction model that is only told "it renders 0x189" guesses (it widens the image, adds !important, or rewrites the
 * container). This module measures the real cause in the browser and turns it into a structured diagnostic:
 *
 *   inspector      runs inside the rendered page: the image, its ancestors, computed layout properties, rectangles and the CSS rules
 *                  (with their media conditions) that match them
 *   classify       decides from that evidence which kind of collapse it is
 *   buildDiagnostic   the object handed to the repair model and stored in the job report
 *   candidateFiles / snippetsAround   which project files really contain the culprit's classes, and the relevant parts of them
 */

const crypto = require('crypto');

/* eslint-disable no-undef */
/** Runs in the page (self-contained). argument: { srcs: [file basenames], max?: number } */
function collapsedImageInspector(argument) {
  const wanted = new Set((argument && argument.srcs) || []);
  const maxImages = (argument && argument.max) || 6;
  const fileOf = (img) => (img.currentSrc || img.src || '').split('?')[0].split('/').pop();
  const label = (el) => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`.slice(0, 110);
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
  const PROPS = ['display', 'visibility', 'position', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'gridColumnStart', 'gridColumnEnd', 'gridArea', 'gridTemplateColumns', 'gridAutoColumns', 'objectFit', 'transform', 'aspectRatio', 'overflowX', 'boxSizing', 'cssFloat', 'left', 'right', 'inset'];
  const computed = (el) => { const s = getComputedStyle(el); const out = {}; for (const p of PROPS) out[p] = s[p]; return out; };
  const RELEVANT = /width|flex|grid|display|position|transform|aspect|max-|min-|float|inset|left:|right:|margin|padding|object-fit|overflow|contain|zoom|scale/i;
  const sheets = [];
  for (const sheet of document.styleSheets) { try { void sheet.cssRules; sheets.push(sheet); } catch (error) { /* cross-origin */ } }
  const rulesFor = (el, cap) => {
    const found = [];
    const visit = (rules, media) => {
      for (const rule of rules) {
        if (found.length >= cap) return;
        if (rule.cssRules && rule.type !== 1) { // @media / @supports / @layer
          const condition = rule.conditionText || rule.media?.mediaText || '';
          const active = rule.media ? window.matchMedia(rule.media.mediaText).matches : true;
          if (active) visit(rule.cssRules, condition ? `@media ${condition}` : media);
          continue;
        }
        if (!rule.selectorText || !rule.style) continue;
        let hit = false;
        try { hit = el.matches(rule.selectorText); } catch (error) { hit = false; }
        if (hit && RELEVANT.test(rule.style.cssText)) found.push({ selector: rule.selectorText.slice(0, 160), media: media || null, css: rule.style.cssText.slice(0, 260), sheet: rule.parentStyleSheet && rule.parentStyleSheet.href ? rule.parentStyleSheet.href.split('/').pop() : 'inline <style>' });
      }
    };
    for (const sheet of sheets) { visit(sheet.cssRules, null); if (found.length >= cap) break; }
    const inline = el.getAttribute && el.getAttribute('style');
    if (inline && RELEVANT.test(inline)) found.push({ selector: '[style attribute]', media: null, css: inline.slice(0, 260), sheet: 'inline' });
    return found;
  };

  const boxes = {};
  for (const img of document.images) { const r = img.getBoundingClientRect(); const f = fileOf(img); if (f && !(f in boxes) && Object.keys(boxes).length < 400) boxes[f] = [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }

  const images = [];
  for (const img of document.images) {
    if (images.length >= maxImages) break;
    const file = fileOf(img);
    if (!wanted.has(file)) continue;
    const chain = [];
    let totalRules = 0;
    for (let node = img, depth = 0; node && node !== document.documentElement && depth < 7; node = node.parentElement, depth += 1) {
      const rules = totalRules < 36 ? rulesFor(node, 8) : [];
      totalRules += rules.length;
      chain.push({ label: label(node), rect: rectOf(node), computed: computed(node), rules });
    }
    images.push({
      src: file, natural: [img.naturalWidth, img.naturalHeight], rect: rectOf(img), complete: img.complete,
      attributes: { width: img.getAttribute('width'), height: img.getAttribute('height'), class: img.getAttribute('class'), style: (img.getAttribute('style') || '').slice(0, 240), sizes: img.getAttribute('sizes'), loading: img.getAttribute('loading') },
      chain
    });
  }
  return { viewport: [window.innerWidth, window.innerHeight], images, boxes };
}
/* eslint-enable no-undef */

const px = (value) => { const n = parseFloat(value); return Number.isFinite(n) ? n : null; };
const isZeroSize = (rect) => !rect || rect[2] < 1;

/**
 * Decides which kind of collapse this is from the measured chain (image first, then its ancestors).
 * Returns { cause, culprit, reason, rule }.
 */
function classify(image) {
  const chain = image.chain || [];
  const own = chain[0];
  if (!own) return { cause: 'unknown', culprit: null, reason: 'the image could not be measured', rule: null };
  // The element that is the highest one still at zero width: its parent has width. That is where the width is lost.
  let index = 0;
  while (index + 1 < chain.length && isZeroSize(chain[index + 1].rect)) index += 1;
  const culprit = chain[index];
  const parent = chain[index + 1] || null;
  const c = culprit.computed;
  const p = parent ? parent.computed : null;
  // The rule that actually sets a zero width: it must win over the harmless width rules (width:100%) matched on the same element.
  const zeroRule = (el) => (el.rules || []).find((rule) => /(?:^|[;\s])(?:max-)?width:\s*0(?:px|%)?\s*(?:!important)?\s*(?:;|$)/i.test(rule.css)) || null;
  const pick = (el, ...needles) => (el.rules || []).find((rule) => needles.some((needle) => rule.css.toLowerCase().includes(needle))) || null;

  if (/scale\(0|matrix\(0[ ,]|scaleX\(0/i.test(c.transform || '')) return { cause: 'transform-collapse', culprit: culprit.label, reason: `${culprit.label} has transform ${c.transform}`, rule: pick(culprit, 'transform') };
  if (index === 0) {
    const widthRule = zeroRule(culprit) || pick(culprit, 'width');
    if (px(c.maxWidth) === 0 || px(c.width) === 0 && /width:\s*0/i.test(widthRule?.css || '') || (widthRule && /(?:^|[;\s])(?:max-)?width:\s*0(?:px|%)?\s*(?:!important)?\s*(?:;|$)/i.test(widthRule.css))) {
      return { cause: 'conflicting-css-width', culprit: culprit.label, reason: `a CSS rule sets the image width to 0 (${widthRule ? `${widthRule.selector}${widthRule.media ? ` in ${widthRule.media}` : ''}` : 'computed max-width 0'})`, rule: widthRule };
    }
    if (p && /flex/.test(p.display) && px(c.flexBasis) === 0) return { cause: 'flex-item-collapsed', culprit: culprit.label, reason: 'the image is a flex item with flex-basis 0 and no width of its own', rule: pick(culprit, 'flex') };
    if (p && /flex/.test(p.display) && Number(c.flexShrink) > 0 && px(c.width) === 0) return { cause: 'flex-item-collapsed', culprit: culprit.label, reason: 'the flex item shrank to zero (flex-shrink > 0 and nothing keeps its width)', rule: pick(culprit, 'flex', 'width') };
    if (p && /grid/.test(p.display)) return { cause: 'grid-track-zero', culprit: culprit.label, reason: `the image sits in a grid (${p.gridTemplateColumns}) whose track for it is 0 wide`, rule: pick(parent, 'grid') };
    if (c.position === 'absolute' || c.position === 'fixed') return { cause: 'absolute-without-width', culprit: culprit.label, reason: 'the image is absolutely positioned with no width or inset on both sides, so it takes no space', rule: pick(culprit, 'position', 'width', 'left', 'right', 'inset') };
    return { cause: 'image-own-width-zero', culprit: culprit.label, reason: `the image itself computes to width ${c.width} (display ${c.display})`, rule: pick(culprit, 'width') };
  }
  // An ancestor is the zero-width element: the image inherits a width of nothing (width:100%, auto, or absolute inside it).
  if (p && /flex/.test(p.display)) {
    return { cause: 'flex-item-collapsed', culprit: culprit.label, reason: `${culprit.label} is a flex item of ${parent.label} (${p.display}) and collapsed to 0 wide (flex ${c.flexGrow} ${c.flexShrink} ${c.flexBasis}, width ${c.width})`, rule: pick(culprit, 'flex', 'width') || pick(parent, 'flex') };
  }
  if (p && /grid/.test(p.display)) {
    return { cause: 'grid-track-zero', culprit: culprit.label, reason: `${culprit.label} is placed in grid ${parent.label} (columns ${p.gridTemplateColumns}; its column ${c.gridColumnStart}/${c.gridColumnEnd}, area ${c.gridArea}) and that track is 0 wide`, rule: pick(culprit, 'grid') || pick(parent, 'grid') };
  }
  if (c.position === 'absolute' || c.position === 'fixed') {
    return { cause: 'absolute-without-width', culprit: culprit.label, reason: `${culprit.label} is absolutely positioned with width ${c.width} and nothing inside it gives it a width`, rule: pick(culprit, 'position', 'width', 'left', 'right', 'inset') };
  }
  const widthRule = zeroRule(culprit) || pick(culprit, 'width');
  if (px(c.width) === 0 || px(c.maxWidth) === 0 || (widthRule && /(?:^|[;\s])(?:max-)?width:\s*0/.test(widthRule.css))) {
    return { cause: 'conflicting-css-width', culprit: culprit.label, reason: `${culprit.label} has width ${c.width}${widthRule ? ` from ${widthRule.selector}${widthRule.media ? ` in ${widthRule.media}` : ''}` : ''}`, rule: widthRule };
  }
  return { cause: 'container-width-zero', culprit: culprit.label, reason: `${culprit.label} has no width (display ${c.display}, width ${c.width}, parent ${parent ? parent.label : 'none'} is ${parent ? parent.rect[2] : '?'}px wide)`, rule: pick(culprit, 'width', 'display') };
}

const CLASS_RE = /[A-Za-z_][\w-]{2,}/g;
/** Class names / ids of the culprit and the first ancestors, used to find the files that define them. */
function tokensOf(image, culprit) {
  const out = new Set();
  const chain = image.chain || [];
  const from = Math.max(0, chain.findIndex((node) => node.label === culprit));
  for (const node of chain.slice(from, from + 4)) for (const part of String(node.label).split(/[.#]/).slice(1)) if (part.length >= 3) out.add(part);
  return [...out].slice(0, 8);
}

/** Project text files that really contain the culprit's classes (stylesheets and markup), best first. */
function candidateFiles(files, image, culprit, { limit = 4 } = {}) {
  const tokens = tokensOf(image, culprit);
  const src = String(image.src || '').split('.')[0];
  const ranked = [];
  for (const file of files || []) {
    if (!file || file.encoding === 'base64' || typeof file.content !== 'string' || !/\.(?:css|scss|jsx?|tsx?|html)$/i.test(file.path)) continue;
    let hits = 0;
    for (const token of tokens) { let at = file.content.indexOf(token); let n = 0; while (at !== -1 && n < 50) { n += 1; at = file.content.indexOf(token, at + token.length); } hits += n; }
    if (src.length > 4 && file.content.includes(src)) hits += 5;
    if (hits) ranked.push({ path: file.path, hits, kind: /\.(?:css|scss)$/i.test(file.path) ? 'stylesheet' : 'markup', chars: file.content.length });
  }
  return ranked.sort((a, b) => b.hits - a.hits).slice(0, limit);
}

/** The parts of a (possibly huge) file around the given tokens, as verbatim text a SEARCH block can copy. */
function snippetsAround(content, tokens, { radius = 450, max = 6 } = {}) {
  const text = String(content || '');
  const spans = [];
  for (const token of tokens) {
    let at = text.indexOf(token);
    let n = 0;
    while (at !== -1 && n < 3) { spans.push([Math.max(0, at - radius), Math.min(text.length, at + token.length + radius)]); n += 1; at = text.indexOf(token, at + token.length + radius); }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) { const last = merged[merged.length - 1]; if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]); }
  return merged.slice(0, max).map(([from, to]) => text.slice(from, to));
}

/**
 * The structured diagnostic for one collapsed image.
 * `baseline` = { boxes } measured on the page BEFORE the edit (same route and viewport), or null.
 */
function buildDiagnostic({ image, route, viewport, baseline = null, files = [] }) {
  const verdict = classify(image);
  const before = baseline && baseline.boxes ? baseline.boxes[image.src] : null;
  const chain = image.chain || [];
  const culpritNode = chain.find((node) => node.label === verdict.culprit) || chain[0];
  const was = before ? `${before[0]}x${before[1]}` : null;
  return {
    category: 'image-zero-width',
    route, viewport,
    asset: image.src,
    expected: 'the image is visible with a non-zero rendered width and height, keeping its aspect ratio',
    observed: `renders ${image.rect[2]}x${image.rect[3]}px (natural ${image.natural[0]}x${image.natural[1]})${was ? `; before the edit ${was}px` : ''}`,
    changedFromBaseline: before ? (before[0] >= 1 && image.rect[2] < 1) : null,
    cause: verdict.cause,
    culprit: verdict.culprit,
    reason: verdict.reason,
    rule: verdict.rule,
    evidence: {
      image: { rect: image.rect, natural: image.natural, attributes: image.attributes, computed: chain[0] ? chain[0].computed : null },
      culprit: culpritNode ? { label: culpritNode.label, rect: culpritNode.rect, computed: culpritNode.computed, rules: culpritNode.rules } : null,
      ancestors: chain.slice(0, 6).map((node) => ({ label: node.label, rect: node.rect, display: node.computed.display, position: node.computed.position, width: node.computed.width, flex: `${node.computed.flexGrow} ${node.computed.flexShrink} ${node.computed.flexBasis}`, grid: node.computed.display.includes('grid') ? node.computed.gridTemplateColumns : undefined }))
    },
    candidateFiles: candidateFiles(files, image, verdict.culprit),
    requiredAction: `Fix the verified cause (${verdict.cause}) on ${verdict.culprit}: ${verdict.reason}. Do not just enlarge the image; correct the rule or the layout that removes its width, keep aspect ratio and the requested arrangement.`
  };
}

/** Same defect, same measurements? Used to tell an ineffective correction from a partial one. */
function measurementSignature(diagnostics = []) {
  const parts = diagnostics.map((d) => `${d.asset}:${d.evidence?.image?.rect?.slice(2).join('x')}:${d.cause}:${d.culprit}`).sort();
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

module.exports = { collapsedImageInspector, classify, buildDiagnostic, candidateFiles, snippetsAround, tokensOf, measurementSignature };
