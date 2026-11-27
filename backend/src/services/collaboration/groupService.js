const mongoose = require('mongoose');
const Group = require('../../models/Group');
const GroupMembership = require('../../models/GroupMembership');
const GroupInvitation = require('../../models/GroupInvitation');
const ProjectSharing = require('../../models/ProjectSharing');
const Project = require('../../models/Project');
const User = require('../../models/User');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { withTransaction, notify, audit, sid, isSupportAdmin } = require('./support');

const ADMIN_ROLES = ['owner', 'admin'];
const MAX_ADMINS = 3;
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
    parentId: group.parentId ? sid(group.parentId) : null,
    settings: group.settings,
    myRole: membership?.role || null,
    myStatus: membership?.status || null,
    // True when the caller manages this sub-group because they own or administer its main group (they are not a member of it).
    inherited: !!membership?.inherited,
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
  let membership = await GroupMembership.findOne({ groupId, userId: uid, status: allowPending ? { $in: ['active', 'pending'] } : 'active' });
  if (!membership) {
    // The owner and admins of a main group manage its sub-groups as admins without being members of them.
    const sub = await Group.findById(groupId);
    if (sub?.parentId && await GroupMembership.exists({ groupId: sub.parentId, userId: uid, status: 'active', role: { $in: ADMIN_ROLES } })) {
      membership = { role: 'admin', status: 'active', groupId: sub._id, userId: uid, inherited: true };
      if (roles && !roles.includes('admin')) throw new ForbiddenError('Only the owner of this sub-group can do this.', 'GROUP_OWNER_REQUIRED');
      return { group: sub, membership };
    }
  }
  if (!membership) {
    // A support admin can open any group without joining it (read access; changing a group still needs a group admin or the support-only tools).
    if (isSupportAdmin(user)) {
      const anyGroup = await Group.findById(groupId);
      if (!anyGroup) throw new NotFoundError('Group');
      if (roles && !roles.includes('support')) throw new ForbiddenError('Only group admins can do this.', 'GROUP_ADMIN_REQUIRED');
      return { group: anyGroup, membership: { role: 'support', status: 'active', groupId: anyGroup._id, userId: uid } };
    }
    throw new NotFoundError('Group');
  }
  const group = await Group.findById(groupId);
  if (!group) throw new NotFoundError('Group');
  if (roles && !roles.includes(membership.role)) throw new ForbiddenError('Only group admins can do this.', 'GROUP_ADMIN_REQUIRED');
  return { group, membership };
}

async function createGroup(user, { name, description = '', settings = {} } = {}, parent = null) {
  const uid = userId(user);
  const cleaned = cleanName(name);
  const parentId = parent ? parent._id : null;
  const nameKey = Group.keyFor(cleaned, parentId);
  const taken = parent ? `A sub-group named "${cleaned}" already exists in ${parent.name}.` : `A group named "${cleaned}" already exists. Choose a different name.`;
  if (await Group.exists({ nameKey })) throw new ConflictError(taken, 'GROUP_NAME_TAKEN');
  let group;
  try {
    group = await withTransaction(async (session) => {
      const [created] = await Group.create([{
        name: cleaned, nameKey, description: cleanDescription(description), ownerId: uid, parentId, settings: pickSettings(settings)
      }], session ? { session } : {});
      await GroupMembership.create([{ groupId: created._id, userId: uid, role: 'owner', status: 'active', joinedAt: new Date() }], session ? { session } : {});
      return created;
    });
  } catch (error) {
    if (error.code === 11000) throw new ConflictError(taken, 'GROUP_NAME_TAKEN');
    // Standalone MongoDB has no transactions: do not leave an owner-less group behind.
    throw error;
  }
  // Without transactions, a failure between the two writes could orphan the group; verify and repair.
  if (!(await GroupMembership.exists({ groupId: group._id, userId: uid }))) {
    await GroupMembership.create({ groupId: group._id, userId: uid, role: 'owner', status: 'active', joinedAt: new Date() });
  }
  await audit(uid, parent ? 'group.subgroup_created' : 'group.created', { groupId: group._id, meta: { name: cleaned, ...(parent ? { parentId: sid(parent._id) } : {}) } });
  return toGroup(group, { role: 'owner', status: 'active' }, { memberCount: 1, projectCount: 0, ...(parent ? { parent: { id: sid(parent._id), name: parent.name } } : {}) });
}

/** A sub-group inside a main group (one level only). Only the main group's owner and admins can create one. */
async function createSubgroup(user, parentId, data = {}) {
  const { group: parent } = await requireMember(user, parentId, { roles: ADMIN_ROLES });
  if (parent.parentId) throw new ValidationError('A sub-group cannot have its own sub-groups.');
  return createGroup(user, data, parent);
}

