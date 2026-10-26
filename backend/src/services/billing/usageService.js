const mongoose = require('mongoose');
const Project = require('../../models/Project');
const User = require('../../models/User');
const AIUsage = require('../../models/AIUsage');
const { AppError } = require('../../utils/errors');
const { limitsFor, resolvePlanName, creditsForTokens } = require('./plans');

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

// Same billing period rule as the billing overview: the 30 days before the renewal date, else the calendar month.
function billingPeriodStart(user, now = new Date()) {
  const renewsAt = user?.subscription?.renewsAt ? new Date(user.subscription.renewsAt) : null;
  if (renewsAt && renewsAt > now) {
    const start = new Date(renewsAt);
    start.setDate(start.getDate() - 30);
    return start;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Throws PlanLimitError when the account has no credits left or has used its monthly token allowance.
async function assertCanUseAI(userId) {
  if (!userId) return;
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
  if (used >= limits.monthlyTokens) {
    throw new PlanLimitError(`You have used ${used.toLocaleString()} of ${limits.monthlyTokens.toLocaleString()} monthly tokens on ${name}. Upgrade your plan to keep generating.`);
  }
}

// Deducts credits for a finished generation (1 credit per 20,000 tokens, never below zero). Returns the updated user.
async function chargeCredits(userId, totalTokens) {
  const exempt = await User.findOne({ _id: userId, creditsExempt: true }).select('_id').lean();
  if (exempt) return User.findById(userId);
  const cost = creditsForTokens(totalTokens);
  const floor = (field) => ({ $max: [0, { $subtract: [{ $ifNull: [field, '$credits'] }, cost] }] });
  return User.findByIdAndUpdate(
    userId,
    [{ $set: { credits: { $max: [0, { $subtract: ['$credits', cost] }] }, 'subscription.creditsRemaining': floor('$subscription.creditsRemaining') } }],
    { new: true }
  );
}

module.exports = { chargeCredits, getProjectUsage, assertCanCreate, assertCanUseAI, PlanLimitError, formatBytes };
