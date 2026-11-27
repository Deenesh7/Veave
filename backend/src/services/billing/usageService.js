const mongoose = require('mongoose');
const Project = require('../../models/Project');
const User = require('../../models/User');
const AIUsage = require('../../models/AIUsage');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { limitsFor, resolvePlanName, creditsForTokens, TOKENS_PER_CREDIT, PLAN_LIMITS, isUnlimitedPlan } = require('./plans');

class PlanLimitError extends AppError {
  constructor(message) {
    super(message, 403);
    this.code = 'PLAN_LIMIT_REACHED';
  }
}

const toObjectId = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

const formatBytes = (bytes) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

/**
 * Real usage straight from the stored projects (the same files the editor loads):
 * - projectCount: active projects owned by the user
 * - storageBytes: true byte size of every stored file, including files offloaded to object storage
 *   (blob.size) and base64 binaries (decoded size, not the inflated base64 length).
 */
async function getProjectUsage(userId) {
  const owner = toObjectId(userId);
  const [projectCount, storage] = await Promise.all([
    Project.countDocuments({ userId: owner, status: { $ne: 'archived' } }),
    Project.aggregate([
      { $match: { userId: owner } },
      { $unwind: '$files' },
      {
        $project: {
          bytes: {
            $cond: [
              { $gt: [{ $ifNull: ['$files.blob.size', 0] }, 0] },
              '$files.blob.size',
              {
                $cond: [
                  { $eq: ['$files.encoding', 'base64'] },
                  { $floor: { $multiply: [{ $strLenBytes: { $ifNull: ['$files.content', ''] } }, 0.75] } },
                  { $strLenBytes: { $ifNull: ['$files.content', ''] } },
                ],
              },
            ],
          },
        },
      },
      { $group: { _id: null, bytes: { $sum: '$bytes' }, files: { $sum: 1 } } },
    ]),
  ]);
  return { projectCount, storageBytes: storage[0]?.bytes || 0, fileCount: storage[0]?.files || 0 };
}

async function planFor(userId) {
  const user = await User.findById(userId).select('plan').lean();
  const name = resolvePlanName(user?.plan);
  return { name, limits: limitsFor(name) };
}

// Throws PlanLimitError when the account may not start something that creates a project or stores more data.
async function assertCanCreate(userId, { newProject = true } = {}) {
  if (!userId) return; // guests have no plan
  const [{ name, limits }, usage] = await Promise.all([planFor(userId), getProjectUsage(userId)]);
  if (newProject && usage.projectCount >= limits.maxProjects) {
    throw new PlanLimitError(`${name} allows ${limits.maxProjects} projects and you have ${usage.projectCount}. Delete a project or upgrade your plan to create more.`);
  }
  if (usage.storageBytes >= limits.storageBytes) {
    throw new PlanLimitError(`Storage is full (${formatBytes(usage.storageBytes)} of ${formatBytes(limits.storageBytes)} on ${name}). Delete projects or upgrade your plan.`);
  }
}

