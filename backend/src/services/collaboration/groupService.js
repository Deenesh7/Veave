const mongoose = require('mongoose');
const Group = require('../../models/Group');
const GroupMembership = require('../../models/GroupMembership');
const GroupInvitation = require('../../models/GroupInvitation');
const ProjectSharing = require('../../models/ProjectSharing');
const Project = require('../../models/Project');
const User = require('../../models/User');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { withTransaction, notify, audit, sid } = require('./support');

const ADMIN_ROLES = ['owner', 'admin'];
const userId = (user) => sid(user?._id || user?.id || user);

const publicUser = (u) => (u ? { id: sid(u._id), name: u.name, email: u.email, avatar: u.avatar || '' } : null);

function cleanName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 60) throw new ValidationError('Group name must be 2-60 characters.');
  return value;
}

function cleanDescription(description) {
  const value = String(description ?? '').trim();
  if (value.length > 500) throw new ValidationError('Description must be 500 characters or fewer.');
  return value;
}

function toGroup(group, membership, extra = {}) {
  return {
    id: sid(group._id),
    groupId: group.groupId,
    name: group.name,
    description: group.description,
    ownerId: sid(group.ownerId),
    settings: group.settings,
    myRole: membership?.role || null,
    myStatus: membership?.status || null,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    ...extra
  };
}

/** Loads the group and the caller's membership. Non-members get "not found" so group ids cannot be probed. */
async function requireMember(user, groupId, { roles = null, allowPending = false } = {}) {
  if (!mongoose.isValidObjectId(groupId)) throw new NotFoundError('Group');
  const uid = userId(user);
  if (!uid) throw new NotFoundError('Group');
  const membership = await GroupMembership.findOne({ groupId, userId: uid, status: allowPending ? { $in: ['active', 'pending'] } : 'active' });
  if (!membership) throw new NotFoundError('Group');
  const group = await Group.findById(groupId);
  if (!group) throw new NotFoundError('Group');
  if (roles && !roles.includes(membership.role)) throw new ForbiddenError('Only group admins can do this.', 'GROUP_ADMIN_REQUIRED');
  return { group, membership };
}

async function createGroup(user, { name, description = '', settings = {} } = {}) {
  const uid = userId(user);
  const cleaned = cleanName(name);
  const nameKey = Group.keyFor(cleaned);
  if (await Group.exists({ nameKey })) throw new ConflictError(`A group named "${cleaned}" already exists. Choose a different name.`, 'GROUP_NAME_TAKEN');
  let group;
  try {
    group = await withTransaction(async (session) => {
      const [created] = await Group.create([{
        name: cleaned, nameKey, description: cleanDescription(description), ownerId: uid, settings: pickSettings(settings)
      }], session ? { session } : {});
      await GroupMembership.create([{ groupId: created._id, userId: uid, role: 'owner', status: 'active', joinedAt: new Date() }], session ? { session } : {});
      return created;
    });
  } catch (error) {
    if (error.code === 11000) throw new ConflictError(`A group named "${cleaned}" already exists. Choose a different name.`, 'GROUP_NAME_TAKEN');
    // Standalone MongoDB has no transactions: do not leave an owner-less group behind.
    throw error;
  }
  // Without transactions, a failure between the two writes could orphan the group; verify and repair.
  if (!(await GroupMembership.exists({ groupId: group._id, userId: uid }))) {
    await GroupMembership.create({ groupId: group._id, userId: uid, role: 'owner', status: 'active', joinedAt: new Date() });
  }
  await audit(uid, 'group.created', { groupId: group._id, meta: { name: cleaned } });
  return toGroup(group, { role: 'owner', status: 'active' }, { memberCount: 1, projectCount: 0 });
}

function pickSettings(input = {}) {
  const out = {};
  if (typeof input.requireApproval === 'boolean') out.requireApproval = input.requireApproval;
  if (typeof input.membersCanInvite === 'boolean') out.membersCanInvite = input.membersCanInvite;
  if (['viewer', 'editor'].includes(input.defaultProjectPermission)) out.defaultProjectPermission = input.defaultProjectPermission;
  return out;
}

