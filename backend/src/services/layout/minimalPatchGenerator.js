// Produces the smallest source edit that changes ONE measured property of ONE element by a known amount.
// Order of preference: inline style (most specific, element-local) -> Tailwind utility on that element -> the CSS rule
// that styles it. Nothing else in the file is touched. Returns null when no safe edit exists.
const { resolveSource, splitClasses } = require('./sourceLocationResolver');

const TW = { paddingTop: ['pt', 'py', 'p'], paddingBottom: ['pb', 'py', 'p'], paddingLeft: ['pl', 'px', 'p'], paddingRight: ['pr', 'px', 'p'], marginTop: ['mt', 'my', 'm'], marginBottom: ['mb', 'my', 'm'], marginLeft: ['ml', 'mx', 'm'], marginRight: ['mr', 'mx', 'm'], height: ['h'], minHeight: ['min-h'], width: ['w'], minWidth: ['min-w'], rowGap: ['gap-y', 'gap'], columnGap: ['gap-x', 'gap'], top: ['top'], left: ['left'] };
const EXPAND = { py: ['pt', 'pb'], px: ['pl', 'pr'], p: ['pt', 'pr', 'pb', 'pl'], my: ['mt', 'mb'], mx: ['ml', 'mr'], m: ['mt', 'mr', 'mb', 'ml'], gap: ['gap-x', 'gap-y'] };
const SIDE_OF = { paddingTop: 'pt', paddingBottom: 'pb', paddingLeft: 'pl', paddingRight: 'pr', marginTop: 'mt', marginBottom: 'mb', marginLeft: 'ml', marginRight: 'mr', rowGap: 'gap-y', columnGap: 'gap-x' };
const MIN_BP = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
// Regions the validation loops regenerate on every build (everything from the marker to the end of the file is rewritten),
// so a permanent rule must be placed BEFORE them or it would be silently deleted.
const MANAGED_MARKERS = ['/* veave-ai-repairs:start', '/* veave-visibility-guard:start'];
function appendBeforeManagedBlocks(sheet, rule) {
  const positions = MANAGED_MARKERS.map((marker) => sheet.indexOf(marker)).filter((i) => i >= 0);
  if (!positions.length) return sheet.replace(/\s+$/, '') + '\n' + rule;
  const at = Math.min(...positions);
  return `${sheet.slice(0, at).replace(/\s+$/, '')}\n${rule}\n${sheet.slice(at)}`;
}
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const fmt = (n) => String(Math.round(n * 100) / 100);

const TOKEN = /^((?:[^\s:]+:)*)(-?)(p[trblxy]?|m[trblxy]?|gap-x|gap-y|gap|min-h|min-w|h|w|top|left)-(\[[^\]]+\]|[\d.]+|px|screen)$/;
function tokenPx(value, viewport) {
  if (value === 'px') return 1;
  if (value === 'screen') return viewport.height;
  const arb = value.match(/^\[(-?[\d.]+)(px|rem|em|vh)?\]$/);
  if (arb) { const n = Number(arb[1]); return arb[2] === 'rem' || arb[2] === 'em' ? n * 16 : arb[2] === 'vh' ? n * viewport.height / 100 : n; }
  return /^[\d.]+$/.test(value) ? Number(value) * 4 : null;
}
/** Priority of a variant prefix at the given width, or null when it does not apply (hover:, dark:, other breakpoints). */
function variantPriority(prefix, width) {
  if (!prefix) return 0;
  const parts = prefix.split(':').filter(Boolean);
  let priority = 0;
  for (const part of parts) {
    if (MIN_BP[part]) { if (width < MIN_BP[part]) return null; priority = Math.max(priority, MIN_BP[part]); continue; }
    const max = part.match(/^max-\[(\d+)px\]$/) || (part.startsWith('max-') && MIN_BP[part.slice(4)] ? [null, MIN_BP[part.slice(4)] - 1] : null);
    if (max) { if (width > Number(max[1])) return null; priority = Math.max(priority, 5000 - Number(max[1])); continue; }
    return null;
  }
  return priority;
}

function tailwindEdit(literal, property, currentPx, newPx, viewport) {
  const families = TW[property];
  if (!families) return null;
  const tokens = literal.split(/(\s+)/);
  let best = null;
  tokens.forEach((raw, index) => {
    const m = raw.match(TOKEN);
    if (!m || m[2] || !families.includes(m[3])) return;
    const priority = variantPriority(m[1], viewport.width);
    if (priority === null) return;
    const value = tokenPx(m[4], viewport);
    if (value === null) return;
    const specificity = families.indexOf(m[3]); // exact utility beats the axis shorthand beats p-*
    if (!best || priority > best.priority || (priority === best.priority && specificity < best.specificity)) best = { index, prefix: m[1], family: m[3], value, priority, specificity, raw };
  });
  if (!best) return null;
  if (Math.abs(best.value - currentPx) > Math.max(2, currentPx * 0.03)) return null; // that utility is not what produced the measured value
  const removable = ['h', 'min-h', 'w', 'min-w'].includes(best.family) && newPx <= 8;
  const own = SIDE_OF[property] || best.family;
  const replacement = removable ? '' : `${best.prefix}${own}-${newPx <= 0 ? '0' : `[${fmt(newPx)}px]`}`;
  const parts = [];
  if (EXPAND[best.family] && best.family !== own) for (const side of EXPAND[best.family]) if (side !== own) parts.push(`${best.prefix}${side}-${best.raw.replace(TOKEN, '$4')}`);
  const next = [...tokens];
  next[best.index] = [...(EXPAND[best.family] && best.family !== own ? [...parts, replacement] : [replacement])].filter(Boolean).join(' ');
  const joined = next.join('').replace(/\s{2,}/g, ' ').trim();
  return { literal: joined, from: best.raw, to: next[best.index] || '(removed)' };
}

