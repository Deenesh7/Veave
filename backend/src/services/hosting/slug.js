const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'dashboard', 'console', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2',
  'cdn', 'static', 'assets', 'media', 'files', 'img', 'images', 'preview', 'staging', 'dev', 'test', 'demo',
  'status', 'support', 'help', 'docs', 'blog', 'billing', 'login', 'logout', 'register', 'signup', 'auth', 'oauth',
  'account', 'accounts', 'settings', 'secure', 'security', 'root', 'localhost', 'veave', 'internal', 'db', 'sites', 'site'
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

function normalizeSlug(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

// Returns null when valid, otherwise an actionable message.
function validateSlug(slug) {
  if (typeof slug !== 'string' || !slug) return 'Choose a site address.';
  if (slug.length < 3 || slug.length > 40) return 'Site address must be 3-40 characters.';
  if (!SLUG_PATTERN.test(slug)) return 'Use lowercase letters, numbers and hyphens only (no leading or trailing hyphen).';
  if (slug.includes('--')) return 'Site address cannot contain consecutive hyphens.';
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved. Choose a different address.`;
  return null;
}

function suggestSlug(name, suffixLength = 5) {
  const base = normalizeSlug(name) || 'site';
  const suffix = Math.random().toString(36).slice(2, 2 + suffixLength).replace(/[^a-z0-9]/g, 'x');
  return `${base.slice(0, 40 - suffixLength - 1)}-${suffix}`.replace(/-{2,}/g, '-');
}

module.exports = { normalizeSlug, validateSlug, suggestSlug, RESERVED_SLUGS };
