const hosting = require('../services/hosting/deploymentService');
const domains = require('../services/hosting/domainService');
const connections = require('../services/hosting/domainConnectionService');
const { hostingConfig, customDomainSupport } = require('../services/hosting/config');
const { ValidationError } = require('../utils/errors');

const userIdOf = (req) => String(req.user._id || req.user.id);

exports.getConfig = (req, res) => {
  const { baseDomain, scheme, publicPort } = hostingConfig();
  res.json({ success: true, data: { baseDomain, scheme, publicPort, customDomains: customDomainSupport() } });
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

// Publish. The two ways to publish are independent:
//   subdomainEnabled   (default true)  the Veave address, <slug>.<base domain>
//   customDomainEnabled (default: a domain was sent)  the owner's own domain, connected in the background
// At least one must be on. Both on: both addresses serve the same published files (one build, one site). Publishing and the domain
// workflow run in the background: the response is the deployment (and the domain connection) to poll.
exports.publish = async (req, res, next) => {
  try {
    const body = req.body || {};
    const projectId = req.params.projectId;
    const userId = userIdOf(req);
    const subdomainEnabled = typeof body.subdomainEnabled === 'boolean' ? body.subdomainEnabled : true;
    const customEnabled = typeof body.customDomainEnabled === 'boolean' ? body.customDomainEnabled : Boolean(body.domain);
    if (!subdomainEnabled && !customEnabled) throw new ValidationError('Turn on at least one way to publish: the Veave address or your own domain.');
    if (customEnabled && !String(body.domain || '').trim()) throw new ValidationError('Enter the domain you want to publish on.');
    // Reject a bad or already-claimed domain before any build starts.
    if (customEnabled) await connections.assertConnectable({ projectId, userId, hostname: body.domain, move: body.move === true });
    const deployment = await hosting.startPublish({ projectId, userId, slug: body.slug, subdomainEnabled });
    let domain = null;
    if (customEnabled) {
      // The domain workflow waits for the deployment to be live, so connecting can start right away.
      domain = await connections.connect({ projectId, userId, hostname: body.domain,
        includeWww: body.includeWww !== false, canonical: body.canonical || 'none', confirmReplace: body.confirmReplace === true, move: body.move === true, dnsMode: body.dnsMode });
    } else if (body.customDomainEnabled === false) {
      // The owner switched the custom domain off: stop serving it (DNS records Veave wrote are taken back; the owner's others stay).
      await connections.disconnect({ projectId, userId }).catch(() => {});
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

exports.getDomain = wrap((req) => domains.getDomain(req.params.projectId, userIdOf(req)));
exports.connectDomain = wrap((req) => connections.connect({ projectId: req.params.projectId, userId: userIdOf(req), hostname: req.body?.domain,
  includeWww: req.body?.includeWww !== false, canonical: req.body?.canonical || 'none', confirmReplace: req.body?.confirmReplace === true, move: req.body?.move === true, dnsMode: req.body?.dnsMode }));
exports.checkDomain = wrap((req) => connections.check(userIdOf(req), req.query.hostname));
exports.retryDomain = wrap((req) => connections.retry({ projectId: req.params.projectId, userId: userIdOf(req) }));
exports.confirmDomainReplace = wrap((req) => connections.confirmReplace({ projectId: req.params.projectId, userId: userIdOf(req) }));
exports.domainInstructions = wrap(async (req) => connections.instructions(await connections.status(req.params.projectId, userIdOf(req))));
exports.domainHealth = wrap((req) => connections.health({ projectId: req.params.projectId, userId: userIdOf(req), refresh: req.query.refresh === 'true' }));
exports.verifyDomain = wrap((req) => domains.verifyDomain(req.params.projectId, userIdOf(req)));
const dnsAccounts = require('../services/hosting/dnsAccounts');
exports.listDnsAccounts = wrap((req) => dnsAccounts.listAccounts(userIdOf(req)));
exports.saveDnsAccount = wrap((req) => dnsAccounts.saveAccount(userIdOf(req), req.params.provider, req.body || {}));
exports.removeDnsAccount = wrap((req) => dnsAccounts.removeAccount(userIdOf(req), req.params.provider));
exports.removeDomain = wrap((req) => domains.removeDomain(req.params.projectId, userIdOf(req)));
