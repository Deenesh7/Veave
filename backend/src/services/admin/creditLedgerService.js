/**
 * The credit ledger and every credit change made through the admin dashboard.
 *
 * It sits on top of the existing balance fields (User.credits and User.subscription.creditsRemaining) and the existing plan rules:
 *  - a balance is only ever changed here, or by the existing charge paths (which now call recordUsage), and every change has a row;
 *  - a change is one atomic update of the user document with a guard, so two requests cannot overdraw a balance;
 *  - an idempotency key makes a repeated request a no-op that returns the first result;
 *  - balances never go below 0 (the same floor the existing charging uses).
 */
const crypto = require('node:crypto');
const User = require('../../models/User');
const CreditTransaction = require('../../models/CreditTransaction');
const { TYPES } = CreditTransaction;
const settings = require('./settingsService');
const notifications = require('./notificationService');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const BALANCE = { $ifNull: ['$subscription.creditsRemaining', '$credits'] };
const balanceOf = (user) => Number(user?.subscription?.creditsRemaining ?? user?.credits ?? 0);
const newId = () => `ctx_${crypto.randomUUID().replace(/-/g, '')}`;
const MAX_CHANGE = 1_000_000;

function cleanReason(reason, { required = true } = {}) {
  const text = String(reason || '').trim().slice(0, 500);
  if (required && text.length < 3) throw new ValidationError('A reason of at least 3 characters is required.');
  return text;
}

function cleanAmount(amount) {
  const number = Number(amount);
  if (!Number.isInteger(number) || number === 0 || Math.abs(number) > MAX_CHANGE) throw new ValidationError(`Credits must be a whole number between 1 and ${MAX_CHANGE}.`);
  return number;
}

/**
 * Changes one user's balance by `amount` (signed) and records the transaction.
 * Returns { transaction, duplicate }. `expectedBalance` makes the change apply only if the balance is still that value.
 */
async function applyChange({ userId, amount, type, reason, adminId = null, idempotencyKey = null, expectedBalance = null, meta }) {
  if (!TYPES.includes(type)) throw new ValidationError('Unknown credit transaction type.');
  const delta = cleanAmount(amount);
  const note = cleanReason(reason, { required: Boolean(adminId) });
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;

  if (key) {
    const existing = await CreditTransaction.findOne({ idempotencyKey: key }).lean();
    if (existing) return { transaction: existing, duplicate: true };
  }

  const transactionId = newId();
  let pending;
  try {
    pending = await CreditTransaction.create({ transactionId, userId, amount: delta, type, reason: note, adminId, idempotencyKey: key || undefined, status: 'pending', meta });
  } catch (error) {
    if (error?.code === 11000 && key) return { transaction: await CreditTransaction.findOne({ idempotencyKey: key }).lean(), duplicate: true };
    throw error;
  }

  try {
    const guards = [];
    if (delta < 0) guards.push({ $expr: { $gte: [BALANCE, -delta] } });
    if (expectedBalance !== null) guards.push({ $expr: { $eq: [BALANCE, expectedBalance] } });
    const set = {
      credits: { $add: [BALANCE, delta] },
      'subscription.creditsRemaining': { $add: [BALANCE, delta] },
      updatedAt: new Date()
    };
    // Credits that are given (not taken) also lift the monthly token cap, exactly like purchased credits do.
    if (delta > 0) {
      set['subscription.bonusCredits'] = { $add: [{ $ifNull: ['$subscription.bonusCredits', 0] }, delta] };
      set['subscription.creditsAllocated'] = { $add: [{ $ifNull: ['$subscription.creditsAllocated', 0] }, delta] };
    }
    const before = await User.findOneAndUpdate({ _id: userId, ...(guards.length ? { $and: guards } : {}) }, [{ $set: set }], { new: false }).select('credits subscription').lean();
    if (!before) {
      const user = await User.findById(userId).select('credits subscription').lean();
      if (!user) throw new NotFoundError('User');
      if (expectedBalance !== null && balanceOf(user) !== expectedBalance) throw new ConflictError('The balance changed while you were editing. Reload and try again.', 'BALANCE_CHANGED');
      throw new ValidationError(`Not enough credits: the balance is ${balanceOf(user)} and ${-delta} were requested.`);
    }
    const previousBalance = balanceOf(before);
    const completed = await CreditTransaction.findByIdAndUpdate(pending._id, { $set: { previousBalance, newBalance: previousBalance + delta, status: 'completed' } }, { new: true }).lean();
    return { transaction: completed, duplicate: false };
  } catch (error) {
    // The balance was not changed: the pending row is removed so it cannot be mistaken for a real transaction.
    await CreditTransaction.deleteOne({ _id: pending._id, status: 'pending' }).catch(() => {});
    throw error;
  }
}

