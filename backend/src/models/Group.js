const mongoose = require('mongoose');
const { randomBytes } = require('crypto');

// A collaboration group. The owner is also an `owner` GroupMembership so every access check goes through memberships.
const groupSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true, default: () => `grp_${randomBytes(6).toString('hex')}` },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  // Case-insensitive uniqueness of the display name.
  nameKey: { type: String, required: true, unique: true },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  settings: {
    // When true, accepting an invitation puts the user in "pending" until an admin approves them.
    requireApproval: { type: Boolean, default: false },
    // When true, plain members may also invite (invitations are always created by someone with this right).
    membersCanInvite: { type: Boolean, default: false },
    defaultProjectPermission: { type: String, enum: ['viewer', 'editor'], default: 'editor' }
  }
}, { timestamps: true });

groupSchema.statics.keyFor = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

module.exports = mongoose.model('Group', groupSchema);
