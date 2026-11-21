/**
 * Job state transitions that end or advance a generation. The statuses are the existing ones
 * (queued -> processing -> committing -> completed | failed | blocked | cancelled) and every write is conditional on the status the job
 * is expected to be in, so a finished, cancelled or already failed job is never revived or overwritten, and two writers cannot both win.
 */
const GenerationJob = require('../../../models/GenerationJob');
const logger = require('../../../utils/logger');

const RUNNING = ['queued', 'processing', 'committing'];

/** processing -> committing. Returns the updated job, or null when the job is no longer processing (cancelled, taken over). */
function beginCommitting(jobId, { analysis = null } = {}) {
  return GenerationJob.findOneAndUpdate({ jobId, status: 'processing' }, { $set: { status: 'committing', ...(analysis ? { analysis } : {}) } }, { new: true });
}

/**
 * Writes the failure of a running job atomically. A job that already reached a final state keeps it: a late error after the
 * completed write must not turn a saved project into "failed".
 * @returns {Promise<'written'|'unchanged'>}
 */
async function markFailed({ jobId, error, failure = error, status = 'failed', errorCode, rolledBack = false, revisionSaved = false, message }) {
  const current = await GenerationJob.findOne({ jobId }).select('status').lean();
  if (current && RUNNING.includes(current.status)) {
    const stepName = revisionSaved && !rolledBack
      ? 'Verified revision saved, but final bookkeeping failed and it could not be rolled back; check the project before retrying.'
      : `Generation ${status}; previous project preserved.`;
    await GenerationJob.updateOne({ jobId, status: { $in: RUNNING } }, { $set: {
      status, error: message, errorCode, stepName,
      ...(failure.report ? { validation: failure.report } : {}), leaseOwner: null, leaseExpiresAt: null
    } }).catch((writeError) => logger.error(`Job ${jobId} failure state could not be written: ${writeError.message}`));
    return 'written';
  }
  logger.warn(`Job ${jobId} raised "${String(error?.message).slice(0, 160)}" after reaching state ${current?.status || 'unknown'}; the state was left unchanged.`);
  return 'unchanged';
}

/**
 * committing -> completed, written from the in-memory job. Returns the update result: `matchedCount` is 0 when the job was no longer
 * committing (cancelled, taken over), and the caller must then roll the revision back instead of reporting success.
 */
function markCompleted(job, { tokenUsage = null } = {}) {
  return GenerationJob.updateOne({ jobId: job.jobId, status: 'committing' }, { $set: {
    status: job.status, progress: job.progress, step: job.step, stepName: job.stepName,
    projectId: job.projectId, conversationId: job.conversationId, generationId: job.generationId,
    parentGenerationId: job.parentGenerationId, changeSummary: job.changeSummary,
    completedAt: job.completedAt, result: job.result, validation: job.validation, usage: tokenUsage
  } });
}

module.exports = { markCompleted, beginCommitting, markFailed, RUNNING };
