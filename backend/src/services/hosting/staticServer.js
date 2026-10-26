const fs = require('node:fs');
const path = require('node:path');
const PublishedSite = require('../../models/PublishedSite');
const DomainConnection = require('../../models/DomainConnection');
const { hostingConfig } = require('./config');
const { validateSlug } = require('./slug');
const { versionDir, SAFE_VERSION } = require('./storage');
const { resolveInside } = require('./safePath');

const TTL_MS = 5000;
const cache = new Map();

function invalidateSite(slug, customDomain) {
  if (slug) cache.delete(slug);
  if (customDomain) cache.delete(`domain:${customDomain}`);
}

async function lookupSite(slug) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site;
  const site = await PublishedSite.findOne({ slug }).select('slug status activeVersion').lean();
  cache.set(slug, { site, at: Date.now() });
  return site;
}

// A hostname serves a site only through a connection that is verified (claimed), routed and in a serving stage. Exact host
// match: "www.x.com" is served only if it was connected, never because "x.com" was.
async function lookupSiteByDomain(hostname) {
  const host = String(hostname || '').toLowerCase();
  const key = `domain:${host}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;
  let result = { site: null, redirect: null };
  const connection = await DomainConnection.findOne({
    hostnames: host, claimed: true, live: true, 'routing.activatedAt': { $ne: null }, stage: { $in: ['ssl_pending', 'checking_health', 'active'] }
  }).select('siteId canonical includeWww apex kind ssl.status').lean();
  if (connection) {
    const site = await PublishedSite.findById(connection.siteId).select('slug status activeVersion').lean();
    // Redirect root <-> www only once HTTPS works, so visitors are never sent to an address that cannot load.
    const wanted = connection.kind === 'apex' && connection.includeWww && connection.canonical !== 'none'
      ? (connection.canonical === 'www' ? `www.${connection.apex}` : connection.apex) : null;
    result = { site, redirect: wanted && wanted !== host && connection.ssl?.status === 'active' ? wanted : null };
  } else {
    // Domains connected before the workflow existed keep working until they are reconnected through it.
    const bare = host.replace(/^www\./, '');
    const legacy = await PublishedSite.findOne({ customDomain: bare, customDomainStatus: 'verified' }).select('slug status activeVersion customDomainWww').lean();
    if (legacy && (host === bare || legacy.customDomainWww !== false) && !(await DomainConnection.exists({ siteId: legacy._id, live: true }))) result = { site: legacy, redirect: null };
  }
  cache.set(key, { result, at: Date.now() });
  return result;
}

// "<slug>.<base>[:port]" -> slug, or null when the host is not a published-site host.
function slugFromHost(hostname, baseDomain) {
  const host = String(hostname || '').toLowerCase();
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  return label;
}

function cacheControlFor(relativePath) {
  if (/\.html?$/i.test(relativePath)) return 'no-cache';
  // Vite emits content-hashed files under assets/: safe to cache forever, and a new deploy changes the names.
  if (/^assets\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i.test(relativePath)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

function statFile(file) {
  return fs.promises.stat(file).then((stat) => (stat.isFile() ? stat : null)).catch(() => null);
}

function sendNotFoundPage(res, root, message) {
  const custom = path.join(root, '404.html');
  return statFile(custom).then((stat) => {
    if (stat) return res.status(404).set('Cache-Control', 'no-cache').sendFile('404.html', { root, dotfiles: 'deny' });
    return res.status(404).type('text/plain').send(message);
  });
}

async function serveHostedSite(req, res, next) {
  const { baseDomain } = hostingConfig();
  const slug = slugFromHost(req.hostname, baseDomain);
  const hostLower = String(req.hostname || '').toLowerCase();
  const isOwnHost = hostLower === baseDomain || hostLower.endsWith(`.${baseDomain}`) || hostLower === 'localhost' || /^[\d.]+$/.test(hostLower) || hostLower.endsWith('.localhost');
  const isCustomHost = !slug && !isOwnHost;
  if (!isCustomHost && (!slug || validateSlug(slug))) return next(); // not a site host (reserved labels such as "app" fall through to the API)
  try {
    const found = isCustomHost ? await lookupSiteByDomain(hostLower) : { site: await lookupSite(slug), redirect: null };
    const site = found.site;
    if (isCustomHost && !site) return next();
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).set('Allow', 'GET, HEAD').end();
    if (found.redirect) return res.redirect(301, `https://${found.redirect}${req.originalUrl}`);
    if (!site || site.status !== 'published' || !SAFE_VERSION.test(String(site.activeVersion))) {
      return res.status(404).type('text/plain').send('This site is not published.');
    }
    const root = versionDir(site._id, site.activeVersion);
    let requested;
    try { requested = decodeURIComponent(req.path); } catch { return res.status(400).type('text/plain').send('Bad request'); }
    let relative = requested.replace(/^\/+/, '');
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const target = resolveInside(root, relative);
    if (!target) return res.status(400).type('text/plain').send('Bad request');

    let file = await statFile(target);
    let servedRelative = relative;
    if (!file) {
      const directoryIndex = resolveInside(root, `${relative}/index.html`);
      if (directoryIndex && await statFile(directoryIndex)) {
        file = true; servedRelative = `${relative}/index.html`;
      }
    }
    if (!file) {
      // Missing files with an extension are real 404s; extensionless paths are client-side routes -> SPA fallback.
      const looksLikeAsset = path.posix.extname(relative) !== '';
      if (looksLikeAsset) return await sendNotFoundPage(res, root, 'Not found');
      servedRelative = 'index.html';
    }
    res.set({
      'Cache-Control': cacheControlFor(servedRelative),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    return res.sendFile(servedRelative, { root, dotfiles: 'deny' }, (error) => {
      if (error && !res.headersSent) res.status(error.status || 500).type('text/plain').send('Site file unavailable.');
    });
  } catch (error) {
    if (!res.headersSent) res.status(503).type('text/plain').send('Site temporarily unavailable.');
  }
}

module.exports = { serveHostedSite, invalidateSite, slugFromHost, cacheControlFor };
