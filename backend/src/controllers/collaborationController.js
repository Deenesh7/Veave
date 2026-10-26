const Notification = require('../models/Notification');
const groupService = require('../services/collaboration/groupService');
const invitationService = require('../services/collaboration/invitationService');
const sharingService = require('../services/collaboration/sharingService');

const wrap = (fn, status = 200) => async (req, res, next) => {
  try {
    const data = await fn(req);
    res.status(status).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// Groups
exports.listGroups = wrap((req) => groupService.listGroups(req.user));
exports.createGroup = wrap((req) => groupService.createGroup(req.user, req.body || {}), 201);
exports.getGroup = wrap((req) => groupService.getGroup(req.user, req.params.groupId));
exports.updateGroup = wrap((req) => groupService.updateGroup(req.user, req.params.groupId, req.body || {}));
exports.deleteGroup = wrap((req) => groupService.deleteGroup(req.user, req.params.groupId, req.body?.confirmName));
exports.transferOwnership = wrap((req) => groupService.transferOwnership(req.user, req.params.groupId, req.body?.newOwnerId, req.body?.confirmName));
exports.leaveGroup = wrap((req) => groupService.leaveGroup(req.user, req.params.groupId, { unshareOwnedProjects: req.body?.unshareOwnedProjects === true }));

// Members
exports.listMembers = wrap((req) => groupService.listMembers(req.user, req.params.groupId));
exports.setMemberRole = wrap((req) => groupService.setMemberRole(req.user, req.params.groupId, req.params.userId, req.body?.role));
exports.removeMember = wrap((req) => groupService.removeMember(req.user, req.params.groupId, req.params.userId));
exports.approveMember = wrap((req) => groupService.approveMember(req.user, req.params.groupId, req.params.userId));

// Invitations
exports.inviteToGroup = wrap((req) => invitationService.invite(req.user, req.params.groupId, req.body || {}), 201);
exports.listGroupInvitations = wrap((req) => invitationService.listForGroup(req.user, req.params.groupId));
exports.revokeInvitation = wrap((req) => invitationService.revoke(req.user, req.params.groupId, req.params.invitationId));
exports.listMyInvitations = wrap((req) => invitationService.listMine(req.user, { status: ['pending', 'all'].includes(req.query.status) ? req.query.status : 'pending' }));
exports.acceptInvitation = wrap((req) => invitationService.accept(req.user, req.params.invitationId));
exports.rejectInvitation = wrap((req) => invitationService.reject(req.user, req.params.invitationId));

// Group projects
exports.listGroupProjects = wrap((req) => sharingService.listGroupProjects(req.user, req.params.groupId));
exports.createGroupProject = wrap((req) => sharingService.createGroupProject(req.user, req.params.groupId, req.body || {}), 201);

// Project sharing
exports.listShares = wrap((req) => sharingService.listShares(req.user, req.params.id));
exports.shareProject = wrap((req) => sharingService.shareProject(req.user, req.params.id, req.body || {}), 201);
exports.updateShare = wrap((req) => sharingService.updateSharePermission(req.user, req.params.id, req.params.shareId, req.body?.permission));
exports.unshareProject = wrap((req) => sharingService.unshare(req.user, req.params.id, req.params.shareId));

// Notifications (always scoped to the caller)
exports.listNotifications = wrap(async (req) => {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean(),
    Notification.countDocuments({ userId: req.user._id, readAt: null })
  ]);
  return { items, unread };
});
exports.markNotificationsRead = wrap(async (req) => {
  const filter = { userId: req.user._id, readAt: null };
  if (Array.isArray(req.body?.ids) && req.body.ids.length) filter._id = { $in: req.body.ids.filter((id) => /^[a-f0-9]{24}$/i.test(String(id))) };
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: result.modifiedCount };
});
