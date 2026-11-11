const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const controller = require('../controllers/hostingController');

const router = express.Router();

// Caddy on-demand TLS asks this before issuing a certificate for a custom domain. Loopback only, no auth.
router.get('/domain-ask', async (req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!/^(?:::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.sendStatus(404);
  const ok = await require('../services/hosting/domainService').isIssuableDomain(req.query.domain).catch(() => false);
  return res.sendStatus(ok ? 200 : 404);
});

// Every hosting endpoint requires a logged-in user; ownership is re-checked in the service layer.
router.use(auth);

const publishLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 20 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: { success: false, error: { message: 'Too many publish attempts. Please wait a few minutes.' } }
});

router.get('/config', controller.getConfig);
router.get('/slug-check', controller.checkSlug);
router.get('/projects/:projectId', controller.getStatus);
router.get('/projects/:projectId/deployments', controller.listDeployments);
router.post('/projects/:projectId/publish', publishLimiter, controller.publish);
router.post('/projects/:projectId/unpublish', controller.unpublish);
router.get('/projects/:projectId/domain', controller.getDomain);
router.get('/domains/check', controller.checkDomain);
router.post('/projects/:projectId/domain', publishLimiter, controller.connectDomain);
router.post('/projects/:projectId/domain/retry', publishLimiter, controller.retryDomain);
router.post('/projects/:projectId/domain/confirm-replace', publishLimiter, controller.confirmDomainReplace);
router.get('/projects/:projectId/domain/instructions', controller.domainInstructions);
router.get('/projects/:projectId/domain/health', controller.domainHealth);
router.post('/projects/:projectId/domain/verify', publishLimiter, controller.verifyDomain);
router.delete('/projects/:projectId/domain', controller.removeDomain);
router.get('/deployments/:deploymentId', controller.getDeployment);

module.exports = router;
