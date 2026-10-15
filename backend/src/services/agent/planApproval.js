/**
 * Pending plan approvals for the two-agent pipeline.
 * A run registers itself after the planner finishes and waits here until the
 * user approves or cancels the plan in the UI (or the run is aborted/times out).
 */
const APPROVAL_TIMEOUT_MS = Number(process.env.PLAN_APPROVAL_TIMEOUT_MS) || 15 * 60 * 1000;

const pending = new Map();

function waitForDecision(runId, { userId = null, projectId = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(runId);
      fn(value);
    };
    const onAbort = () => finish(reject, signal.reason || new Error('Aborted'));
    const timer = setTimeout(() => finish(resolve, 'cancel'), APPROVAL_TIMEOUT_MS);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(runId, { userId: userId ? String(userId) : null, projectId: String(projectId), resolve: (d) => finish(resolve, d) });
  });
}

/** @returns {'ok'|'not_found'|'forbidden'} */
function submitDecision(runId, decision, { userId = null, projectId = null } = {}) {
  const entry = pending.get(runId);
  if (!entry) return 'not_found';
  if (entry.projectId !== String(projectId)) return 'not_found';
  if (entry.userId && entry.userId !== String(userId)) return 'forbidden';
  entry.resolve(decision === 'approve' ? 'approve' : 'cancel');
  return 'ok';
}

module.exports = { waitForDecision, submitDecision };
