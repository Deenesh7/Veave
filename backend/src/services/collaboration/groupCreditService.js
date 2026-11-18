/**
 * Credits of a group's projects, managed by the platform's support admins (see isSupportAdmin in support.js).
 *
 * A support admin does not create credits: they move them. "add" takes credits from the manager's own balance and puts them on projects
 * (Project.creditBalance, which a project spends before anyone's personal balance, see usageService); "take" moves unspent project credits
 * back to the manager's own balance. Every move is a ledger row on the manager's balance and one audit entry listing every project, so
 * the totals always add up.
 *
 * A bulk change touches several documents. Each step is an atomic guarded update; if a later step fails, the earlier ones are undone so a
 * request is all-or-nothing (and a refund of whatever could not be undone is issued). Mongo transactions are not needed for this and
 * are not available on a standalone server.
 */
const mongoose = require('mongoose');
const Project = require('../../models/Project');
const ProjectSharing = require('../../models/ProjectSharing');
const User = require('../../models/User');
const AuditLog = require('../../models/AuditLog');
const CreditTransaction = require('../../models/CreditTransaction');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../utils/errors');
const { audit, notify, sid, isSupportAdmin } = require('./support');
const { userId } = require('./groupService');
const Group = require('../../models/Group');
const ledger = require('../admin/creditLedgerService');
const logger = require('../../utils/logger');

const MAX_EACH = 100000;
const MAX_PROJECTS = 200;
const NOW = { $ifNull: ['$creditBalance', 0] };

const projectUpdate = (id, filter, next) => Project.collection.findOneAndUpdate({ _id: id, ...filter }, [{ $set: { creditBalance: next } }], { returnDocument: 'before', projection: { creditBalance: 1 } });
const give = (id, amount) => projectUpdate(id, {}, { $add: [NOW, amount] });
const takeAway = (id, amount) => projectUpdate(id, { $expr: { $gte: [NOW, amount] } }, { $subtract: [NOW, amount] });

async function sharedProjects(groupId) {
  const shares = await ProjectSharing.find({ groupId, targetType: 'group' }).select('projectId').lean();
  if (!shares.length) return [];
  return Project.find({ _id: { $in: shares.map((share) => share.projectId) }, status: 'active' }).select('name userId creditBalance').sort({ name: 1 }).lean();
}

/** Group credits belong to the platform's support admins: any group, whether or not they are a member of it. */
async function requireSupport(user, groupId) {
  if (!isSupportAdmin(user)) throw new ForbiddenError('Only a support admin can manage group credits.', 'SUPPORT_ADMIN_REQUIRED');
  if (!mongoose.isValidObjectId(groupId)) throw new NotFoundError('Group');
  const group = await Group.findById(groupId);
  if (!group) throw new NotFoundError('Group');
  return { group };
}

async function myBalance(uid) {
  const user = await User.findById(uid).select('credits subscription').lean();
  return ledger.balanceOf(user);
}

/** What the credits box shows: the group's projects with their balances, the totals and what the caller can still give. */
async function overview(user, groupId) {
  await requireSupport(user, groupId);
  const projects = await sharedProjects(groupId);
  const allocated = projects.reduce((sum, project) => sum + (Number(project.creditBalance) || 0), 0);
  return {
    projects: projects.map((project) => ({ id: sid(project._id), name: project.name, creditBalance: Number(project.creditBalance) || 0 })),
    totals: { projects: projects.length, allocated, average: projects.length ? Math.round((allocated / projects.length) * 10) / 10 : 0 },
    available: await myBalance(userId(user)),
    limits: { maxEach: MAX_EACH, maxProjects: MAX_PROJECTS }
  };
}

function cleanAllocations(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new ValidationError('Choose at least one project.');
  if (raw.length > MAX_PROJECTS) throw new ValidationError(`At most ${MAX_PROJECTS} projects can be changed at once.`);
  const seen = new Set();
  return raw.map((entry) => {
    const projectId = String(entry?.projectId || '');
    const amount = Number(entry?.amount);
    if (!mongoose.isValidObjectId(projectId)) throw new ValidationError('One of the projects is not valid.');
    if (seen.has(projectId)) throw new ValidationError('A project was listed twice.');
    seen.add(projectId);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_EACH) throw new ValidationError(`Credits must be a whole number between 1 and ${MAX_EACH}.`);
    return { projectId, amount };
  });
}

/**
 * action: 'add' | 'take'. allocations: [{ projectId, amount }]. Returns the fresh overview plus what was changed.
 * `idempotencyKey` makes a repeated request (a double click, a retry) a no-op.
 */
