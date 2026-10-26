// Orchestrates detect -> diagnose -> rank -> (LLM picks) -> patch -> rebuild -> verify in a real browser -> retry/rollback.
// Geometry collection and ranking are deterministic; the optional chooser (LLM) only selects among evidenced candidates.
const { collectLayout } = require('./layoutGeometryCollector');
const { detectBlankRegions, summarize } = require('./blankRegionDetector');
const { analyzeCause, buildIndex } = require('./layoutCauseAnalyzer');
const { generatePatch } = require('./minimalPatchGenerator');
const { verifyGapFix } = require('./browserVisualVerifier');
const { checkRegression } = require('./layoutRegressionChecker');

const STATES = Object.freeze({ DIAGNOSIS_PENDING: 'DIAGNOSIS_PENDING', CAUSE_IDENTIFIED: 'CAUSE_IDENTIFIED', PATCH_APPLIED: 'PATCH_APPLIED', BUILD_PASSED: 'BUILD_PASSED', RENDER_VERIFIED: 'RENDER_VERIFIED', REGRESSION_PASSED: 'REGRESSION_PASSED', VERIFICATION_FAILED: 'VERIFICATION_FAILED' });
const DEFAULT_RESPONSIVE = [{ width: 375, height: 812 }, { width: 768, height: 1024 }];
const gapKey = (gap) => `${gap.axis}|${gap.above?.path}|${gap.below?.path || gap.edge}`;

/** Does the prompt ask about sideways spacing? Vertical is the default. */
const axisFromRequest = (request = '') => (/\b(horizontal|sideways|between (?:the )?columns?|left|right)\b/i.test(request) ? 'both' : 'y');

function descendantTexts(snapshot, element, limit = 4) {
  const { byId } = buildIndex(snapshot);
  const texts = [];
  for (const el of snapshot.elements) {
    if (!el.hasText || el === element) continue;
    for (let cur = el; cur; cur = byId.get(cur.parent)) if (cur.id === element.id) { texts.push(el.text); break; }
    if (texts.length >= limit) break;
  }
  return texts.concat(element.text ? [element.text] : []);
}

/** Builds a chooser that asks an LLM to pick among the evidenced candidates. `ask(messages)` returns { content }. */
function makeLlmChooser(ask) {
  return async ({ request, diagnosis, candidates }) => {
    const evidence = {
      request, gap: diagnosis.gap, targetGapPx: diagnosis.target, between: { above: diagnosis.above, below: diagnosis.below },
      candidates: candidates.slice(0, 6).map((c, index) => ({ index, type: c.type, element: c.path, classes: c.cls.slice(0, 120), property: c.property, currentPx: c.current, removesPx: c.contribution, expectedGapAfterPx: c.expectedGapAfter, score: c.score, confidence: c.confidence, evidence: c.evidence, rationale: c.rationale, instances: c.instances }))
    };
    const completion = await ask([
      { role: 'system', content: 'You choose which measured layout cause to fix to remove unwanted blank space. Prefer the cause that is the real source of the gap (an ancestor or sibling spacing property), not merely a large value. Keep intentional whitespace. Reply with JSON only: {"index": <candidate index>, "reason": "<one sentence>"}.' },
      { role: 'user', content: JSON.stringify(evidence) }
    ]);
    const parsed = JSON.parse(String(completion?.content || '{}').match(/\{[\s\S]*\}/)?.[0] || '{}');
    const picked = candidates[Number(parsed.index)];
    return picked ? { candidate: picked, reason: String(parsed.reason || '').slice(0, 240) } : null;
  };
}