// Same billing period rule as the billing overview: the month before the renewal date, else the calendar month.
function billingPeriodStart(user, now = new Date()) {
  const renewsAt = user?.subscription?.renewsAt ? new Date(user.subscription.renewsAt) : null;
  if (renewsAt && renewsAt > now) {
    const start = new Date(renewsAt);
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** The project's own credit balance, or 0 when it has none. A project with a balance pays for generations in it before the owner does. */
async function projectCredits(projectId) {
  if (!projectId || !mongoose.isValidObjectId(projectId)) return 0;
  const project = await Project.findById(projectId).select('creditBalance').lean();
  return Number(project?.creditBalance) > 0 ? Number(project.creditBalance) : 0;
}

const unlimitedPlanNames = () => Object.keys(PLAN_LIMITS).filter(isUnlimitedPlan);

/**
 * True when nothing about credits or the monthly token allowance may stop (or be charged to) this account:
 *  - the account itself is on an unlimited plan (Post Paid Plan) or is marked credits-exempt;
 *  - the project being worked in belongs to an account on an unlimited plan (its shared collaborators work on that account's terms);
 *  - the account was invited into, or is a member of, a group owned by (or joined through an invitation from) an unlimited account.
 */
async function hasUnlimitedCredits(userId, { projectId = null } = {}) {
  if (!userId) return false;
  const unlimited = unlimitedPlanNames();
  const user = await User.findById(userId).select('plan creditsExempt').lean();
  if (!user) return false;
  if (user.creditsExempt || unlimited.includes(user.plan)) return true;
  if (projectId && mongoose.isValidObjectId(projectId)) {
    const project = await Project.findById(projectId).select('userId').lean();
    if (project?.userId && String(project.userId) !== String(userId) && await User.exists({ _id: project.userId, $or: [{ plan: { $in: unlimited } }, { creditsExempt: true }] })) return true;
  }
  const GroupMembership = require('../../models/GroupMembership');
  const Group = require('../../models/Group');
  const memberships = await GroupMembership.find({ userId: toObjectId(userId), status: 'active' }).select('groupId invitedBy').lean();
  if (!memberships.length) return false;
  const inviters = memberships.map((row) => row.invitedBy).filter(Boolean);
  const groups = await Group.find({ _id: { $in: memberships.map((row) => row.groupId) } }).select('ownerId').lean();
  const sponsors = [...new Set([...inviters, ...groups.map((group) => group.ownerId)].map(String))];
  return Boolean(sponsors.length && await User.exists({ _id: { $in: sponsors }, plan: { $in: unlimited } }));
}

// Throws PlanLimitError when the account has no credits left or has used its monthly token allowance.
async function assertCanUseAI(userId, { projectId = null } = {}) {
  if (!userId) return;
  if (await hasUnlimitedCredits(userId, { projectId })) return;
  if (await projectCredits(projectId) > 0) return; // the project has credits of its own: they pay, so the owner's balance and monthly allowance are not in the way
  const user = await User.findById(userId).select('plan credits subscription creditsExempt').lean();
  if (!user || user.creditsExempt) return;
  const name = resolvePlanName(user.plan);
  const limits = limitsFor(name);
  const creditsLeft = user.subscription?.creditsRemaining ?? user.credits ?? limits.credits;
  if (creditsLeft <= 0) {
    throw new PlanLimitError(`You have used all ${limits.credits} credits included in ${name}. Upgrade your plan to keep generating.`);
  }
  const [agg] = await AIUsage.aggregate([
    { $match: { userId: toObjectId(userId), createdAt: { $gte: billingPeriodStart(user) } } },
    { $group: { _id: null, tokens: { $sum: '$totalTokens' } } },
  ]);
  const used = agg?.tokens || 0;
  const tokenCap = limits.monthlyTokens + (user.subscription?.bonusCredits || 0) * TOKENS_PER_CREDIT;
  if (used >= tokenCap) {
    throw new PlanLimitError(`You have used ${used.toLocaleString()} of ${tokenCap.toLocaleString()} monthly tokens on ${name}. Upgrade your plan to keep generating.`);
  }
}

/**
 * Pays `cost` credits for a generation in a project that has its own balance: takes what the project has (never more than it has,
 * atomically, so two jobs cannot spend the same credits) and returns how many credits are still to be paid by the owner.
 */
async function chargeProjectCredits(userId, projectId, cost) {
  if (!(await projectCredits(projectId))) return cost;
  // Straight on the collection: a pipeline update must not go through the Project model's update hooks (revision, preview rebuild).
  const before = await Project.collection.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(String(projectId)), creditBalance: { $gt: 0 } },
    [{ $set: { creditBalance: { $max: [0, { $subtract: ['$creditBalance', cost] }] } } }],
    { returnDocument: 'before', projection: { creditBalance: 1, userId: 1 } }
  );
  if (!before) return cost;
  const used = Math.min(Number(before.creditBalance), cost);
  try {
    await require('../admin/creditLedgerService').recordProjectUsage({ userId: before.userId || userId, projectId, previousBalance: before.creditBalance, newBalance: before.creditBalance - used, reason: 'AI generation (paid from the project\'s credits)' });
  } catch (error) { logger.warn(`Project credit usage was not recorded: ${error.message}`); }
  return cost - used;
}

