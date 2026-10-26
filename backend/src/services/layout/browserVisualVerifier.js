// Verifies a corrected gap against the real rendered result: numerical geometry first, screenshot comparison second.
const { inkRect } = require('./blankRegionDetector');
const { AXES, round } = require('./geometry');

function measureGapBetween(snapshot, gap) {
  const ax = AXES[gap.axis];
  const byPath = new Map(snapshot.elements.map((e) => [e.path, e]));
  const A = gap.above && byPath.get(gap.above.path);
  const B = gap.below && byPath.get(gap.below.path);
  if (!A || (gap.below && !B)) return { ok: false, reason: `bordering element ${!A ? gap.above.path : gap.below.path} is no longer rendered` };
  const a = inkRect(A, gap.axis);
  const size = B ? inkRect(B, gap.axis)[ax.start] - a[ax.end] : snapshot.docHeight - a[ax.end];
  return { ok: true, size: round(size), A, B };
}

async function compareScreenshots(beforePng, afterPng, { aboveRows, threshold = 16 }) {
  if (!beforePng || !afterPng) return { status: 'skipped', detail: 'screenshots unavailable' };
  let sharp; try { sharp = require('sharp'); } catch { return { status: 'skipped', detail: 'image library unavailable' }; }
  try {
    const [bm, am] = await Promise.all([sharp(beforePng).metadata(), sharp(afterPng).metadata()]);
    const width = Math.min(bm.width, am.width); const rows = Math.max(1, Math.min(Math.floor(aboveRows), bm.height, am.height));
    const raw = (png) => sharp(png).extract({ left: 0, top: 0, width, height: rows }).removeAlpha().raw().toBuffer();
    const [x, y] = await Promise.all([raw(beforePng), raw(afterPng)]);
    let changed = 0;
    for (let i = 0; i < x.length; i += 3) if (Math.abs(x[i] - y[i]) > threshold || Math.abs(x[i + 1] - y[i + 1]) > threshold || Math.abs(x[i + 2] - y[i + 2]) > threshold) changed += 1;
    const fraction = changed / (x.length / 3);
    return { status: fraction <= 0.02 ? 'passed' : 'failed', changedFraction: Math.round(fraction * 10000) / 10000, comparedRows: rows, heightBefore: bm.height, heightAfter: am.height, detail: `${(fraction * 100).toFixed(2)}% of pixels above the gap changed` };
  } catch (error) { return { status: 'skipped', detail: `screenshot comparison failed: ${error.message}` }; }
}

/**
 * @returns { passed, progress, gapBefore, gapAfter, expectedAfter, checks[] }
 * passed   - the measured gap fell to (about) the expected value and the neighbours stayed aligned.
 * progress - the gap shrank materially but not to the expected value (another ancestor still controls it).
 */
async function verifyGapFix({ before, after, gap, expectedAfter, reduction, screenshots = {}, tolerance = 2, sharedStyle = false }) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const measured = measureGapBetween(after, gap);
  if (!measured.ok) { add('gap-measured', 'failed', measured.reason); return { passed: false, progress: false, gapBefore: gap.size, gapAfter: null, expectedAfter, checks }; }
  const gapAfter = measured.size;
  const slack = Math.max(12, gap.size * 0.12);
  const shrank = gap.size - gapAfter;
  const reached = gapAfter <= expectedAfter + slack && gapAfter >= -tolerance;
  add('gap-decreased', shrank >= Math.max(8, reduction * 0.1) ? 'passed' : 'failed', `gap ${gap.size}px -> ${gapAfter}px`);
  add('gap-matches-expectation', reached ? 'passed' : 'failed', `expected about ${expectedAfter}px (+/-${round(slack)}), measured ${gapAfter}px`);
  const beforeA = before.elements.find((e) => e.path === gap.above.path); const beforeB = gap.below && before.elements.find((e) => e.path === gap.below.path);
  const drift = (p, q) => !p || !q || (Math.abs(p.rect.left - q.rect.left) <= tolerance && Math.abs(p.rect.width - q.rect.width) <= tolerance);
  add('adjacent-alignment', drift(beforeA, measured.A) && drift(beforeB, measured.B) ? 'passed' : 'failed', 'bordering elements keep their horizontal position and width');
  const shot = sharedStyle ? { status: 'skipped', detail: 'shared style: every instance changes, so pixels above this gap legitimately move' } : await compareScreenshots(screenshots.before, screenshots.after, { aboveRows: gap.start });
  add('screenshot-above-gap-unchanged', shot.status, shot.detail);
  const tall = before.docHeight > before.viewport.height + 1 && after.docHeight > after.viewport.height + 1;
  if (shot.heightBefore && tall) {
    const delta = shot.heightBefore - shot.heightAfter;
    add('page-height-reduced', Math.abs(delta - shrank) <= Math.max(16, shrank * 0.15) ? 'passed' : 'failed', `screenshot height fell by ${delta}px, gap by ${round(shrank)}px`);
  }
  const hard = checks.filter((c) => c.status === 'failed');
  return { passed: !hard.length, progress: shrank >= Math.max(8, reduction * 0.4) && !hard.some((c) => c.name === 'adjacent-alignment' || c.name === 'screenshot-above-gap-unchanged'), gapBefore: gap.size, gapAfter, expectedAfter, checks };
}

module.exports = { verifyGapFix, measureGapBetween, compareScreenshots };
