const hosting = require('../services/hosting/deploymentService');
const domains = require('../services/hosting/domainService');
const connections = require('../services/hosting/domainConnectionService');
const purchase = require('../services/hosting/domainPurchaseService');
const godaddy = require('../services/hosting/godaddyService');
const { hostingConfig } = require('../services/hosting/config');

const userIdOf = (req) => String(req.user._id || req.user.id);

exports.getConfig = (req, res) => {
  const { baseDomain, scheme, publicPort } = hostingConfig();
  res.json({ success: true, data: { baseDomain, scheme, publicPort } });
};

exports.checkSlug = async (req, res, next) => {
  try {
    const data = await hosting.checkSlug(req.query.slug, req.query.projectId, userIdOf(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.getStatus = async (req, res, next) => {
  try {
    res.json({ success: true, data: await hosting.getStatus(req.params.projectId, userIdOf(req)) });
  } catch (error) { next(error); }
};

// Publish to the free subdomain; with `domain` also connect that custom domain. Publishing and the domain workflow run in
// the background: the response is the deployment (and the domain connection) to poll.
exports.publish = async (req, res, next) => {
  try {
    // Reject a bad or already-claimed domain before any build starts.
    if (req.body?.domain) await connections.assertConnectable({ projectId: req.params.projectId, userId: userIdOf(req), hostname: req.body.domain, move: req.body.move === true });
    const deployment = await hosting.startPublish({ projectId: req.params.projectId, userId: userIdOf(req), slug: req.body?.slug });
    let domain = null;
    if (req.body?.domain) {
      // The domain workflow waits for the deployment to be live, so connecting can start right away.
      domain = await connections.connect({ projectId: req.params.projectId, userId: userIdOf(req), hostname: req.body.domain,
        includeWww: req.body.includeWww !== false, canonical: req.body.canonical || 'none', confirmReplace: req.body.confirmReplace === true, move: req.body.move === true });
    }
    res.status(202).json({ success: true, data: { deployment, domain } });
  } catch (error) { next(error); }
};

exports.unpublish = async (req, res, next) => {
  try {
    res.json({ success: true, data: { site: await hosting.unpublish({ projectId: req.params.projectId, userId: userIdOf(req) }) } });
  } catch (error) { next(error); }
};

exports.listDeployments = async (req, res, next) => {
  try {
    res.json({ success: true, data: await hosting.listDeployments(req.params.projectId, userIdOf(req)) });
  } catch (error) { next(error); }
};

exports.getDeployment = async (req, res, next) => {
  try {
    res.json({ success: true, data: await hosting.getDeployment(req.params.deploymentId, userIdOf(req)) });
  } catch (error) { next(error); }
};

const wrap = (fn) => async (req, res, next) => {
  try { res.json({ success: true, data: await fn(req) }); } catch (error) { next(error); }
};

exports.domainAvailable = wrap((req) => godaddy.checkAvailability(req.query.domain));
exports.domainSearch = wrap((req) => purchase.search(req.query.domain));
exports.domainOrder = wrap((req) => purchase.createOrder({ projectId: req.params.projectId, userId: userIdOf(req), domain: req.body?.domain, contact: req.body?.contact }));
exports.myDomains = wrap((req) => purchase.listMyDomains(userIdOf(req)));
exports.renewalPrice = wrap((req) => purchase.renewalPrice(userIdOf(req), req.params.domain, Number(req.query.period) || 1));
exports.renewalOrder = wrap((req) => purchase.createRenewalOrder({ userId: userIdOf(req), domain: req.params.domain, period: req.body?.period }));
exports.dnsList = wrap((req) => purchase.dnsList(userIdOf(req), req.params.domain));
exports.dnsSet = wrap((req) => purchase.dnsSet(userIdOf(req), req.params.domain, req.body));
exports.dnsDelete = wrap((req) => purchase.dnsDelete(userIdOf(req), req.params.domain, req.body));
exports.domainOrderGet = wrap((req) => purchase.getOrder({ orderId: req.params.orderId, userId: userIdOf(req) }));
exports.domainOrderVerify = wrap((req) => purchase.verifyAndRegister({ projectId: req.params.projectId, userId: userIdOf(req), ...req.body }));
exports.getDomain = wrap((req) => domains.getDomain(req.params.projectId, userIdOf(req)));
exports.connectDomain = wrap((req) => connections.connect({ projectId: req.params.projectId, userId: userIdOf(req), hostname: req.body?.domain,
  includeWww: req.body?.includeWww !== false, canonical: req.body?.canonical || 'none', confirmReplace: req.body?.confirmReplace === true, move: req.body?.move === true }));
exports.checkDomain = wrap((req) => connections.check(userIdOf(req), req.query.hostname));
exports.retryDomain = wrap((req) => connections.retry({ projectId: req.params.projectId, userId: userIdOf(req) }));
exports.confirmDomainReplace = wrap((req) => connections.confirmReplace({ projectId: req.params.projectId, userId: userIdOf(req) }));
exports.domainInstructions = wrap(async (req) => connections.instructions(await connections.status(req.params.projectId, userIdOf(req))));
exports.domainHealth = wrap((req) => connections.health({ projectId: req.params.projectId, userId: userIdOf(req), refresh: req.query.refresh === 'true' }));
exports.verifyDomain = wrap((req) => domains.verifyDomain(req.params.projectId, userIdOf(req)));
exports.configureDomain = wrap((req) => domains.configureWithGoDaddy(req.params.projectId, userIdOf(req)));
exports.removeDomain = wrap((req) => domains.removeDomain(req.params.projectId, userIdOf(req)));

// Razorpay posts raw JSON; the signature is computed over the exact bytes.
exports.razorpayWebhook = async (req, res) => {
  try {
    await purchase.handleWebhook(req.body, req.get('x-razorpay-signature'));
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 400).json({ success: false });
  }
};