/** The sub-groups of a main group: all of them for its owner and admins, otherwise only the ones the caller belongs to. */
async function listSubgroups(user, parentId) {
  const uid = userId(user);
  const { group: parent, membership } = await requireMember(user, parentId);
  if (parent.parentId) return [];
  const all = ADMIN_ROLES.includes(membership.role) || membership.role === 'support';
  const children = await Group.find({ parentId: parent._id }).lean();
  if (!children.length) return [];
  const ids = children.map((c) => c._id);
  const [mine, counts, projectCounts] = await Promise.all([
    GroupMembership.find({ groupId: { $in: ids }, userId: uid, status: { $in: ['active', 'pending'] } }).lean(),
    GroupMembership.aggregate([{ $match: { groupId: { $in: ids }, status: 'active' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]),
    ProjectSharing.aggregate([{ $match: { groupId: { $in: ids }, targetType: 'group' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }])
  ]);
  const mineBy = new Map(mine.map((m) => [String(m.groupId), m]));
  const memberCount = new Map(counts.map((c) => [String(c._id), c.n]));
  const projectCount = new Map(projectCounts.map((c) => [String(c._id), c.n]));
  const inherited = { role: membership.role === 'support' ? 'support' : 'admin', status: 'active', inherited: membership.role !== 'support' };
  return children
    .filter((c) => all || mineBy.has(String(c._id)))
    .map((c) => {
      const own = mineBy.get(String(c._id));
      const effective = own && (ADMIN_ROLES.includes(own.role) || !all) ? own : inherited;
      return toGroup(c, effective, { memberCount: memberCount.get(String(c._id)) || 0, projectCount: projectCount.get(String(c._id)) || 0, parent: { id: sid(parent._id), name: parent.name } });
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
  let groupIds = memberships.map((m) => m.groupId);
  if (isSupportAdmin(user)) {
    // A support admin sees every group (the ones they are not in are read-only for them apart from the support tools).
    const all = await Group.find({}).select('_id').sort({ updatedAt: -1 }).limit(500).lean();
    const mine = new Set(groupIds.map(String));
    groupIds = [...groupIds, ...all.map((g) => g._id).filter((id) => !mine.has(String(id)))];
  }
  if (!groupIds.length) return [];
  const [found, counts, projectCounts] = await Promise.all([
    Group.find({ _id: { $in: groupIds } }).lean(),
    GroupMembership.aggregate([{ $match: { groupId: { $in: groupIds }, status: 'active' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]),
    ProjectSharing.aggregate([{ $match: { groupId: { $in: groupIds }, targetType: 'group' } }, { $group: { _id: '$groupId', n: { $sum: 1 } } }])
  ]);
  const memberCount = new Map(counts.map((c) => [String(c._id), c.n]));
  const projectCount = new Map(projectCounts.map((c) => [String(c._id), c.n]));
  const membershipByGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
  const supportView = { role: 'support', status: 'active' };
  // A sub-group gets its own card only for someone who is not in its main group (they find it in the main group's Sub-groups tab).
  const parents = await Group.find({ _id: { $in: [...new Set(found.filter((g) => g.parentId).map((g) => String(g.parentId)))] } }).select('name').lean();
  const parentById = new Map(parents.map((p) => [String(p._id), p]));
  const inParent = (g) => membershipByGroup.get(String(g.parentId))?.status === 'active';
  const groups = found.filter((g) => !g.parentId || (membershipByGroup.has(String(g._id)) && !inParent(g)));
  return groups
    .map((group) => toGroup(group, membershipByGroup.get(String(group._id)) || supportView, {
      memberCount: memberCount.get(String(group._id)) || 0,
      projectCount: projectCount.get(String(group._id)) || 0,
      ...(group.parentId && parentById.get(String(group.parentId)) ? { parent: { id: sid(group.parentId), name: parentById.get(String(group.parentId)).name } } : {})
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function getGroup(user, groupId) {
  const { group, membership } = await requireMember(user, groupId, { allowPending: true });
  const [memberCount, projectCount, parent] = await Promise.all([
    GroupMembership.countDocuments({ groupId: group._id, status: 'active' }),
    ProjectSharing.countDocuments({ groupId: group._id, targetType: 'group' }),
    group.parentId ? Group.findById(group.parentId).select('name').lean() : null
  ]);
  const subgroupCount = group.parentId || membership.status !== 'active' ? 0 : (await listSubgroups(user, group._id)).length;
  // Only someone who can open the main group gets a link back to it.
  const canOpenParent = parent && (membership.inherited || isSupportAdmin(user) || await GroupMembership.exists({ groupId: parent._id, userId: userId(user), status: 'active' }));
  return toGroup(group, membership, {
    memberCount, projectCount, subgroupCount,
    parent: parent ? { id: sid(parent._id), name: parent.name, canOpen: !!canOpenParent } : null
  });
}

async function updateGroup(user, groupId, patch = {}) {
  const { group, membership } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  if (patch.name !== undefined) {
    const cleaned = cleanName(patch.name);
    const nameKey = Group.keyFor(cleaned, group.parentId);
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
  return toGroup(group, membership);
}

async function listMembers(user, groupId) {
  const { membership } = await requireMember(user, groupId);
  const isAdmin = ADMIN_ROLES.includes(membership.role);
  const rows = await GroupMembership.find({ groupId, status: isAdmin ? { $in: ['active', 'pending'] } : 'active' }).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name email avatar').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const order = { owner: 0, admin: 1, editor: 2, member: 3 };
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
  if (!['admin', 'editor', 'member'].includes(role)) throw new ValidationError('Role must be "admin", "editor" or "member".');
  const support = isSupportAdmin(user);
  let group; let actor;
  if (support) {
    if (!mongoose.isValidObjectId(groupId)) throw new NotFoundError('Group');
    group = await Group.findById(groupId);
    if (!group) throw new NotFoundError('Group');
    actor = { role: 'owner' }; // a support admin may change any role except the owner's
  } else {
    ({ group, membership: actor } = await requireMember(user, groupId, { roles: ADMIN_ROLES }));
  }
  const target = await GroupMembership.findOne({ groupId, userId: targetUserId, status: 'active' });
  if (!target) throw new NotFoundError('Member');
  if (target.role === 'owner') throw new ForbiddenError('The group owner\'s role cannot be changed. Transfer ownership instead.', 'OWNER_PROTECTED');
  if (sid(target.userId) === userId(user)) throw new ForbiddenError('You cannot change your own role.', 'SELF_ROLE_CHANGE');
  // Group admins are assigned (and removed) by a support admin only. The group owner, and admins, manage editors and staff.
  if (!support && (role === 'admin' || target.role === 'admin')) {
    throw new ForbiddenError('Only a support admin can assign or remove a group admin.', 'SUPPORT_ADMIN_REQUIRED');
  }
  if (actor.role !== 'owner' && target.role === 'admin') throw new ForbiddenError('Only a support admin can change a group admin.', 'SUPPORT_ADMIN_REQUIRED');
  if (target.role === role) return { userId: sid(target.userId), role };
  if (role === 'admin') {
    const admins = await GroupMembership.countDocuments({ groupId, status: 'active', role: 'admin' });
    if (admins >= MAX_ADMINS) throw new ConflictError(`A group can have at most ${MAX_ADMINS} admins (the owner is not counted). Change an existing admin first.`, 'ADMIN_LIMIT');
  }
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
  if (membership.inherited) throw new ValidationError('You manage this sub-group through its main group, so there is nothing to leave.');
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
  // The owner deletes a group; a sub-group can also be deleted by the owner or an admin of its main group.
  const { group, membership } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  if (membership.role !== 'owner' && !membership.inherited) throw new ForbiddenError('Only the group owner can delete the group.', 'GROUP_OWNER_REQUIRED');
  if (String(confirmName || '').trim() !== group.name) throw new ValidationError('Type the group name exactly to confirm deletion.');
  // Deleting a main group deletes its sub-groups too.
  const ids = [group._id, ...(await Group.find({ parentId: group._id }).select('_id').lean()).map((g) => g._id)];
  const members = await GroupMembership.find({ groupId: { $in: ids }, status: 'active' }).select('userId').lean();
  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    await ProjectSharing.deleteMany({ groupId: { $in: ids } }, opts);
    await GroupInvitation.updateMany({ groupId: { $in: ids }, status: 'pending' }, { $set: { status: 'revoked', respondedAt: new Date() } }, opts);
    await GroupMembership.deleteMany({ groupId: { $in: ids } }, opts);
    await Group.deleteMany({ _id: { $in: ids } }, opts);
  });
  await audit(userId(user), 'group.deleted', { groupId, meta: { name: group.name } });
  await notify([...new Set(members.map((m) => sid(m.userId)))].filter((id) => id !== userId(user)), { type: 'removed_from_group', title: `${group.name} was deleted`, data: {} });
  return { deleted: true };
}

module.exports = {
  ADMIN_ROLES, requireMember, createGroup, createSubgroup, listSubgroups, listGroups, getGroup, updateGroup, listMembers, setMemberRole, approveMember,
  removeMember, leaveGroup, transferOwnership, deleteGroup, publicUser, userId
};
