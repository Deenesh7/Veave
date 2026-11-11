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

// Paid plans can top up with extra credits at a flat price per credit.
const CREDIT_PRICE_INR = 12;
const MIN_CREDIT_PURCHASE = 10;
const MAX_CREDIT_PURCHASE = 5000;
const canBuyExtraCredits = (name) => limitsFor(name).price > 0;

// AI photo enhancement (image-to-image) is billed per successful photo, not per token: the model returns an image, not text.
const imageEnhanceCredits = () => {
  const value = Number.parseInt(process.env.IMAGE_ENHANCE_CREDITS, 10);
  return Number.isInteger(value) && value >= 0 ? value : 2;
};

// Credits a generation costs: its tokens divided by 20,000, rounded up, at least 1.
function creditsForTokens(totalTokens) {
  return Math.max(1, Math.ceil((Number(totalTokens) || 0) / TOKENS_PER_CREDIT));
}

module.exports = { imageEnhanceCredits, CREDIT_PRICE_INR, MIN_CREDIT_PURCHASE, MAX_CREDIT_PURCHASE, canBuyExtraCredits, TOKENS_PER_CREDIT, creditsForTokens, PLAN_LIMITS, resolvePlanName, limitsFor };
