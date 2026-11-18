const templateService = require('../services/templates/templateService');

const fail = (res, error) => {
  if (error instanceof templateService.TemplateError) {
    return res.status(error.status).json({ success: false, error: error.message, code: error.code });
  }
  throw error;
};

// Gallery listing: filters (category, q) and sorting (featured, newest, popular, name) are applied on the server.
exports.list = (req, res, next) => {
  try {
    const { category = null, q = '', sort = 'featured' } = req.query;
    const templates = templateService.listTemplates({ user: req.user, category: category ? String(category) : null, q: String(q).slice(0, 80), sort: String(sort) });
    res.json({ success: true, templates, categories: templateService.listCategories({ user: req.user }) });
  } catch (error) { next(error); }
};

const logger = require('../utils/logger');
const themes = () => require('../services/templateSites/templateTheme');
// The font and palette library never changes while the server runs: built once, and the browser may keep it for an hour.
let libraryBody = null;
exports.themeLibrary = (req, res) => {
  libraryBody = libraryBody || { success: true, ...themes().library() };
  res.set('Cache-Control', 'public, max-age=3600');
  res.json(libraryBody);
};

// The template's real, compiled website (nothing saved). The frontend shows it in a sandboxed iframe and sends it the theme CSS.
//
// Compiling takes 0.2 to 1 s, so each template is compiled ONCE: the result is kept in memory, on disk (so a server restart, which a
// dev server does on every file change, does not throw it away) and concurrent first requests share one compile. The answer carries an
// ETag, so a browser that already has the page gets a tiny 304 instead of 130 KB.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LISTENER = `<style id="veave-theme"></style><script>window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='veave-theme'){document.getElementById('veave-theme').textContent=d.css||'';}});</script>`;
const compiled = new Map();     // cache key -> html
const compiling = new Map();    // cache key -> Promise<html>
const CACHE_DIR = path.join(os.tmpdir(), 'veave-template-html');

const cacheKeyOf = (template) => `${template._contentHash}-${require('../services/preview/previewService').COMPILER_VERSION}`;

async function compiledSiteHtml(template) {
  const key = cacheKeyOf(template);
  if (compiled.has(key)) return { html: compiled.get(key), key };
  if (!compiling.has(key)) {
    const run = (async () => {
      const file = path.join(CACHE_DIR, `${key.replace(/[^\w.-]/g, '_')}.html`);
      const remember = async (html) => { try { await fs.promises.mkdir(CACHE_DIR, { recursive: true }); await fs.promises.writeFile(file, html); } catch { /* a read-only disk only loses the restart cache */ } };
      try { const saved = await fs.promises.readFile(file, 'utf8'); if (saved) return saved; } catch { /* not on disk yet */ }
      // Object storage is the shared, permanent copy: every server (and every restart, on any machine) reuses what one of them compiled.
      const storage = require('../services/storage/s3BlobStorage');
      const objectName = `template-previews/${key.replace(/[^\w.-]/g, '_')}.html`;
      try {
        const stored = await storage.getNamedObject(objectName);
        if (stored && stored.length) { const html = stored.toString('utf8'); await remember(html); return html; }
      } catch (error) { logger.warn(`Stored template preview ${objectName} could not be read (${error.message}); compiling it.`); }
      const built = await require('../services/preview/previewService').compileTemplateFiles(templateService.instantiateFiles(template));
      const html = built.includes('</head>') ? built.replace('</head>', `${LISTENER}</head>`) : `${LISTENER}${built}`;
      await remember(html);
      if (storage.isConfigured()) storage.putNamedObject(objectName, html, 'text/html; charset=utf-8').catch((error) => logger.warn(`Template preview ${objectName} could not be stored in S3: ${error.message}`));
      return html;
    })().then((html) => {
      if (compiled.size > 40) compiled.clear();
      compiled.set(key, html);
      return html;
    }).finally(() => compiling.delete(key));
    compiling.set(key, run);
  }
  return { html: await compiling.get(key), key };
}

exports.siteHtml = async (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.query.version || null, user: req.user });
    const etag = `"${cacheKeyOf(template)}"`;
    // The page itself is the same for everyone who may see this template; the browser must ask again (cheap) each time.
    res.set({ 'Cache-Control': 'private, no-cache', ETag: etag });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const { html } = await compiledSiteHtml(template);
    res.json({ success: true, html, hash: template._contentHash });
  } catch (error) { try { fail(res, error); } catch (other) { next(other); } }
};

/** Compiles every template in the background (one at a time) so the first person to open one never waits for it. */
exports.warmSiteHtml = async () => {
  let warmed = 0;
  for (const entry of templateService.listTemplates({}) || []) {
    try { await compiledSiteHtml(templateService.resolveTemplate(entry.id, { version: entry.version })); warmed += 1; } catch { /* a template that cannot compile is reported when it is opened */ }
  }
  return warmed;
};

// The theme CSS for the live preview: generated by the same code that writes it into a created site.
exports.themeCss = (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.query.version || null, user: req.user });
    const { theme, adjusted } = themes().normalize(req.body?.theme, template);
    res.json({ success: true, css: themes().previewCss(theme, template), theme, adjusted });
  } catch (error) { try { fail(res, error); } catch (other) { next(other); } }
};

// The template's own pictures for that preview (public templates only, same visibility as the gallery thumbnail).
const TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' };
exports.asset = (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.query.version || null, user: req.user });
    const rel = String(req.params[0] || '').replace(/^\/+/, '');
    const file = rel && !rel.includes('..') ? template._files.get(`public/${rel}`) : null;
    const type = TYPES[rel.split('.').pop().toLowerCase()];
    if (!file || !type) return res.status(404).type('text/plain').send('Not found');
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    res.send(file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content);
  } catch (error) { try { fail(res, error); } catch (other) { next(other); } }
};

exports.detail = (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.query.version || null, user: req.user });
    res.json({ success: true, template: templateService.describeTemplate(template) });
  } catch (error) {
    try { fail(res, error); } catch (other) { next(other); }
  }
};

// The gallery thumbnail. It is a plain <img> source, so it is served without credentials for public templates.
exports.preview = (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.query.version || null, user: req.user });
    const image = templateService.getPreviewImage(template);
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(image.body);
  } catch (error) {
    try { fail(res, error); } catch (other) { next(other); }
  }
};

// "Use Template": the server confirms the template exists, is available to this account and is usable, and returns the
// reference the composer sends with the generation request. Generation validates it again.
exports.select = (req, res, next) => {
  try {
    const template = templateService.resolveTemplate(req.params.id, { version: req.body?.version || null, user: req.user });
    res.json({ success: true, selection: { templateId: template.id, templateVersion: template.version, name: template.name, category: template.category, previewUrl: `/api/templates/${template.id}/preview?version=${template.version}` } });
  } catch (error) {
    try { fail(res, error); } catch (other) { next(other); }
  }
};
