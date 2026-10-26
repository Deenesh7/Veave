const mongoose = require('mongoose');

// Grants a group (or a single user) access to a project at a permission level. The project owner is implicit.
const projectSharingSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  targetType: { type: String, enum: ['group', 'user'], required: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  permission: { type: String, enum: ['viewer', 'editor', 'admin'], default: 'viewer' },
  grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

projectSharingSchema.pre('validate', function requireOneTarget(next) {
  if (this.targetType === 'group' && !this.groupId) return next(new Error('groupId is required for a group share'));
  if (this.targetType === 'user' && !this.userId) return next(new Error('userId is required for a user share'));
  return next();
});

projectSharingSchema.index({ projectId: 1, groupId: 1 }, { unique: true, partialFilterExpression: { targetType: 'group' } });
projectSharingSchema.index({ projectId: 1, userId: 1 }, { unique: true, partialFilterExpression: { targetType: 'user' } });
projectSharingSchema.index({ groupId: 1 });
projectSharingSchema.index({ userId: 1 });

module.exports = mongoose.model('ProjectSharing', projectSharingSchema);