function inlineEdit(tagSource, property, currentPx, newPx) {
  const camel = new RegExp(`(\\b${property})(\\s*:\\s*)(['"\`]?)(-?[\\d.]+)(px|rem)?(\\3)`);
  const m = tagSource.match(camel);
  if (m) {
    const old = Number(m[4]) * (m[5] === 'rem' ? 16 : 1);
    if (Math.abs(old - currentPx) > Math.max(2, currentPx * 0.03)) return null;
    const value = m[3] || m[5] ? `${m[3] || "'"}${fmt(newPx)}px${m[3] || "'"}` : fmt(newPx);
    return { source: tagSource.replace(camel, `$1$2${value}`), from: m[0], to: `${m[1]}${m[2]}${value}` };
  }
  const css = new RegExp(`(${kebab(property)})(\\s*:\\s*)(-?[\\d.]+)(px|rem)?`);
  const k = tagSource.match(css);
  if (k) {
    const old = Number(k[3]) * (k[4] === 'rem' ? 16 : 1);
    if (Math.abs(old - currentPx) > Math.max(2, currentPx * 0.03)) return null;
    return { source: tagSource.replace(css, `$1$2${fmt(newPx)}px`), from: k[0], to: `${k[1]}${k[2]}${fmt(newPx)}px` };
  }
  return null;
}

const toPx = (value) => { const m = String(value).trim().match(/^(-?[\d.]+)(px|rem|em)?$/); return m ? Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1) : null; };

function cssEdit(source, location, property, currentPx, newPx) {
  const longhand = kebab(property);
  const family = longhand.startsWith('padding') ? 'padding' : longhand.startsWith('margin') ? 'margin' : longhand === 'row-gap' ? 'gap' : null;
  const side = { top: 0, right: 1, bottom: 2, left: 3 }[longhand.split('-')[1]];
  const decls = location.rule.declarations;
  const direct = [...decls].reverse().find((d) => d.prop === longhand);
  const short = family && [...decls].reverse().find((d) => d.prop === family);
  const apply = (decl, value) => ({ source: source.slice(0, decl.start) + value + source.slice(decl.end), from: `${decl.prop}: ${decl.value}`, to: `${decl.prop}: ${value}` });
  const directIdx = direct ? decls.indexOf(direct) : -1; const shortIdx = short ? decls.indexOf(short) : -1;
  if (direct && directIdx > shortIdx) { const old = toPx(direct.value); if (old === null || Math.abs(old - currentPx) > Math.max(2, currentPx * 0.03)) return null; return apply(direct, `${fmt(newPx)}px`); }
  if (short && side !== undefined && family !== 'gap') {
    const parts = short.value.split(/\s+/).map(toPx);
    if (parts.some((p) => p === null) || parts.length > 4) return null;
    const full = [parts[0], parts[1] ?? parts[0], parts[2] ?? parts[0], parts[3] ?? parts[1] ?? parts[0]];
    if (Math.abs(full[side] - currentPx) > Math.max(2, currentPx * 0.03)) return null;
    full[side] = newPx;
    return apply(short, full.map((n) => `${fmt(n)}px`).join(' '));
  }
  if (direct) { const old = toPx(direct.value); if (old !== null && Math.abs(old - currentPx) <= Math.max(2, currentPx * 0.03)) return apply(direct, `${fmt(newPx)}px`); }
  return null;
}

/**
 * @param files      project files (not mutated)
 * @param candidate  ranked candidate from LayoutCauseAnalyzer
 * @param element    snapshot element record for candidate.path
 * @param reduction  px to remove along the axis
 * @returns { files, change, expected } | { error }
 */
