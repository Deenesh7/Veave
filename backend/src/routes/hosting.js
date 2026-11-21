const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const controller = require('../controllers/hostingController');

const router = express.Router();

// Caddy on-demand TLS asks this before issuing a certificate for a custom domain. No login: Caddy cannot send one. It is only
// answered for Caddy itself, never for visitors whose requests Caddy forwards:
//  - with CADDY_ASK_TOKEN set (recommended when Caddy runs in its own container), the request must carry that token;
//  - without it, only loopback and private-network callers are served, and never a request that carries X-Forwarded-For
//    (Caddy adds it to everything it proxies from the internet).
const PRIVATE_ADDRESS = /^(?:::1|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|fd[0-9a-f]{2}:|fc[0-9a-f]{2}:)/i;
function mayAskIssuance(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const token = String(process.env.CADDY_ASK_TOKEN || '');
  if (token) {
    const given = Buffer.from(String(req.query.token || ''));
    const want = Buffer.from(token);
    return given.length === want.length && require('node:crypto').timingSafeEqual(given, want);
  }
  return PRIVATE_ADDRESS.test(ip) && !req.headers['x-forwarded-for'];
}
router.get('/domain-ask', async (req, res) => {
  if (!mayAskIssuance(req)) return res.sendStatus(404);
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
// The owner's DNS provider accounts (Cloudflare, GoDaddy): saved encrypted, checked with the provider first, never returned.
router.get('/dns-accounts', controller.listDnsAccounts);
router.put('/dns-accounts/:provider', publishLimiter, controller.saveDnsAccount);
router.delete('/dns-accounts/:provider', controller.removeDnsAccount);
router.get('/deployments/:deploymentId', controller.getDeployment);

module.exports = router;
module.exports.mayAskIssuance = mayAskIssuance;
