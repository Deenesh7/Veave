/** Writes the admin audit trail. Never throws: an audit write problem must not break the action it records (it is logged instead). */
const AdminAuditLog = require('../../models/AdminAuditLog');
const logger = require('../../utils/logger');

const SECRET_KEYS = /password|token|secret|apikey|authorization/i;
const scrub = (value, depth = 0) => {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const plain = typeof value.toObject === 'function' ? value.toObject() : value;
    return Object.fromEntries(Object.entries(plain).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, item]) => [key, scrub(item, depth + 1)]));
  }
  return typeof value === 'string' ? value.slice(0, 2000) : value;
};

async function record(actor, action, { resourceType = '', resourceId = '', before, after, meta, req = null } = {}) {
  try {
    const actorId = actor?._id || actor?.id || actor;
    if (!actorId) return null;
    return await AdminAuditLog.create({
      actorId, actorEmail: actor?.email || '', action, resourceType, resourceId: String(resourceId || ''),
      before: scrub(before), after: scrub(after), meta: scrub(meta), ip: String(req?.ip || '').slice(0, 64)
    });
  } catch (error) {
    logger.error(`Audit record "${action}" could not be written: ${error.message}`);
    return null;
  }
}

module.exports = { record, scrub };