function generatePatch(files, candidate, element, { reduction, viewport, hints = {} } = {}) {
  if (!candidate.patchable) return { error: `no safe automatic patch for cause type "${candidate.type}"` };
  const property = candidate.property;
  const current = candidate.current ?? 0;
  const newPx = Math.max(0, Math.round((current - reduction) * 100) / 100);
  const resolved = resolveSource(files, element, { ...hints, viewportWidth: viewport.width });
  const edit = (fileIndex, content) => files.map((f, i) => (i === fileIndex ? { ...f, content } : f));
  const fileIndex = (path) => files.findIndex((f) => f.path === path);
  if (candidate.type === 'box-model') {
    // Append one scoped rule to the stylesheet that already styles this element; no existing declaration is touched.
    const locations = resolved.css.filter((c) => !c.inline);
    const loc = locations[locations.length - 1];
    const classes = splitClasses(element.cls).filter((c) => /^[\w-]+$/.test(c));
    if (!loc || !classes.length) return { error: 'no stylesheet that styles this element was found for a box-sizing rule', searched: resolved.files };
    const index = fileIndex(loc.file);
    const sheet = files[index].content;
    const head = loc.selector.split(/\s+/)[0];
    const scoped = /^\.[\w-]+$/.test(head) && loc.selector.includes(' ') && (sheet.split(head + ' ').length - 1) >= Math.max(3, resolved.css.length / 2);
    const selector = `${scoped ? `${head} ` : ''}${classes.map((c) => `.${c}`).join('')}`;
    if (sheet.includes(`${selector}{box-sizing:border-box}`)) return { error: 'the box-sizing rule is already present' };
    const rule = `\n/* veave: padding and min-height are counted together (border-box) so the box is not taller than its content */\n${selector}{box-sizing:border-box}\n`;
    return { files: edit(index, appendBeforeManagedBlocks(sheet, rule.trim() + '\n')), change: { file: loc.file, kind: 'css-append', selector, from: 'box-sizing: content-box', to: 'box-sizing: border-box', description: `${selector}: box-sizing content-box -> border-box (removes ${Math.round(reduction)}px)` }, expected: { property: 'boxSizing', from: current, to: 'border-box' }, shared: true };
  }

  // spacer elements: delete the empty element when the whole box is the excess
  if (candidate.type === 'spacer' && newPx <= 8) {
    for (const loc of resolved.markup) {
      const file = files[fileIndex(loc.file)];
      const tail = file.content.slice(loc.tagEnd);
      const closed = loc.selfClosing ? { end: loc.tagEnd } : (tail.match(new RegExp(`^\\s*</${loc.tagName}>`)) ? { end: loc.tagEnd + tail.match(new RegExp(`^\\s*</${loc.tagName}>`))[0].length } : null);
      if (!closed || resolved.markup.filter((m) => m.file === loc.file && m.literal === loc.literal).length > 1 && !loc.textHit && resolved.markup.length > 1) continue;
      const before = file.content.slice(0, loc.tagStart).replace(/[ \t]*$/, '');
      const content = before + file.content.slice(closed.end).replace(/^\s*\n/, '\n');
      return { files: edit(fileIndex(loc.file), content), change: { file: loc.file, kind: 'remove-spacer', from: file.content.slice(loc.tagStart, closed.end).slice(0, 160), to: '(removed)', description: `removed empty spacer <${loc.tagName}> (${current}px)` }, expected: { property, from: current, to: 0 } };
    }
  }
  for (const loc of resolved.markup) {
    const file = files[fileIndex(loc.file)];
    const tag = file.content.slice(loc.tagStart, loc.tagEnd);
    const inline = inlineEdit(tag, property, current, newPx);
    if (inline) return { files: edit(fileIndex(loc.file), file.content.slice(0, loc.tagStart) + inline.source + file.content.slice(loc.tagEnd)), change: { file: loc.file, kind: 'inline-style', from: inline.from, to: inline.to, description: `${property} ${current}px -> ${newPx}px` }, expected: { property, from: current, to: newPx }, shared: resolved.shared };
    const tw = tailwindEdit(loc.literal, property, current, newPx, viewport);
    if (tw) return { files: edit(fileIndex(loc.file), file.content.slice(0, loc.literalStart) + tw.literal + file.content.slice(loc.literalEnd)), change: { file: loc.file, kind: 'tailwind', from: tw.from, to: tw.to, description: `${property} ${current}px -> ${newPx}px` }, expected: { property, from: current, to: newPx }, shared: resolved.shared };
  }
  for (const loc of [...resolved.css].reverse()) {
    const index = fileIndex(loc.file);
    if (loc.inline) continue; // <style> blocks inside html are not rewritten
    const css = cssEdit(files[index].content, loc, property, current, newPx);
    if (css) return { files: edit(index, css.source), change: { file: loc.file, kind: 'css-rule', selector: loc.selector, from: css.from, to: css.to, description: `${loc.selector}: ${property} ${current}px -> ${newPx}px` }, expected: { property, from: current, to: newPx }, shared: loc.specificity === 1 };
  }
  return { error: `could not trace ${property} of ${element.tag} (${splitClasses(element.cls).slice(0, 4).join(' ') || 'no class'}) to a source declaration`, searched: resolved.files };
}

module.exports = { generatePatch, appendBeforeManagedBlocks, tailwindEdit, inlineEdit, cssEdit, variantPriority, tokenPx };
