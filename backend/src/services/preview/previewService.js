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
    const { frontendRoot } = require('./offlineCompile');
    return createHash('sha1').update(require('node:fs').readFileSync(path.join(frontendRoot, 'src/utils/codeTransformer.js'))).digest('hex').slice(0, 16);
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
    // Public binary files the document actually references (listed in the asset shim / rewritten in CSS).
    const assetPaths = source.files
      .filter((file) => file.encoding === 'base64' && file.path.startsWith('public/'))
      .map((file) => `/${file.path.slice('public/'.length)}`)
      .filter((publicPath) => html.includes(publicPath));
    fields = bytes > MAX_HTML_BYTES
      ? { status: 'skipped', html: '', bytes, error: `Compiled preview is ${Math.round(bytes / 1048576)} MB; the editor will compile it in the browser instead.` }
      : { status: 'ready', html, bytes, error: '' , assetPaths };
  } catch (error) {
    // A source error (e.g. a syntax error) is not a hosting failure: remember it and let the editor show the live error.
    fields = { status: 'failed', html: '', bytes: 0, error: String(error.message).slice(0, 2000) };
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

/** Returns an up-to-date stored preview, compiling it first if the source changed. Concurrent callers share one compile. */
async function ensurePrecompiled(projectId) {
  const key = String(projectId);
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

/** One public asset of a project, found by the preview's capability token. */
async function readPreviewAsset(token, assetPath) {
  if (!/^[a-f0-9]{48}$/.test(String(token))) return null;
  const clean = String(assetPath || '').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((part) => !part || part === '.' || part === '..') || /[\\\0]/.test(clean)) return null;
  const preview = await PrecompiledPreview.findOne({ token }).select('projectId assetPaths').lean();
  if (!preview || !preview.assetPaths.includes(`/${clean}`)) return null; // only files the compiled preview actually references
  const project = await Project.findOne({ _id: preview.projectId, 'files.path': `public/${clean}` }, { 'files.$': 1 }).lean();
  const stored = project?.files?.[0];
  if (!stored) return null;
  const file = await hydrateFile(stored);
  const buffer = file.encoding === 'base64' ? Buffer.from(file.content || '', 'base64') : Buffer.from(file.content || '', 'utf8');
  const extension = clean.split('.').pop().toLowerCase();
  return { buffer, contentType: MIME[extension] || 'application/octet-stream' };
}

module.exports = { ensurePrecompiled, schedulePrecompile, previewSourceHash, readPreviewAsset, ASSET_BASE_PLACEHOLDER };
