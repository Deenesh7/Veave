const mongoose = require('mongoose');

const groupMembershipSchema = new mongoose.Schema({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  // active: has access. pending: accepted but waiting for admin approval. removed/left: no access (kept for history).
  status: { type: String, enum: ['active', 'pending', 'removed', 'left'], default: 'active' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  joinedAt: { type: Date, default: null }
}, { timestamps: true });

groupMembershipSchema.index({ groupId: 1, userId: 1 }, { unique: true });
groupMembershipSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('GroupMembership', groupMembershipSchema);
