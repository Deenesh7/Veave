/**
 * Wall-clock timing of the slow stages of a generation, so tuning is based on measurements.
 *
 *   timed('image-render-check', fn, scope)   runs fn, logs "[timing] <scope> <stage> <ms>ms" and adds the time to the scope's totals
 *   summary(scope)                           { stage: { ms, calls } } for one job (what the job stored as analysis.timings)
 *   forget(scope)                            drops the totals once they were saved
 *
 * It never changes what fn returns or throws, and a failure to record never fails the job.
 */
const logger = require('../../../utils/logger');

const totals = new Map();

function record(scope, stage, ms) {
  const key = scope || 'unscoped';
  const stages = totals.get(key) || {};
  const entry = stages[stage] || { ms: 0, calls: 0 };
  entry.ms += ms;
  entry.calls += 1;
  stages[stage] = entry;
  totals.set(key, stages);
}

async function timed(stage, fn, scope = '') {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    try { record(scope, stage, ms); logger.info(`[timing] ${scope || '-'} ${stage} ${ms}ms`); } catch { /* timing is advisory */ }
  }
}

const summary = (scope) => totals.get(scope || 'unscoped') || {};
const forget = (scope) => { totals.delete(scope || 'unscoped'); };

module.exports = { timed, record, summary, forget };
