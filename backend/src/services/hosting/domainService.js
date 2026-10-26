// Facade kept for the endpoints and the purchase flow that already call these names. The work itself is done by the
// durable workflow (domainConnectionService + domainOrchestrator); nothing here keeps its own state.
const PublishedSite = require('../../models/PublishedSite');
const DomainConnection = require('../../models/DomainConnection');
const { AppError, ValidationError } = require('../../utils/errors');
const godaddy = require('./godaddyService');
const connections = require('./domainConnectionService');
const { normalizeHostname } = require('./domainValidation');

const getDomain = (projectId, userId) => connections.status(projectId, userId);
const connectDomain = (projectId, userId, domain, options = {}) => connections.connect({ projectId, userId, hostname: domain, ...options });
const verifyDomain = (projectId, userId) => connections.verifyNow({ projectId, userId });
const removeDomain = (projectId, userId) => connections.disconnect({ projectId, userId });

// "Set up with GoDaddy": run the workflow now. Whether DNS can be changed automatically is decided (and explained) by the workflow.
async function configureWithGoDaddy(projectId, userId) {
  const view = await connections.status(projectId, userId);
  if (!view.domain) throw new ValidationError('No domain connected.');
  if (!godaddy.isEnabled()) throw new AppError('GoDaddy integration is not configured on this server.', 503);
  return connections.verifyNow({ projectId, userId });
}

// Caddy's on-demand TLS "ask": only issue certificates for hostnames with a verified, routed, published connection.
async function isIssuableDomain(input) {
  if (await connections.isIssuableHostname(input)) return true;
  // Sites connected before the workflow existed (no DomainConnection) keep working until they are reconnected.
  const parsed = normalizeHostname(input);
  if (!parsed.ok) return false;
  const bare = parsed.hostname.replace(/^www\./, '');
  const site = await PublishedSite.findOne({ customDomain: bare, customDomainStatus: 'verified', status: 'published' }).select('_id customDomainWww').lean();
  if (!site) return false;
  if (await DomainConnection.exists({ siteId: site._id, live: true })) return false;
  return parsed.hostname === bare || site.customDomainWww !== false;
}

module.exports = { getDomain, connectDomain, verifyDomain, configureWithGoDaddy, removeDomain, isIssuableDomain };
