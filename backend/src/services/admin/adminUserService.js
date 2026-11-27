/** User management for admins: search, profile, status, role, notes, websites and activity. Reuses the existing User model. */
const User = require('../../models/User');
const AdminNote = require('../../models/AdminNote');
const AdminAuditLog = require('../../models/AdminAuditLog');
const CreditTransaction = require('../../models/CreditTransaction');
const TemplateSite = require('../../models/TemplateSite');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const Project = require('../../models/Project');
const AIUsage = require('../../models/AIUsage');
const audit = require('./auditService');
const ledger = require('./creditLedgerService');
const notifications = require('./notificationService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../utils/errors');

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isId = (value) => /^[a-f0-9]{24}$/i.test(String(value || ''));
const LIST_FIELDS = 'name email role isRootAdmin adminRole status plan credits subscription createdAt lastActiveAt lastLoginAt creditsExempt avatar';

const present = (user) => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role || 'USER', isRoot: user.isRootAdmin === true, adminRole: user.role === 'ADMIN' ? (user.adminRole || 'admin') : null, status: user.status || 'active', avatar: user.avatar || '',
  plan: user.plan || 'Free Tier', balance: ledger.balanceOf(user), creditsExempt: Boolean(user.creditsExempt),
  subscription: { tier: user.subscription?.tier || user.plan || 'Free Tier', status: user.subscription?.status || 'active', billingCycle: user.subscription?.billingCycle || 'monthly', creditsAllocated: user.subscription?.creditsAllocated ?? null, bonusCredits: user.subscription?.bonusCredits ?? 0, renewsAt: user.subscription?.renewsAt || null },
  createdAt: user.createdAt, lastActiveAt: user.lastActiveAt || null, lastLoginAt: user.lastLoginAt || null,
  suspendedAt: user.suspendedAt || null, suspensionReason: user.suspensionReason || ''
});

