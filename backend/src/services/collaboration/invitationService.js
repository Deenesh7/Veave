const Group = require('../../models/Group');
const GroupMembership = require('../../models/GroupMembership');
const GroupInvitation = require('../../models/GroupInvitation');
const User = require('../../models/User');
const { AppError, NotFoundError, ValidationError, ForbiddenError, ConflictError } = require('../../utils/errors');
const { withTransaction, notify, audit, sid } = require('./support');
const { requireMember, ADMIN_ROLES, userId, publicUser } = require('./groupService');
const mail = require('../mail/mailService');
const Project = require('../../models/Project');
const ProjectSharing = require('../../models/ProjectSharing');
const access = require('./projectAccess');

const SCOPES = ['group', 'project', 'both'];
const projectNames = async (rows) => {
  const ids = [...new Set(rows.map((r) => r.projectId).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const list = await Project.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(list.map((p) => [String(p._id), p.name]));
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toInvitation(inv, { group, inviter, invitee, projectName } = {}) {
  return {
    id: sid(inv._id),
    invitationId: inv.invitationId,
    groupId: sid(inv.groupId),
    groupName: group?.name || null,
    inviter: publicUser(inviter) || { id: sid(inv.inviterId) },
    invitee: publicUser(invitee) || { id: sid(inv.inviteeId), email: inv.inviteeEmail },
    inviteeEmail: inv.inviteeEmail,
    role: inv.role,
    scope: inv.scope || 'group',
    projectId: inv.projectId ? sid(inv.projectId) : null,
    projectName: projectName || null,
    projectPermission: inv.projectPermission || 'viewer',
    status: inv.status,
    expiresAt: inv.expiresAt,
    respondedAt: inv.respondedAt,
    createdAt: inv.createdAt
  };
}

/** Marks overdue pending invitations as expired so every reader sees one consistent state. */
async function expireOverdue(filter = {}) {
  await GroupInvitation.updateMany({ ...filter, status: 'pending', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired', respondedAt: new Date() } });
}

async function invite(user, groupId, { email, userId: targetUserId, role = 'member', scope = 'group', projectId = null, projectPermission } = {}) {
  const { group, membership } = await requireMember(user, groupId);
  const isAdmin = ADMIN_ROLES.includes(membership.role);
  if (!isAdmin && !group.settings?.membersCanInvite) throw new ForbiddenError('Only group admins can invite people.', 'GROUP_ADMIN_REQUIRED');
  if (!['admin', 'editor', 'member'].includes(role)) throw new ValidationError('Role must be "admin", "editor" or "member".');
  if (role === 'admin') throw new ForbiddenError('Invite them as editor or staff. A support admin can then make them a group admin.', 'SUPPORT_ADMIN_REQUIRED');
  if (!SCOPES.includes(scope)) throw new ValidationError('Scope must be "group", "project" or "both".');
  let project = null;
  if (scope !== 'group') {
    if (!projectId) throw new ValidationError('Choose the project to invite them to.');
    ({ project } = await access.requireProjectAccess(projectId, user, 'admin'));
    const inGroup = await ProjectSharing.exists({ projectId, targetType: 'group', groupId: group._id });
    if (!inGroup) throw new ValidationError('That project is not shared with this group.');
  }
  const projPerm = scope === 'group' ? 'viewer' : (['viewer', 'editor'].includes(projectPermission) ? projectPermission : (role === 'editor' ? 'editor' : 'viewer'));

  let invitee = null;
  let inviteeEmail;
  if (targetUserId) {
    invitee = await User.findById(targetUserId).select('name email avatar');
    if (!invitee) throw new NotFoundError('User');
    inviteeEmail = invitee.email;
  } else {
    inviteeEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(inviteeEmail)) throw new ValidationError('Enter a valid email address.');
    invitee = await User.findOne({ email: inviteeEmail }).select('name email avatar');
  }
  if (invitee && sid(invitee._id) === userId(user)) throw new ValidationError('You are already in this group.');

  if (invitee && scope !== 'project') {
    const existing = await GroupMembership.findOne({ groupId, userId: invitee._id });
    if (existing && ['active', 'pending'].includes(existing.status)) {
      throw new ConflictError(existing.status === 'active' ? `${invitee.email} is already a member of this group.` : `${invitee.email} already accepted and is waiting for admin approval.`, 'ALREADY_MEMBER');
    }
  }
  await expireOverdue({ groupId, inviteeEmail });
  let invitation;
  try {
    invitation = await GroupInvitation.create({
      groupId, inviterId: userId(user), inviteeId: invitee?._id || null, inviteeEmail, role, scope, projectId: scope === 'group' ? null : projectId, projectPermission: projPerm,
      expiresAt: new Date(Date.now() + GroupInvitation.TTL_MS)
    });
  } catch (error) {
    if (error.code === 11000) throw new ConflictError(`${inviteeEmail} already has a pending invitation to this group.`, 'DUPLICATE_INVITATION');
    throw error;
  }
  await audit(userId(user), 'invitation.sent', { groupId, targetUserId: invitee?._id || null, meta: { invitationId: invitation.invitationId, role, scope, projectId, email: inviteeEmail } });
  await require('../billing/postPaidOnInvite').onInvitation({ inviter: user, inviteeEmail, invitationId: invitation.invitationId });
  if (invitee) {
    await notify(invitee._id, {
      type: 'group_invitation',
      title: `${user.name || 'Someone'} invited you to ${group.name}`,
      message: group.description || 'Open Pending Invitations to accept or decline.',
      data: { invitationId: invitation.invitationId, groupId: sid(group._id), groupName: group.name }
    });
  }
  const delivery = await mail.sendGroupInvitation({
    to: inviteeEmail, inviterName: user.name || 'A Veave user', groupName: group.name, groupDescription: group.description,
    role, expiresAt: invitation.expiresAt, isRegistered: !!invitee
  });
  return { ...toInvitation(invitation, { group, inviter: user, invitee, projectName: project?.name }), email: { sent: delivery.sent, reason: delivery.reason || null }, inviteeRegistered: !!invitee};
}

async function listForGroup(user, groupId) {
  const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  await expireOverdue({ groupId });
  const rows = await GroupInvitation.find({ groupId }).sort({ createdAt: -1 }).limit(100).lean();
  const users = await User.find({ _id: { $in: rows.flatMap((r) => [r.inviterId, r.inviteeId]).filter(Boolean) } }).select('name email avatar').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const names = await projectNames(rows);
  return rows.map((r) => toInvitation(r, { group, inviter: byId.get(String(r.inviterId)), invitee: byId.get(String(r.inviteeId)), projectName: names.get(String(r.projectId)) }));
}

async function listMine(user, { status = 'pending' } = {}) {
  const uid = userId(user);
  // An invitation sent to an email before the person signed up is theirs once an account with that email exists.
  const mine = { $or: [{ inviteeId: uid }, { inviteeId: null, inviteeEmail: String(user.email || '').toLowerCase() }] };
  await expireOverdue(mine);
  const filter = { ...mine, ...(status === 'all' ? {} : { status }) };
  const rows = await GroupInvitation.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  const [groups, inviters] = await Promise.all([
    Group.find({ _id: { $in: rows.map((r) => r.groupId) } }).select('name description').lean(),
    User.find({ _id: { $in: rows.map((r) => r.inviterId) } }).select('name email avatar').lean()
  ]);
  const groupById = new Map(groups.map((g) => [String(g._id), g]));
  const inviterById = new Map(inviters.map((u) => [String(u._id), u]));
  const names = await projectNames(rows);
  return rows.map((r) => ({
    ...toInvitation(r, { group: groupById.get(String(r.groupId)), inviter: inviterById.get(String(r.inviterId)), invitee: user, projectName: names.get(String(r.projectId)) }),
    groupDescription: groupById.get(String(r.groupId))?.description || ''
  }));
}

async function loadMine(user, invitationId) {
  const inv = await GroupInvitation.findOne({ invitationId });
  // Someone else's invitation is "not found": the id alone must never reveal or act on another user's invitation.
  const byId = inv && inv.inviteeId && sid(inv.inviteeId) === userId(user);
  const byEmail = inv && !inv.inviteeId && inv.inviteeEmail === String(user.email || '').toLowerCase();
  if (!byId && !byEmail) throw new NotFoundError('Invitation');
  return inv;
}

function explainStatus(inv) {
  if (inv.status === 'pending') return null;
  const map = {
    accepted: 'This invitation was already accepted.',
    rejected: 'This invitation was already declined.',
    revoked: 'This invitation was revoked by a group admin.',
    expired: 'This invitation has expired. Ask an admin to invite you again.'
  };
  return map[inv.status] || 'This invitation is no longer valid.';
}

async function accept(user, invitationId) {
  const inv = await loadMine(user, invitationId);
  await expireOverdue({ _id: inv._id });
  // Atomic gate: only one request can move a still-valid pending invitation to accepted.
  const claimed = await GroupInvitation.findOneAndUpdate(
    { _id: inv._id, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'accepted', respondedAt: new Date(), inviteeId: user._id } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await GroupInvitation.findById(inv._id);
    throw new ConflictError(explainStatus(fresh) || 'This invitation is no longer valid.', 'INVITATION_NOT_PENDING');
  }
  const group = await Group.findById(claimed.groupId);
  if (!group) {
    await GroupInvitation.updateOne({ _id: claimed._id }, { $set: { status: 'revoked' } });
    throw new ConflictError('This group no longer exists.', 'INVITATION_NOT_PENDING');
  }
  const scope = claimed.scope || 'group';
  const joinsGroup = scope !== 'project';
  const needsApproval = joinsGroup && !!group.settings?.requireApproval;
  try {
    await withTransaction(async (session) => {
      const opt = session ? { session } : {};
      if (joinsGroup) {
        // The invited role is applied automatically; an existing member is updated to it (never demoted owner/admin).
        const existing = await GroupMembership.findOne({ groupId: claimed.groupId, userId: user._id }).session(session || null);
        const keep = existing && existing.status === 'active' && ['owner', 'admin'].includes(existing.role);
        await GroupMembership.findOneAndUpdate(
          { groupId: claimed.groupId, userId: user._id },
          { $set: { ...(keep ? {} : { role: claimed.role }), status: keep ? 'active' : (needsApproval ? 'pending' : 'active'), invitedBy: claimed.inviterId, ...(needsApproval ? {} : { joinedAt: existing?.joinedAt || new Date() }) } },
          { upsert: true, new: true, setDefaultsOnInsert: true, ...opt }
        );
      }
      if (scope !== 'group' && claimed.projectId) {
        const project = await Project.findById(claimed.projectId).select('userId').lean();
        if (project && sid(project.userId) !== userId(user)) {
          const current = await ProjectSharing.findOne({ projectId: claimed.projectId, targetType: 'user', userId: user._id }).session(session || null);
          // Never lower an existing higher grant (e.g. project admin).
          const rank = { viewer: 1, editor: 2, admin: 3 };
          const permission = current && rank[current.permission] > rank[claimed.projectPermission] ? current.permission : claimed.projectPermission;
          await ProjectSharing.findOneAndUpdate(
            { projectId: claimed.projectId, targetType: 'user', userId: user._id },
            { $set: { permission, grantedBy: claimed.inviterId }, $setOnInsert: { projectId: claimed.projectId, targetType: 'user', userId: user._id } },
            { upsert: true, new: true, setDefaultsOnInsert: true, ...opt }
          );
        }
      }
    });
  } catch (error) {
    // Could not be written: put the invitation back so the user can retry.
    await GroupInvitation.updateOne({ _id: claimed._id }, { $set: { status: 'pending', respondedAt: null } });
    throw error;
  }
  await audit(userId(user), 'invitation.accepted', { groupId: claimed.groupId, targetUserId: claimed.inviterId, meta: { invitationId, needsApproval, scope } });
  const admins = await GroupMembership.find({ groupId: claimed.groupId, status: 'active', role: { $in: ADMIN_ROLES } }).select('userId').lean();
  const recipients = [...new Set([sid(claimed.inviterId), ...admins.map((a) => sid(a.userId))])];
  await notify(recipients, {
    type: needsApproval ? 'membership_pending' : 'invitation_accepted',
    title: needsApproval ? `${user.name} accepted and awaits approval` : scope === 'project' ? `${user.name} joined a project in ${group.name}` : `${user.name} joined ${group.name}`,
    message: needsApproval ? 'Approve the member from the group page.' : `${user.email} accepted your invitation.`,
    data: { groupId: sid(group._id), invitationId, userId: userId(user) }
  });
  return { invitation: toInvitation(claimed, { group }), membershipStatus: !joinsGroup ? 'project' : needsApproval ? 'pending' : 'active', groupId: sid(group._id) };
}

async function reject(user, invitationId) {
  const inv = await loadMine(user, invitationId);
  await expireOverdue({ _id: inv._id });
  const claimed = await GroupInvitation.findOneAndUpdate(
    { _id: inv._id, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'rejected', respondedAt: new Date(), inviteeId: user._id } },
    { new: true }
  );
  if (!claimed) {
    const fresh = await GroupInvitation.findById(inv._id);
    throw new ConflictError(explainStatus(fresh) || 'This invitation is no longer valid.', 'INVITATION_NOT_PENDING');
  }
  const group = await Group.findById(claimed.groupId).select('name');
  await audit(userId(user), 'invitation.rejected', { groupId: claimed.groupId, meta: { invitationId } });
  await notify(claimed.inviterId, {
    type: 'invitation_rejected',
    title: `${user.name} declined to join ${group?.name || 'your group'}`,
    data: { groupId: sid(claimed.groupId), invitationId }
  });
  return { invitation: toInvitation(claimed, { group }) };
}

async function revoke(user, groupId, invitationId) {
  const { group } = await requireMember(user, groupId, { roles: ADMIN_ROLES });
  const claimed = await GroupInvitation.findOneAndUpdate(
    { invitationId, groupId, status: 'pending' },
    { $set: { status: 'revoked', respondedAt: new Date() } },
    { new: true }
  );
  if (!claimed) {
    const existing = await GroupInvitation.findOne({ invitationId, groupId });
    if (!existing) throw new NotFoundError('Invitation');
    throw new ConflictError(`Only pending invitations can be revoked (this one is ${existing.status}).`, 'INVITATION_NOT_PENDING');
  }
  await audit(userId(user), 'invitation.revoked', { groupId, targetUserId: claimed.inviteeId || null, meta: { invitationId } });
  if (claimed.inviteeId) await notify(claimed.inviteeId, { type: 'group_invitation', title: `Invitation to ${group.name} was withdrawn`, data: { groupId: sid(group._id) } });
  return { invitation: toInvitation(claimed, { group }) };
}

module.exports = { invite, listForGroup, listMine, accept, reject, revoke, expireOverdue };