async function runBlankSpaceEngine({
  files, route = '/', viewport = { width: 1440, height: 900 }, request = '', region = null, axis, maxAttempts = 4, maxGaps = 3, minGap = 120,
  minConfidence = 0.45, responsiveViewports = DEFAULT_RESPONSIVE, signal, collect = collectLayout, chooseCandidate = null, onState = null
} = {}) {
  const report = { status: 'unresolved', state: STATES.DIAGNOSIS_PENDING, transitions: [], route, viewport, request, initialGaps: [], finalGaps: [], attempts: [], unresolved: [], regression: [], files, changes: [] };
  const move = (state, detail) => { report.state = state; report.transitions.push({ state, detail: detail || null }); if (onState) { try { onState(state, detail); } catch { /* reporting only */ } } };
  const axes = (axis || axisFromRequest(request)) === 'both' ? ['y', 'x'] : [axis || 'y'];
  const detectAll = (snapshot) => axes.flatMap((a) => detectBlankRegions(snapshot, { axis: a, minGap, region })).sort((p, q) => q.size - p.size);
  move(STATES.DIAGNOSIS_PENDING, `rendering ${route} at ${viewport.width}px`);

  let current; let shot;
  try { ({ snapshot: current, screenshot: shot } = await collect(files, { route, viewport, signal, screenshot: true })); } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    report.status = 'verification-unavailable'; report.reason = `The page could not be rendered, so no blank-space analysis or verification was possible: ${error.message}`;
    move(STATES.VERIFICATION_FAILED, report.reason); return report;
  }
  const initial = detectAll(current);
  report.initialGaps = initial.map(summarize);
  if (!initial.length) { report.status = 'no-blank-space'; report.reason = `No blank region of at least ${minGap}px was measured on ${route}.`; report.finalGaps = []; return report; }

  // Baselines for the responsive regression checks (taken before any edit, so they are comparable).
  const baselines = new Map();
  for (const vp of responsiveViewports) {
    try { baselines.set(vp.width, (await collect(files, { route, viewport: vp, signal })).snapshot); } catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; }
  }

  let workingFiles = files;
  const rejected = new Set(); const givenUp = new Set(); const targets = new Set(initial.slice(0, maxGaps).map(gapKey));
  let applied = 0; let guard = 0;
  while (applied < maxAttempts && guard < maxAttempts * 4) {
    guard += 1; signal?.throwIfAborted();
    const gap = detectAll(current).find((g) => (targets.has(gapKey(g)) || !applied) && !givenUp.has(gapKey(g)));
    if (!gap) break;
    const diagnosis = analyzeCause(current, gap);
    let candidates = diagnosis.candidates.filter((c) => !rejected.has(c.key));
    const eligible = candidates.filter((c) => c.patchable && c.score >= minConfidence);
    if (!eligible.length) {
      givenUp.add(gapKey(gap));
      report.unresolved.push({ gap: diagnosis.gap, reason: candidates.length ? 'no candidate reached the confidence needed to edit safely' : 'no measurable cause was found', diagnosis });
      continue;
    }
    let chosen = eligible[0]; let reason = 'highest ranked by measured evidence';
    if (chooseCandidate) {
      try { const picked = await chooseCandidate({ request, diagnosis, candidates: eligible }); if (picked?.candidate && eligible.includes(picked.candidate)) { chosen = picked.candidate; reason = picked.reason || 'selected by the model from measured candidates'; } } catch (error) { if (signal?.aborted) throw error; }
    }
    move(STATES.CAUSE_IDENTIFIED, `${chosen.type}: ${chosen.property} on ${chosen.path} (${chosen.confidence}, ${chosen.contribution}px)`);
    const attempt = { gap: diagnosis.gap, cause: { type: chosen.type, path: chosen.path, property: chosen.property, current: chosen.current, contribution: chosen.contribution, score: chosen.score, confidence: chosen.confidence, evidence: chosen.evidence }, reason, expectedGapAfter: chosen.expectedGapAfter, status: 'pending' };
    report.attempts.push(attempt);
    const element = current.elements.find((e) => e.id === chosen.elementId);
    // An empty spacer carries no content, so it is removed whole; every other cause only gives up the excess over a normal gap.
    const reduction = chosen.type === 'spacer' || chosen.type === 'box-model' ? chosen.contribution : Math.max(1, Math.min(chosen.contribution, diagnosis.excess));
    const patch = generatePatch(workingFiles, chosen, element, { reduction, viewport: current.viewport, hints: { texts: descendantTexts(current, element) } });
    if (patch.error) { attempt.status = 'not-patchable'; attempt.detail = patch.error; rejected.add(chosen.key); continue; }
    applied += 1; attempt.change = patch.change; attempt.shared = Boolean(patch.shared);
    move(STATES.PATCH_APPLIED, `${patch.change.file}: ${patch.change.description}`);

    let after; let afterShot;
    try { ({ snapshot: after, screenshot: afterShot } = await collect(patch.files, { route, viewport, signal, screenshot: true })); } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      attempt.status = 'rolled-back'; attempt.detail = `the patched project did not build/render: ${error.message}`; rejected.add(chosen.key); move(STATES.VERIFICATION_FAILED, attempt.detail); continue;
    }
    move(STATES.BUILD_PASSED);
    const verdict = await verifyGapFix({ before: current, after, gap, expectedAfter: chosen.expectedGapAfter, reduction, screenshots: { before: shot, after: afterShot }, sharedStyle: Boolean(patch.shared && chosen.type === 'box-model') });
    attempt.verification = verdict;
    if (!verdict.passed && !verdict.progress) {
      attempt.status = 'rolled-back';
      attempt.detail = verdict.gapAfter === null ? 'a bordering element disappeared' : Math.abs(verdict.gapAfter - gap.size) < 4 ? 'the patch did not change the measured gap (wrong cause or another ancestor controls it)' : `the gap moved to ${verdict.gapAfter}px, not the expected ${verdict.expectedAfter}px`;
      rejected.add(chosen.key); move(STATES.VERIFICATION_FAILED, attempt.detail); continue;
    }
    move(STATES.RENDER_VERIFIED, `gap ${verdict.gapBefore}px -> ${verdict.gapAfter}px`);

    const regressions = [{ viewport: `${viewport.width}px`, ...checkRegression(current, after, { band: { start: gap.start, reduction: Math.max(0, gap.size - (verdict.gapAfter ?? gap.size)) }, axis: gap.axis, sharedStyle: Boolean(patch.shared && chosen.type === 'box-model') }) }];
    const nextBaselines = new Map();
    for (const vp of responsiveViewports) {
      const base = baselines.get(vp.width); if (!base) continue;
      try { const snap = (await collect(patch.files, { route, viewport: vp, signal })).snapshot; nextBaselines.set(vp.width, snap); regressions.push({ viewport: `${vp.width}px`, ...checkRegression(base, snap, { axis: gap.axis }) }); } catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; regressions.push({ viewport: `${vp.width}px`, passed: false, checks: [{ name: 'renders', status: 'failed', detail: error.message }] }); }
    }
    attempt.regression = regressions;
    if (regressions.some((r) => !r.passed)) {
      const failed = regressions.flatMap((r) => r.checks.filter((c) => c.status === 'failed').map((c) => `${r.viewport}: ${c.name} (${c.detail})`));
      attempt.status = 'rolled-back'; attempt.detail = `regression: ${failed.slice(0, 3).join('; ')}`; rejected.add(chosen.key); move(STATES.VERIFICATION_FAILED, attempt.detail); continue;
    }
    move(STATES.REGRESSION_PASSED);
    attempt.status = verdict.passed ? 'verified' : 'partial';
    workingFiles = patch.files; current = after; shot = afterShot; report.changes.push(patch.change);
    for (const [width, snap] of nextBaselines) baselines.set(width, snap);
    report.regression = regressions;
  }

  report.files = workingFiles;
  report.finalGaps = detectAll(current).map(summarize);
  const targetsLeft = report.finalGaps.filter((g) => targets.has(gapKey({ axis: g.axis, above: g.above, below: g.below, edge: g.edge })));
  const verified = report.attempts.filter((a) => a.status === 'verified' || a.status === 'partial').length;
  if (verified && !targetsLeft.length) { report.status = 'fixed'; }
  else if (verified) { report.status = 'partially-fixed'; report.reason = `${targetsLeft.length} blank region(s) remain after ${report.attempts.length} attempt(s).`; }
  else { report.status = 'unresolved'; report.reason = report.attempts.length ? 'every attempted patch failed verification and was rolled back' : 'no cause was identified with enough confidence to edit'; move(STATES.VERIFICATION_FAILED, report.reason); }
  if (report.status === 'fixed' && report.state !== STATES.REGRESSION_PASSED) move(STATES.REGRESSION_PASSED, 'last verified patch kept');
  report.remainingCandidates = report.unresolved.flatMap((u) => u.diagnosis.candidates.slice(0, 3).map((c) => ({ type: c.type, path: c.path, property: c.property, contribution: c.contribution, confidence: c.confidence })));
  return report;
}

module.exports = { runBlankSpaceEngine, makeLlmChooser, axisFromRequest, STATES };
