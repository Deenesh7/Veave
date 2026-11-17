const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const { requireAdmin, requireRootAdmin, requireStepUp } = require('../middleware/admin');
const { adminLimiter, adminSensitiveLimiter } = require('../middleware/rateLimiter');
const c = require('../controllers/adminController');
const { LIMITS } = require('../services/admin/adminTemplateService');
const { ValidationError } = require('../utils/errors');

const router = express.Router();

// Every admin route: signed in, then ADMIN (read from the database record), then rate limited.
router.use(auth, requireAdmin, adminLimiter);

const memory = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.zipBytes, files: 2, fields: 20, fieldSize: 20_000 } });
const zipUpload = (req, res, next) => memory.fields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }])(req, res, (error) => (error ? next(new ValidationError(error.code === 'LIMIT_FILE_SIZE' ? 'The file is too large.' : `Upload failed: ${error.message}`)) : next()));
const imageUpload = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.imageBytes, files: 1, fields: 5 } }).fields([{ name: 'image', maxCount: 1 }])(req, res, (error) => (error ? next(new ValidationError(error.code === 'LIMIT_FILE_SIZE' ? 'The picture is too large.' : `Upload failed: ${error.message}`)) : next()));

router.get('/me', c.me);
router.get('/dashboard', c.dashboard);
router.get('/analytics', c.analytics);
router.get('/analytics/export', c.analyticsExport);

router.get('/users', c.listUsers);
router.get('/users/:id', c.getUser);
router.get('/users/:id/websites', c.userWebsites);
router.get('/users/:id/activity', c.userActivity);
router.get('/users/:id/credits', c.userCredits);
router.get('/users/:id/notes', c.userNotes);
router.post('/users/:id/notes', adminSensitiveLimiter, c.addUserNote);
router.patch('/users/:id/status', adminSensitiveLimiter, c.setUserStatus);
// Roles and administrators: root only, and the root must re-enter their password.
router.patch('/users/:id/role', adminSensitiveLimiter, requireRootAdmin, requireStepUp, c.setUserRole);

router.get('/credits/summary', c.creditSummary);
router.get('/credits/transactions', c.creditTransactions);
router.get('/credits/transactions/export', adminSensitiveLimiter, c.creditExport);
router.post('/credits/adjust', adminSensitiveLimiter, c.creditAdjust);
router.post('/credits/allocate', adminSensitiveLimiter, c.creditAllocate);

router.get('/templates', c.listTemplates);
router.post('/templates', adminSensitiveLimiter, zipUpload, c.uploadTemplate);
router.get('/templates/:id', c.getTemplate);
router.post('/templates/:id/versions', adminSensitiveLimiter, zipUpload, c.replaceTemplate);
router.get('/templates/:id/preview', c.templatePreview);
router.post('/templates/:id/duplicate', adminSensitiveLimiter, c.duplicateTemplate);
router.delete('/templates/:id', adminSensitiveLimiter, c.deleteTemplate);
router.patch('/templates/:id/versions/:version', adminSensitiveLimiter, c.updateTemplate);
router.post('/templates/:id/versions/:version/status', adminSensitiveLimiter, c.setTemplateStatus);
router.post('/templates/:id/versions/:version/images', adminSensitiveLimiter, imageUpload, c.addTemplateImage);
router.get('/templates/:id/versions/:version/images/:key', c.templateImage);
router.delete('/templates/:id/versions/:version/images/:key', adminSensitiveLimiter, c.removeTemplateImage);

router.get('/plans', c.listPlans);
router.get('/plans/transactions', c.planTransactions);
router.get('/plans/:name/users', c.planUsers);
router.put('/plans/:name', adminSensitiveLimiter, requireRootAdmin, c.updatePlan);

router.get('/audit-logs', c.auditLogs);

router.get('/notifications', c.notifications);
router.get('/notifications/unread-count', c.unreadCount);
router.post('/notifications/read', c.markRead);

router.get('/admins', c.listAdmins);
router.post('/admins', adminSensitiveLimiter, requireRootAdmin, requireStepUp, c.addAdmin);
router.delete('/admins/:id', adminSensitiveLimiter, requireRootAdmin, requireStepUp, c.removeAdmin);

router.get('/settings', c.getSettings);
router.put('/settings/:group', adminSensitiveLimiter, requireRootAdmin, c.updateSettings);

module.exports = router;
