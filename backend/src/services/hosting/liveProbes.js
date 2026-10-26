// Independent, outside-in checks of a custom domain: what public DNS says, what the HTTP and TLS endpoints at the address
// DNS points to actually answer. The orchestrator never trusts its own database to declare a site live.
//
// Safety: a customer controls where their domain resolves. Before any connection is opened the resolved address must be a
// public one AND one of the addresses Veave serves from (PUBLISH_SERVER_IP); the request then goes to that exact IP, so a
// DNS answer pointing at an internal service is never contacted.
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { resolverList, makeResolver } = require('./domainVerification');

const privateRanges = new net.BlockList();
for (const [addr, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) privateRanges.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) privateRanges.addSubnet(addr, prefix, 'ipv6');

function isPublicAddress(address) {
  const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
  return Boolean(family) && !privateRanges.check(address, family);
}

const TRANSIENT = ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT'];
const MISSING = ['ENOTFOUND', 'ENODATA'];

async function resolveAll(hostname, { resolvers = null } = {}) {
  const list = resolvers || resolverList().map((server) => makeResolver(server));
  const out = { a: new Set(), aaaa: new Set(), cname: new Set(), errors: [] };
  for (const resolver of list) {
    for (const [key, fn] of [['a', 'resolve4'], ['aaaa', 'resolve6'], ['cname', 'resolveCname']]) {
      try { (await resolver[fn](hostname)).forEach((value) => out[key].add(String(value).replace(/\.$/, '').toLowerCase())); }
      catch (error) { if (!MISSING.includes(error.code)) { if (TRANSIENT.includes(error.code)) out.errors.push(error.code); else throw error; } }
    }
  }
  return { a: [...out.a], aaaa: [...out.aaaa], cname: [...out.cname], transientErrors: out.errors };
}

const bodyHash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function request({ protocol, ip, port = null, hostname, path = '/', timeout = 8000, maxBytes = 1024 * 1024, headers = {} }) {
  return new Promise((resolve, reject) => {
    const client = protocol === 'https:' ? https : http;
    const options = { host: ip, port: port || (protocol === 'https:' ? 443 : 80), path, method: 'GET', timeout,
      headers: { Host: hostname, Accept: 'text/html,*/*', 'User-Agent': 'VeavePublishCheck/1.0', ...headers } };
    if (protocol === 'https:') Object.assign(options, { servername: hostname, rejectUnauthorized: true });
    const req = client.request(options, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size <= maxBytes) chunks.push(chunk); });
      res.on('end', () => { const body = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body, hash: bodyHash(body) }); });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

/** Reads the certificate the server presents for `hostname` at `ip`, without trusting it, and judges it. */
function tlsProbe({ ip, hostname, timeout = 8000 }) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: ip, port: 443, servername: hostname, rejectUnauthorized: false, timeout }, () => {
      const cert = socket.getPeerCertificate();
      const trusted = socket.authorized;
      const identityError = cert?.subject ? tls.checkServerIdentity(hostname, cert) : new Error('no certificate');
      const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
      const result = {
        ok: Boolean(trusted && !identityError && validTo && validTo > new Date()),
        trusted, hostnameMatches: !identityError,
        error: !trusted ? String(socket.authorizationError || 'untrusted certificate') : (identityError ? `Certificate does not cover ${hostname}` : null),
        issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
        validFrom: cert?.valid_from ? new Date(cert.valid_from) : null,
        validTo,
        daysLeft: validTo ? Math.floor((validTo - Date.now()) / 86400000) : null,
        protocol: socket.getProtocol()
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'TLS connection timed out' }); });
    socket.on('error', (error) => resolve({ ok: false, error: error.code === 'ECONNREFUSED' ? 'Nothing is listening for HTTPS at that address yet.' : error.message }));
  });
}

// Certificate authorities Veave's TLS terminator (Caddy) may use. A CAA record that excludes all of them blocks issuance.
const ACME_ISSUERS = ['letsencrypt.org', 'zerossl.com'];

/** CAA is inherited from the closest ancestor that has one; returns whether issuance is blocked and by what. */
async function caaStatus(hostname, { resolvers = null } = {}) {
  const list = resolvers || resolverList().map((server) => makeResolver(server));
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i += 1) {
    const name = labels.slice(i).join('.');
    for (const resolver of list) {
      try {
        const records = await resolver.resolveCaa(name);
        if (records.length) {
          const issuers = records.filter((record) => record.issue !== undefined || record.issuewild !== undefined)
            .map((record) => String(record.issue ?? record.issuewild ?? '').split(';')[0].trim().toLowerCase());
          const allowed = issuers.length === 0 || issuers.some((value) => value === '' ? false : ACME_ISSUERS.includes(value));
          return { present: true, allowed, at: name, issuers };
        }
      } catch (error) { if (![...MISSING, ...TRANSIENT, 'ENOTIMP', 'EREFUSED'].includes(error.code)) throw error; }
    }
  }
  return { present: false, allowed: true };
}

const defaultProbes = { resolveAll, request, tlsProbe, isPublicAddress, caaStatus };

module.exports = { resolveAll, request, tlsProbe, isPublicAddress, caaStatus, bodyHash, defaultProbes, TRANSIENT, ACME_ISSUERS };