/** Sets a user's balance to `target` as a CREDIT_ADJUSTMENT (the difference is applied atomically). */
async function adjustTo({ userId, target, reason, adminId, idempotencyKey }) {
  const goal = Number(target);
  if (!Number.isInteger(goal) || goal < 0 || goal > MAX_CHANGE) throw new ValidationError('The new balance must be a whole number of 0 or more.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user = await User.findById(userId).select('credits subscription').lean();
    if (!user) throw new NotFoundError('User');
    const current = balanceOf(user);
    if (current === goal) throw new ValidationError(`The balance is already ${goal}.`);
    try {
      return await applyChange({ userId, amount: goal - current, type: 'CREDIT_ADJUSTMENT', reason, adminId, idempotencyKey, expectedBalance: current, meta: { setTo: goal } });
    } catch (error) { if (error.code !== 'BALANCE_CHANGED' || attempt === 2) throw error; }
  }
  return null;
}

/** Records a charge that the existing billing code already applied (CREDIT_USAGE). Never throws. */
async function recordUsage({ userId, previousBalance, newBalance, reason, meta }) {
  try {
    const used = previousBalance - newBalance;
    if (!(used > 0)) return null;
    const row = await CreditTransaction.create({ transactionId: newId(), userId, previousBalance, amount: -used, newBalance, type: 'CREDIT_USAGE', reason: String(reason || 'AI generation').slice(0, 500), adminId: null, meta });
    const { unusualUsageCredits } = await settings.get('credits');
    if (used >= unusualUsageCredits) {
      await notifications.create({ type: 'UNUSUAL_CREDIT_USAGE', severity: 'warning', title: 'Unusual credit consumption', message: `A single charge of ${used} credits was made (threshold ${unusualUsageCredits}).`, data: { userId: String(userId), credits: used }, dedupeKey: `usage:${row.transactionId}` });
    }
    return row;
  } catch (error) { logger.warn(`Credit usage was not recorded: ${error.message}`); return null; }
}

/** Records a balance change that the existing billing code already applied (purchase, plan change, welcome credits). Never throws. */
async function recordApplied({ userId, previousBalance, newBalance, type, reason, idempotencyKey, meta }) {
  try {
    const amount = newBalance - previousBalance;
    if (!amount) return null;
    return await CreditTransaction.create({ transactionId: newId(), userId, previousBalance, amount, newBalance, type, reason: String(reason || '').slice(0, 500), adminId: null, idempotencyKey: idempotencyKey || undefined, meta });
  } catch (error) {
    if (error?.code !== 11000) logger.warn(`Credit change was not recorded: ${error.message}`);
    return null;
  }
}

/**
 * A balance is stored twice (User.credits and User.subscription.creditsRemaining) and every reader uses creditsRemaining first. If an
 * older code path ever changed only one of them, the two screens would disagree. This makes the legacy field follow the authoritative one.
 * Returns how many accounts were repaired. Safe to run any time.
 */
async function reconcileBalances() {
  const result = await User.updateMany(
    { 'subscription.creditsRemaining': { $type: 'number' }, $expr: { $ne: ['$credits', '$subscription.creditsRemaining'] } },
    [{ $set: { credits: '$subscription.creditsRemaining' } }]
  );
  if (result.modifiedCount) logger.warn(`Credit balances: ${result.modifiedCount} account(s) had two different stored values and were made consistent.`);
  return result.modifiedCount || 0;
}

/* ------------------------------ queries ------------------------------ */

function filterFrom(query = {}) {
  const filter = {};
  if (query.userId) filter.userId = query.userId;
  if (query.adminId) filter.adminId = query.adminId;
  if (query.type && TYPES.includes(String(query.type))) filter.type = String(query.type);
  const from = query.from ? new Date(query.from) : null;
  const to = query.to ? new Date(query.to) : null;
  if ((from && !Number.isNaN(+from)) || (to && !Number.isNaN(+to))) {
    filter.createdAt = {};
    if (from && !Number.isNaN(+from)) filter.createdAt.$gte = from;
    if (to && !Number.isNaN(+to)) filter.createdAt.$lte = new Date(+to + (String(query.to).length <= 10 ? 86_399_999 : 0));
  }
  if (query.direction === 'in') filter.amount = { $gt: 0 };
  if (query.direction === 'out') filter.amount = { $lt: 0 };
  return filter;
}

async function withPeople(rows) {
  const ids = [...new Set(rows.flatMap((row) => [row.userId, row.adminId]).filter(Boolean).map(String))];
  const people = await User.find({ _id: { $in: ids } }).select('name email').lean();
  const byId = new Map(people.map((person) => [String(person._id), person]));
  return rows.map((row) => ({
    ...row,
    user: byId.get(String(row.userId)) ? { id: String(row.userId), name: byId.get(String(row.userId)).name, email: byId.get(String(row.userId)).email } : { id: String(row.userId) },
    admin: row.adminId && byId.get(String(row.adminId)) ? { id: String(row.adminId), name: byId.get(String(row.adminId)).name, email: byId.get(String(row.adminId)).email } : null
  }));
}

