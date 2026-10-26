// Compares two layout snapshots of the same route/viewport and reports regressions a patch must not introduce:
// lost content, new overlaps, new overflow/clipping, content that moved when it should not have, and new console errors.
const { detectOverlaps, isContent } = require('./blankRegionDetector');

const pairKey = (o) => `${o.above?.path}|${o.below?.path}`;

/**
 * @param band  { start, end, reduction } of the corrected gap on the primary viewport, or null (responsive viewports:
 *              only the structural checks run, since positions legitimately differ)
 */
function checkRegression(before, after, { band = null, tolerance = 2, axis = 'y', sharedStyle = false } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, status: ok ? 'passed' : 'failed', detail });
  const afterByPath = new Map(after.elements.map((e) => [e.path, e]));
  const beforeContent = before.elements.filter(isContent);

  const lost = beforeContent.filter((e) => { const next = afterByPath.get(e.path); return !next || !isContent(next) || (e.hasText && next.text !== e.text); });
  add('content-preserved', !lost.length, lost.length ? `${lost.length} content element(s) missing or changed: ${lost.slice(0, 3).map((e) => `${e.tag}"${e.text}"`).join(', ')}` : `${beforeContent.length} content elements intact`);

  const knownOverlaps = new Set(detectOverlaps(before, axis).map(pairKey));
  const fresh = detectOverlaps(after, axis).filter((o) => !knownOverlaps.has(pairKey(o)));
  add('no-new-overlap', !fresh.length, fresh.length ? `${fresh.length} new overlap(s), e.g. ${fresh[0].above.tag} over ${fresh[0].below.tag} by ${Math.abs(fresh[0].size)}px` : 'no new overlapping content');

  const overflow = after.docWidth > Math.max(before.docWidth, after.viewport.width + 1) + tolerance;
  add('no-new-horizontal-overflow', !overflow, overflow ? `document width ${after.docWidth}px exceeds ${before.docWidth}px` : 'no new horizontal overflow');

  const clippedBefore = new Set(before.elements.filter((e) => e.clipped).map((e) => e.path));
  const clipped = after.elements.filter((e) => e.clipped && !clippedBefore.has(e.path));
  add('no-new-clipping', !clipped.length, clipped.length ? `${clipped.length} element(s) newly clipped by an overflow container, e.g. ${clipped[0].tag}"${clipped[0].text}"` : 'nothing newly clipped');

  add('no-new-console-errors', (after.errors || []).length <= (before.errors || []).length, `${(after.errors || []).length} console error(s) after, ${(before.errors || []).length} before`);

  if (band) {
    const s = axis === 'y' ? { start: 'top', end: 'bottom', cross: 'left' } : { start: 'left', end: 'right', cross: 'top' };
    const moved = [];
    for (const e of beforeContent) {
      const next = afterByPath.get(e.path); if (!next) continue;
      const delta = next.rect[s.start] - e.rect[s.start];
      const cross = Math.abs(next.rect[s.cross] - e.rect[s.cross]);
      const above = e.rect[s.end] <= band.start + tolerance;
      // A shared style change legitimately moves every instance of that style, so content may only move up, never down.
      const ok = sharedStyle ? delta <= tolerance : above ? Math.abs(delta) <= tolerance : (delta <= tolerance && delta >= -(band.reduction + Math.max(6, band.reduction * 0.1)));
      if (!ok || cross > tolerance) moved.push({ path: e.path, delta: Math.round(delta), cross: Math.round(cross) });
    }
    add('no-unintended-shift', !moved.length, moved.length ? `${moved.length} element(s) moved unexpectedly, e.g. ${moved[0].path} by ${moved[0].delta}px` : 'content above the gap stayed put; content below moved up by at most the removed space');
  }
  return { passed: checks.every((c) => c.status === 'passed'), checks };
}

module.exports = { checkRegression };
