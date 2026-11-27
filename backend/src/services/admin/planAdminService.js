/** Plans and subscriptions for admins. The plan table stays in services/billing/plans.js; admin changes are stored as overrides and applied to it. */
const User = require('../../models/User');
const CreditTransaction = require('../../models/CreditTransaction');
const plansModule = require('../billing/plans');
const settings = require('./settingsService');
const audit = require('./auditService');
const ledger = require('./creditLedgerService');
const { ValidationError, NotFoundError } = require('../../utils/errors');

const GB = 1024 * 1024 * 1024;
const BASE = JSON.parse(JSON.stringify(plansModule.PLAN_LIMITS));   // the code's defaults, kept so an override can be undone

function applyOverrides(overrides = {}) {
  for (const [name, plan] of Object.entries(plansModule.PLAN_LIMITS)) {
    const base = BASE[name];
    const o = overrides[name] || {};
    plan.credits = o.credits ?? base.credits;
    plan.monthlyTokens = o.monthlyTokens ?? base.monthlyTokens;
    plan.maxProjects = o.maxProjects ?? base.maxProjects;
    plan.storageBytes = o.storageGB !== undefined ? o.storageGB * GB : base.storageBytes;
  }
}

async function loadOverrides() { applyOverrides(await settings.get('plans')); }

async function list() {
  const overrides = await settings.get('plans');
  const now = new Date();
  const counts = await User.aggregate([{ $group: { _id: { plan: { $ifNull: ['$plan', 'Free Tier'] } }, users: { $sum: 1 },
    active: { $sum: { $cond: [{ $and: [{ $in: [{ $ifNull: ['$subscription.status', 'active'] }, ['active', 'trialing']] }, { $or: [{ $eq: [{ $ifNull: ['$subscription.renewsAt', null] }, null] }, { $gt: ['$subscription.renewsAt', now] }] }] }, 1, 0] } },
    expired: { $sum: { $cond: [{ $and: [{ $gt: [{ $ifNull: ['$subscription.renewsAt', null] }, null] }, { $lte: ['$subscription.renewsAt', now] }] }, 1, 0] } } } }]);
  // Accounts with an old or unknown plan name ("Free Plan") are counted as Free Tier, the same way billing treats them.
  const byPlan = new Map();
  for (const row of counts) {
    const name = plansModule.resolvePlanName(row._id.plan);
    const sum = byPlan.get(name) || { users: 0, active: 0, expired: 0 };
    byPlan.set(name, { users: sum.users + row.users, active: sum.active + row.active, expired: sum.expired + row.expired });
  }
  return Object.entries(plansModule.PLAN_LIMITS).map(([name, limits]) => ({
    name, price: limits.price, credits: limits.credits, monthlyTokens: limits.monthlyTokens, maxProjects: limits.maxProjects, storageGB: Math.round(limits.storageBytes / GB),
    monthlyCredits: overrides[name]?.monthlyCredits ?? limits.credits, yearlyCredits: overrides[name]?.yearlyCredits ?? limits.credits * 12,
    users: byPlan.get(name)?.users || 0, activeSubscriptions: byPlan.get(name)?.active || 0, expiredSubscriptions: byPlan.get(name)?.expired || 0,
    customised: Boolean(overrides[name] && Object.keys(overrides[name]).length)
  }));
}

async function update(admin, name, body, req) {
  if (!plansModule.PLAN_LIMITS[name]) throw new NotFoundError('Plan');
  const next = {};
  const take = (key, label, options) => { if (body[key] !== undefined && body[key] !== null && body[key] !== '') next[key] = settings.int(body[key], label, options); };
  take('credits', 'Credits', { max: 1_000_000 });
  take('monthlyTokens', 'Monthly tokens', { max: 100_000_000_000 });
  take('maxProjects', 'Project limit', { min: 1, max: 100_000 });
  take('storageGB', 'Storage (GB)', { min: 1, max: 100_000 });
  take('monthlyCredits', 'Monthly credits', { max: 1_000_000 });
  take('yearlyCredits', 'Yearly credits', { max: 12_000_000 });
  if (!Object.keys(next).length) throw new ValidationError('Nothing to change.');
  const all = await settings.get('plans');
  const before = { ...(all[name] || {}) };
  const merged = { ...all, [name]: { ...before, ...next } };
  await settings.set('plans', merged, admin._id);
  applyOverrides(merged);
  await audit.record(admin, 'PLAN_UPDATED', { resourceType: 'plan', resourceId: name, before, after: merged[name], req });
  return (await list()).find((plan) => plan.name === name);
}

