const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const Project = require('../../models/Project');
const PrecompiledPreview = require('../../models/PrecompiledPreview');
const logger = require('../../utils/logger');
const { hydrateFiles, hydrateFile } = require('../storage/s3BlobStorage');

// The client replaces this placeholder with `${origin}/api/preview-assets/${token}` before showing the document.
const ASSET_BASE_PLACEHOLDER = '__VEAVE_ASSET_BASE__';
const MAX_HTML_BYTES = 12 * 1024 * 1024; // stays well under MongoDB's 16 MB document limit
const SCHEDULE_DELAY_MS = 1500;

// Changing the transformer must invalidate documents it already compiled (they may contain its old bugs).
const COMPILER_VERSION = (() => {
  try {
    const { transformerPath } = require('./frontendAssets');
    return createHash('sha1').update(require('node:fs').readFileSync(transformerPath)).digest('hex').slice(0, 16);
  } catch { return 'unknown'; }
})();

const inFlight = new Map();   // projectId -> Promise
const scheduled = new Map();  // projectId -> Timeout

// Compare revisions by exact millisecond: String(date) drops them, so two saves in one second looked identical.
const sameRevision = (a, b) => Boolean(a && b) && new Date(a).getTime() === new Date(b).getTime();

const base64ByteLength = (content = '') => {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
};

/**
 * Fingerprint of a project's source. The browser computes the exact same value (frontend/src/utils/previewHash.js)
 * from the files it holds, which is how it knows a stored compiled preview matches what is on screen.
 * Text files hash their content; binary files hash their path and byte size (cheap, and size changes on any real edit).
 */
function previewSourceHash(files = []) {
  const sorted = files.filter((file) => file && typeof file.path === 'string')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const file of sorted) {
    hash.update(`${file.path}\0`);
    if (file.encoding === 'base64') {
      const size = file.blob?.size ?? base64ByteLength(file.content || '');
      hash.update(`b\0${size}\0`);
    } else {
      hash.update(`t\0${file.content || ''}\0`);
    }
  }
  return hash.digest('hex');
}

function runCompileWorker(files, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'compileWorker.js'), { workerData: { files, options }, execArgv: ['--no-warnings'] });
    let settled = false;
    worker.once('message', (message) => {
      settled = true;
      if (message.ok) resolve(message.html);
      else reject(Object.assign(new Error(message.error?.message || 'Preview compile failed.'), { filePath: message.error?.filePath }));
    });
    worker.once('error', (error) => { settled = true; reject(error); });
    worker.once('exit', (code) => { if (!settled && code !== 0) reject(new Error(`Preview compiler exited with code ${code}.`)); });
  });
}

// Text files must carry their full content (hydrated from object storage when offloaded). Binary assets are not
// needed to compile, only their paths, so they stay out of the worker message (tens of MB less to copy).
async function loadSource(projectId) {
  const project = await Project.findById(projectId).select('files updatedAt').lean();
  if (!project) return null;
  const raw = project.files || [];
  const text = await hydrateFiles(raw.filter((file) => file.encoding !== 'base64'));
  const binary = raw.filter((file) => file.encoding === 'base64');
  return { updatedAt: project.updatedAt, files: [...text, ...binary] };
}

/**
 * The compiled page goes to S3 (content-addressed: identical output is stored once) and the database keeps only the reference.
 * Without S3, or if the upload fails, it stays in the document exactly as before.
 */
async function storeHtml(html) {
  const storage = require('../storage/s3BlobStorage');
  if (storage.isConfigured()) {
    try { return { html: '', htmlBlob: await storage.uploadFile({ path: 'preview/index.html', content: html, encoding: 'utf8' }) }; }
    catch (error) { logger.warn(`Compiled preview could not be stored in S3, keeping it in the database: ${error.message}`); }
  }
  return { html, htmlBlob: null };
}

/** The compiled HTML of a stored preview, wherever it is kept. */
async function htmlOf(doc) {
  if (!doc) return '';
  if (doc.html) return doc.html;
  if (doc.htmlBlob?.provider === 's3') return (await require('../storage/s3BlobStorage').hydrateFile({ blob: doc.htmlBlob, content: '', encoding: 'utf8' })).content;
  return '';
}