async function list(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const filter = {};
  const q = String(query.q || '').trim().slice(0, 80);
  if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }];
  if (['USER', 'ADMIN'].includes(query.role)) filter.role = query.role === 'USER' ? { $ne: 'ADMIN' } : 'ADMIN';
  if (query.plan) filter.plan = String(query.plan).slice(0, 60);
  if (['active', 'suspended'].includes(query.status)) filter.status = query.status === 'active' ? { $ne: 'suspended' } : 'suspended';
  if (query.subscription && ['active', 'inactive', 'trialing', 'canceled'].includes(query.subscription)) filter['subscription.status'] = query.subscription;
  const sorts = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { name: 1 }, active: { lastActiveAt: -1 }, credits: { 'subscription.creditsRemaining': -1 } };
  const [total, rows] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).select(LIST_FIELDS).sort(sorts[query.sort] || sorts.newest).skip((page - 1) * limit).limit(limit).lean()
  ]);
  return { users: rows.map(present), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

async function mustFind(id) {
  if (!isId(id)) throw new NotFoundError('User');
  const user = await User.findById(id).select(LIST_FIELDS).lean();
  if (!user) throw new NotFoundError('User');
  return user;
}

async function get(id) {
  const user = await mustFind(id);
  const [sites, projects, transactions, notes, lastJob] = await Promise.all([
    TemplateSite.countDocuments({ userId: id }), Project.countDocuments({ userId: id }),
    CreditTransaction.countDocuments({ userId: id }), AdminNote.countDocuments({ userId: id }),
    TemplateGenerationJob.findOne({ userId: id }).sort({ createdAt: -1 }).select('status createdAt type').lean()
  ]);
  return { user: present(user), stats: { websites: sites, projects, transactions, notes, lastJob } };
}

async function websites(id) {
  await mustFind(id);
  const [sites, projects] = await Promise.all([
    TemplateSite.find({ userId: id }).sort({ createdAt: -1 }).limit(100).select('name templateId templateVersion status createdAt updatedAt category').lean(),
    Project.find({ userId: id }).sort({ updatedAt: -1 }).limit(100).select('name status createdAt updatedAt template').lean()
  ]);
  return {
    templateSites: sites.map((site) => ({ id: String(site._id), name: site.name, templateId: site.templateId, templateVersion: site.templateVersion, status: site.status, category: site.category || '', createdAt: site.createdAt, updatedAt: site.updatedAt })),
    projects: projects.map((project) => ({ id: String(project._id), name: project.name, status: project.status, template: project.template?.id || null, createdAt: project.createdAt, updatedAt: project.updatedAt }))
  };
}

async function activity(id) {
  const user = await mustFind(id);
  const [jobs, usage, audits] = await Promise.all([
    TemplateGenerationJob.find({ userId: id }).sort({ createdAt: -1 }).limit(20).select('type status errorCode createdAt completedAt creditsCharged').lean(),
    AIUsage.find({ userId: id }).sort({ createdAt: -1 }).limit(20).select('model totalTokens createdAt').lean(),
    AdminAuditLog.find({ resourceType: 'user', resourceId: String(id) }).sort({ createdAt: -1 }).limit(20).lean()
  ]);
  const events = [
    ...(user.createdAt ? [{ at: user.createdAt, kind: 'account', text: 'Account created' }] : []),
    ...(user.lastLoginAt ? [{ at: user.lastLoginAt, kind: 'login', text: 'Last sign-in' }] : []),
    ...jobs.map((job) => ({ at: job.createdAt, kind: 'generation', text: `${job.type === 'site-customize' ? 'Website' : 'Page'} generation ${job.status}${job.errorCode ? ` (${job.errorCode})` : ''}` })),
    ...usage.map((row) => ({ at: row.createdAt, kind: 'ai', text: `AI request on ${row.model || 'a model'} (${Number(row.totalTokens || 0).toLocaleString('en-US')} tokens)` })),
    ...audits.map((row) => ({ at: row.createdAt, kind: 'admin', text: `${row.action.replace(/_/g, ' ').toLowerCase()} by ${row.actorEmail || 'an admin'}` }))
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 50);
  return { events };
}

async function activeAdminCount(except = null) {
  return User.countDocuments({ role: 'ADMIN', status: { $ne: 'suspended' }, ...(except ? { _id: { $ne: except } } : {}) });
}

async function setStatus(admin, id, status, reason, req) {
  if (!['active', 'suspended'].includes(status)) throw new ValidationError('Status must be active or suspended.');
  const user = await mustFind(id);
  if (String(user._id) === String(admin._id)) throw new ForbiddenError('You cannot change the status of your own account.', 'SELF_ACTION');
  if (user.isRootAdmin) throw new ForbiddenError('The root administrator cannot be suspended or restored.', 'ROOT_PROTECTED');
  if (user.role === 'ADMIN' && !admin.isRootAdmin) throw new ForbiddenError('Only the root administrator can change an administrator account.', 'ROOT_ADMIN_REQUIRED');
  const note = String(reason || '').trim().slice(0, 300);
  if (status === 'suspended') {
    if (note.length < 3) throw new ValidationError('A reason is required to suspend an account.');
    if (user.role === 'ADMIN' && (await activeAdminCount(user._id)) < 1) throw new ForbiddenError('The last active administrator cannot be suspended.', 'LAST_ADMIN');
  }
  if ((user.status || 'active') === status) throw new ValidationError(`The account is already ${status}.`);
  const changes = status === 'suspended' ? { status, suspendedAt: new Date(), suspensionReason: note } : { status, suspendedAt: null, suspensionReason: '' };
  const updated = await User.findByIdAndUpdate(id, { $set: changes }, { new: true }).select(LIST_FIELDS).lean();
  await audit.record(admin, status === 'suspended' ? 'USER_SUSPENDED' : 'USER_RESTORED', { resourceType: 'user', resourceId: id, before: { status: user.status || 'active' }, after: { status }, meta: { reason: note, email: user.email }, req });
  if (status === 'suspended') await notifications.create({ type: 'SECURITY', severity: 'info', title: 'Account suspended', message: `${user.email} was suspended by ${admin.email}.`, data: { userId: id } });
  return present(updated);
}

const ADMIN_TYPES = ['admin', 'support'];
const cleanType = (type) => { const value = type === undefined || type === null || type === '' ? 'admin' : String(type); if (!ADMIN_TYPES.includes(value)) throw new ValidationError('The administrator type must be "admin" or "support".'); return value; };

async function setRole(admin, id, role, req, adminRole = 'admin') {
  if (!['USER', 'ADMIN'].includes(role)) throw new ValidationError('Role must be USER or ADMIN.');
  if (!admin.isRootAdmin) throw new ForbiddenError('Only the root administrator can change roles.', 'ROOT_ADMIN_REQUIRED');
  const user = await mustFind(id);
  if (String(user._id) === String(admin._id)) throw new ForbiddenError('You cannot change your own role.', 'SELF_ACTION');
  if (user.isRootAdmin) throw new ForbiddenError('The root administrator cannot be demoted.', 'ROOT_PROTECTED');
  if ((user.role || 'USER') === role) throw new ValidationError(`The account already has the ${role} role.`);
  if (role === 'USER' && (await activeAdminCount(user._id)) < 1) throw new ForbiddenError('At least one administrator must remain.', 'LAST_ADMIN');
  if (role === 'ADMIN' && user.status === 'suspended') throw new ValidationError('Restore the account before making it an administrator.');
  const updated = await User.findByIdAndUpdate(id, { $set: { role, adminRole: role === 'ADMIN' ? cleanType(adminRole) : 'admin' } }, { new: true }).select(LIST_FIELDS).lean();
  await audit.record(admin, 'USER_ROLE_CHANGED', { resourceType: 'user', resourceId: id, before: { role: user.role || 'USER' }, after: { role, adminRole: role === 'ADMIN' ? cleanType(adminRole) : null }, meta: { email: user.email }, req });
  await notifications.create({ type: 'SECURITY', severity: 'warning', title: 'Role changed', message: `${user.email} is now ${role} (changed by ${admin.email}).`, data: { userId: id } });
  return present(updated);
}

/**
 * Moves an account to a plan. The Post Paid Plan (no credit or token limit, billed after use) can only be given here: to any account,
 * including support administrators. Moving back to a normal plan gives that plan's allowance.
 */
async function setPlan(admin, id, plan, req) {
  const plans = require('../billing/plans');
  if (!plans.PLAN_LIMITS[plan]) throw new ValidationError(`Choose one of: ${Object.keys(plans.PLAN_LIMITS).join(', ')}.`);
  const user = await User.findById(id).select(`${LIST_FIELDS}`).lean();
  if (!user) throw new NotFoundError('User');
  if (user.status === 'suspended') throw new ValidationError('Restore the account before changing its plan.');
  if (plans.resolvePlanName(user.plan) === plan) throw new ValidationError(`The account is already on ${plan}.`);
  const limits = plans.PLAN_LIMITS[plan];
  const before = ledger.balanceOf(user);
  let set;
  if (plans.isUnlimitedPlan(plan)) {
    // Credits are no longer counted; the balance is left as it was so moving back later is not a surprise.
    set = { plan, 'subscription.tier': plan, 'subscription.status': 'active', 'subscription.billingCycle': 'monthly', 'subscription.bonusCredits': 0, 'subscription.renewsAt': null };
  } else {
    const renewsAt = new Date();
    renewsAt.setMonth(renewsAt.getMonth() + 1);
    set = { plan, credits: limits.credits, 'subscription.tier': plan, 'subscription.status': 'active', 'subscription.creditsAllocated': limits.credits, 'subscription.creditsRemaining': limits.credits, 'subscription.bonusCredits': 0, 'subscription.renewsAt': renewsAt };
  }
  const updated = await User.findByIdAndUpdate(id, { $set: set }, { new: true }).select(LIST_FIELDS).lean();
  const after = ledger.balanceOf(updated);
  if (after !== before) await ledger.recordApplied({ userId: id, previousBalance: before, newBalance: after, type: 'CREDIT_ADJUSTMENT', reason: `Plan changed to ${plan} by an administrator` });
  await audit.record(admin, 'USER_PLAN_CHANGED', { resourceType: 'user', resourceId: id, before: { plan: user.plan || 'Free Tier' }, after: { plan }, meta: { email: user.email }, req });
  await notifications.create({ type: 'SECURITY', severity: 'info', title: 'Plan changed', message: `${user.email} is now on ${plan} (changed by ${admin.email}).`, data: { userId: id } });
  return present(updated);
}

async function addNote(admin, id, text, req) {
  await mustFind(id);
  const note = String(text || '').trim();
  if (!note) throw new ValidationError('The note cannot be empty.');
  if (note.length > 2000) throw new ValidationError('The note is too long (2000 characters at most).');
  const row = await AdminNote.create({ userId: id, adminId: admin._id, adminName: admin.name || admin.email, note });
  await audit.record(admin, 'USER_NOTE_ADDED', { resourceType: 'user', resourceId: id, meta: { length: note.length }, req });
  return row.toObject();
}

async function notes(id) {
  await mustFind(id);
  return AdminNote.find({ userId: id }).sort({ createdAt: -1 }).limit(100).lean();
}

async function admins() {
  const rows = await User.find({ role: 'ADMIN' }).select(LIST_FIELDS).sort({ createdAt: 1 }).lean();
  return rows.map(present);
}

async function promoteByEmail(admin, email, req, adminRole = 'admin') {
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ValidationError('Enter a valid email address.');
  const user = await User.findOne({ email: address }).select('_id').lean();
  if (!user) throw new NotFoundError('A user with that email');
  return setRole(admin, String(user._id), 'ADMIN', req, adminRole);
}

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,128}$/;

