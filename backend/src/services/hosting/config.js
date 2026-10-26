const os = require('node:os');
const path = require('node:path');

const isProduction = () => process.env.NODE_ENV === 'production';

// Veave's production domain: the app lives at app.veave.net and every published site at <slug>.veave.net.
// Local development keeps using *.localhost, which needs no DNS and no purchase.
const PRODUCTION_DOMAIN = 'veave.net';

// Read lazily so tests and .env changes are honoured.
function hostingConfig() {
  const baseDomain = String(process.env.PUBLISH_BASE_DOMAIN || (isProduction() ? PRODUCTION_DOMAIN : 'localhost')).trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const scheme = process.env.PUBLISH_SCHEME || (isProduction() ? 'https' : 'http');
  // Dev (localhost) needs the API port in the URL; production sits behind a reverse proxy on 80/443.
  const publicPort = process.env.PUBLISH_PUBLIC_PORT !== undefined
    ? process.env.PUBLISH_PUBLIC_PORT
    : (baseDomain === 'localhost' ? String(process.env.PORT || 5000) : '');
  return {
    baseDomain,
    scheme,
    publicPort,
    storageDir: path.resolve(process.env.PUBLISH_STORAGE_DIR || path.join(__dirname, '../../../.published')),
    npmCacheDir: path.resolve(process.env.PUBLISH_NPM_CACHE_DIR || path.join(os.tmpdir(), 'veave-publish-npm-cache')),
    // Untrusted project code (vite config, plugins) runs during a build. Only a container is a real sandbox,
    // so local builds are opt-in in production.
    allowLocalBuild: process.env.PUBLISH_ALLOW_LOCAL_BUILD !== undefined
      ? process.env.PUBLISH_ALLOW_LOCAL_BUILD === 'true'
      : !isProduction(),
    installTimeoutMs: Number.parseInt(process.env.PUBLISH_INSTALL_TIMEOUT_MS, 10) || 5 * 60 * 1000,
    buildTimeoutMs: Number.parseInt(process.env.PUBLISH_BUILD_TIMEOUT_MS, 10) || 5 * 60 * 1000,
    maxSiteBytes: Number.parseInt(process.env.PUBLISH_MAX_SITE_BYTES, 10) || 200 * 1024 * 1024,
    maxSiteFiles: Number.parseInt(process.env.PUBLISH_MAX_SITE_FILES, 10) || 5000,
    keepVersions: Math.max(2, Number.parseInt(process.env.PUBLISH_KEEP_VERSIONS, 10) || 3),
    verifyPublicUrl: process.env.PUBLISH_VERIFY_PUBLIC_URL !== undefined
      ? process.env.PUBLISH_VERIFY_PUBLIC_URL === 'true'
      : isProduction(),
    verifyOrigin: process.env.PUBLISH_VERIFY_ORIGIN || `http://127.0.0.1:${process.env.PORT || 5000}`
  };
}

function siteHost(slug, config = hostingConfig()) {
  return `${slug}.${config.baseDomain}`;
}

function siteUrl(slug, config = hostingConfig()) {
  const port = config.publicPort ? `:${config.publicPort}` : '';
  return `${config.scheme}://${siteHost(slug, config)}${port}/`;
}

// Custom-domain workflow settings (read lazily so tests and .env changes are honoured).
function domainConfig() {
  const hours = (name, fallback) => Math.max(0.0001, Number.parseFloat(process.env[name])) || fallback;
  const ms = (name, fallback) => Math.max(1, Number.parseInt(process.env[name], 10)) || fallback;
  return {
    // Where customers' domains must point. Nothing is hardcoded: both come from the deployment's environment.
    ipv4: String(process.env.PUBLISH_SERVER_IP || '').trim() || null,
    ipv6: String(process.env.PUBLISH_SERVER_IPV6 || '').trim() || null,
    verifyTtlMs: hours('DOMAIN_VERIFY_TTL_HOURS', 168) * 3600 * 1000,         // how long a challenge stays valid
    dnsWaitMs: hours('DOMAIN_DNS_WAIT_HOURS', 72) * 3600 * 1000,              // propagation allowance
    healthIntervalMs: hours('DOMAIN_HEALTH_INTERVAL_HOURS', 6) * 3600 * 1000, // re-check of live domains
    tickMs: ms('DOMAIN_ORCHESTRATOR_INTERVAL_MS', 10000),
    leaseMs: ms('DOMAIN_STEP_LEASE_MS', 5 * 60 * 1000),
    maxSslAttempts: ms('DOMAIN_SSL_MAX_ATTEMPTS', 8),
    maxHealthAttempts: ms('DOMAIN_HEALTH_MAX_ATTEMPTS', 6),
    sslRenewWithinDays: ms('DOMAIN_SSL_RENEW_WITHIN_DAYS', 14),
    deployWaitMs: ms('DOMAIN_DEPLOY_WAIT_MS', 30 * 60 * 1000)
  };
}

module.exports = { hostingConfig, domainConfig, siteHost, siteUrl, PRODUCTION_DOMAIN };