/**
 * Checks the compiled page against the project's own files: every picture/font path the page mentions under one of the project's public
 * folders must exist. A path that does not exist is a picture that will be missing on screen, so it is recorded (and logged) at compile
 * time instead of being discovered by a visitor. Returns { checked, missingCount, missing[] }.
 */
const MEDIA_REF = /(?<![\w:/.%@-])\/((?:[\w.@%+-]+\/)+[\w.@%+-]+\.(?:png|jpe?g|webp|gif|svg|avif|ico|woff2?|ttf|otf|mp4|webm))(?![\w-])/gi;
function validateCompiledAssets(html, files = []) {
  const have = new Set();
  const folders = new Set();
  for (const file of files) {
    if (!file?.path?.startsWith('public/')) continue;
    const rest = file.path.slice('public/'.length);
    have.add(`/${rest}`);
    if (rest.includes('/')) folders.add(rest.split('/')[0]);
  }
  const seen = new Set();
  // The page refers to its own pictures as `${placeholder}/assets/...`: take the placeholder off so they are checked like plain paths.
  for (const match of String(html).split(ASSET_BASE_PLACEHOLDER).join('').matchAll(MEDIA_REF)) {
    const ref = `/${match[1]}`;
    if (folders.has(match[1].split('/')[0])) seen.add(ref.split('?')[0]);
  }
  const missing = [...seen].filter((ref) => !have.has(ref));
  return { checked: seen.size, missingCount: missing.length, missing: missing.slice(0, 50) };
}

