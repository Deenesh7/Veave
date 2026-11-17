/** Admin credit operations: confirmation rules, single and bulk changes, each with a ledger row and an audit entry. */
const User = require('../../models/User');
const ledger = require('./creditLedgerService');
const settings = require('./settingsService');
const audit = require('./auditService');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');

const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));
const ACTIONS = { add: 'CREDIT_ALLOCATION', deduct: 'CREDIT_DEDUCTION', refund: 'CREDIT_REFUND', set: 'CREDIT_ADJUSTMENT' };
const MAX_BULK = 50_000;

async function needConfirmation(size, confirmed, what) {
  const { largeAdjustmentThreshold } = await settings.get('credits');
  if (size >= largeAdjustmentThreshold && !confirmed) {
    throw new ConflictError(`${what} is ${size} credits (${largeAdjustmentThreshold} or more needs confirmation). Confirm to continue.`, 'CONFIRMATION_REQUIRED', { threshold: largeAdjustmentThreshold, size });
  }
}

/** add | deduct | refund | set (set the balance to a value). */
async function adjust(admin, { userId, action, amount, reason, confirm = false, idempotencyKey = null }, req) {
  if (!isId(userId)) throw new ValidationError('Choose a user.');
  if (!ACTIONS[action]) throw new ValidationError('Action must be add, deduct, refund or set.');
  const user = await User.findById(userId).select('name email credits subscription').lean();
  if (!user) throw new NotFoundError('User');
  const current = ledger.balanceOf(user);
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0 || (action !== 'set' && value === 0)) throw new ValidationError('Enter a whole number of credits.');
  const delta = action === 'set' ? value - current : action === 'deduct' ? -value : value;
  await needConfirmation(Math.abs(delta), confirm, action === 'set' ? 'This change' : 'This amount');
  const result = action === 'set'
    ? await ledger.adjustTo({ userId, target: value, reason, adminId: admin._id, idempotencyKey })
    : await ledger.applyChange({ userId, amount: delta, type: ACTIONS[action], reason, adminId: admin._id, idempotencyKey });
  if (!result.duplicate) {
    await audit.record(admin, action === 'deduct' ? 'CREDITS_DEDUCTED' : action === 'set' ? 'CREDITS_ADJUSTED' : action === 'refund' ? 'CREDITS_REFUNDED' : 'CREDITS_ALLOCATED', {
      resourceType: 'user', resourceId: userId, before: { balance: result.transaction.previousBalance }, after: { balance: result.transaction.newBalance }, meta: { transactionId: result.transaction.transactionId, amount: result.transaction.amount, reason: result.transaction.reason, email: user.email }, req
    });
  }
  return result;
}

/** Gives the same credits to chosen users, or to every eligible user. Repeating a batch (same batchKey) changes nothing twice. */
async function allocate(admin, { userIds = [], all = false, plans = [], amount, reason, confirm = false, batchKey = null }, req) {
  const credits = Number(amount);
  if (!Number.isInteger(credits) || credits < 1 || credits > 100_000) throw new ValidationError('Credits must be a whole number between 1 and 100000.');
  let ids;
  if (all) {
    const filter = { status: { $ne: 'suspended' }, creditsExempt: { $ne: true } };
    if (Array.isArray(plans) && plans.length) filter.plan = { $in: plans.map(String).slice(0, 20) };
    ids = (await User.find(filter).select('_id').limit(MAX_BULK + 1).lean()).map((user) => String(user._id));
    if (ids.length > MAX_BULK) throw new ValidationError(`Too many users (more than ${MAX_BULK}).`);
  } else {
    if (!Array.isArray(userIds) || !userIds.length) throw new ValidationError('Select at least one user.');
    if (userIds.length > 1000) throw new ValidationError('Select at most 1000 users at a time.');
    ids = [...new Set(userIds.map(String))];
    if (ids.some((id) => !isId(id))) throw new ValidationError('One of the selected users is not valid.');
    const found = await User.find({ _id: { $in: ids }, status: { $ne: 'suspended' } }).select('_id').lean();
    ids = found.map((user) => String(user._id));
  }
  if (!ids.length) throw new ValidationError('No eligible users to give credits to.');
  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 3) throw new ValidationError('A reason of at least 3 characters is required.');
  // Everyone-at-once and big batches always need an explicit confirmation.
  await needConfirmation(all ? Math.max(credits * ids.length, (await settings.get('credits')).largeAdjustmentThreshold) : credits * ids.length, confirm, `Giving ${credits} credits to ${ids.length} user${ids.length === 1 ? '' : 's'} (${credits * ids.length} in total)`);
  const batch = batchKey ? String(batchKey).slice(0, 80) : null;
  let applied = 0;
  let duplicates = 0;
  const failed = [];
  for (const userId of ids) {
    try {
      const result = await ledger.applyChange({ userId, amount: credits, type: 'CREDIT_ALLOCATION', reason: cleanReason, adminId: admin._id, idempotencyKey: batch ? `bulk:${batch}:${userId}` : null, meta: { bulk: true, batch } });
      if (result.duplicate) duplicates += 1; else applied += 1;
    } catch (error) { failed.push({ userId, error: error.message }); }
  }
  await audit.record(admin, 'CREDITS_ALLOCATED_BULK', { resourceType: 'credits', resourceId: batch || '', after: { credits, users: applied, everyone: Boolean(all) }, meta: { reason: cleanReason, requested: ids.length, duplicates, failed: failed.length, plans }, req });
  return { requested: ids.length, applied, duplicates, failed: failed.slice(0, 50), failedCount: failed.length };
}

module.exports = { adjust, allocate, ACTIONS };
