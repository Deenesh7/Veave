const mongoose = require('mongoose');
const logger = require('../../utils/logger');

/**
 * Emails a user about their build (best effort: never blocks or fails the build). JOB_EMAILS=false turns it off.
 *   kind 'plan'    the plan is ready and waits for approval
 *   kind 'project' the build finished and passed verification
 */
async function emailUser(userId, kind, details = {}) {
  try {
    if (!userId || String(process.env.JOB_EMAILS || '').toLowerCase() === 'false') return;
    if (mongoose.connection.readyState !== 1) return;
    const owner = await require('../../models/User').findById(userId).select('name email').lean();
    if (!owner?.email) return;
    const mail = require('./mailService');
    const href = mail.appUrl(details.projectId ? `/editor/${details.projectId}` : '/');
    if (kind === 'plan') await mail.sendPlanReady({ to: owner.email, name: owner.name, summary: details.summary, href });
    else await mail.sendProjectReady({ to: owner.email, name: owner.name, projectName: details.projectName, summary: details.summary, href });
  } catch (error) {
    logger.warn(`Build email (${kind}) failed: ${error.message}`);
  }
}

module.exports = { emailUser };
