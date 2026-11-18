const { ForbiddenError } = require('../utils/errors');

/**
 * Admin-only guard. Mount it after `auth`. The role comes from the database record that `auth` loaded, never from the request:
 * nothing the client sends (body, header, token claims) can grant it. A refused attempt raises a security notification.
 */
const requireAdmin = (req, res, next) => {
  // The admin portal belongs to the root administrator alone. Another account that still has the ADMIN role is refused like anyone else.
  if (req.user && req.user.role === 'ADMIN' && req.user.isRootAdmin === true && req.user.status !== 'suspended') return next();
  if (req.user) {
    const hour = new Date().toISOString().slice(0, 13);
    require('../services/admin/notificationService').create({
      type: 'SECURITY', severity: 'warning', title: 'Blocked admin access attempt',
      message: `${req.user.email} tried to use ${req.method} ${req.originalUrl.split('?')[0]}.`, data: { userId: String(req.user._id) }, dedupeKey: `admin-denied:${req.user._id}:${hour}`
    });
  }
  return next(new ForbiddenError('Administrator access is required.', 'ADMIN_REQUIRED'));
};

const audit = () => require('../services/admin/auditService');

/** Only the root administrator may pass. Mount after requireAdmin. */
const requireRootAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN' && req.user.isRootAdmin === true && req.user.status !== 'suspended') return next();
  audit().record(req.user, 'ADMIN_ROOT_DENIED', { resourceType: 'route', resourceId: `${req.method} ${req.originalUrl.split('?')[0]}`, req }).catch(() => {});
  require('../services/admin/notificationService').create({
    type: 'SECURITY', severity: 'warning', title: 'Blocked root-only action',
    message: `${req.user?.email} (not the root administrator) tried ${req.method} ${req.originalUrl.split('?')[0]}.`, data: { userId: String(req.user?._id) },
    dedupeKey: `root-denied:${req.user?._id}:${new Date().toISOString().slice(0, 13)}`
  });
  return next(new ForbiddenError('Only the root administrator can do this.', 'ROOT_ADMIN_REQUIRED'));
};

/**
 * Step-up check for the most sensitive actions: the signed-in admin must send their own password again (body.currentPassword), so a
 * stolen or left-open session alone cannot create administrators. Wrong attempts are written to the audit log and raise an alert.
 */
const requireStepUp = async (req, res, next) => {
  try {
    const given = String(req.body?.currentPassword || '');
    if (req.body && 'currentPassword' in req.body) delete req.body.currentPassword; // never passed on, never logged
    if (!req.user?.password) return next(new ForbiddenError('This account has no password. Set one before using this action.', 'PASSWORD_NOT_SET'));
    if (!given) return next(new ForbiddenError('Enter your password to confirm this action.', 'PASSWORD_REQUIRED'));
    if (await req.user.comparePassword(given)) return next();
    await audit().record(req.user, 'ADMIN_STEPUP_FAILED', { resourceType: 'route', resourceId: `${req.method} ${req.originalUrl.split('?')[0]}`, req }).catch(() => {});
    require('../services/admin/notificationService').create({ type: 'SECURITY', severity: 'warning', title: 'Wrong password on a sensitive admin action', message: `${req.user.email} entered a wrong password for ${req.method} ${req.originalUrl.split('?')[0]}.`, data: { userId: String(req.user._id) }, dedupeKey: `stepup:${req.user._id}:${new Date().toISOString().slice(0, 15)}` });
    return next(new ForbiddenError('The password is not correct.', 'PASSWORD_INVALID'));
  } catch (error) { return next(error); }
};

/**
 * Areas a "support" administrator may NOT use: templates, plans, analytics, audit logs, settings, bulk credit grants and exports, and anything
 * about administrators. The root administrator and full administrators pass. Mount after requireAdmin.
 */
const requireFullAdmin = (req, res, next) => {
  if (req.user?.isRootAdmin === true || (req.user?.adminRole || 'admin') !== 'support') return next();
  audit().record(req.user, 'ADMIN_AREA_DENIED', { resourceType: 'route', resourceId: `${req.method} ${req.originalUrl.split('?')[0]}`, req }).catch(() => {});
  return next(new ForbiddenError('Your administrator role (Support) does not include this area.', 'ADMIN_ROLE_LIMITED'));
};

module.exports = { requireAdmin, requireRootAdmin, requireStepUp, requireFullAdmin };
