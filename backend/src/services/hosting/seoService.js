const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchChromium } = require('../browser/launchChromium');
const logger = require('../../utils/logger');

// Makes a published single-page app crawlable: every static route is rendered in a headless browser and saved as a real
// HTML file (so crawlers and link previews see the content without running JavaScript), plus sitemap.xml and robots.txt.

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain', '.xml': 'application/xml' };

function deriveRoutes(sourceFiles = [], limit = 30) {
  const routes = new Set(['/']);
  for (const file of sourceFiles) {
    if (!/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) || typeof file.content !== 'string') continue;
    for (const match of file.content.matchAll(/<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g)) {
      const route = match[1];
      if (/^\/[A-Za-z0-9_\-/]*$/.test(route) && !route.includes('//')) routes.add(route.replace(/\/+$/, '') || '/');
    }
  }
  return [...routes].slice(0, limit);
}

function buildSitemap(baseUrl, routes) {
  const base = baseUrl.replace(/\/+$/, '');
  const today = new Date().toISOString().slice(0, 10);
  const urls = routes.map((route) => `  <url>\n    <loc>${base}${route === '/' ? '/' : route}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${route === '/' ? '1.0' : '0.8'}</priority>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function withRobots(existing, baseUrl) {
  const text = existing ? existing.toString('utf8') : 'User-agent: *\nAllow: /\n';
  if (/^\s*Sitemap:/im.test(text)) return text;
  return `${text.trimEnd()}\n\nSitemap: ${baseUrl.replace(/\/+$/, '')}/sitemap.xml\n`;
}

async function serveDirectory(dir) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let target = path.join(dir, pathname);
      if (!target.startsWith(dir)) { res.writeHead(403).end(); return; }
      let stat = await fs.stat(target).catch(() => null);
      if (stat?.isDirectory()) { target = path.join(target, 'index.html'); stat = await fs.stat(target).catch(() => null); }
      if (!stat) {
        if (path.extname(pathname)) { res.writeHead(404).end(); return; }
        target = path.join(dir, 'index.html');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(await fs.readFile(target));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function enhanceForSearch(files, { baseUrl, sourceFiles = [], log = () => {}, timeoutMs = Number.parseInt(process.env.PUBLISH_PRERENDER_TIMEOUT_MS, 10) || 90000 } = {}) {
  const out = new Map(files.map((file) => [file.path, file]));
  const routes = deriveRoutes(sourceFiles);

  // Sitemap and robots are cheap and always added.
  out.set('sitemap.xml', { path: 'sitemap.xml', buffer: Buffer.from(buildSitemap(baseUrl, routes)) });
  out.set('robots.txt', { path: 'robots.txt', buffer: Buffer.from(withRobots(out.get('robots.txt')?.buffer, baseUrl)) });
  log(`SEO: sitemap.xml (${routes.length} URL${routes.length === 1 ? '' : 's'}) and robots.txt added.`);

  const isRealBuild = files.some((file) => /^assets\/.+\.js$/.test(file.path));
  if (String(process.env.PUBLISH_PRERENDER || '').toLowerCase() === 'false' || !isRealBuild) return [...out.values()];

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veave-prerender-'));
  let server; let browser;
  try {
    for (const file of files) {
      const target = path.join(dir, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.buffer);
    }
    const served = await serveDirectory(dir);
    server = served.server;
    browser = await launchChromium({ browserType: chromium });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    // Only the local copy of the site is fetched; external images/fonts/scripts are skipped (the HTML keeps their URLs).
    await context.route('**/*', (route) => (route.request().url().startsWith(served.origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const deadline = Date.now() + timeoutMs;
    let done = 0;
    for (const route of routes) {
      if (Date.now() > deadline) { log('SEO: prerender time budget reached; remaining routes stay client-rendered.', 'warn'); break; }
      const page = await context.newPage();
      try {
        await page.goto(`${served.origin}${route}`, { waitUntil: 'load', timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(400);
        const textLength = await page.evaluate(() => (document.getElementById('root')?.innerText || '').trim().length);
        if (textLength < 40) { log(`SEO: ${route} rendered almost no text; left as client-rendered.`, 'warn'); continue; }
        const html = `<!DOCTYPE html>\n${await page.evaluate(() => document.documentElement.outerHTML)}`;
        const filePath = route === '/' ? 'index.html' : `${route.replace(/^\//, '')}/index.html`;
        out.set(filePath, { path: filePath, buffer: Buffer.from(html, 'utf8') });
        done += 1;
      } catch (error) {
        log(`SEO: could not prerender ${route}: ${String(error.message).split('\n')[0]}`, 'warn');
      } finally {
        await page.close().catch(() => {});
      }
    }
    log(`SEO: prerendered ${done} of ${routes.length} page(s) as static HTML for search engines.`);
  } catch (error) {
    logger.warn(`Prerender skipped: ${error.message}`);
    log(`SEO: prerender skipped (${String(error.message).split('\n')[0]}).`, 'warn');
  } finally {
    await browser?.close().catch(() => {});
    server?.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return [...out.values()];
}

module.exports = { enhanceForSearch, deriveRoutes, buildSitemap, withRobots };
