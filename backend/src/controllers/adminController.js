/** Thin HTTP layer for /api/admin. Every route is mounted behind `auth` and `requireAdmin`; the logic lives in services/admin. */
const User = require('../models/User');
const AdminAuditLog = require('../models/AdminAuditLog');
const AdminNotification = require('../models/AdminNotification');
const users = require('../services/admin/adminUserService');
const credits = require('../services/admin/adminCreditService');
const ledger = require('../services/admin/creditLedgerService');
const templateAdmin = require('../services/admin/adminTemplateService');
const plans = require('../services/admin/planAdminService');
const analytics = require('../services/admin/adminAnalyticsService');
const settings = require('../services/admin/settingsService');
const audit = require('../services/admin/auditService');
const { ValidationError, NotFoundError } = require('../utils/errors');

const ok = (res, data = {}, status = 200) => res.status(status).json({ success: true, data });
const wrap = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
const csv = (res, name, body) => { res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); res.send(`\uFEFF${body}`); };
const page = (query) => ({ page: Math.max(1, Number.parseInt(query.page, 10) || 1), limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25)) });
const idOf = (value) => (/^[a-f0-9]{24}$/i.test(String(value || '')) ? String(value) : null);

/* dashboard & analytics */
exports.dashboard = wrap(async (req, res) => ok(res, await analytics.dashboard(req.query)));
exports.analytics = wrap(async (req, res) => ok(res, await analytics.analytics(req.query)));
exports.analyticsExport = wrap(async (req, res) => {
  const body = await analytics.exportReport(String(req.query.report || ''), req.query);
  if (body === null) throw new ValidationError('Unknown report.');
  csv(res, `veave-${req.query.report}-${new Date().toISOString().slice(0, 10)}.csv`, body);
});

/* users */
exports.listUsers = wrap(async (req, res) => ok(res, await users.list(req.query)));
exports.getUser = wrap(async (req, res) => ok(res, await users.get(req.params.id)));
exports.userWebsites = wrap(async (req, res) => ok(res, await users.websites(req.params.id)));
exports.userActivity = wrap(async (req, res) => ok(res, await users.activity(req.params.id)));
exports.userCredits = wrap(async (req, res) => { await users.mustFind(req.params.id); ok(res, await ledger.list({ ...req.query, userId: req.params.id })); });
exports.userNotes = wrap(async (req, res) => ok(res, { notes: await users.notes(req.params.id) }));
exports.addUserNote = wrap(async (req, res) => ok(res, { note: await users.addNote(req.user, req.params.id, req.body?.note, req) }, 201));
exports.setUserStatus = wrap(async (req, res) => ok(res, { user: await users.setStatus(req.user, req.params.id, req.body?.status, req.body?.reason, req) }));
exports.setUserPlan = wrap(async (req, res) => ok(res, { user: await users.setPlan(req.user, req.params.id, req.body?.plan, req) }));
exports.setUserRole = wrap(async (req, res) => ok(res, { user: await users.setRole(req.user, req.params.id, req.body?.role, req) }));

