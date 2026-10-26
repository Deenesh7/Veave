// Hostname validation for custom domains. Everything that later reaches DNS lookups, TLS probes, Caddy's "ask" endpoint
// or a database query goes through here first, so a malformed or hostile value never gets that far.
const { domainToASCII } = require('node:url');
const tldts = require('tldts');
const { hostingConfig } = require('./config');

const LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Names that can never be a public customer website (RFC 2606/6761/6762, private-network and test suffixes).
const RESERVED_SUFFIXES = new Set(['local', 'localhost', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'test', 'example', 'invalid', 'onion', 'arpa', 'localdomain', 'home.arpa']);

const problem = (error) => ({ ok: false, error });

/**
 * Normalises user input ("https://WWW.Example.com/", "Müller.de") to an ASCII hostname and rejects anything that is not a
 * plain public DNS name: ports, credentials, paths with content, IP addresses, single labels, reserved or platform names.
 */
function normalizeHostname(input, { baseDomain = hostingConfig().baseDomain } = {}) {
  let value = String(input ?? '').trim();
  if (!value) return problem('Enter a domain name, e.g. example.com.');
  if (value.length > 600) return problem('That domain name is too long.');
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (/[@\s\\]/.test(value.split('/')[0])) return problem('Enter only the domain name, without credentials or spaces.');
  const [authority] = value.split(/[/?#]/); // anything after the host (path, query) is ignored
  if (/:\d*$/.test(authority)) return problem('Enter only the domain name, without a port.');
  const ascii = domainToASCII(authority.replace(/\.$/, '').toLowerCase());
  if (!ascii) return problem('That is not a valid domain name.');
  if (ascii.length > 253) return problem('That domain name is too long.');
  const labels = ascii.split('.');
  if (labels.length < 2) return problem('Enter a full domain name such as example.com.');
  if (!labels.every((label) => LABEL.test(label))) return problem('That is not a valid domain name.');
  const parsed = tldts.parse(ascii, { allowPrivateDomains: false });
  if (parsed.isIp) return problem('IP addresses cannot be used as a website domain.');
  if (/^\d+$/.test(labels.at(-1))) return problem('That is not a valid domain name.');
  if (RESERVED_SUFFIXES.has(labels.at(-1)) || RESERVED_SUFFIXES.has(labels.slice(-2).join('.'))) return problem('That domain cannot be used for a public website.');
  if (tldts.parse(ascii, { allowPrivateDomains: true }).isPrivate) return problem('That address belongs to a shared hosting service; use a domain you own.');
  if (!parsed.domain || !parsed.isIcann) return problem('That domain does not end in a recognised public suffix (for example .com or .co.uk).');
  if (baseDomain && (ascii === baseDomain || ascii.endsWith(`.${baseDomain}`))) return problem('That domain is reserved for Veave.');
  return { ok: true, hostname: ascii };
}

/**
 * Splits a hostname into the registrable domain and what the user wants to connect.
 *   example.com           -> apex, optionally with www
 *   www.example.com       -> treated as the apex "example.com" with www (the common way people type it)
 *   blog.example.co.uk    -> subdomain of example.co.uk, no apex/www behaviour
 */
function classifyHostname(hostname) {
  const parsed = tldts.parse(hostname);
  const apex = parsed.domain;
  const sub = parsed.subdomain || '';
  if (!sub) return { hostname, apex, kind: 'apex', zone: apex, label: '@' };
  if (sub === 'www') return { hostname: apex, apex, kind: 'apex', zone: apex, label: '@', typedWww: true };
  return { hostname, apex, kind: 'subdomain', zone: apex, label: sub };
}

/** Hostnames a connection serves: the apex (and www on request) or exactly the subdomain. */
function servedHostnames({ hostname, kind, apex }, { includeWww = false } = {}) {
  if (kind === 'subdomain') return [hostname];
  return includeWww ? [apex, `www.${apex}`] : [apex];
}

module.exports = { normalizeHostname, classifyHostname, servedHostnames, RESERVED_SUFFIXES };
