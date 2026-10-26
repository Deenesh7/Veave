const mongoose = require('mongoose');
const Notification = require('../../models/Notification');
const AuditLog = require('../../models/AuditLog');
const logger = require('../../utils/logger');

let transactionsSupported = null;

// Multi-document transactions need a replica set or mongos. On a standalone mongod we fall back to the atomic
// conditional updates the callers are written around, so correctness never depends on transaction support.
async function supportsTransactions() {
  if (transactionsSupported !== null) return transactionsSupported;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = !!(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

/** Runs `work(session)` in a transaction when the deployment supports it, otherwise with `session = null`. */
async function withTransaction(work) {
  if (!(await supportsTransactions())) return work(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function notify(userIds, { type, title, message = '', data = {} }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    await Notification.insertMany(ids.map((userId) => ({ userId, type, title, message, data })));
  } catch (error) {
    logger.warn(`Notification delivery failed (${type}): ${error.message}`);
  }
}

async function audit(actorId, action, { groupId = null, projectId = null, targetUserId = null, meta = {} } = {}) {
  try {
    await AuditLog.create({ actorId, action, groupId, projectId, targetUserId, meta });
  } catch (error) {
    logger.warn(`Audit log write failed (${action}): ${error.message}`);
  }
}

const sid = (value) => (value && value._id ? String(value._id) : value ? String(value) : '');

module.exports = { withTransaction, notify, audit, sid, supportsTransactions };
