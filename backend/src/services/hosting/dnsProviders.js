// Who runs DNS for a domain, and can Veave change it? Automatic changes are only attempted where the platform really has
// authority (a zone inside Veave's own GoDaddy account, e.g. a domain bought through Veave). Everything else is manual:
// the user gets the exact records to add. Veave never asks for, stores or uses customers' registrar credentials.
const dns = require('node:dns');
const godaddy = require('./godaddyService');
const { resolverList, makeResolver } = require('./domainVerification');

const PROVIDERS = [
  { id: 'godaddy', label: 'GoDaddy', match: /domaincontrol\.com$/ },
  { id: 'cloudflare', label: 'Cloudflare', match: /\.ns\.cloudflare\.com$/ },
  { id: 'route53', label: 'Amazon Route 53', match: /awsdns-\d+\.(?:com|net|org|co\.uk)$/ },
  { id: 'google', label: 'Google Cloud DNS / Domains', match: /(?:googledomains\.com|ns-cloud-[a-z]\d\.googledomains\.com)$/ },
  { id: 'namecheap', label: 'Namecheap', match: /registrar-servers\.com$/ },
  { id: 'azure', label: 'Azure DNS', match: /azure-dns\.(?:com|net|org|info)$/ },
  { id: 'digitalocean', label: 'DigitalOcean', match: /digitalocean\.com$/ },
  { id: 'hostinger', label: 'Hostinger', match: /dns-parking\.com$/ },
  { id: 'squarespace', label: 'Squarespace Domains', match: /squarespacedns\.com$/ },
  { id: 'wix', label: 'Wix', match: /wixdns\.net$/ }
];

async function detectProvider(zone, { resolver = null } = {}) {
  let nameservers = [];
  try {
    const r = resolver || makeResolver(resolverList()[0]);
    nameservers = (await r.resolveNs(zone)).map((ns) => ns.toLowerCase().replace(/\.$/, ''));
  } catch (error) {
    if (!['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  const hit = PROVIDERS.find((provider) => nameservers.some((ns) => provider.match.test(ns)));
  return { id: hit?.id || 'unknown', label: hit?.label || 'your DNS provider', nameservers, found: nameservers.length > 0 };
}

/** The GoDaddy adapter: usable only when the zone is in Veave's own account. */
function goDaddyAdapter() {
  return {
    id: 'godaddy',
    async isAuthorized(zone) {
      if (!godaddy.isEnabled()) return { ok: false, reason: 'The GoDaddy integration is not configured on this server.' };
      try {
        return (await godaddy.ownsDomain(zone))
          ? { ok: true }
          : { ok: false, reason: 'This domain is not in the GoDaddy account connected to Veave, so Veave cannot change its DNS.' };
      } catch (error) { return { ok: false, reason: `GoDaddy could not be reached: ${error.message}`, transient: true }; }
    },
    listRecords: (zone) => godaddy.listDnsRecords(zone),
    setRecord: (zone, record) => godaddy.setDnsRecord(zone, record),
    deleteRecord: (zone, record) => godaddy.deleteDnsRecord(zone, record)
  };
}

/**
 * Picks the adapter that may change this zone, or explains why none can. An adapter is only used when the zone's
 * nameservers really belong to its provider (changing GoDaddy's copy of a zone that is served elsewhere would do nothing).
 */
async function resolveAdapter(zone, { provider, adapters = null } = {}) {
  const list = adapters || [goDaddyAdapter()];
  let reason = null;
  for (const adapter of list) {
    if (provider?.found && provider.id !== adapter.id) { reason = `The domain's DNS is hosted at ${provider.label}, not ${adapter.id}.`; continue; }
    const auth = await adapter.isAuthorized(zone);
    if (auth.ok) return { adapter, authorized: true };
    if (auth.transient) return { adapter: null, authorized: false, reason: auth.reason, transient: true };
    reason = auth.reason;
  }
  const where = provider?.id && provider.id !== 'unknown' ? provider.label : 'your DNS provider';
  return { adapter: null, authorized: false, reason: provider?.found && provider.id !== 'godaddy' && !adapters
    ? `Veave has no authorised access to ${where}. Add the records below at ${where}.`
    : (reason || `Add the records below at ${where}.`) };
}

module.exports = { detectProvider, resolveAdapter, goDaddyAdapter, PROVIDERS };
