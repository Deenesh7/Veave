const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const groupInvitationSchema = new mongoose.Schema({
  invitationId: { type: String, required: true, unique: true, default: () => `inv_${randomBytes(8).toString('hex')}` },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  inviterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Null while the invited person has no account yet; filled in when they accept (their email must match).
  inviteeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  inviteeEmail: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'revoked', 'expired'], default: 'pending' },
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + INVITATION_TTL_MS) },
  respondedAt: { type: Date, default: null }
}, { timestamps: true });

// One live invitation per (group, email): the database, not just the controller, prevents duplicates.
groupInvitationSchema.index(
  { groupId: 1, inviteeEmail: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
groupInvitationSchema.index({ inviteeId: 1, status: 1, createdAt: -1 });
groupInvitationSchema.index({ inviteeEmail: 1, status: 1 });
groupInvitationSchema.index({ groupId: 1, status: 1 });

groupInvitationSchema.statics.TTL_MS = INVITATION_TTL_MS;

module.exports = mongoose.model('GroupInvitation', groupInvitationSchema);
