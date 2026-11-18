/**
 * Credits of a single PROJECT, set by the root administrator.
 *
 * A project with a balance pays for the generations made in it before its owner's own balance is touched (see usageService). The balance
 * is kept on the project (Project.creditBalance); every change is a ledger row (CreditTransaction with projectId), an audit entry and a
 * notification to the owner. Changes are atomic and guarded, so a balance can never go below 0 and a repeated request is a no-op.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Project = require('../../models/Project');
const User = require('../../models/User');
const CreditTransaction = require('../../models/CreditTransaction');
const audit = require('./auditService');
const { notify } = require('../collaboration/support');
const { ValidationError, NotFoundError } = require('../../utils/errors');

const MAX = 1_000_000;
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const present = (project, owner) => ({
  id: String(project._id), name: project.name, creditBalance: project.creditBalance ?? null, updatedAt: project.updatedAt,
  owner: owner ? { id: String(owner._id), name: owner.name, email: owner.email } : null
});

async function search(query = {}) {
  const q = String(query.q || '').trim().slice(0, 80);
  const filter = { status: { $ne: 'archived' } };
  if (q) {
    const owners = await User.find({ $or: [{ email: new RegExp(escapeRegex(q), 'i') }, { name: new RegExp(escapeRegex(q), 'i') }] }).select('_id').limit(50).lean();
    filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { userId: { $in: owners.map((o) => o._id) } }, ...(/^[a-f0-9]{24}$/i.test(q) ? [{ _id: q }] : [])];
  }
  const projects = await Project.find(filter).select('name userId creditBalance updatedAt').sort({ updatedAt: -1 }).limit(20).lean();
  const owners = await User.find({ _id: { $in: projects.map((p) => p.userId).filter(Boolean) } }).select('name email').lean();
  const byId = new Map(owners.map((o) => [String(o._id), o]));
  return projects.map((p) => present(p, byId.get(String(p.userId))));
}

async function mustFind(id) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Project');
  const project = await Project.findById(id).select('name userId creditBalance updatedAt').lean();
  if (!project) throw new NotFoundError('Project');
  return project;
}

async function get(id) {
  const project = await mustFind(id);
  const owner = project.userId ? await User.findById(project.userId).select('name email').lean() : null;
  const history = await CreditTransaction.find({ projectId: project._id, status: 'completed' }).sort({ createdAt: -1 }).limit(30).lean();
  return { project: present(project, owner), history };
}

/** action: 'add' | 'deduct' | 'set'. Returns { project, transaction, duplicate }. */
async function change(admin, id, { action, amount, reason, idempotencyKey = null }, req) {
  const project = await mustFind(id);
  const value = Number(amount);
  if (!['add', 'deduct', 'set'].includes(action)) throw new ValidationError('The action must be add, deduct or set.');
  if (!Number.isInteger(value) || value < (action === 'set' ? 0 : 1) || value > MAX) throw new ValidationError(`Credits must be a whole number${action === 'set' ? ' of 0 or more' : ' of 1 or more'} (at most ${MAX}).`);
  const note = String(reason || '').trim().slice(0, 500);
  if (note.length < 3) throw new ValidationError('A reason of at least 3 characters is required.');
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
  if (key) {
    const existing = await CreditTransaction.findOne({ idempotencyKey: key }).lean();
    if (existing) return { project: (await get(id)).project, transaction: existing, duplicate: true };
  }

  const NOW = { $ifNull: ['$creditBalance', 0] };
  const filter = { _id: project._id, ...(action === 'deduct' ? { $expr: { $gte: [NOW, value] } } : {}) };
  const next = action === 'add' ? { $add: [NOW, value] } : action === 'deduct' ? { $subtract: [NOW, value] } : value;
  // Straight on the collection: a pipeline update must not run the Project model's update hooks (revision bump, preview rebuild).
  const before = await Project.collection.findOneAndUpdate(filter, [{ $set: { creditBalance: next } }], { returnDocument: 'before', projection: { creditBalance: 1 } });
  if (!before) throw new ValidationError(`Not enough credits: the project has ${project.creditBalance ?? 0} and ${value} were requested.`);
  const previous = Number(before.creditBalance ?? 0);
  const after = action === 'add' ? previous + value : action === 'deduct' ? previous - value : value;
  if (action === 'set' && after === previous) { /* still recorded: an explicit confirmation of the balance */ }

  let transaction;
  try {
    transaction = await CreditTransaction.create({
      transactionId: `ctx_${crypto.randomUUID().replace(/-/g, '')}`, userId: project.userId, projectId: project._id,
      previousBalance: previous, amount: after - previous, newBalance: after,
      type: action === 'add' ? 'CREDIT_ALLOCATION' : 'CREDIT_ADJUSTMENT', reason: note, adminId: admin._id, idempotencyKey: key || undefined,
      meta: { scope: 'project', action, projectName: project.name }
    });
  } catch (error) {
    if (error?.code === 11000 && key) return { project: (await get(id)).project, transaction: await CreditTransaction.findOne({ idempotencyKey: key }).lean(), duplicate: true };
    throw error;
  }
  await audit.record(admin, 'PROJECT_CREDITS_CHANGED', { resourceType: 'project', resourceId: String(project._id), before: { creditBalance: previous }, after: { creditBalance: after }, meta: { action, amount: value, reason: note, projectName: project.name }, req });
  if (project.userId && after !== previous) {
    await notify(project.userId, { type: 'project_credits', title: `${project.name}: ${after > previous ? `${after - previous} credits added` : `${previous - after} credits removed`}`, message: `This project now has ${after} credits of its own. ${note}`, data: { projectId: String(project._id) } }).catch(() => {});
  }
  require('../cache/cacheService').invalidate('projects').catch(() => {});
  return { project: (await get(id)).project, transaction: transaction.toObject(), duplicate: false };
}

module.exports = { search, get, change };