/* credits */
exports.creditAdjust = wrap(async (req, res) => {
  const result = await credits.adjust(req.user, { ...req.body, idempotencyKey: req.body?.idempotencyKey || req.get('Idempotency-Key') || null }, req);
  ok(res, { transaction: result.transaction, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
});
exports.creditAllocate = wrap(async (req, res) => ok(res, await credits.allocate(req.user, req.body || {}, req), 201));
exports.creditTransactions = wrap(async (req, res) => ok(res, await ledger.list(req.query)));
exports.creditExport = wrap(async (req, res) => {
  await audit.record(req.user, 'CREDITS_EXPORTED', { resourceType: 'credits', meta: { filters: req.query }, req });
  csv(res, `veave-credit-transactions-${new Date().toISOString().slice(0, 10)}.csv`, await ledger.exportCsv(req.query));
});
exports.creditSummary = wrap(async (req, res) => {
  const r = analytics.range(req.query);
  ok(res, { totals: await ledger.totals({ from: r.start, to: r.end }), settings: await settings.get('credits'), range: { from: r.start, to: r.end } });
});

/* templates */
const pick = (body) => ({ name: body.name, description: body.description, category: body.category, tags: body.tags, keywords: body.keywords });
const fileOf = (req, field) => req.files?.[field]?.[0] || null;
exports.listTemplates = wrap(async (req, res) => ok(res, await templateAdmin.list(req.query)));
exports.getTemplate = wrap(async (req, res) => ok(res, await templateAdmin.detail(req.params.id)));
exports.uploadTemplate = wrap(async (req, res) => {
  const zip = fileOf(req, 'file');
  if (!zip) throw new ValidationError('Choose a ZIP file to upload.');
  const created = await templateAdmin.upload(req.user, { buffer: zip.buffer, fields: pick(req.body || {}) }, req);
  const thumb = fileOf(req, 'thumbnail');
  if (thumb) created.template = await templateAdmin.addImage(req.user, created.template.id, created.template.version, { kind: 'thumbnail', buffer: thumb.buffer, name: thumb.originalname }, req);
  ok(res, created, 201);
});
exports.replaceTemplate = wrap(async (req, res) => {
  const zip = fileOf(req, 'file');
  if (!zip) throw new ValidationError('Choose a ZIP file to upload.');
  ok(res, await templateAdmin.upload(req.user, { buffer: zip.buffer, fields: pick(req.body || {}), templateId: req.params.id }, req), 201);
});
exports.updateTemplate = wrap(async (req, res) => ok(res, { template: await templateAdmin.updateInfo(req.user, req.params.id, req.params.version, req.body || {}, req) }));
exports.setTemplateStatus = wrap(async (req, res) => ok(res, { template: await templateAdmin.setStatus(req.user, req.params.id, req.params.version, req.body?.status, req) }));
exports.duplicateTemplate = wrap(async (req, res) => ok(res, { template: await templateAdmin.duplicate(req.user, req.params.id, req.body?.version || null, req) }, 201));
exports.deleteTemplate = wrap(async (req, res) => ok(res, await templateAdmin.remove(req.user, req.params.id, req.body?.confirm, req)));
exports.addTemplateImage = wrap(async (req, res) => {
  const image = fileOf(req, 'image');
  if (!image) throw new ValidationError('Choose a picture to upload.');
  ok(res, { template: await templateAdmin.addImage(req.user, req.params.id, req.params.version, { kind: req.body?.kind, buffer: image.buffer, name: image.originalname }, req) }, 201);
});
exports.removeTemplateImage = wrap(async (req, res) => ok(res, { template: await templateAdmin.removeImage(req.user, req.params.id, req.params.version, req.params.key, req) }));
exports.templateImage = wrap(async (req, res) => {
  const image = await templateAdmin.imageBytes(req.params.id, req.params.version, req.params.key);
  res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  res.send(image.body);
});
exports.templatePreview = wrap(async (req, res) => ok(res, await templateAdmin.previewHtml(req.params.id, req.query.version || null)));

/* plans */
exports.listPlans = wrap(async (req, res) => ok(res, { plans: await plans.list() }));
exports.updatePlan = wrap(async (req, res) => ok(res, { plan: await plans.update(req.user, req.params.name, req.body || {}, req) }));
exports.planUsers = wrap(async (req, res) => ok(res, await plans.users(req.params.name, req.query)));
exports.planTransactions = wrap(async (req, res) => ok(res, await plans.transactions(req.query)));

/* audit logs (read only) */
exports.auditLogs = wrap(async (req, res) => {
  const { page: pageNo, limit } = page(req.query);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action).slice(0, 60);
  if (idOf(req.query.actorId)) filter.actorId = req.query.actorId;
  if (req.query.resourceType) filter.resourceType = String(req.query.resourceType).slice(0, 40);
  if (req.query.q) filter.$or = [{ actorEmail: new RegExp(String(req.query.q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { resourceId: String(req.query.q).slice(0, 80) }];
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if ((from && !Number.isNaN(+from)) || (to && !Number.isNaN(+to))) {
    filter.createdAt = {};
    if (from && !Number.isNaN(+from)) filter.createdAt.$gte = from;
    if (to && !Number.isNaN(+to)) filter.createdAt.$lte = new Date(+to + (String(req.query.to).length <= 10 ? 86_399_999 : 0));
  }
  const [total, rows, actions] = await Promise.all([
    AdminAuditLog.countDocuments(filter),
    AdminAuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((pageNo - 1) * limit).limit(limit).lean(),
    AdminAuditLog.distinct('action')
  ]);
  ok(res, { logs: rows, total, page: pageNo, pages: Math.max(1, Math.ceil(total / limit)), actions: actions.sort() });
});

/* notifications */
exports.notifications = wrap(async (req, res) => {
  const { page: pageNo, limit } = page(req.query);
  const filter = {};
  if (req.query.status === 'unread') filter.readAt = null;
  if (req.query.status === 'read') filter.readAt = { $ne: null };
  if (AdminNotification.TYPES.includes(req.query.type)) filter.type = req.query.type;
  if (['info', 'warning', 'critical'].includes(req.query.severity)) filter.severity = req.query.severity;
  const [total, rows, unread] = await Promise.all([
    AdminNotification.countDocuments(filter), AdminNotification.find(filter).sort({ createdAt: -1 }).skip((pageNo - 1) * limit).limit(limit).lean(), AdminNotification.countDocuments({ readAt: null })
  ]);
  ok(res, { notifications: rows, total, unread, page: pageNo, pages: Math.max(1, Math.ceil(total / limit)), types: AdminNotification.TYPES });
});
exports.unreadCount = wrap(async (req, res) => ok(res, { unread: await AdminNotification.countDocuments({ readAt: null }) }));
exports.markRead = wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(idOf).slice(0, 200) : [];
  const filter = req.body?.all ? { readAt: null } : { _id: { $in: ids }, readAt: null };
  if (!req.body?.all && !ids.length) throw new ValidationError('Choose notifications to mark as read.');
  const result = await AdminNotification.updateMany(filter, { $set: { readAt: new Date(), readBy: req.user._id } });
  ok(res, { updated: result.modifiedCount });
});

/* admin management */
exports.listAdmins = wrap(async (req, res) => ok(res, { admins: await users.admins() }));
// A new administrator is either a brand-new account (name, email, password) or an existing account promoted by email. Root only.
exports.addAdmin = wrap(async (req, res) => ok(res, { user: req.body?.password
  ? await users.createAdmin(req.user, req.body, req)
  : await users.promoteByEmail(req.user, req.body?.email, req, req.body?.adminRole) }, 201));
exports.setAdminType = wrap(async (req, res) => ok(res, { user: await users.setAdminType(req.user, req.params.id, req.body?.adminRole, req) }));
exports.removeAdmin = wrap(async (req, res) => ok(res, { user: await users.setRole(req.user, req.params.id, 'USER', req) }));

/* platform settings */
exports.getSettings = wrap(async (req, res) => ok(res, { credits: await settings.get('credits'), platform: await settings.get('platform') }));
exports.updateSettings = wrap(async (req, res) => {
  const group = req.params.group;
  if (!['credits', 'platform'].includes(group)) throw new NotFoundError('Setting group');
  const before = await settings.get(group);
  const after = await settings.set(group, { ...before, ...(req.body || {}) }, req.user._id);
  await audit.record(req.user, group === 'credits' ? 'CREDIT_SETTINGS_CHANGED' : 'PLATFORM_SETTINGS_CHANGED', { resourceType: 'settings', resourceId: group, before, after, req });
  ok(res, { [group]: after });
});
exports.me = wrap(async (req, res) => ok(res, { user: users.present(req.user), unread: await AdminNotification.countDocuments({ readAt: null }) }));

/* project credits (root administrator) */
const projectCredits = () => require('../services/admin/adminProjectCreditService');
exports.searchProjects = wrap(async (req, res) => ok(res, { projects: await projectCredits().search(req.query) }));
exports.getProjectCredits = wrap(async (req, res) => ok(res, await projectCredits().get(req.params.id)));
exports.changeProjectCredits = wrap(async (req, res) => {
  const result = await projectCredits().change(req.user, req.params.id, { ...req.body, idempotencyKey: req.body?.idempotencyKey || req.get('Idempotency-Key') || null }, req);
  ok(res, result, result.duplicate ? 200 : 201);
});