async function changeCredits(user, groupId, { action, allocations, idempotencyKey } = {}) {
  const { group } = await requireSupport(user, groupId);
  if (!['add', 'take'].includes(action)) throw new ValidationError('The action must be "add" or "take".');
  const wanted = cleanAllocations(allocations);
  const uid = userId(user);
  const key = idempotencyKey ? `group-credits:${uid}:${String(idempotencyKey).slice(0, 80)}` : null;
  if (key && await CreditTransaction.exists({ idempotencyKey: key })) return { ...(await overview(user, groupId)), duplicate: true, changed: [] };

  const projects = await sharedProjects(groupId);
  const byId = new Map(projects.map((project) => [sid(project._id), project]));
  const rows = wanted.map((entry) => {
    const project = byId.get(entry.projectId);
    if (!project) throw new NotFoundError('Project');
    if (action === 'take' && entry.amount > (Number(project.creditBalance) || 0)) {
      throw new ValidationError(`"${project.name}" has only ${Number(project.creditBalance) || 0} credits, so ${entry.amount} cannot be taken back.`);
    }
    return { ...entry, project };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const meta = { scope: 'group-credits', groupId: sid(group._id), groupName: group.name, projects: rows.length };
  const applied = []; // { row, before }

  if (action === 'add') {
    // 1. The caller pays first (guarded: it fails cleanly if the balance is too low).
    await ledger.applyChange({ userId: uid, amount: -total, type: 'CREDIT_DEDUCTION', reason: `Credits given to ${rows.length} project${rows.length === 1 ? '' : 's'} of ${group.name}`, idempotencyKey: key, meta });
    // 2. Then every project is credited; any failure undoes what was done and refunds.
    try {
      for (const row of rows) {
        const before = await give(row.project._id, row.amount);
        if (!before) throw new NotFoundError('Project');
        applied.push({ row, before: Number(before.creditBalance) || 0 });
      }
    } catch (error) {
      let stillOnProjects = 0;
      for (const done of applied.reverse()) {
        const undone = await takeAway(done.row.project._id, done.row.amount).catch(() => null);
        if (!undone) stillOnProjects += done.row.amount;
      }
      await ledger.applyChange({ userId: uid, amount: total - stillOnProjects, type: 'CREDIT_REFUND', reason: `Refund: the credits for ${group.name} could not be completed`, meta }).catch((e) => logger.error(`Group credit refund failed for ${uid}: ${e.message}`));
      throw error;
    }
  } else {
    try {
      for (const row of rows) {
        const before = await takeAway(row.project._id, row.amount);
        if (!before) throw new ValidationError(`"${row.project.name}" no longer has ${row.amount} credits. Reload and try again.`);
        applied.push({ row, before: Number(before.creditBalance) || 0 });
      }
      await ledger.applyChange({ userId: uid, amount: total, type: 'CREDIT_REFUND', reason: `Credits taken back from ${rows.length} project${rows.length === 1 ? '' : 's'} of ${group.name}`, idempotencyKey: key, meta });
    } catch (error) {
      for (const done of applied.reverse()) await give(done.row.project._id, done.row.amount).catch((e) => logger.error(`Group credit rollback failed: ${e.message}`));
      throw error;
    }
  }

  const changed = rows.map((row, index) => ({ projectId: row.projectId, name: row.project.name, amount: row.amount, before: applied[index]?.before ?? null, after: action === 'add' ? row.amount + (applied[index]?.before ?? 0) : (applied[index]?.before ?? 0) - row.amount }));
  await audit(uid, 'group.credits_changed', { groupId, meta: { operation: action, total, projects: changed } });
  const owners = new Map();
  rows.forEach((row, index) => { const owner = sid(row.project.userId); if (owner && owner !== uid) owners.set(owner, [...(owners.get(owner) || []), changed[index]]); });
  for (const [owner, list] of owners) {
    await notify(owner, { type: 'project_credits', title: `${group.name}: project credits ${action === 'add' ? 'added' : 'taken back'}`, message: list.map((c) => `${c.name}: ${c.before} -> ${c.after}`).join('; ').slice(0, 300), data: { groupId: sid(group._id) } }).catch(() => {});
  }
  require('../cache/cacheService').invalidate('projects').catch(() => {});
  return { ...(await overview(user, groupId)), duplicate: false, changed };
}

/** The group's recent credit changes (newest first), for the history list in the credits box. */
async function history(user, groupId, { limit = 25 } = {}) {
  await requireSupport(user, groupId);
  const rows = await AuditLog.find({ groupId, action: 'group.credits_changed' }).sort({ createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 25, 1), 100)).lean();
  const actors = await User.find({ _id: { $in: rows.map((row) => row.actorId) } }).select('name email').lean();
  const byId = new Map(actors.map((actor) => [sid(actor._id), actor]));
  return rows.map((row) => ({
    id: sid(row._id), at: row.createdAt, operation: row.meta?.operation, total: row.meta?.total || 0,
    actor: byId.get(sid(row.actorId)) ? { name: byId.get(sid(row.actorId)).name, email: byId.get(sid(row.actorId)).email } : null,
    projects: (row.meta?.projects || []).map((p) => ({ name: p.name, amount: p.amount, before: p.before, after: p.after }))
  }));
}

/** One project (the coin next to a project's name): the same operation with a single allocation. */
async function manageProjectCredits(user, groupId, projectId, { action, amount, idempotencyKey } = {}) {
  const result = await changeCredits(user, groupId, { action, allocations: [{ projectId, amount }], idempotencyKey });
  const project = result.projects.find((p) => p.id === String(projectId));
  return { projectId: String(projectId), creditBalance: project?.creditBalance ?? 0 };
}

module.exports = { overview, changeCredits, history, manageProjectCredits };