// Deducts credits for a finished generation (1 credit per 20,000 tokens, never below zero). Returns the updated user.
// With a projectId, the project's own balance (if it has one) pays first and the owner only pays what is left.
async function chargeCredits(userId, totalTokens, { projectId = null } = {}) {
  if (await hasUnlimitedCredits(userId, { projectId })) return User.findById(userId);
  let cost = creditsForTokens(totalTokens);
  if (projectId) { cost = await chargeProjectCredits(userId, projectId, cost); if (cost <= 0) return User.findById(userId); }
  const floor = (field) => ({ $max: [0, { $subtract: [{ $ifNull: [field, '$credits'] }, cost] }] });
  const before = await User.findByIdAndUpdate(
    userId,
    [{ $set: { credits: { $max: [0, { $subtract: ['$credits', cost] }] }, 'subscription.creditsRemaining': floor('$subscription.creditsRemaining') } }],
    { new: false }
  ).select('credits subscription').lean();
  const updated = await User.findById(userId);
  // Every balance change has a ledger row (the admin Credit Management history); a failed record never blocks the charge.
  if (before && updated) {
    const ledger = require('../admin/creditLedgerService');
    await ledger.recordUsage({ userId, previousBalance: ledger.balanceOf(before), newBalance: ledger.balanceOf(updated), reason: `AI generation (${Number(totalTokens || 0).toLocaleString('en-US')} tokens)`, meta: { tokens: Number(totalTokens) || 0 } });
  }
  return updated;
}

// Throws PlanLimitError unless the account can pay `credits` more credits (used before starting a paid AI task that has a fixed price).
// Estimates are guesses and real usage often runs higher, so an estimated task must fit with a safety buffer on top (default +30%).
const estimateBuffer = () => { const v = Number.parseFloat(process.env.ESTIMATE_BUFFER_PERCENT); return Number.isFinite(v) && v >= 0 ? v / 100 : 0.3; };

async function assertCanSpendCredits(userId, credits, { projectId = null, estimate = false } = {}) {
  if (!userId || !credits) return;
  if (await hasUnlimitedCredits(userId, { projectId })) return;
  const base = credits;
  if (estimate) credits = Math.ceil(credits * (1 + estimateBuffer()));
  const total = credits;
  const fromProject = await projectCredits(projectId);
  if (fromProject >= credits) return;
  await assertCanUseAI(userId, { projectId });
  credits -= fromProject; // the project pays what it has; the owner must cover the rest
  const user = await User.findById(userId).select('plan credits subscription creditsExempt').lean();
  if (!user || user.creditsExempt) return;
  const left = user.subscription?.creditsRemaining ?? user.credits ?? limitsFor(resolvePlanName(user.plan)).credits;
  if (left < credits && estimate) {
    const available = left + fromProject;
    throw new PlanLimitError(`This prompt is estimated to use about ${base} credits (about ${total} with a safety buffer, as it can take more tokens than expected), but you only have ${available} left. It would go over your current credit limit, so please upgrade your plan or buy more credits.`);
  }
  if (left < credits) throw new PlanLimitError(`This needs ${credits} credits and you have ${left}. Buy more credits or upgrade your plan.`);
}

// Deducts a fixed number of credits (never below zero) for a finished task that is priced per item.
async function chargeFixedCredits(userId, credits, { projectId = null } = {}) {
  if (!credits) return User.findById(userId);
  return chargeCredits(userId, credits * TOKENS_PER_CREDIT, { projectId });
}

module.exports = { hasUnlimitedCredits, assertCanSpendCredits, chargeFixedCredits, chargeCredits, getProjectUsage, assertCanCreate, assertCanUseAI, PlanLimitError, formatBytes };
