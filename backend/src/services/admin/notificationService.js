/** Notifications for the admin team. `create` never throws, and a dedupe key keeps repeated events from piling up. */
const AdminNotification = require('../../models/AdminNotification');
const logger = require('../../utils/logger');

async function create({ type, severity = 'info', title, message = '', data, dedupeKey }) {
  try {
    return await AdminNotification.create({ type, severity, title, message, data, ...(dedupeKey ? { dedupeKey } : {}) });
  } catch (error) {
    if (error?.code === 11000) return null; // the same event was already recorded
    logger.warn(`Admin notification "${title}" was not saved: ${error.message}`);
    return null;
  }
}

module.exports = { create };
