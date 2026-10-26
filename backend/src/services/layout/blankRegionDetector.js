// Turns a layout snapshot into blank-region records: gaps between visible content boxes that are large and out of
// proportion with the rest of the page. Pure (no browser), so it can be unit-tested with synthetic snapshots.
const { findGaps, median, normalizeRect, round, px } = require('./geometry');

const DEFAULTS = { minGap: 120, outlierFactor: 1.75, minOutlierSamples: 4, edgeGaps: true };

const visibleBox = (el) => el.vis || el.rect;
const isContent = (el) => !el.hidden && (el.hasText || el.replaced || el.paintsImage) && visibleBox(el).width > 0 && visibleBox(el).height > 0
  && el.style.position !== 'fixed' && el.style.position !== 'sticky';

const transparent = (value) => !value || value === 'transparent' || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(value);

/**
 * The box a viewer actually perceives. Text without its own background or border is perceived at its content box, so its
 * padding counts as blank space (and can be a cause); boxes with a background/border/image are perceived whole.
 */
function inkRect(el, axis = 'y') {
  const rect = normalizeRect(visibleBox(el));
  const s = el.style;
  const painted = el.replaced || el.paintsImage || !transparent(s.backgroundColor) || [s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderRightWidth].some((w) => px(w) > 0);
  if (painted) return rect;
  const shrink = axis === 'y' ? { top: px(s.paddingTop), bottom: px(s.paddingBottom), left: 0, right: 0 } : { top: 0, bottom: 0, left: px(s.paddingLeft), right: px(s.paddingRight) };
  return normalizeRect({ top: rect.top + shrink.top, bottom: Math.max(rect.top + shrink.top + 1, rect.bottom - shrink.bottom), left: rect.left + shrink.left, right: Math.max(rect.left + shrink.left + 1, rect.right - shrink.right) });
}

function contentItems(snapshot, axis = 'y') {
  return snapshot.elements.filter(isContent).map((el) => ({ el, rect: inkRect(el, axis) }));
}

/**
 * @param snapshot  result of collectLayout
 * @param options   { axis: 'y'|'x', minGap, region: { top, bottom }, edgeGaps }
 * @returns blank regions sorted by size (largest first); each has the bordering elements and the band geometry.
 */
function detectBlankRegions(snapshot, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const axis = config.axis || 'y';
  const items = contentItems(snapshot, axis);
  const pairGaps = findGaps(items, { axis }).map((gap) => ({
    ...gap, above: gap.above.el, below: gap.below.el,
    borders: { above: gap.borders.above.map((i) => i.el), below: gap.borders.below.map((i) => i.el) }
  }));
  // Gap against the document edges (e.g. blank space after the last section) - only meaningful on the vertical axis.
  const edges = [];
  if (axis === 'y' && config.edgeGaps && items.length && snapshot.docHeight > snapshot.viewport.height + 1) {
    const last = items.reduce((best, item) => (item.rect.bottom > best.rect.bottom ? item : best), items[0]);
    const size = snapshot.docHeight - last.rect.bottom;
    if (size > 0) edges.push({ axis, kind: 'gap', edge: 'page-end', start: last.rect.bottom, end: snapshot.docHeight, size: round(size), above: last.el, below: null, cross: [last.rect.left, last.rect.right], borders: { above: [last.el], below: [] } });
  }
  const positive = pairGaps.filter((gap) => gap.size > 0).map((gap) => gap.size);
  const typical = median(positive);
  const outlier = (gap) => positive.length < config.minOutlierSamples || gap.size >= typical * config.outlierFactor;
  const region = config.region;
  return [...pairGaps, ...edges]
    .filter((gap) => gap.kind === 'gap' && gap.size >= config.minGap && outlier(gap))
    .filter((gap) => !region || (gap.end >= region.top && gap.start <= region.bottom))
    .map((gap, index) => ({ id: `gap-${gap.axis}-${Math.round(gap.start)}-${Math.round(gap.end)}`, index, typicalGap: round(typical), ...gap }))
    .sort((a, b) => b.size - a.size);
}

/** Overlapping content boxes (negative gaps): reported separately because they are a different defect from blank space. */
function detectOverlaps(snapshot, axis = 'y') {
  return findGaps(contentItems(snapshot, axis), { axis }).filter((gap) => gap.kind === 'overlap').map((gap) => ({ ...gap, above: gap.above.el, below: gap.below.el }));
}

const summarize = (gap) => ({ id: gap.id, axis: gap.axis, size: gap.size, start: round(gap.start), end: round(gap.end), edge: gap.edge || null, above: gap.above && { path: gap.above.path, tag: gap.above.tag, text: gap.above.text }, below: gap.below && { path: gap.below.path, tag: gap.below.tag, text: gap.below.text } });

module.exports = { detectBlankRegions, detectOverlaps, contentItems, inkRect, isContent, summarize, DEFAULTS };