async function list(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const filter = filterFrom(query);
  if (query.q) {
    const needle = String(query.q).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({ $or: [{ email: new RegExp(needle, 'i') }, { name: new RegExp(needle, 'i') }] }).select('_id').limit(200).lean();
    filter.userId = { $in: users.map((user) => user._id) };
  }
  const [total, rows] = await Promise.all([
    CreditTransaction.countDocuments(filter),
    CreditTransaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean()
  ]);
  return { transactions: await withPeople(rows), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

const csvCell = (value) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // a spreadsheet must never run a cell as a formula
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (rows, columns) => [columns.map((column) => csvCell(column.label)).join(','), ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(','))].join('\r\n');

async function exportCsv(query = {}) {
  const filter = filterFrom(query);
  const rows = await withPeople(await CreditTransaction.find(filter).sort({ createdAt: -1 }).limit(50_000).lean());
  return toCsv(rows, [
    { label: 'Transaction ID', value: (r) => r.transactionId }, { label: 'Date', value: (r) => new Date(r.createdAt).toISOString() },
    { label: 'User ID', value: (r) => r.user.id }, { label: 'User email', value: (r) => r.user.email || '' },
    { label: 'Type', value: (r) => r.type }, { label: 'Previous balance', value: (r) => r.previousBalance }, { label: 'Credits', value: (r) => r.amount },
    { label: 'New balance', value: (r) => r.newBalance }, { label: 'Reason', value: (r) => r.reason }, { label: 'Admin', value: (r) => r.admin?.email || '' }
  ]);
}

/** Totals for the dashboard: distributed (credits given), consumed (credits used) and what users still hold. */
async function totals({ from = null, to = null } = {}) {
  const match = {};
  if (from || to) match.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [rows, holdings] = await Promise.all([
    CreditTransaction.aggregate([{ $match: match }, { $group: { _id: null,
      distributed: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
      consumed: { $sum: { $cond: [{ $eq: ['$type', 'CREDIT_USAGE'] }, { $multiply: ['$amount', -1] }, 0] } },
      deducted: { $sum: { $cond: [{ $and: [{ $ne: ['$type', 'CREDIT_USAGE'] }, { $lt: ['$amount', 0] }] }, { $multiply: ['$amount', -1] }, 0] } }
    } }]),
    User.aggregate([{ $group: { _id: null, remaining: { $sum: { $ifNull: ['$subscription.creditsRemaining', '$credits'] } }, users: { $sum: 1 } } }])
  ]);
  return { distributed: rows[0]?.distributed || 0, consumed: rows[0]?.consumed || 0, deducted: rows[0]?.deducted || 0, remaining: holdings[0]?.remaining || 0, users: holdings[0]?.users || 0 };
}

/* ------------------------------ scheduled rules ------------------------------ */

const monthKey = (date = new Date()) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** Gives every eligible user the configured monthly credits once per calendar month (safe to run any number of times). */
async function runMonthlyAllocation(now = new Date()) {
  const { monthlyAllocation } = await settings.get('credits');
  if (!monthlyAllocation.enabled || !(monthlyAllocation.amount > 0)) return { skipped: true, allocated: 0 };
  const filter = { status: { $ne: 'suspended' }, creditsExempt: { $ne: true } };
  if (monthlyAllocation.plans?.length) filter.plan = { $in: monthlyAllocation.plans };
  let allocated = 0;
  for await (const user of User.find(filter).select('_id').lean().cursor()) {
    const result = await applyChange({ userId: user._id, amount: monthlyAllocation.amount, type: 'MONTHLY_CREDIT_ALLOCATION', reason: `Monthly credits for ${monthKey(now)}`, adminId: null, idempotencyKey: `monthly:${monthKey(now)}:${user._id}` }).catch((error) => { logger.warn(`Monthly credits for ${user._id}: ${error.message}`); return null; });
    if (result && !result.duplicate) allocated += 1;
  }
  return { skipped: false, allocated };
}

/** Expires admin and monthly grants older than the configured number of days, up to what the user still holds. */
async function runExpiry(now = new Date()) {
  const { expiry } = await settings.get('credits');
  if (!expiry.enabled) return { skipped: true, expired: 0 };
  const cutoff = new Date(+now - expiry.days * 86_400_000);
  let expired = 0;
  for await (const grant of CreditTransaction.find({ type: { $in: ['CREDIT_ALLOCATION', 'MONTHLY_CREDIT_ALLOCATION'] }, amount: { $gt: 0 }, createdAt: { $lte: cutoff }, status: 'completed' }).sort({ createdAt: 1 }).cursor()) {
    const user = await User.findById(grant.userId).select('credits subscription creditsExempt').lean();
    if (!user || user.creditsExempt) continue;
    const take = Math.min(grant.amount, balanceOf(user));
    if (take <= 0) continue;
    const result = await applyChange({ userId: grant.userId, amount: -take, type: 'CREDIT_EXPIRY', reason: `Credits granted on ${grant.createdAt.toISOString().slice(0, 10)} expired after ${expiry.days} days`, adminId: null, idempotencyKey: `expiry:${grant.transactionId}`, meta: { grantTransactionId: grant.transactionId } }).catch(() => null);
    if (result && !result.duplicate) expired += 1;
  }
  return { skipped: false, expired };
}

module.exports = { reconcileBalances, applyChange, adjustTo, recordUsage, recordApplied, list, exportCsv, toCsv, totals, runMonthlyAllocation, runExpiry, balanceOf, TYPES };
