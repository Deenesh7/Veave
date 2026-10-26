// Pure geometry helpers for the blank-space engine. Rectangles are { top, right, bottom, left } in document coordinates.
const AXES = {
  y: { name: 'y', start: 'top', end: 'bottom', size: 'height', crossStart: 'left', crossEnd: 'right', crossSize: 'width', marginStart: 'marginTop', marginEnd: 'marginBottom', paddingStart: 'paddingTop', paddingEnd: 'paddingBottom', gap: 'rowGap', minSize: 'minHeight', maxSize: 'maxHeight', inset: 'top', borderStart: 'borderTopWidth', borderEnd: 'borderBottomWidth' },
  x: { name: 'x', start: 'left', end: 'right', size: 'width', crossStart: 'top', crossEnd: 'bottom', crossSize: 'height', marginStart: 'marginLeft', marginEnd: 'marginRight', paddingStart: 'paddingLeft', paddingEnd: 'paddingRight', gap: 'columnGap', minSize: 'minWidth', maxSize: 'maxWidth', inset: 'left', borderStart: 'borderLeftWidth', borderEnd: 'borderRightWidth' }
};

const px = (value) => { const n = parseFloat(value); return Number.isFinite(n) ? n : 0; };
const round = (n) => Math.round(n * 10) / 10;

function normalizeRect(rect = {}) {
  const left = rect.left ?? rect.x ?? 0;
  const top = rect.top ?? rect.y ?? 0;
  const width = rect.width ?? ((rect.right ?? left) - left);
  const height = rect.height ?? ((rect.bottom ?? top) - top);
  return { x: left, y: top, width, height, top, left, right: rect.right ?? left + width, bottom: rect.bottom ?? top + height };
}

// verticalGap = B.top - A.bottom ; horizontalGap = B.left - A.right (negative when the boxes overlap).
const verticalGap = (a, b) => b.top - a.bottom;
const horizontalGap = (a, b) => b.left - a.right;
const overlapLength = (aStart, aEnd, bStart, bEnd) => Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
const intersects = (a, b, tolerance = 0) => overlapLength(a.left, a.right, b.left, b.right) > tolerance && overlapLength(a.top, a.bottom, b.top, b.bottom) > tolerance;
const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
const contains = (outer, inner, tolerance = 1) => inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;

/** Drops boxes that sit completely inside another box so nested wrappers/inline children never produce a second gap. */
function dropContained(items, rectOf = (item) => item.rect) {
  return items.filter((item, index) => !items.some((other, otherIndex) => {
    if (otherIndex === index) return false;
    const a = rectOf(other); const b = rectOf(item);
    if (!contains(a, b)) return false;
    // identical boxes: keep the first one only
    return !contains(b, a) || otherIndex < index;
  }));
}

/**
 * Finds the empty bands between content boxes along one axis. For every box B the nearest box A that ends before B starts
 * and shares the cross axis with B defines a gap (B.start - A.end). Bands with the same extent are merged, so wrappers and
 * multi-column rows never report one visual gap twice. Overlaps are reported with a negative size.
 */
function findGaps(items, { axis = 'y', rectOf = (item) => item.rect, minCrossOverlap = 4, tolerance = 2 } = {}) {
  const ax = AXES[axis];
  const boxes = dropContained(items, rectOf);
  const raw = [];
  for (const b of boxes) {
    const rb = rectOf(b);
    let best = null;
    for (const a of boxes) {
      if (a === b) continue;
      const ra = rectOf(a);
      const cross = overlapLength(ra[ax.crossStart], ra[ax.crossEnd], rb[ax.crossStart], rb[ax.crossEnd]);
      if (cross < minCrossOverlap || ra[ax.start] >= rb[ax.start]) continue;
      if (!best || ra[ax.end] > rectOf(best.a)[ax.end] || (ra[ax.end] === rectOf(best.a)[ax.end] && cross > best.cross)) best = { a, cross };
    }
    if (!best) continue;
    const ra = rectOf(best.a);
    const size = rb[ax.start] - ra[ax.end];
    raw.push({ axis, start: ra[ax.end], end: rb[ax.start], size: round(size), kind: size < -tolerance ? 'overlap' : 'gap', above: best.a, below: b, cross: [Math.max(ra[ax.crossStart], rb[ax.crossStart]), Math.min(ra[ax.crossEnd], rb[ax.crossEnd])] });
  }
  const merged = [];
  for (const gap of raw) {
    const twin = merged.find((m) => Math.abs(m.start - gap.start) <= tolerance && Math.abs(m.end - gap.end) <= tolerance);
    if (!twin) { merged.push({ ...gap, borders: { above: [gap.above], below: [gap.below] } }); continue; }
    twin.cross = [Math.min(twin.cross[0], gap.cross[0]), Math.max(twin.cross[1], gap.cross[1])];
    if (!twin.borders.above.includes(gap.above)) twin.borders.above.push(gap.above);
    if (!twin.borders.below.includes(gap.below)) twin.borders.below.push(gap.below);
  }
  return merged.sort((p, q) => p.start - q.start);
}

const median = (values) => { if (!values.length) return 0; const s = [...values].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

module.exports = { AXES, px, round, normalizeRect, verticalGap, horizontalGap, overlapLength, intersects, area, contains, dropContained, findGaps, median };
