/** Numbers for the dashboard and the analytics page, all read from the real collections. */
const User = require('../../models/User');
const TemplateSite = require('../../models/TemplateSite');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const TemplateDefinition = require('../../models/TemplateDefinition');
const CreditTransaction = require('../../models/CreditTransaction');
const ledger = require('./creditLedgerService');
const settings = require('./settingsService');

const DAY = 86_400_000;
const startOfDay = (date) => { const d = new Date(date); d.setUTCHours(0, 0, 0, 0); return d; };
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);
const BALANCE = { $ifNull: ['$subscription.creditsRemaining', '$credits'] };

function range({ from, to, days = 30 } = {}) {
  const end = to && !Number.isNaN(+new Date(to)) ? new Date(to) : new Date();
  end.setUTCHours(23, 59, 59, 999);
  let start = from && !Number.isNaN(+new Date(from)) ? startOfDay(from) : startOfDay(+end - (Math.min(Math.max(Number(days) || 30, 1), 366) - 1) * DAY);
  if (+end - +start > 366 * DAY) start = startOfDay(+end - 365 * DAY);
  if (start > end) start = startOfDay(end);
  return { start, end };
}

/** Fills the days with no data so a chart has one point per day. */
function dailySeries(rows, { start, end }, fields) {
  const byDay = new Map(rows.map((row) => [row._id, row]));
  const out = [];
  for (let t = +startOfDay(start); t <= +end; t += DAY) {
    const key = dayKey(t);
    const row = byDay.get(key) || {};
    out.push({ date: key, ...Object.fromEntries(fields.map((field) => [field, row[field] || 0])) });
  }
  return out;
}

const dayGroup = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'UTC' } });

async function userGrowth(r) {
  const rows = await User.aggregate([{ $match: { createdAt: { $gte: r.start, $lte: r.end } } }, { $group: { _id: dayGroup('$createdAt'), users: { $sum: 1 } } }]);
  const before = await User.countDocuments({ createdAt: { $lt: r.start } });
  let total = before;
  return dailySeries(rows, r, ['users']).map((point) => { total += point.users; return { ...point, total }; });
}

async function dailyConsumption(r) {
  const rows = await CreditTransaction.aggregate([{ $match: { type: 'CREDIT_USAGE', createdAt: { $gte: r.start, $lte: r.end } } }, { $group: { _id: dayGroup('$createdAt'), credits: { $sum: { $multiply: ['$amount', -1] } } } }]);
  return dailySeries(rows, r, ['credits']);
}

async function monthlyConsumption(months = 12) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const rows = await CreditTransaction.aggregate([{ $match: { type: 'CREDIT_USAGE', createdAt: { $gte: start } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'UTC' } }, credits: { $sum: { $multiply: ['$amount', -1] } } } }]);
  const byMonth = new Map(rows.map((row) => [row._id, row.credits]));
  return Array.from({ length: months }, (_, index) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month: key, credits: byMonth.get(key) || 0 };
  });
}

async function popularTemplates(r = null, limit = 8) {
  const match = r ? { createdAt: { $gte: r.start, $lte: r.end } } : {};
  const rows = await TemplateSite.aggregate([{ $match: match }, { $group: { _id: '$templateId', websites: { $sum: 1 }, users: { $addToSet: '$userId' } } }, { $project: { websites: 1, users: { $size: '$users' } } }, { $sort: { websites: -1 } }, { $limit: limit }]);
  const names = await templateNames();
  return rows.map((row) => ({ templateId: row._id, name: names.get(row._id) || row._id, websites: row.websites, users: row.users }));
}

async function templateNames() {
  const docs = await TemplateDefinition.find({}, { templateId: 1, 'manifest.name': 1 }).lean();
  return new Map(docs.map((doc) => [doc.templateId, doc.manifest?.name || doc.templateId]));
}

async function generationActivity(r) {
  const [sites, jobs] = await Promise.all([
    TemplateSite.aggregate([{ $match: { createdAt: { $gte: r.start, $lte: r.end } } }, { $group: { _id: dayGroup('$createdAt'), websites: { $sum: 1 } } }]),
    TemplateGenerationJob.aggregate([{ $match: { createdAt: { $gte: r.start, $lte: r.end }, status: { $in: ['completed', 'failed'] } } }, { $group: { _id: dayGroup('$createdAt'), completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } }])
  ]);
  const merged = new Map();
  for (const row of sites) merged.set(row._id, { _id: row._id, websites: row.websites });
  for (const row of jobs) merged.set(row._id, { ...(merged.get(row._id) || { _id: row._id }), completed: row.completed, failed: row.failed });
  return dailySeries([...merged.values()], r, ['websites', 'completed', 'failed']);
}

async function monthlyGenerations(months = 12) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const rows = await TemplateSite.aggregate([{ $match: { createdAt: { $gte: start } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'UTC' } }, websites: { $sum: 1 } } }]);
  const byMonth = new Map(rows.map((row) => [row._id, row.websites]));
  return Array.from({ length: months }, (_, index) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month: key, websites: byMonth.get(key) || 0 };
  });
}

