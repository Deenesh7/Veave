const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['group_invitation', 'invitation_accepted', 'invitation_rejected', 'membership_pending', 'membership_approved',
      'removed_from_group', 'project_shared', 'project_unshared', 'role_changed', 'ownership_transferred'],
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null }
}, { timestamps: true });

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
