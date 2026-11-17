/**
 * The root administrator: the single account that may create and remove other administrators.
 *
 * Who is root:
 *   1. an account already marked isRootAdmin;
 *   2. otherwise the OLDEST active administrator (this is how an existing installation with one admin becomes root);
 *   3. otherwise, on a database with no administrator at all, the first email of ADMIN_EMAILS (a one-time bootstrap).
 * ADMIN_EMAILS is NOT a way to add administrators later: once a root exists it is ignored, so a restart can never re-promote an account
 * the root removed, and nobody gains access just because their email is listed.
 */
const User = require('../../models/User');
const AdminAuditLog = require('../../models/AdminAuditLog');
const logger = require('../../utils/logger');

async function ensureRootAdmin() {
  if (await User.exists({ isRootAdmin: true })) return null;
  let candidate = await User.findOne({ role: 'ADMIN', status: { $ne: 'suspended' } }).sort({ createdAt: 1 });
  let how = 'oldest administrator';
  if (!candidate) {
    const first = String(process.env.ADMIN_EMAILS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)[0];
    if (!first) return null;
    candidate = await User.findOne({ email: first });
    if (!candidate) { logger.warn(`ADMIN_EMAILS names ${first}, but that account does not exist yet. Register it, then restart the server.`); return null; }
    candidate.role = 'ADMIN';
    how = 'ADMIN_EMAILS bootstrap';
  }
  candidate.isRootAdmin = true;
  await candidate.save();
  await AdminAuditLog.create({ actorId: candidate._id, actorEmail: 'system', action: 'ROOT_ADMIN_SET', resourceType: 'user', resourceId: String(candidate._id), after: { isRootAdmin: true }, meta: { how, email: candidate.email } }).catch(() => {});
  logger.info(`${candidate.email} is the root administrator (${how}).`);
  return candidate;
}

module.exports = { ensureRootAdmin };
