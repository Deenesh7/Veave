const mongoose = require('mongoose');
const Project = require('../../models/Project');
const ProjectSharing = require('../../models/ProjectSharing');
const GroupMembership = require('../../models/GroupMembership');
const { NotFoundError, ForbiddenError } = require('../../utils/errors');

/**
 * Single source of truth for "what may this user do with this project".
 *
 *   owner   the project's creator (or any logged-in user for a legacy ownerless project)
 *   admin   may manage sharing and permissions of the project
 *   editor  may change files and run the AI on the project
 *   viewer  read-only
 *
 * Access is recomputed from the database on every request, so removing a member or revoking a share takes effect
 * immediately, whatever session or token the user is holding.
 */
const LEVELS = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const levelName = (rank) => Object.keys(LEVELS).find((key) => LEVELS[key] === rank) || null;
const idOf = (value) => (value && value._id ? String(value._id) : value ? String(value) : '');
const asObjectId = (value) => (mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null);

async function activeMemberships(userId) {
  if (!userId) return [];
  return GroupMembership.find({ userId, status: 'active' }).select('groupId role').lean();
}

/** Computes the caller's access to an already-loaded project document (needs `_id` and `userId`). */
async function levelForProject(project, userId) {
  const uid = idOf(userId);
  const ownerId = idOf(project.userId);
  if (!ownerId) return { level: 'owner', via: 'legacy-ownerless' }; // ownerless projects keep their old behaviour
  if (!uid) return { level: null, via: null };
  if (ownerId === uid) return { level: 'owner', via: 'owner' };

  const memberships = await activeMemberships(uid);
  const roleByGroup = new Map(memberships.map((m) => [String(m.groupId), m.role]));
  const shares = await ProjectSharing.find({
    projectId: project._id,
    $or: [
      { targetType: 'user', userId: asObjectId(uid) },
      ...(memberships.length ? [{ targetType: 'group', groupId: { $in: memberships.map((m) => m.groupId) } }] : [])
    ]
  }).select('targetType groupId permission').lean();

  let best = 0;
  let via = null;
  for (const share of shares) {
    let rank = LEVELS[share.permission] || 0;
    // Group owners/admins manage the projects shared with their group.
    if (share.targetType === 'group' && ['owner', 'admin'].includes(roleByGroup.get(String(share.groupId)))) rank = Math.max(rank, LEVELS.admin);
    if (rank > best) { best = rank; via = share.targetType === 'group' ? { type: 'group', groupId: String(share.groupId) } : { type: 'user' }; }
  }
  return { level: levelName(best), via };
}

/**
 * Loads a project and enforces a minimum access level.
 * Unknown ids, and projects the caller has no access to at all, are both "not found" so ids cannot be probed.
 * A caller that can see the project but lacks the level gets 403.
 */
async function requireProjectAccess(projectId, user, minLevel = 'viewer', { select = null } = {}) {
  if (!mongoose.isValidObjectId(projectId)) throw new NotFoundError('Project');
  const userId = user ? idOf(user._id || user.id || user) : null;
  const doc = await Project.findById(projectId).select(select ? `${select} userId revision` : 'userId revision name').lean();
  if (!doc) throw new NotFoundError('Project');
  const { level, via } = await levelForProject(doc, userId);
  if (!level) throw new NotFoundError('Project');
  if (LEVELS[level] < LEVELS[minLevel]) {
    throw new ForbiddenError(minLevel === 'editor' ? 'You have view-only access to this project.' : `This action needs ${minLevel} access to the project.`, 'INSUFFICIENT_PROJECT_ACCESS');
  }
  return { project: doc, level, via, canEdit: LEVELS[level] >= LEVELS.editor, canManage: LEVELS[level] >= LEVELS.admin, isOwner: level === 'owner' };
}

/** Mongo filter for a single project the caller may access at `minLevel`. Throws when access is denied. */
async function accessibleQuery(projectId, user, minLevel = 'viewer') {
  await requireProjectAccess(projectId, user, minLevel);
  return { _id: projectId };
}

/** Does anyone besides the owner have access (i.e. is this a collaborative project)? */
async function isShared(projectId) {
  return !!(await ProjectSharing.exists({ projectId }));
}

/** Projects shared with the caller (directly or via groups), excluding the ones they own. */
async function listSharedWithUser(userId) {
  const memberships = await activeMemberships(userId);
  const roleByGroup = new Map(memberships.map((m) => [String(m.groupId), m.role]));
  const shares = await ProjectSharing.find({
    $or: [
      { targetType: 'user', userId },
      ...(memberships.length ? [{ targetType: 'group', groupId: { $in: memberships.map((m) => m.groupId) } }] : [])
    ]
  }).lean();
  const byProject = new Map();
  for (const share of shares) {
    let rank = LEVELS[share.permission] || 0;
    if (share.targetType === 'group' && ['owner', 'admin'].includes(roleByGroup.get(String(share.groupId)))) rank = Math.max(rank, LEVELS.admin);
    const entry = byProject.get(String(share.projectId)) || { rank: 0, groupIds: [], direct: false };
    entry.rank = Math.max(entry.rank, rank);
    if (share.targetType === 'group') entry.groupIds.push(String(share.groupId)); else entry.direct = true;
    byProject.set(String(share.projectId), entry);
  }
  return byProject;
}

module.exports = { LEVELS, levelName, levelForProject, requireProjectAccess, accessibleQuery, isShared, listSharedWithUser, activeMemberships };
