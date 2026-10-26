// Domain-control proof. The user adds a TXT record whose value only this platform could have produced for exactly this
// hostname, user and project. Nothing secret is stored: the expected value is recomputed from an HMAC.
const crypto = require('node:crypto');
const dns = require('node:dns');
const { AppError } = require('../../utils/errors');

const PREFIX = 'veave-site-verification=';
const RECORD_LABEL = '_veave-verify';
let warnedEphemeral = false;
let ephemeralSecret = null;

function secret() {
  const configured = process.env.DOMAIN_VERIFY_SECRET || '';
  if (configured.length >= 16) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('Domain verification is not configured on this server (DOMAIN_VERIFY_SECRET).', 503);
  }
  // Development and tests only: a stable value from the JWT secret, else one for the life of the process.
  if (process.env.JWT_SECRET) return `dev:${process.env.JWT_SECRET}`;
  ephemeralSecret = ephemeralSecret || crypto.randomBytes(32).toString('hex');
  if (!warnedEphemeral) { warnedEphemeral = true; }
  return ephemeralSecret;
}

const newNonce = () => crypto.randomBytes(16).toString('hex');

/** The TXT value the user must publish. Bound to host + user + project + nonce, so it cannot be reused elsewhere. */
function challengeValue({ hostname, userId, projectId, nonce }) {
  const mac = crypto.createHmac('sha256', secret()).update(`v1|${hostname}|${userId}|${projectId}|${nonce}`).digest('base64url');
  return `${PREFIX}${mac}`;
}

/** Where the record goes, relative to the zone and absolute. */
function challengeRecord(connection) {
  const zoneLabel = connection.kind === 'subdomain' ? `${RECORD_LABEL}.${connection.hostname.slice(0, -(connection.apex.length + 1))}` : RECORD_LABEL;
  return {
    type: 'TXT',
    name: zoneLabel,
    fqdn: `${zoneLabel}.${connection.apex}`,
    data: challengeValue({ hostname: connection.kind === 'subdomain' ? connection.hostname : connection.apex, userId: String(connection.userId), projectId: String(connection.projectId), nonce: connection.verification.nonce }),
    purpose: 'Proves you control this domain'
  };
}

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

// Public resolvers are used instead of the server's own so a poisoned or stale local cache cannot "verify" a domain.
function resolverList() {
  const configured = (process.env.DNS_RESOLVERS || '1.1.1.1,8.8.8.8,9.9.9.9').split(',').map((item) => item.trim()).filter(Boolean);
  return configured;
}
function makeResolver(server) {
  const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
  if (server) resolver.setServers([server]);
  return resolver;
}

/** Looks the TXT record up on every configured public resolver; the proof counts if any of them shows the exact value. */
async function checkChallenge(connection, { resolvers = null } = {}) {
  const expected = challengeRecord(connection);
  const list = resolvers || resolverList().map((server) => ({ server, resolver: makeResolver(server) }));
  const seen = [];
  for (const { server, resolver } of list) {
    try {
      const records = (await resolver.resolveTxt(expected.fqdn)).map((parts) => parts.join(''));
      seen.push(...records);
      if (records.some((value) => safeEqual(value.trim(), expected.data))) return { verified: true, record: expected, via: server };
    } catch (error) {
      if (!['ENOTFOUND', 'ENODATA', 'ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error.code)) throw error;
    }
  }
  const wrong = seen.filter((value) => value.startsWith(PREFIX));
  return { verified: false, record: expected, reason: wrong.length ? 'A verification record exists but its value is wrong or belongs to a different request.' : 'The verification TXT record was not found yet.' };
}

module.exports = { challengeValue, challengeRecord, checkChallenge, newNonce, PREFIX, RECORD_LABEL, resolverList, makeResolver };
