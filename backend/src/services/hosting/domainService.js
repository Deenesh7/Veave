// Facade kept for the endpoints that already call these names. The work itself is done by the
// durable workflow (domainConnectionService + domainOrchestrator); nothing here keeps its own state.
const PublishedSite = require('../../models/PublishedSite');
const DomainConnection = require('../../models/DomainConnection');
const connections = require('./domainConnectionService');
const { normalizeHostname } = require('./domainValidation');

const getDomain = (projectId, userId) => connections.status(projectId, userId);
const connectDomain = (projectId, userId, domain, options = {}) => connections.connect({ projectId, userId, hostname: domain, ...options });
const verifyDomain = (projectId, userId) => connections.verifyNow({ projectId, userId });
const removeDomain = (projectId, userId) => connections.disconnect({ projectId, userId });

// Caddy's on-demand TLS "ask": only issue certificates for hostnames with a verified, routed, published connection, or for the
// Veave address (<slug>.<base domain>) of a site that is published with that address switched on.
async function isIssuableDomain(input) {
  if (await connections.isIssuableHostname(input)) return true;
  const { baseDomain } = require('./config').hostingConfig();
  const host = String(input || '').trim().toLowerCase().replace(/\.$/, '');
  if (baseDomain && host.endsWith(`.${baseDomain}`)) {
    const slug = host.slice(0, -(baseDomain.length + 1));
    if (!slug || slug.includes('.') || require('./slug').validateSlug(slug)) return false;
    return Boolean(await PublishedSite.exists({ slug, status: 'published', subdomainEnabled: { $ne: false } }));
  }
  // Sites connected before the workflow existed (no DomainConnection) keep working until they are reconnected.
  const parsed = normalizeHostname(input);
  if (!parsed.ok) return false;
  const bare = parsed.hostname.replace(/^www\./, '');
  const site = await PublishedSite.findOne({ customDomain: bare, customDomainStatus: 'verified', status: 'published' }).select('_id customDomainWww').lean();
  if (!site) return false;
  if (await DomainConnection.exists({ siteId: site._id, live: true })) return false;
  return parsed.hostname === bare || site.customDomainWww !== false;
}

module.exports = { getDomain, connectDomain, verifyDomain, removeDomain, isIssuableDomain };
