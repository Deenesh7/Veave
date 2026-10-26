const mongoose = require('mongoose');
const Project = require('../../models/Project');
const ProjectSharing = require('../../models/ProjectSharing');
const Group = require('../../models/Group');
const GroupMembership = require('../../models/GroupMembership');
const User = require('../../models/User');
const { AppError, NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { notify, audit, sid } = require('./support');
const access = require('./projectAccess');
const { requireMember, ADMIN_ROLES, userId } = require('./groupService');

const PERMISSIONS = ['viewer', 'editor', 'admin'];

function toShare(share, { group, user } = {}) {
  return {
    id: sid(share._id),
    projectId: sid(share.projectId),
    targetType: share.targetType,
    permission: share.permission,
    grantedBy: sid(share.grantedBy),
    createdAt: share.createdAt,
    group: group ? { id: sid(group._id), name: group.name, groupId: group.groupId } : null,
    user: user ? { id: sid(user._id), name: user.name, email: user.email, avatar: user.avatar || '' } : null
  };
}

/** A caller can only grant up to their own level, and only the owner can hand out "admin". */
function assertCanGrant(level, permission) {
  if (!PERMISSIONS.includes(permission)) throw new ValidationError('Permission must be viewer, editor or admin.');
  if (permission === 'admin' && level !== 'owner') throw new ForbiddenError('Only the project owner can grant admin access.', 'OWNER_REQUIRED');
}

async function listShares(user, projectId) {
  const { project, level } = await access.requireProjectAccess(projectId, user, 'admin');
  const shares = await ProjectSharing.find({ projectId }).sort({ createdAt: 1 }).lean();
  const [groups, users, owner] = await Promise.all([
    Group.find({ _id: { $in: shares.filter((s) => s.groupId).map((s) => s.groupId) } }).select('name groupId').lean(),
    User.find({ _id: { $in: shares.filter((s) => s.userId).map((s) => s.userId) } }).select('name email avatar').lean(),
    project.userId ? User.findById(project.userId).select('name email avatar').lean() : null
  ]);
  const groupById = new Map(groups.map((g) => [String(g._id), g]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return {
    myLevel: level,
    owner: owner ? { id: sid(owner._id), name: owner.name, email: owner.email, avatar: owner.avatar || '' } : null,
    shares: shares.map((s) => toShare(s, { group: groupById.get(String(s.groupId)), user: userById.get(String(s.userId)) }))
  };
}

async function shareProject(user, projectId, { groupId, userId: targetUserId, email, permission = 'viewer' } = {}) {
  const { project, level } = await access.requireProjectAccess(projectId, user, 'admin');
  assertCanGrant(level, permission);
  const actorId = userId(user);

  if (groupId) {
    const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES }); // you must administer the group you share into
    let share;
    try {
      share = await ProjectSharing.findOneAndUpdate(
        { projectId, targetType: 'group', groupId },
        { $set: { permission, grantedBy: actorId }, $setOnInsert: { projectId, targetType: 'group', groupId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code === 11000) throw new ConflictError('This project is already shared with that group.', 'ALREADY_SHARED');
      throw error;
    }
    await audit(actorId, 'project.shared_with_group', { projectId, groupId, meta: { permission } });
    const members = await GroupMembership.find({ groupId, status: 'active', userId: { $ne: actorId } }).select('userId').lean();
    await notify(members.map((m) => m.userId), {
      type: 'project_shared', title: `${project.name} was shared with ${group.name}`, message: `You can ${permission === 'viewer' ? 'view' : 'edit'} this project.`,
      data: { projectId: sid(projectId), groupId: sid(groupId), permission }
    });
    return toShare(share, { group });
  }

  let target = null;
  if (targetUserId) target = await User.findById(targetUserId).select('name email avatar');
  else if (email) target = await User.findOne({ email: String(email).trim().toLowerCase() }).select('name email avatar');
  if (!target) throw new AppError('No registered Veave user has that email.', 404);
  if (sid(target._id) === sid(project.userId)) throw new ValidationError('That user already owns this project.');
  const share = await ProjectSharing.findOneAndUpdate(
    { projectId, targetType: 'user', userId: target._id },
    { $set: { permission, grantedBy: actorId }, $setOnInsert: { projectId, targetType: 'user', userId: target._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await audit(actorId, 'project.shared_with_user', { projectId, targetUserId: target._id, meta: { permission } });
  await notify(target._id, { type: 'project_shared', title: `${user.name || 'Someone'} shared ${project.name} with you`, data: { projectId: sid(projectId), permission } });
  return toShare(share, { user: target });
}

async function loadShare(projectId, shareId) {
  if (!mongoose.isValidObjectId(shareId)) throw new NotFoundError('Share');
  const share = await ProjectSharing.findOne({ _id: shareId, projectId });
  if (!share) throw new NotFoundError('Share');
  return share;
}

async function updateSharePermission(user, projectId, shareId, permission) {
  const { level } = await access.requireProjectAccess(projectId, user, 'admin');
  assertCanGrant(level, permission);
  const share = await loadShare(projectId, shareId);
  // A non-owner cannot touch (demote) an admin grant: admins cannot lock each other, or the owner's grants, out.
  if (share.permission === 'admin' && level !== 'owner') throw new ForbiddenError('Only the project owner can change an admin grant.', 'OWNER_REQUIRED');
  share.permission = permission;
  share.grantedBy = userId(user);
  await share.save();
  await audit(userId(user), 'project.share_permission_changed', { projectId, groupId: share.groupId, targetUserId: share.userId, meta: { permission } });
  return toShare(share);
}

async function unshare(user, projectId, shareId) {
  const { project, level } = await access.requireProjectAccess(projectId, user, 'admin');
  const share = await loadShare(projectId, shareId);
  if (share.permission === 'admin' && level !== 'owner') throw new ForbiddenError('Only the project owner can remove an admin grant.', 'OWNER_REQUIRED');
  await share.deleteOne();
  await audit(userId(user), 'project.unshared', { projectId, groupId: share.groupId, targetUserId: share.userId });
  if (share.targetType === 'user') await notify(share.userId, { type: 'project_unshared', title: `Access to ${project.name} was removed`, data: { projectId: sid(projectId) } });
  else {
    const members = await GroupMembership.find({ groupId: share.groupId, status: 'active', userId: { $ne: userId(user) } }).select('userId').lean();
    await notify(members.map((m) => m.userId), { type: 'project_unshared', title: `${project.name} is no longer shared with your group`, data: { projectId: sid(projectId), groupId: sid(share.groupId) } });
  }
  return { unshared: true };
}

const LEVEL_LABEL = access.levelName;

async function describeProjects(projects, uid, accessByProject) {
  const owners = await User.find({ _id: { $in: projects.map((p) => p.userId).filter(Boolean) } }).select('name email avatar').lean();
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));
  const groupIds = [...new Set([...accessByProject.values()].flatMap((a) => a.groupIds))];
  const groups = await Group.find({ _id: { $in: groupIds } }).select('name groupId').lean();
  const groupById = new Map(groups.map((g) => [String(g._id), g]));
  return projects.map((p) => {
    const info = accessByProject.get(String(p._id)) || { rank: 0, groupIds: [], direct: false };
    return {
      ...p,
      access: LEVEL_LABEL(info.rank),
      canEdit: info.rank >= access.LEVELS.editor,
      owner: ownerById.get(String(p.userId)) ? { id: sid(p.userId), name: ownerById.get(String(p.userId)).name, email: ownerById.get(String(p.userId)).email } : null,
      groups: info.groupIds.map((id) => groupById.get(id)).filter(Boolean).map((g) => ({ id: sid(g._id), name: g.name })),
      sharedDirectly: info.direct
    };
  });
}

const LIST_SELECT = '-files.content -files.blob';

async function listSharedWithMe(user) {
  const uid = userId(user);
  const shared = await access.listSharedWithUser(uid);
  const ids = [...shared.keys()];
  if (!ids.length) return [];
  const projects = await Project.find({ _id: { $in: ids }, userId: { $ne: uid }, status: 'active' }).select(LIST_SELECT).sort({ updatedAt: -1 }).lean();
  return describeProjects(projects, uid, shared);
}

async function listGroupProjects(user, groupId) {
  const { membership } = await requireMember(user, groupId);
  const uid = userId(user);
  const shares = await ProjectSharing.find({ groupId, targetType: 'group' }).lean();
  if (!shares.length) return [];
  const mine = await access.listSharedWithUser(uid);
  const projects = await Project.find({ _id: { $in: shares.map((s) => s.projectId) }, status: 'active' }).select(LIST_SELECT).sort({ updatedAt: -1 }).lean();
  const rows = await describeProjects(projects, uid, new Map(projects.map((p) => {
    const share = shares.find((s) => String(s.projectId) === String(p._id));
    let rank = access.LEVELS[share.permission];
    if (ADMIN_ROLES.includes(membership.role)) rank = Math.max(rank, access.LEVELS.admin);
    const own = sid(p.userId) === uid;
    return [String(p._id), { rank: own ? access.LEVELS.owner : Math.max(rank, mine.get(String(p._id))?.rank || 0), groupIds: [String(groupId)], direct: false }];
  })));
  return rows.map((row) => ({ ...row, groupPermission: shares.find((s) => String(s.projectId) === String(row._id))?.permission }));
}

async function createGroupProject(user, groupId, { name, description = '', permission } = {}) {
  const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  const projectName = String(name || '').trim();
  if (projectName.length < 1 || projectName.length > 100) throw new ValidationError('Project name must be 1-100 characters.');
  const level = PERMISSIONS.includes(permission) && permission !== 'admin' ? permission : (group.settings?.defaultProjectPermission || 'editor');
  const projectService = require('../project/projectService');
  const { scaffoldReactProject } = require('../project/reactScaffolder');
  const files = scaffoldReactProject([], { projectName });
  const project = await projectService.create(userId(user), { name: projectName, description, files });
  await ProjectSharing.create({ projectId: project._id, targetType: 'group', groupId, permission: level, grantedBy: userId(user) });
  await audit(userId(user), 'project.created_for_group', { projectId: project._id, groupId, meta: { permission: level } });
  const members = await GroupMembership.find({ groupId, status: 'active', userId: { $ne: userId(user) } }).select('userId').lean();
  await notify(members.map((m) => m.userId), {
    type: 'project_shared', title: `New project in ${group.name}: ${projectName}`, data: { projectId: sid(project._id), groupId: sid(groupId), permission: level }
  });
  return { _id: project._id, name: project.name, description: project.description, permission: level };
}

module.exports = { createGroupProject, listShares, shareProject, updateSharePermission, unshare, listSharedWithMe, listGroupProjects, PERMISSIONS };
