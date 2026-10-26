const mongoose = require('mongoose');

// Append-only record of administrative actions (group, membership and sharing changes).
const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ groupId: 1, createdAt: -1 });
auditLogSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
