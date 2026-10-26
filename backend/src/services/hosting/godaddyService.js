const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');

// Thin wrapper around GoDaddy's `gddy` CLI (https://github.com/godaddy/cli), used for domains only.
// Auth is a Personal Access Token in GDDY_PAT. The CLI is spawned without a shell, so a domain name can never
// be interpreted as a command; every argument is validated first.

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RECORD_NAME_RE = /^(?:@|[a-z0-9_](?:[a-z0-9_.-]{0,250}[a-z0-9_])?)$/i;

const bin = () => process.env.GDDY_BIN || 'gddy';
// GDDY_PAT for servers; GDDY_USE_LOGIN=true reuses the machine's `gddy auth login` session (local development).
const isEnabled = () => Boolean(process.env.GDDY_PAT) || process.env.GDDY_USE_LOGIN === 'true';

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  return DOMAIN_RE.test(domain) ? domain : null;
}

function run(args, { timeoutMs = 30000 } = {}) {
  if (!isEnabled()) return Promise.reject(new AppError('GoDaddy integration is not configured (set GDDY_PAT or GDDY_USE_LOGIN=true).', 503));
  return new Promise((resolve, reject) => {
    execFile(bin(), [...args, '--json'], {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin` },
      stdio: ['ignore', 'pipe', 'pipe']
    }, (error, stdout, stderr) => {
      const text = String(stdout || '').trim();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON output */ }
      if (error) {
        if (error.code === 'ENOENT') return reject(new AppError('The gddy CLI is not installed on the server.', 503));
        let errBody = parsed;
        if (!errBody) { try { errBody = JSON.parse(String(stderr || '').trim()); } catch { /* plain text */ } }
        let message = errBody?.error?.message || errBody?.message || String(stderr || error.message).trim().slice(0, 300);
        if (/contact is missing required fields/i.test(message)) {
          message = 'The GoDaddy account has no default contact details. Run `gddy domain contact init`, fill in the registrant details, and try again.';
        }
        logger.warn(`gddy ${args[0]} ${args[1] || ''} failed: ${message}`);
        return reject(new AppError(`GoDaddy: ${message}`, 502));
      }
      resolve(parsed);
    });
  });
}

// The CLI may wrap results ({ result }, { data }) or return the value directly.
const unwrap = (value) => (value && !Array.isArray(value) && typeof value === 'object'
  ? (value.result ?? value.data ?? value.records ?? value.domains ?? value) : value);
const asArray = (value) => { const v = unwrap(value); return Array.isArray(v) ? v : (v ? [v] : []); };

async function checkAvailability(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Enter a valid domain name, e.g. example.com.', 400);
  const result = unwrap(await run(['domain', 'available', domain]));
  const row = Array.isArray(result) ? result[0] : result;
  return { domain, available: Boolean(row?.available), definitive: Boolean(row?.definitive), terms: row?.terms || [], currency: row?.currency || null };
}

async function listAccountDomains() {
  const rows = asArray(await run(['domain', 'list']));
  return rows.map((row) => String(row.domain || row.domainName || row.name || '').toLowerCase()).filter(Boolean);
}

async function ownsDomain(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) return false;
  return (await listAccountDomains()).includes(domain);
}

async function listDnsRecords(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Invalid domain.', 400);
  return asArray(await run(['dns', 'list', domain]));
}

/**
 * Make sure the records exist. `set` replaces every record of that type+name, so existing A/CNAME records for
 * the same host are overwritten on purpose (the domain is being pointed at Veave); other types are untouched.
 */
async function pointDomain(domainInput, records) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Invalid domain.', 400);
  const applied = [];
  for (const record of records) {
    if (!['A', 'CNAME', 'TXT'].includes(record.type) || !RECORD_NAME_RE.test(record.name) || !record.data || /[\s]/.test(record.type)) {
      throw new AppError('Invalid DNS record.', 400);
    }
    await run(['dns', 'set', domain, '--type', record.type, '--name', record.name, '--data', String(record.data), '--ttl', String(record.ttl || 600)]);
    applied.push(record);
  }
  return applied;
}

// Locks a price for `domain` and returns the legal agreements plus a single-use token (valid ~10 minutes).
async function quoteDomain(domainInput, { period = 1 } = {}) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Enter a valid domain name, e.g. example.com.', 400);
  const q = unwrap(await run(['domain', 'quote', domain, '--period', String(period), '--no-renew'], { timeoutMs: 45000 }));
  if (!q?.available || !q.quoteToken) throw new AppError(`${domain} is not available to register.`, 409);
  return {
    domain,
    price: Number.parseFloat(q.price),
    currency: q.currency || 'USD',
    renewalPrice: q.renewalPrice ? Number.parseFloat(q.renewalPrice) : null,
    period: q.period || period,
    quoteToken: q.quoteToken,
    expiresAt: q.expiresAt || null,
    agreements: (q.requiredAgreements || []).map((a) => ({ title: a.title, url: a.url, type: a.agreementType }))
  };
}

// Registers the domain and CHARGES the GoDaddy account. Only call after the customer's own payment is verified.
async function purchaseDomain(quoteToken) {
  if (!/^[\w.-]{8,200}$/.test(String(quoteToken || ''))) throw new AppError('Invalid quote token.', 400);
  const r = unwrap(await run(['domain', 'purchase', '--quote-token', quoteToken, '--agree', '--confirm'], { timeoutMs: 120000 }));
  return { status: r?.status || 'UNKNOWN', operationId: r?.operationId || null };
}

async function suggestDomains(query, limit = 5) {
  const text = String(query || '').trim().slice(0, 60);
  if (!/^[\w .-]+$/.test(text)) return [];
  const rows = asArray(await run(['domain', 'suggest', text, '--limit', String(limit)]));
  return rows.map((row) => String(row.domain || row.name || '').toLowerCase()).filter(Boolean).slice(0, limit);
}

// ---- Registrant contact, collected in our own UI (no need to touch GoDaddy) --------------------------------------
function contactsPath() {
  if (process.env.GDDY_CONTACTS_PATH) return process.env.GDDY_CONTACTS_PATH;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/gddy/contacts.toml');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gddy/contacts.toml');
}

const clean = (value, max = 100) => String(value ?? '').replace(/[\u0000-\u001f"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Accepts "+91 98765 43210", "+919876543210", "+91.9876543210" or a bare 10-digit Indian number.
function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (/^\+\d{1,3}\.\d{4,14}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length > 6) {
    const cc = digits.startsWith('91') ? 2 : digits.startsWith('1') ? 1 : digits.length > 10 ? digits.length - 10 : 2;
    return `+${digits.slice(0, cc)}.${digits.slice(cc)}`;
  }
  return digits.length === 10 ? `+91.${digits}` : raw;
}

function validateContact(input = {}) {
  const c = {
    name_first: clean(input.firstName, 50), name_last: clean(input.lastName, 50), email: clean(input.email, 120),
    phone: clean(normalizePhone(input.phone), 20), organization: clean(input.organization, 100), address1: clean(input.address1, 120),
    city: clean(input.city, 60), state: clean(input.state, 60), postal_code: clean(input.postalCode, 15),
    country: clean(input.country, 2).toUpperCase()
  };
  const required = ['name_first', 'name_last', 'email', 'phone', 'address1', 'city', 'state', 'postal_code', 'country'];
  const missing = required.filter((key) => !c[key]);
  if (missing.length) throw new AppError('Please fill in all the contact details.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new AppError('Enter a valid email address.', 400);
  if (!/^\+\d{1,3}\.\d{4,14}$/.test(c.phone)) throw new AppError('Phone must look like +91.9876543210 (country code, a dot, then the number).', 400);
  if (!/^[A-Z]{2}$/.test(c.country)) throw new AppError('Country must be a 2-letter code, e.g. IN.', 400);
  return c;
}

// The CLI reads registrant details from contacts.toml. Writes and the quote that consumes them are serialised.
let contactLock = Promise.resolve();
function withContact(input, fn) {
  const contact = validateContact(input);
  const task = contactLock.then(async () => {
    const lines = ['registrant', 'admin', 'tech', 'billing'].map((role) => [`[${role}]`,
      ...Object.entries(contact).filter(([, v]) => v).map(([k, v]) => `${k} = "${v}"`)].join('\n'));
    fs.mkdirSync(path.dirname(contactsPath()), { recursive: true });
    fs.writeFileSync(contactsPath(), `${lines.join('\n\n')}\n`, { mode: 0o600 });
    return fn();
  });
  contactLock = task.catch(() => {});
  return task;
}

// ---- Domain management: details, renewal and DNS (renewal is not in the CLI's commands; `gddy api call` reaches it) --
async function getDomainDetails(domainInput) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Invalid domain.', 400);
  const d = unwrap(await run(['domain', 'get', domain]));
  return {
    domain,
    expiresAt: d?.expiresAt || d?.expires || d?.expiry || null,
    autoRenew: d?.autoRenew ?? d?.renewAuto ?? null,
    status: d?.status || null,
    nameServers: d?.nameServers || null
  };
}

async function quoteRenewal(domainInput, { period = 1 } = {}) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Invalid domain.', 400);
  const q = unwrap(await run(['api', 'call', 'quoteRenewal', '--body', JSON.stringify({ domain, period })], { timeoutMs: 45000 }));
  const price = q?.price;
  const value = Number.parseFloat(price?.value ?? q?.priceValue);
  if (!q?.quoteToken || !Number.isFinite(value)) throw new AppError('GoDaddy did not return a renewal price for this domain.', 502);
  // simple-money: the integer carries the currency's ISO-4217 implied decimals (USD 1499 = 14.99; JPY has none).
  const code = price?.currencyCode || 'USD';
  const amount = ['JPY', 'KRW', 'VND', 'CLP'].includes(code) ? value : value / 100;
  return {
    domain, period: q.period || period, price: amount, currency: code, quoteToken: q.quoteToken,
    currentExpiresAt: q.currentExpiresAt || null, newExpiresAt: q.resolvedNewExpiresAt || q.expiresAt || null
  };
}

// Charges the GoDaddy account and extends the domain. Only call after the customer's own payment is verified.
async function renewDomain({ domain: domainInput, quoteToken, period = 1, idempotencyKey }) {
  const domain = normalizeDomain(domainInput);
  if (!domain || !/^[\w-]{8,100}$/.test(String(quoteToken || '')) || !/^[\w-]{8,100}$/.test(String(idempotencyKey || ''))) throw new AppError('Invalid renewal request.', 400);
  const r = unwrap(await run(['api', 'call', 'renewDomain', '--body', JSON.stringify({ domain, quoteToken, period, consent: { agreedAt: new Date().toISOString() } }),
    '--param', `Idempotency-Key=${idempotencyKey}`], { timeoutMs: 60000 }));
  return { renewalId: r?.renewalId || null, status: r?.status || 'CONFIRMED', newExpiresAt: r?.expiresAt || null };
}

async function getRenewal(renewalId) {
  if (!/^[\w-]{8,100}$/.test(String(renewalId || ''))) throw new AppError('Invalid renewal id.', 400);
  const r = unwrap(await run(['api', 'call', 'getRenewal', '--param', `renewalId=${renewalId}`]));
  return { renewalId, status: r?.status || 'UNKNOWN', newExpiresAt: r?.expiresAt || null };
}

async function setAutoRenew(domainInput, enabled) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new AppError('Invalid domain.', 400);
  await run(['api', 'call', 'setAutoRenew', '--param', `domain-name=${domain}`, '--body', JSON.stringify(Boolean(enabled)),
    '--param', `Idempotency-Key=ar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`]);
  return { domain, autoRenew: Boolean(enabled) };
}

const DNS_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX']);
async function setDnsRecord(domainInput, record) {
  const domain = normalizeDomain(domainInput);
  const type = String(record?.type || '').toUpperCase();
  const name = String(record?.name || '').trim();
  const data = String(record?.data || '').trim();
  if (!domain || !DNS_TYPES.has(type) || !RECORD_NAME_RE.test(name) || !data || data.length > 1000) throw new AppError('Invalid DNS record.', 400);
  const args = ['dns', 'set', domain, '--type', type, '--name', name, '--data', data, '--ttl', String(Math.min(Math.max(Number(record.ttl) || 600, 600), 86400))];
  if (type === 'MX') args.push('--priority', String(Math.min(Math.max(Number(record.priority) || 10, 0), 65535)));
  await run(args);
  return { type, name, data };
}

async function deleteDnsRecord(domainInput, { type, name }) {
  const domain = normalizeDomain(domainInput);
  const t = String(type || '').toUpperCase();
  if (!domain || !DNS_TYPES.has(t) || !RECORD_NAME_RE.test(String(name || ''))) throw new AppError('Invalid DNS record.', 400);
  await run(['dns', 'delete', domain, '--type', t, '--name', String(name)]);
  return { type: t, name };
}

module.exports = { getDomainDetails, quoteRenewal, renewDomain, getRenewal, setAutoRenew, setDnsRecord, deleteDnsRecord, normalizePhone, validateContact, withContact, contactsPath, quoteDomain, purchaseDomain, suggestDomains, isEnabled, normalizeDomain, checkAvailability, listAccountDomains, ownsDomain, listDnsRecords, pointDomain, _run: run };