async function listGroups(user) {
  const uid = userId(user);
  const memberships = await GroupMembership.find({ userId: uid, status: { $in: ['active', 'pending'] } }).lean();
  if (!memberships.length) return [];
  const groupIds = memberships.map((m) => m.groupId);
  const [groups, counts, projectCounts] = await Promise.all([
    Group.find({ _id: { $in: groupIds } }).lean(),
    GroupMembership.aggregate([{ $match: { groupId: { $in: groupIds }, status: 'active' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]),
    ProjectSharing.aggregate([{ $match: { groupId: { $in: groupIds }, targetType: 'group' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }])
  ]);
  const memberCount = new Map(counts.map((c) => [String(c._id), c.n]));
  const projectCount = new Map(projectCounts.map((c) => [String(c._id), c.n]));
  const membershipByGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
  return groups
    .map((group) => toGroup(group, membershipByGroup.get(String(group._id)), {
      memberCount: memberCount.get(String(group._id)) || 0,
      projectCount: projectCount.get(String(group._id)) || 0
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function getGroup(user, groupId) {
  const { group, membership } = await requireMember(user, groupId, { allowPending: true });
  const [memberCount, projectCount] = await Promise.all([
    GroupMembership.countDocuments({ groupId: group._id, status: 'active' }),
    ProjectSharing.countDocuments({ groupId: group._id, targetType: 'group' })
  ]);
  return toGroup(group, membership, { memberCount, projectCount });
}

async function updateGroup(user, groupId, patch = {}) {
  const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  if (patch.name !== undefined) {
    const cleaned = cleanName(patch.name);
    const nameKey = Group.keyFor(cleaned);
    if (nameKey !== group.nameKey && await Group.exists({ nameKey, _id: { $ne: group._id } })) {
      throw new ConflictError(`A group named "${cleaned}" already exists. Choose a different name.`, 'GROUP_NAME_TAKEN');
    }
    group.name = cleaned;
    group.nameKey = nameKey;
  }
  if (patch.description !== undefined) group.description = cleanDescription(patch.description);
  if (patch.settings) Object.assign(group.settings, pickSettings(patch.settings));
  try {
    await group.save();
  } catch (error) {
    if (error.code === 11000) throw new ConflictError('A group with that name already exists.', 'GROUP_NAME_TAKEN');
    throw error;
  }
  await audit(userId(user), 'group.updated', { groupId: group._id, meta: { fields: Object.keys(patch) } });
  return toGroup(group, { role: (await GroupMembership.findOne({ groupId, userId: userId(user) })).role, status: 'active' });
}

async function listMembers(user, groupId) {
  const { membership } = await requireMember(user, groupId);
  const isAdmin = ADMIN_ROLES.includes(membership.role);
  const rows = await GroupMembership.find({ groupId, status: isAdmin ? { $in: ['active', 'pending'] } : 'active' }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name email avatar').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const order = { owner: 0, admin: 1, member: 2 };
  return rows
    .map((row) => ({
      id: sid(row._id),
      userId: sid(row.userId),
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt,
      user: publicUser(byId.get(String(row.userId)))
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || order[a.role] - order[b.role] || String(a.user?.name).localeCompare(String(b.user?.name)));
}

async function setMemberRole(user, groupId, targetUserId, role) {
  if (!['admin', 'member'].includes(role)) throw new ValidationError('Role must be "admin" or "member".');
  const { group, membership: actor } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  const target = await GroupMembership.findOne({ groupId, userId: targetUserId, status: 'active' });
  if (!target) throw new NotFoundError('Member');
  if (target.role === 'owner') throw new ForbiddenError('The group owner\'s role cannot be changed. Transfer ownership instead.', 'OWNER_PROTECTED');
  if (sid(target.userId) === userId(user)) throw new ForbiddenError('You cannot change your own role.', 'SELF_ROLE_CHANGE');
  // Only the owner may promote to / demote from admin; admins manage plain members only (no privilege escalation).
  if (actor.role !== 'owner' && (role === 'admin' || target.role === 'admin')) {
    throw new ForbiddenError('Only the group owner can grant or remove the admin role.', 'OWNER_REQUIRED');
  }
  if (target.role === role) return { userId: sid(target.userId), role };
  target.role = role;
  await target.save();
  await audit(userId(user), 'group.member_role_changed', { groupId, targetUserId, meta: { role } });
  await notify(targetUserId, { type: 'role_changed', title: `Your role in ${group.name} changed`, message: `You are now a group ${role}.`, data: { groupId: sid(group._id) } });
  return { userId: sid(target.userId), role };
}

async function approveMember(user, groupId, targetUserId) {
  const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  const target = await GroupMembership.findOneAndUpdate(
    { groupId, userId: targetUserId, status: 'pending' },
    { $set: { status: 'active', joinedAt: new Date() } },
    { new: true }
  );
  if (!target) throw new NotFoundError('Pending member');
  await audit(userId(user), 'group.member_approved', { groupId, targetUserId });
  await notify(targetUserId, { type: 'membership_approved', title: `You joined ${group.name}`, message: 'An admin approved your membership.', data: { groupId: sid(group._id) } });
  return { userId: sid(target.userId), status: 'active' };
}

async function removeMember(user, groupId, targetUserId) {
  const { group, membership: actor } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  const target = await GroupMembership.findOne({ groupId, userId: targetUserId, status: { $in: ['active', 'pending'] } });
  if (!target) throw new NotFoundError('Member');
  if (target.role === 'owner') throw new ForbiddenError('The group owner cannot be removed.', 'OWNER_PROTECTED');
  if (sid(target.userId) === userId(user)) throw new ForbiddenError('Use "Leave group" to remove yourself.', 'USE_LEAVE');
  if (target.role === 'admin' && actor.role !== 'owner') throw new ForbiddenError('Only the group owner can remove an admin.', 'OWNER_REQUIRED');
  target.status = 'removed';
  await target.save();
  // Direct per-user shares granted through this group's admins stay; group-based access disappears with the membership.
  await audit(userId(user), 'group.member_removed', { groupId, targetUserId });
  await notify(targetUserId, { type: 'removed_from_group', title: `You were removed from ${group.name}`, message: 'You no longer have access to this group\'s projects.', data: { groupId: sid(group._id) } });
  return { removed: true };
}

async function leaveGroup(user, groupId, { unshareOwnedProjects = false } = {}) {
  const uid = userId(user);
  const { group, membership } = await requireMember(user, groupId, { allowPending: true });
  if (membership.role === 'owner') throw new ForbiddenError('The owner cannot leave. Transfer ownership or delete the group first.', 'OWNER_CANNOT_LEAVE');
  const owned = await Project.find({ userId: uid }).select('_id').lean();
  const sharedOwned = owned.length ? await ProjectSharing.find({ groupId, targetType: 'group', projectId: { $in: owned.map((p) => p._id) } }).select('_id').lean() : [];
  if (sharedOwned.length && !unshareOwnedProjects) {
    throw new ConflictError(`You own ${sharedOwned.length} project(s) shared with this group. Leaving will stop sharing them with the group.`, 'OWNED_PROJECTS_SHARED', { count: sharedOwned.length });
  }
  if (sharedOwned.length) await ProjectSharing.deleteMany({ _id: { $in: sharedOwned.map((s) => s._id) } });
  membership.status = 'left';
  await membership.save();
  await audit(uid, 'group.left', { groupId, meta: { unsharedProjects: sharedOwned.length } });
  const admins = await GroupMembership.find({ groupId, status: 'active', role: { $in: ADMIN_ROLES } }).select('userId').lean();
  await notify(admins.map((a) => a.userId), { type: 'removed_from_group', title: `${user.name || 'A member'} left ${group.name}`, data: { groupId: sid(group._id) } });
  return { left: true };
}

async function transferOwnership(user, groupId, newOwnerId, confirmName) {
  const { group, membership: actor } = await requireMember(user, groupId, { roles: ['owner'] });
  if (String(confirmName || '').trim() !== group.name) throw new ValidationError('Type the group name exactly to confirm the ownership transfer.');
  const next = await GroupMembership.findOne({ groupId, userId: newOwnerId, status: 'active' });
  if (!next || sid(next.userId) === userId(user)) throw new NotFoundError('Member');
  // Order matters when transactions are unavailable: promote first so the group never has no owner.
  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    next.role = 'owner';
    await next.save(opts);
    actor.role = 'admin';
    await actor.save(opts);
    group.ownerId = next.userId;
    await group.save(opts);
  });
  await audit(userId(user), 'group.ownership_transferred', { groupId, targetUserId: newOwnerId });
  await notify(newOwnerId, { type: 'ownership_transferred', title: `You now own ${group.name}`, data: { groupId: sid(group._id) } });
  return { ownerId: sid(newOwnerId) };
}

async function deleteGroup(user, groupId, confirmName) {
  const { group } = await requireMember(user, groupId, { roles: ['owner'] });
  if (String(confirmName || '').trim() !== group.name) throw new ValidationError('Type the group name exactly to confirm deletion.');
  const members = await GroupMembership.find({ groupId, status: 'active' }).select('userId').lean();
  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await ProjectSharing.deleteMany({ groupId }, opts);
    await GroupInvitation.updateMany({ groupId, status: 'pending' }, { $set: { status: 'revoked', respondedAt: new Date() } }, opts);
    await GroupMembership.deleteMany({ groupId }, opts);
    await Group.deleteOne({ _id: groupId }, opts);
  });
  await audit(userId(user), 'group.deleted', { groupId, meta: { name: group.name } });
  await notify(members.map((m) => m.userId).filter((id) => sid(id) !== userId(user)), { type: 'removed_from_group', title: `${group.name} was deleted`, data: {} });
  return { deleted: true };
}

module.exports = {
  ADMIN_ROLES, requireMember, createGroup, listGroups, getGroup, updateGroup, listMembers, setMemberRole, approveMember,
  removeMember, leaveGroup, transferOwnership, deleteGroup, publicUser, userId
};