async function compileProject(projectId) {
  const source = await loadSource(projectId);
  if (!source) return null;
  const sourceHash = previewSourceHash(source.files);
  const existing = await PrecompiledPreview.findOne({ projectId });
  if (existing && existing.sourceHash === sourceHash && existing.status !== 'failed' && existing.compilerVersion === COMPILER_VERSION) {
    // Source unchanged (e.g. only metadata was saved): keep the compiled document, just record it is current.
    if (!sameRevision(existing.sourceUpdatedAt, source.updatedAt)) await PrecompiledPreview.updateOne({ _id: existing._id }, { sourceUpdatedAt: source.updatedAt });
    return PrecompiledPreview.findById(existing._id);
  }

  const started = Date.now();
  const compileFiles = source.files.map((file) => (file.encoding === 'base64' ? { path: file.path, encoding: 'base64', content: '' } : file));
  let fields;
  try {
    const html = await runCompileWorker(compileFiles, { assetBase: ASSET_BASE_PLACEHOLDER, sourceMaps: false });
    const bytes = Buffer.byteLength(html, 'utf8');
    // Every public picture/font of the project may be served to this preview (binary files, and text SVGs, under public/). It used to
    // be only those whose path appeared literally in the page, which left out pictures named only in JSON data or built at run time.
    const assetPaths = source.files
      .filter((file) => (file.encoding === 'base64' || /\.svg$/i.test(file.path)) && file.path.startsWith('public/'))
      .map((file) => `/${file.path.slice('public/'.length)}`);
    const assetReport = validateCompiledAssets(html, source.files);
    if (assetReport.missingCount) logger.warn(`Compiled preview of project ${projectId} points at ${assetReport.missingCount} file(s) that do not exist, for example ${assetReport.missing.slice(0, 3).join(', ')}.`);
    fields = bytes > MAX_HTML_BYTES
      ? { status: 'skipped', html: '', htmlBlob: null, bytes, error: `Compiled preview is ${Math.round(bytes / 1048576)} MB; the editor will compile it in the browser instead.` }
      : { status: 'ready', ...(await storeHtml(html)), bytes, error: '' , assetPaths, assetReport };
  } catch (error) {
    // A source error (e.g. a syntax error) is not a hosting failure: remember it and let the editor show the live error.
    fields = { status: 'failed', html: '', htmlBlob: null, bytes: 0, error: String(error.message).slice(0, 2000) };
  }
  const doc = await PrecompiledPreview.findOneAndUpdate(
    { projectId },
    {
      $set: { ...fields, sourceHash, compilerVersion: COMPILER_VERSION, sourceUpdatedAt: source.updatedAt, compileMs: Date.now() - started, compiledAt: new Date() },
      // The token is stable for the life of the project so URLs held by an open editor stay valid across saves.
      $setOnInsert: { token: randomBytes(24).toString('hex') }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  logger.info(`Precompiled preview ${fields.status} for project ${projectId} in ${Date.now() - started}ms (${Math.round((fields.bytes || 0) / 1024)} KB)`);
  return doc;
}

/**
 * Compiles the project as it would look with `overrides` (text files replacing the current ones) WITHOUT saving anything: used to
 * look at an older revision before restoring it. Returns { html, token } (the token serves the project's pictures, as for the normal preview).
 */
async function compileWithOverrides(projectId, overrides = []) {
  const source = await loadSource(projectId);
  if (!source) return null;
  const replace = new Map(overrides.filter((file) => file && typeof file.path === 'string' && !file.deleted).map((file) => [file.path, file]));
  const merged = source.files.map((file) => (replace.has(file.path) ? { ...file, content: replace.get(file.path).content, encoding: undefined } : file));
  for (const [filePath, file] of replace) if (!merged.some((item) => item.path === filePath)) merged.push({ path: filePath, content: file.content, language: file.language || 'plaintext' });
  const compileFiles = merged.map((file) => (file.encoding === 'base64' ? { path: file.path, encoding: 'base64', content: '' } : file));
  const html = await runCompileWorker(compileFiles, { assetBase: ASSET_BASE_PLACEHOLDER, sourceMaps: false });
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('This revision is too large to preview.');
  const doc = await ensurePrecompiled(projectId);
  // The older version may show pictures the current one no longer does: let the preview's token serve them too.
  const assetPaths = source.files
    .filter((file) => (file.encoding === 'base64' || /\.svg$/i.test(file.path)) && file.path.startsWith('public/'))
    .map((file) => `/${file.path.slice('public/'.length)}`)
    .filter((publicPath) => html.includes(publicPath));
  if (doc?.token && assetPaths.length) await PrecompiledPreview.updateOne({ projectId }, { $addToSet: { assetPaths: { $each: assetPaths } } });
  return { html, token: doc?.token || null };
}

/**
 * Compiles a complete, given set of files as the project's website WITHOUT saving anything (used to look at an older version).
 * Text files carry their content; binary files may be references (they are not needed to compile). Returns { html, token }.
 */
async function compileFilesPreview(projectId, files = []) {
  const compileFiles = files.map((file) => (file.encoding === 'base64' ? { path: file.path, encoding: 'base64', content: '' } : { path: file.path, content: file.content || '', language: file.language }));
  const html = await runCompileWorker(compileFiles, { assetBase: ASSET_BASE_PLACEHOLDER, sourceMaps: false });
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('This version is too large to preview.');
  const doc = await ensurePrecompiled(projectId);
  // The version may show pictures the current site no longer does: let the preview's token serve them too (they are stored with the project).
  const stored = await Project.findById(projectId).select('files.path').lean();
  const have = new Set((stored?.files || []).map((file) => file.path));
  const assetPaths = files.filter((file) => file.encoding === 'base64' && file.path.startsWith('public/') && have.has(file.path)).map((file) => `/${file.path.slice('public/'.length)}`).filter((publicPath) => html.includes(publicPath));
  if (doc?.token && assetPaths.length) await PrecompiledPreview.updateOne({ projectId }, { $addToSet: { assetPaths: { $each: assetPaths } } });
  return { html, token: doc?.token || null };
}

/** Returns an up-to-date stored preview, compiling it first if the source changed. Concurrent callers share one compile. */
async function ensurePrecompiled(projectId, { light = false } = {}) {
  const key = String(projectId);
  if (light && !inFlight.has(key)) {
    // Callers that only need the token (the editor view) never load the stored HTML (1-4 MB): just check it is current.
    const stamp = await Project.findById(key).select('updatedAt').lean();
    if (!stamp) return null;
    const fresh = await PrecompiledPreview.findOne({ projectId: key }).select('token status compilerVersion sourceUpdatedAt').lean();
    if (fresh && fresh.status !== 'failed' && fresh.compilerVersion === COMPILER_VERSION && sameRevision(fresh.sourceUpdatedAt, stamp.updatedAt)) return fresh;
  }
  if (scheduled.has(key)) { clearTimeout(scheduled.get(key)); scheduled.delete(key); }
  if (!inFlight.has(key)) {
    // Fast path: the stored preview was built from the project's current revision, nothing to load or hash.
    const run = (async () => {
      const stamp = await Project.findById(key).select('updatedAt').lean();
      if (!stamp) return null;
      const existing = await PrecompiledPreview.findOne({ projectId: key });
      if (existing && existing.status !== 'failed' && existing.compilerVersion === COMPILER_VERSION && sameRevision(existing.sourceUpdatedAt, stamp.updatedAt)) return existing;
      return compileProject(key);
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, run);
  }
  return inFlight.get(key);
}

/** Called after every project save: compile in the background shortly after the last change. */
function schedulePrecompile(projectId) {
  const key = String(projectId);
  if (process.env.PRECOMPILE_PREVIEWS === 'false') return;
  if (scheduled.has(key)) clearTimeout(scheduled.get(key));
  const timer = setTimeout(() => {
    scheduled.delete(key);
    ensurePrecompiled(key).catch((error) => logger.warn(`Precompile of project ${key} failed: ${error.message}`));
  }, SCHEDULE_DELAY_MS);
  if (typeof timer.unref === 'function') timer.unref();
  scheduled.set(key, timer);
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf', json: 'application/json',
  css: 'text/css; charset=utf-8', txt: 'text/plain; charset=utf-8'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One public asset of a project, found by the preview's capability token. Returns null only when the file really does not exist;
 * a storage hiccup is retried and then thrown (the route answers 503 so the browser can try again), never reported as "not found".
 */
async function readPreviewAsset(token, assetPath) {
  if (!/^[a-f0-9]{48}$/.test(String(token))) return null;
  const clean = String(assetPath || '').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\0]/.test(clean)) return null;
  const preview = await PrecompiledPreview.findOne({ token }).select('projectId assetPaths').lean();
  if (!preview) return null;
  // Only files under public/ are ever served. A file the compiled page did not list (added since, or named only in data) is still served
  // if it exists: the token is the access check, and everything under public/ is the site's public content anyway.
  const project = await Project.findOne({ _id: preview.projectId, 'files.path': `public/${clean}` }, { 'files.$': 1 }).lean();
  const stored = project?.files?.[0];
  if (!stored) return null;
  if (!preview.assetPaths.includes(`/${clean}`)) await PrecompiledPreview.updateOne({ _id: preview._id }, { $addToSet: { assetPaths: `/${clean}` } }).catch(() => {});
  let file;
  for (let attempt = 0; ; attempt += 1) {
    try { file = await hydrateFile(stored); break; } catch (error) {
      if (attempt >= 2) throw Object.assign(new Error(`The picture ${clean} could not be read from storage.`), { statusCode: 503, transient: true, cause: error });
      await sleep(150 * (attempt + 1));
    }
  }
  const buffer = file.encoding === 'base64' ? Buffer.from(file.content || '', 'base64') : Buffer.from(file.content || '', 'utf8');
  const extension = clean.split('.').pop().toLowerCase();
  return { buffer, contentType: MIME[extension] || require('../storage/s3BlobStorage').contentTypeForPath(clean) };
}

/** Compiles a template's own files (no project, nothing saved) for the New Site preview. */
const compileTemplateFiles = (files) => runCompileWorker(files.map((file) => ({ path: file.path, content: file.content || '', language: file.language })), { assetBase: ASSET_BASE_PLACEHOLDER, sourceMaps: false });

module.exports = { validateCompiledAssets, htmlOf, compileTemplateFiles, compileFilesPreview, compileWithOverrides, ensurePrecompiled, schedulePrecompile, previewSourceHash, readPreviewAsset, ASSET_BASE_PLACEHOLDER };