/**
 * Creates a brand-new administrator account (root only). The root gives a one-time password, which the new administrator should change.
 * A new account is always a normal ADMIN: never root, never created from a request that is not the root's.
 */
async function createAdmin(admin, { name, email, password, adminRole }, req) {
  if (!admin.isRootAdmin) throw new ForbiddenError('Only the root administrator can create administrators.', 'ROOT_ADMIN_REQUIRED');
  const cleanName = String(name || '').trim().slice(0, 80);
  const address = String(email || '').trim().toLowerCase();
  if (cleanName.length < 2) throw new ValidationError('Enter the administrator\'s name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new ValidationError('Enter a valid email address.');
  if (!PASSWORD_RULE.test(String(password || ''))) throw new ValidationError('The password needs 10 or more characters with an upper-case letter, a lower-case letter and a number.');
  if (await User.exists({ email: address })) throw new ValidationError('An account with that email already exists. Use "Promote an existing account" instead.');
  const created = await User.create({ name: cleanName, email: address, password, role: 'ADMIN', isRootAdmin: false, adminRole: cleanType(adminRole) });
  await audit.record(admin, 'ADMIN_CREATED', { resourceType: 'user', resourceId: String(created._id), after: { role: 'ADMIN', adminRole: cleanType(adminRole) }, meta: { email: address }, req });
  await notifications.create({ type: 'SECURITY', severity: 'warning', title: 'Administrator created', message: `${address} was made an administrator by ${admin.email}.`, data: { userId: String(created._id) } });
  return present(created);
}

/** Changes what kind of administrator someone is (root only): "admin" (all areas except root-only ones) or "support" (users and credits). */
async function setAdminType(admin, id, type, req) {
  if (!admin.isRootAdmin) throw new ForbiddenError('Only the root administrator can change administrator types.', 'ROOT_ADMIN_REQUIRED');
  const next = cleanType(type);
  const user = await mustFind(id);
  if (user.role !== 'ADMIN') throw new ValidationError('That account is not an administrator.');
  if (user.isRootAdmin) throw new ForbiddenError('The root administrator cannot be changed.', 'ROOT_PROTECTED');
  if ((user.adminRole || 'admin') === next) throw new ValidationError(`That administrator is already ${next === 'support' ? 'a Support admin' : 'a full Admin'}.`);
  const updated = await User.findByIdAndUpdate(id, { $set: { adminRole: next } }, { new: true }).select(LIST_FIELDS).lean();
  await audit.record(admin, 'ADMIN_TYPE_CHANGED', { resourceType: 'user', resourceId: id, before: { adminRole: user.adminRole || 'admin' }, after: { adminRole: next }, meta: { email: user.email }, req });
  await notifications.create({ type: 'SECURITY', severity: 'info', title: 'Administrator type changed', message: `${user.email} is now ${next === 'support' ? 'a Support admin' : 'a full Admin'} (changed by ${admin.email}).`, data: { userId: id } });
  return present(updated);
}

module.exports = { setAdminType, createAdmin, list, get, websites, activity, setStatus, setRole, setPlan, addNote, notes, admins, promoteByEmail, present, mustFind, isId };