async function users(name, query = {}) {
  if (!plansModule.PLAN_LIMITS[name]) throw new NotFoundError('Plan');
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const filter = name === 'Free Tier' ? { $or: [{ plan: 'Free Tier' }, { plan: null }, { plan: { $exists: false } }, { plan: { $nin: Object.keys(plansModule.PLAN_LIMITS) } }] } : { plan: name };
  const [total, rows] = await Promise.all([User.countDocuments(filter), User.find(filter).select('name email credits subscription status createdAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()]);
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), users: rows.map((user) => ({ id: String(user._id), name: user.name, email: user.email, status: user.status || 'active', balance: ledger.balanceOf(user), subscriptionStatus: user.subscription?.status || 'active', renewsAt: user.subscription?.renewsAt || null })) };
}

/** Credit rows that come from plans: monthly allocations and plan changes. */
async function transactions(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const filter = { $or: [{ type: 'MONTHLY_CREDIT_ALLOCATION' }, { reason: /^Plan changed/ }, { reason: /^Credits purchased/ }] };
  const [total, rows] = await Promise.all([CreditTransaction.countDocuments(filter), CreditTransaction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean()]);
  const people = await User.find({ _id: { $in: rows.map((row) => row.userId) } }).select('name email').lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), transactions: rows.map((row) => ({ ...row, user: { id: String(row.userId), name: byId.get(String(row.userId))?.name, email: byId.get(String(row.userId))?.email } })) };
}

const addMonths = (date, months) => {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  next.setUTCDate(Math.min(day, new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
  return next;
};

/**
 * Monthly renewal. Every active subscription whose renewal date has passed gets its plan's monthly credits and a renewal date one
 * month later (stepped forward until it is in the future, so a server that was off for a while grants once, not repeatedly).
 *  - the balance becomes the plan's monthly credits plus whatever bought (bonus) credits are still unspent; unused plan credits do not roll over;
 *  - each renewal is one atomic update guarded by the old renewal date and has a ledger row, so running it twice (or on two servers) is safe;
 *  - accounts without a renewal date get one (a month after sign-up, stepped to the future) without any credits being granted;
 *  - suspended and cancelled accounts are skipped.
 */
async function runRenewals(now = new Date()) {
  const overrides = await settings.get('plans');
  let renewed = 0;
  let initialised = 0;

  for await (const user of User.find({ status: { $ne: 'suspended' }, $or: [{ 'subscription.renewsAt': null }, { 'subscription.renewsAt': { $exists: false } }] }).select('_id createdAt').lean().cursor()) {
    let date = addMonths(user.createdAt || now, 1);
    while (date <= now) date = addMonths(date, 1);
    const result = await User.updateOne({ _id: user._id, $or: [{ 'subscription.renewsAt': null }, { 'subscription.renewsAt': { $exists: false } }] }, { $set: { 'subscription.renewsAt': date } });
    if (result.modifiedCount) initialised += 1;
  }

  const due = { status: { $ne: 'suspended' }, plan: { $nin: Object.keys(plansModule.PLAN_LIMITS).filter(plansModule.isUnlimitedPlan) }, 'subscription.status': { $in: ['active', 'trialing'] }, 'subscription.renewsAt': { $lte: now } };
  for await (const user of User.find(due).select('plan credits subscription').lean().cursor()) {
    try {
      const planName = plansModule.resolvePlanName(user.plan);
      const limits = plansModule.limitsFor(planName);
      const allowance = overrides[planName]?.monthlyCredits ?? limits.credits;
      const old = new Date(user.subscription.renewsAt);
      let next = addMonths(old, 1);
      while (next <= now) next = addMonths(next, 1);
      const before = ledger.balanceOf(user);
      const bonus = Math.max(0, user.subscription?.bonusCredits || 0);
      const balance = allowance + Math.min(before, bonus);
      const updated = await User.findOneAndUpdate(
        { _id: user._id, 'subscription.renewsAt': old },
        { $set: { credits: balance, 'subscription.creditsRemaining': balance, 'subscription.creditsAllocated': allowance, 'subscription.tier': planName, 'subscription.renewsAt': next, updatedAt: now } },
        { new: true }
      ).select('_id').lean();
      if (!updated) continue; // another run already renewed this account
      renewed += 1;
      await ledger.recordApplied({ userId: user._id, previousBalance: before, newBalance: balance, type: 'MONTHLY_CREDIT_ALLOCATION', reason: `Monthly renewal of ${planName} (${old.toISOString().slice(0, 10)})`, idempotencyKey: `renewal:${user._id}:${old.toISOString()}`, meta: { plan: planName, allowance } });
    } catch (error) { require('../../utils/logger').warn(`Plan renewal for ${user._id}: ${error.message}`); }
  }
  return { renewed, initialised };
}

module.exports = { runRenewals, list, update, users, transactions, loadOverrides, applyOverrides };