async function templateCounts() {
  const docs = await TemplateDefinition.find({}, { templateId: 1, version: 1, 'manifest.status': 1 }).lean();
  const ids = new Set(docs.map((doc) => doc.templateId));
  const published = new Set(docs.filter((doc) => doc.manifest?.status === 'published').map((doc) => doc.templateId));
  return { total: ids.size, published: published.size };
}

async function dashboard(query = {}) {
  const r = range({ days: query.days || 30 });
  const { lowBalanceThreshold } = await settings.get('credits');
  const today = startOfDay(new Date());
  const [totalUsers, activeUsers, newToday, lowBalance, templates, websites, totals, growth, daily, monthly, popular, generations] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ lastActiveAt: { $gte: new Date(Date.now() - 30 * DAY) }, status: { $ne: 'suspended' } }),
    User.countDocuments({ createdAt: { $gte: today } }),
    User.countDocuments({ creditsExempt: { $ne: true }, status: { $ne: 'suspended' }, $expr: { $lte: [BALANCE, lowBalanceThreshold] } }),
    templateCounts(),
    TemplateSite.countDocuments({}),
    ledger.totals(),
    userGrowth(r), dailyConsumption(r), monthlyConsumption(12), popularTemplates(null, 8), generationActivity(r)
  ]);
  return {
    range: { from: dayKey(r.start), to: dayKey(r.end) },
    cards: { totalUsers, activeUsers, totalTemplates: templates.total, publishedTemplates: templates.published, websitesGenerated: websites, creditsDistributed: totals.distributed, creditsConsumed: totals.consumed, newToday, lowBalanceUsers: lowBalance, lowBalanceThreshold },
    charts: { userGrowth: growth, dailyCredits: daily, monthlyCredits: monthly, popularTemplates: popular, generations }
  };
}

async function mostActiveUsers(r, limit = 10) {
  const rows = await CreditTransaction.aggregate([
    { $match: { type: 'CREDIT_USAGE', createdAt: { $gte: r.start, $lte: r.end } } },
    { $group: { _id: '$userId', credits: { $sum: { $multiply: ['$amount', -1] } }, actions: { $sum: 1 } } },
    { $sort: { credits: -1 } }, { $limit: limit }
  ]);
  const users = await User.find({ _id: { $in: rows.map((row) => row._id) } }).select('name email plan').lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  return rows.map((row) => ({ userId: String(row._id), name: byId.get(String(row._id))?.name || '', email: byId.get(String(row._id))?.email || '', plan: byId.get(String(row._id))?.plan || '', credits: row.credits, actions: row.actions }));
}

async function analytics(query = {}) {
  const r = range(query);
  const [totals, consumers, growth, daily, monthly, popular, generations, monthlyGen, plans, active] = await Promise.all([
    ledger.totals({ from: r.start, to: r.end }),
    User.countDocuments({ creditsExempt: { $ne: true } }),
    userGrowth(r), dailyConsumption(r), monthlyConsumption(12), popularTemplates(r, 10), generationActivity(r), monthlyGenerations(12),
    User.aggregate([{ $group: { _id: '$plan', users: { $sum: 1 }, credits: { $sum: BALANCE } } }, { $sort: { users: -1 } }]),
    mostActiveUsers(r, 10)
  ]);
  return {
    range: { from: dayKey(r.start), to: dayKey(r.end) },
    credits: { distributed: totals.distributed, consumed: totals.consumed, deducted: totals.deducted, remaining: totals.remaining, averageConsumptionPerUser: consumers ? Number((totals.consumed / consumers).toFixed(2)) : 0, users: totals.users },
    userGrowth: growth, dailyCredits: daily, monthlyCredits: monthly, popularTemplates: popular, generations, monthlyGenerations: monthlyGen,
    subscriptions: plans.map((row) => ({ plan: row._id || 'Free Tier', users: row.users, credits: row.credits })),
    mostActiveUsers: active
  };
}

async function exportReport(report, query = {}) {
  const r = range(query);
  const t = (rows, cols) => ledger.toCsv(rows, cols.map(([label, key]) => ({ label, value: (row) => row[key] })));
  if (report === 'consumption') return t(await dailyConsumption(r), [['Date', 'date'], ['Credits consumed', 'credits']]);
  if (report === 'growth') return t(await userGrowth(r), [['Date', 'date'], ['New users', 'users'], ['Total users', 'total']]);
  if (report === 'generations') return t(await generationActivity(r), [['Date', 'date'], ['Websites created', 'websites'], ['Jobs completed', 'completed'], ['Jobs failed', 'failed']]);
  if (report === 'templates') return t(await popularTemplates(r, 100), [['Template', 'name'], ['Template ID', 'templateId'], ['Websites', 'websites'], ['Users', 'users']]);
  if (report === 'users') return t(await mostActiveUsers(r, 500), [['Name', 'name'], ['Email', 'email'], ['Plan', 'plan'], ['Credits consumed', 'credits'], ['Actions', 'actions']]);
  if (report === 'subscriptions') return t((await analytics(query)).subscriptions, [['Plan', 'plan'], ['Users', 'users'], ['Credits held', 'credits']]);
  return null;
}

module.exports = { dashboard, analytics, exportReport, range, popularTemplates, templateNames };
