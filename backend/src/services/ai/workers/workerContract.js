/**
 * The contract every generation worker follows.
 *
 *   input    a plain object the orchestrator validated and built (never a live job document)
 *   output   a plain object; the worker never edits job state it was not given
 *   result   { worker, ok, output, error, cancelled, startedAt, finishedAt, durationMs }
 *
 * `runWorker` runs one worker call under that contract: it times it, logs it with the job id and worker name, applies an optional
 * timeout, and turns anything thrown into a classified result. It does not decide what a failure means for the job: the
 * orchestrator does (a failed image worker is not fatal, a failed commit worker is).
 */
const logger = require('../../../utils/logger');
const { isTransientError } = require('../jobSupport/retry');
const { failureCode } = require('../jobSupport/failureCode');
const stageTimer = require('../jobSupport/stageTimer');

/** { code, message, retryable, permanent } for any error a worker can throw. */
function classifyError(error) {
  const message = String(error?.message || error || 'unknown error').slice(0, 500);
  const code = failureCode(error);
  const retryable = isTransientError(error);
  return { code, message, retryable, permanent: !retryable && /^PROVIDER_(AUTH|CREDITS|MODEL)$/.test(code) };
}

/**
 * @param name    worker name, used in logs and results
 * @param work    async ({ signal, log }) => output
 * @param options { jobId, signal, timeoutMs, log }
 * @returns {Promise<{worker, ok, output, error, cancelled, startedAt, finishedAt, durationMs}>} never rejects
 */
async function runWorker(name, work, { jobId = '-', signal = null, timeoutMs = 0, log = logger } = {}) {
  const startedAt = new Date();
  const timeout = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
  const combined = signal || timeout ? AbortSignal.any([...(signal ? [signal] : []), ...(timeout ? [timeout] : [])]) : new AbortController().signal;
  const prefix = `[job ${jobId}] [worker ${name}]`;
  const scoped = { info: (m) => log.info(`${prefix} ${m}`), warn: (m) => log.warn(`${prefix} ${m}`), error: (m) => log.error(`${prefix} ${m}`) };
  const finish = (fields) => {
    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;
    try { stageTimer.record(jobId, `worker:${name}`, durationMs); } catch { /* timing is advisory */ }
    return { worker: name, ok: false, output: null, error: null, cancelled: false, startedAt, finishedAt, durationMs, ...fields };
  };
  // Already cancelled before it began: do not start work (and do not pay for it).
  if (signal?.aborted) {
    const result = finish({ cancelled: true, error: { code: 'CANCELLED', message: 'cancelled before start', retryable: false, permanent: false, cause: signal.reason || new Error('cancelled') } });
    scoped.info('cancelled before start');
    return result;
  }
  scoped.info('started');
  try {
    const output = await work({ signal: combined, log: scoped });
    const result = finish({ ok: true, output: output ?? null });
    scoped.info(`finished in ${result.durationMs}ms`);
    return result;
  } catch (error) {
    // A caller's cancellation is not a failure of the worker; a worker timeout is.
    const cancelled = Boolean(signal?.aborted);
    const timedOut = Boolean(timeout?.aborted) && !cancelled;
    const classified = timedOut ? { code: 'WORKER_TIMEOUT', message: `${name} worker timed out after ${timeoutMs}ms`, retryable: true, permanent: false } : classifyError(error);
    const result = finish({ cancelled, error: { ...classified, cause: error } });
    (cancelled ? scoped.info : scoped.warn)(cancelled ? 'cancelled' : `failed (${classified.code}${classified.retryable ? ', retryable' : ''}): ${classified.message}`);
    return result;
  }
}

module.exports = { runWorker, classifyError };
