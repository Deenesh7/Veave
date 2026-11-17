/** Platform settings stored in MongoDB (PlatformSetting). Defaults apply until an admin changes them. */
const PlatformSetting = require('../../models/PlatformSetting');
const { ValidationError } = require('../../utils/errors');

const DEFAULTS = {
  credits: {
    newUserCredits: 50,                       // credits a newly registered user starts with
    monthlyAllocation: { enabled: false, amount: 0, plans: [] },   // credits added each calendar month (to users on the listed plans; empty = every plan)
    expiry: { enabled: false, days: 365 },    // admin-granted credits older than this are expired by the expiry job
    largeAdjustmentThreshold: 500,            // a single change at or above this needs an explicit confirmation
    unusualUsageCredits: 100,                 // one generation costing this many credits raises an admin notification
    lowBalanceThreshold: 10                   // "low credit balance" = at or below this
  },
  plans: {},                                  // { [planName]: { credits, monthlyTokens, maxProjects, storageGB, monthlyCredits, yearlyCredits } }
  platform: { registrationOpen: true }
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const cache = new Map();

const int = (value, name, { min = 0, max = 10_000_000 } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min || number > max) throw new ValidationError(`${name} must be a whole number between ${min} and ${max}.`);
  return number;
};

function sanitize(key, input) {
  const value = input && typeof input === 'object' ? input : {};
  if (key === 'credits') {
    const base = clone(DEFAULTS.credits);
    if (value.newUserCredits !== undefined) base.newUserCredits = int(value.newUserCredits, 'New user credits', { max: 100000 });
    if (value.monthlyAllocation) {
      base.monthlyAllocation = {
        enabled: Boolean(value.monthlyAllocation.enabled),
        amount: int(value.monthlyAllocation.amount ?? 0, 'Monthly allocation', { max: 100000 }),
        plans: Array.isArray(value.monthlyAllocation.plans) ? value.monthlyAllocation.plans.map(String).slice(0, 20) : []
      };
    }
    if (value.expiry) base.expiry = { enabled: Boolean(value.expiry.enabled), days: int(value.expiry.days ?? 365, 'Expiry days', { min: 1, max: 3650 }) };
    if (value.largeAdjustmentThreshold !== undefined) base.largeAdjustmentThreshold = int(value.largeAdjustmentThreshold, 'Large adjustment threshold', { min: 1, max: 1000000 });
    if (value.unusualUsageCredits !== undefined) base.unusualUsageCredits = int(value.unusualUsageCredits, 'Unusual usage threshold', { min: 1, max: 1000000 });
    if (value.lowBalanceThreshold !== undefined) base.lowBalanceThreshold = int(value.lowBalanceThreshold, 'Low balance threshold', { max: 100000 });
    return base;
  }
  if (key === 'platform') {
    return { registrationOpen: value.registrationOpen === undefined ? true : Boolean(value.registrationOpen) };
  }
  if (key === 'plans') return value;
  throw new ValidationError('Unknown setting group.');
}

/** The current value of one group, merged over its defaults. */
async function get(key) {
  if (cache.has(key)) return clone(cache.get(key));
  const doc = await PlatformSetting.findOne({ key }).lean();
  const value = key === 'plans' ? (doc?.value || {}) : { ...clone(DEFAULTS[key]), ...(doc?.value || {}) };
  cache.set(key, value);
  return clone(value);
}

async function set(key, input, adminId = null) {
  const value = sanitize(key, input);
  await PlatformSetting.findOneAndUpdate({ key }, { $set: { value, updatedBy: adminId } }, { upsert: true, new: true });
  cache.set(key, value);
  return clone(value);
}

const clearCache = () => cache.clear();

module.exports = { get, set, DEFAULTS, clearCache, int };
