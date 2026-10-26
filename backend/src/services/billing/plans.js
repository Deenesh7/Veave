// Single source of truth for plan limits (used by billing overview and by limit enforcement).
const PLAN_LIMITS = {
  'Free Tier': {
    price: 0,
    credits: 50,
    monthlyTokens: 1_000_000,
    storageBytes: 5 * 1024 * 1024 * 1024,   // 5 GB
    maxProjects: 5,
  },
  'Plus Plan': {
    price: 2999,
    credits: 250,
    monthlyTokens: 5_000_000,
    storageBytes: 50 * 1024 * 1024 * 1024,  // 50 GB
    maxProjects: 15,
  },
  'Pro Plan': {
    price: 5999,
    credits: 750,
    monthlyTokens: 15_000_000,
    storageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    maxProjects: 100,
  },
};

// Accounts created before plans were named consistently have plan "Free Plan" (or none).
function resolvePlanName(name) {
  return PLAN_LIMITS[name] ? name : 'Free Tier';
}

function limitsFor(name) {
  return PLAN_LIMITS[resolvePlanName(name)];
}

// 1 credit = 20,000 tokens (so 50 credits = 1,000,000 tokens, 250 = 5M, 750 = 15M).
const TOKENS_PER_CREDIT = 20_000;

// Credits a generation costs: its tokens divided by 20,000, rounded up, at least 1.
function creditsForTokens(totalTokens) {
  return Math.max(1, Math.ceil((Number(totalTokens) || 0) / TOKENS_PER_CREDIT));
}

module.exports = { TOKENS_PER_CREDIT, creditsForTokens, PLAN_LIMITS, resolvePlanName, limitsFor };
