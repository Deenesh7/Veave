const mongoose = require('mongoose');

const TYPES = ['NEW_USER', 'UNUSUAL_CREDIT_USAGE', 'GENERATION_FAILED', 'TEMPLATE_PUBLISHED', 'SECURITY', 'SYSTEM_ERROR', 'RESOURCE_WARNING', 'LOW_CREDITS'];

// Notifications for the admin team (shared: one read state for the team, plus who read it).
const schema = new mongoose.Schema({
  type: { type: String, enum: TYPES, required: true, index: true },
  severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  data: { type: mongoose.Schema.Types.Mixed, default: undefined },
  dedupeKey: { type: String, default: undefined },
  readAt: { type: Date, default: null, index: true },
  readBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ createdAt: -1 });
schema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

module.exports = mongoose.model('AdminNotification', schema);
module.exports.TYPES = TYPES;
