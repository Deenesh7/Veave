/**
 * Veave Template Service
 *
 * Templates are reusable, versioned website starting points. They are stored in MongoDB (collection `templatedefinitions`,
 * one document per template version) and their images in S3; no template lives in the backend source tree.
 *
 *   manifest   template.json (metadata, design tokens, typography, layout, components, pages, features, dependencies)
 *   files      the approved scaffold (a complete React + Vite + Tailwind project), text files
 *   assets     scaffold images (public/**) as S3 references, and the gallery preview
 *
 * `preload()` reads everything once at startup into an in-memory registry; lookups stay synchronous. Templates are added with
 * `npm run templates:import -- <directory>` (scripts/import-templates.cjs). For tests and tooling, `configure({ root })`
 * (or VEAVE_TEMPLATES_DIR) reads the same layout from a directory instead:
 *
 *   <root>/<templateId>/<version>/{template.json, preview.svg, files/, assets.json}
 *
 * The service is the only code that reads templates. Callers identify a template by its stable id (and optionally a
 * version), never by a path: ids are looked up in an in-memory registry, so a client can not make the server read an arbitrary
 * file. Registry data is deep-frozen; `instantiateFiles` always returns fresh copies, so generating or editing a project can
 * never change the stored template.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_SCHEMA_VERSIONS = [1];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CATEGORIES = ['Portfolio', 'SaaS', 'Business', 'E-commerce', 'Education', 'Blog', 'Landing Page'];
const COLOR_KEYS = ['bg', 'surface', 'surface2', 'line', 'fg', 'muted', 'brand', 'onBrand', 'accent'];
const CSS_VARS = { bg: '--bg', surface: '--surface', surface2: '--surface-2', line: '--line', fg: '--fg', muted: '--muted', brand: '--brand', onBrand: '--on-brand' };
// Packages a generated project may depend on (the same registry the validation sandbox accepts).
const ALLOWED_DEPENDENCIES = new Set([
  'react', 'react-dom', 'react-router-dom', 'lucide-react', 'framer-motion', 'gsap', 'clsx', 'axios', 'recharts', 'react-icons', 'date-fns',
  '@vitejs/plugin-react', 'autoprefixer', 'postcss', 'tailwindcss', 'vite'
]);

class TemplateError extends Error {
  constructor(message, code = 'TEMPLATE_INVALID', status = 422, details = null) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// Template images (the gallery preview and public/images/*) are not kept in the repo or on the backend disk: each template
// version lists them in assets.json with their S3 location. preloadAssets() downloads them once at startup into this cache.
const assetCache = new Map(); // "<id>@<version>" -> Map<path relative to the version directory, text content>
const ASSET_MANIFEST = 'assets.json';

// null = templates come from MongoDB (preload()); a directory = read from disk (tests, import tooling).
let registryRoot = process.env.VEAVE_TEMPLATES_DIR || null;
let registry = null; // Map<id, { latest: version, versions: Map<version, template> }>

/* ------------------------------ loading ------------------------------ */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

function safeRelativePath(relative) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.includes('\\') || /^[a-zA-Z]:/.test(relative)) return false;
  const parts = relative.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..' && part !== '.git' && part !== 'node_modules');
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new TemplateError(`Template scaffold must not contain symbolic links: ${path.relative(base, full)}`);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function languageOf(file) {
  if (/\.(?:jsx?|mjs|cjs)$/.test(file)) return 'javascript';
  if (/\.tsx?$/.test(file)) return 'typescript';
  if (file.endsWith('.css')) return 'css';
  if (file.endsWith('.json')) return 'json';
  if (/\.(?:html|svg)$/.test(file)) return 'html';
  if (file.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

/** Returns the list of problems with a manifest (empty when valid). */
function validateManifest(manifest) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['The manifest must be a JSON object.'];
  need(SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion), `Unsupported schemaVersion ${manifest.schemaVersion}; supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`);
  need(typeof manifest.id === 'string' && ID_PATTERN.test(manifest.id), 'id must be a stable slug (lowercase letters, digits, hyphens).');
  need(typeof manifest.version === 'string' && VERSION_PATTERN.test(manifest.version), 'version must look like 1.0.0.');
  need(typeof manifest.name === 'string' && manifest.name.trim(), 'name is required.');
  need(typeof manifest.description === 'string' && manifest.description.trim(), 'description is required.');
  need(CATEGORIES.includes(manifest.category), `category must be one of: ${CATEGORIES.join(', ')}.`);
  need(Array.isArray(manifest.tags) && Array.isArray(manifest.styleTags), 'tags and styleTags must be arrays.');
  need(['published', 'draft', 'deprecated'].includes(manifest.status), 'status must be published, draft or deprecated.');
  need(manifest.access && ['public', 'restricted'].includes(manifest.access.visibility), 'access.visibility must be public or restricted.');
  need(typeof manifest.previewImage === 'string' && safeRelativePath(manifest.previewImage), 'previewImage must be a safe relative path.');
  const colors = manifest.designTokens?.colors;
  need(colors && COLOR_KEYS.every((key) => /^#[0-9a-f]{6}$/i.test(colors[key] || '')), `designTokens.colors needs hex values for: ${COLOR_KEYS.join(', ')}.`);
  need(manifest.designTokens?.radius?.card && manifest.designTokens?.radius?.button, 'designTokens.radius.card and .button are required.');
  need(manifest.typography?.headingFont && manifest.typography?.bodyFont, 'typography.headingFont and bodyFont are required.');
  need(manifest.layout && manifest.spacing && manifest.responsive, 'layout, spacing and responsive rules are required.');
  need(Array.isArray(manifest.components) && manifest.components.length > 0, 'components must list the template components.');
  need(Array.isArray(manifest.pages) && manifest.pages.length > 0 && manifest.pages.every((page) => typeof page.path === 'string' && page.path.startsWith('/') && safeRelativePath(page.file || '')), 'pages need a route path and a source file.');
  need(Array.isArray(manifest.features), 'features must be an array.');
  need(manifest.dependencies && typeof manifest.dependencies === 'object' && manifest.dependencies.react, 'dependencies must include react.');
  for (const name of Object.keys(manifest.dependencies || {})) need(ALLOWED_DEPENDENCIES.has(name), `Dependency "${name}" is not on the supported package list.`);
  need(manifest.scaffold && manifest.scaffold.dir === 'files' && Array.isArray(manifest.scaffold.requiredFiles) && manifest.scaffold.requiredFiles.every(safeRelativePath), 'scaffold.dir must be "files" and scaffold.requiredFiles must be safe paths.');
  need(Array.isArray(manifest.scaffold?.protectedFiles) && Array.isArray(manifest.scaffold?.sharedFiles) && Array.isArray(manifest.scaffold?.promptFiles), 'scaffold.protectedFiles, sharedFiles and promptFiles are required.');
  return errors;
}

function readAssetManifest(dir) {
  const file = path.join(dir, ASSET_MANIFEST);
  if (!fs.existsSync(file)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(file, 'utf8')).assets;
    return Array.isArray(entries) ? entries.filter((entry) => entry && safeRelativePath(entry.path) && entry.blob?.provider === 's3') : [];
  } catch { return []; }
}

/** Downloads every template image listed in an assets.json from S3 into memory. Call once before the server starts. */
async function preloadAssets({ root = registryRoot } = {}) {
  const { hydrateFile } = require('../storage/s3BlobStorage');
  let loaded = 0;
  if (!fs.existsSync(root)) return loaded;
  for (const id of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    for (const version of fs.readdirSync(path.join(root, id), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      const entries = readAssetManifest(path.join(root, id, version));
      if (!entries.length) continue;
      const cache = new Map();
      await Promise.all(entries.map(async (entry) => {
        if (fs.existsSync(path.join(root, id, version, entry.path))) return; // a local copy (development) wins
        const file = await hydrateFile({ path: entry.path, encoding: 'utf8', content: '', blob: entry.blob });
        cache.set(entry.path, file.content);
        loaded += 1;
      }));
      assetCache.set(`${id}@${version}`, cache);
    }
  }
  loadRegistry({ force: true });
  return loaded;
}

/** Test hook: fills the image cache with placeholders so tests run without S3. */
function stubAssetsForTests({ root = registryRoot } = {}) {
  for (const id of fs.readdirSync(root)) {
    for (const version of fs.readdirSync(path.join(root, id))) {
      const cache = new Map();
      for (const entry of readAssetManifest(path.join(root, id, version))) cache.set(entry.path, `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><title>${entry.path}</title></svg>`);
      assetCache.set(`${id}@${version}`, cache);
    }
  }
  registry = null;
}

/** Validates a template's manifest, scaffold and preview and returns the frozen template. `files` is Map<path, { path, content, language, hash }>. */
function assembleTemplate(manifest, files, preview) {
  const errors = validateManifest(manifest);
  if (errors.length) throw new TemplateError(`Template "${manifest?.id || 'unknown'}" has an invalid manifest: ${errors.join(' ')}`, 'TEMPLATE_INVALID', 422, errors);
  const missing = manifest.scaffold.requiredFiles.filter((file) => !files.has(file));
  if (missing.length) throw new TemplateError(`Template ${manifest.id}@${manifest.version} is missing required files: ${missing.join(', ')}`, 'TEMPLATE_INVALID', 422, missing);
  for (const page of manifest.pages) if (!files.has(page.file)) throw new TemplateError(`Template ${manifest.id}@${manifest.version} page ${page.path} points to a missing file ${page.file}.`);
  for (const component of manifest.components) if (!files.has(component.path)) throw new TemplateError(`Template ${manifest.id}@${manifest.version} component ${component.name} points to a missing file ${component.path}.`);
  for (const file of [...manifest.scaffold.protectedFiles, ...manifest.scaffold.sharedFiles, ...manifest.scaffold.promptFiles]) {
    if (!files.has(file)) throw new TemplateError(`Template ${manifest.id}@${manifest.version} lists ${file} but the scaffold does not contain it.`);
  }
  // Required dependencies must really be declared by the scaffold's own package.json.
  let declared = {};
  try {
    const pkg = JSON.parse(files.get('package.json').content);
    declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  } catch { throw new TemplateError(`Template ${manifest.id}@${manifest.version} has an unreadable package.json.`); }
  const undeclared = Object.keys(manifest.dependencies).filter((name) => !declared[name]);
  if (undeclared.length) throw new TemplateError(`Template ${manifest.id}@${manifest.version} requires ${undeclared.join(', ')} but its package.json does not declare them.`, 'TEMPLATE_DEPENDENCY_MISSING', 422, undeclared);
  if (preview === null || preview === undefined) throw new TemplateError(`Template ${manifest.id}@${manifest.version} has no preview image (${manifest.previewImage}).`);
  return deepFreeze({ ...manifest, _files: files, _preview: preview, _contentHash: sha([...files.values()].map((file) => `${file.path}:${file.hash}`).join('\n')) });
}

const fileEntry = (relative, content) => ({ path: relative, content, language: languageOf(relative), hash: sha(content) });

/** Reads one template version from a directory (test fixtures and the import script). Returns { manifest, files, preview }. */
function readTemplateDirectory(dir) {
  const manifestPath = path.join(dir, 'template.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new TemplateError(`Template manifest could not be read (${path.basename(path.dirname(dir))}/${path.basename(dir)}): ${error.message}`);
  }
  const errors = validateManifest(manifest);
  if (errors.length) throw new TemplateError(`Template "${manifest?.id || path.basename(path.dirname(dir))}" has an invalid manifest: ${errors.join(' ')}`, 'TEMPLATE_INVALID', 422, errors);
  if (path.basename(path.dirname(dir)) !== manifest.id || path.basename(dir) !== manifest.version) {
    throw new TemplateError(`Template directory ${path.basename(path.dirname(dir))}/${path.basename(dir)} does not match its manifest (${manifest.id}@${manifest.version}).`);
  }
  const filesDir = path.join(dir, manifest.scaffold.dir);
  if (!fs.existsSync(filesDir)) throw new TemplateError(`Template ${manifest.id}@${manifest.version} has no scaffold directory.`);
  const files = new Map();
  for (const relative of walk(filesDir).sort()) {
    if (!safeRelativePath(relative)) throw new TemplateError(`Template ${manifest.id}@${manifest.version} contains an unsafe path: ${relative}`);
    files.set(relative, fileEntry(relative, fs.readFileSync(path.join(filesDir, relative), 'utf8')));
  }
  // Images that live in S3 instead of on disk.
  const remote = assetCache.get(`${manifest.id}@${manifest.version}`) || new Map();
  for (const entry of readAssetManifest(dir)) {
    if (!entry.path.startsWith(`${manifest.scaffold.dir}/`) || files.has(entry.path.slice(manifest.scaffold.dir.length + 1))) continue;
    const content = remote.get(entry.path);
    if (content === undefined) throw new TemplateError(`Template ${manifest.id}@${manifest.version} image ${entry.path} is stored in S3 but was not loaded. Check the S3 settings.`, 'TEMPLATE_ASSET_MISSING', 503);
    const relative = entry.path.slice(manifest.scaffold.dir.length + 1);
    files.set(relative, fileEntry(relative, content));
  }
  const previewPath = path.join(dir, manifest.previewImage);
  const preview = fs.existsSync(previewPath) ? fs.readFileSync(previewPath, 'utf8') : (remote.get(manifest.previewImage) ?? null);
  return { manifest, files, preview };
}

function loadTemplateVersion(dir) {
  const { manifest, files, preview } = readTemplateDirectory(dir);
  return assembleTemplate(manifest, files, preview);
}

function addToRegistry(next, template) {
  const entry = next.get(template.id) || { versions: new Map(), latest: null };
  entry.versions.set(template.version, template);
  next.set(template.id, entry);
}

function finishRegistry(next, problems) {
  for (const entry of next.values()) {
    const published = [...entry.versions.values()].filter((template) => template.status === 'published').map((template) => template.version);
    entry.latest = published.sort(compareVersions).at(-1) || null;
  }
  next.problems = problems;
  return next;
}

/** Loads every template from MongoDB (text files) and S3 (images) into the in-memory registry. Call once at startup. */
async function loadFromDatabase() {
  const TemplateDefinition = require('../../models/TemplateDefinition');
  const { hydrateFile } = require('../storage/s3BlobStorage');
  const docs = await TemplateDefinition.find({}).lean();
  const next = new Map();
  const problems = [];
  for (const doc of docs) {
    try {
      const manifest = doc.manifest;
      if (manifest?.id !== doc.templateId || manifest?.version !== doc.version) throw new TemplateError(`Template document ${doc.templateId}@${doc.version} does not match its manifest.`);
      const files = new Map();
      for (const file of doc.files || []) {
        if (!safeRelativePath(file.path)) throw new TemplateError(`Template ${doc.templateId}@${doc.version} contains an unsafe path: ${file.path}`);
        files.set(file.path, fileEntry(file.path, file.content));
      }
      await Promise.all((doc.assets || []).map(async (asset) => {
        if (!safeRelativePath(asset.path)) throw new TemplateError(`Template ${doc.templateId}@${doc.version} contains an unsafe path: ${asset.path}`);
        const stored = await hydrateFile({ path: asset.path, encoding: 'utf8', content: '', blob: asset.blob });
        files.set(asset.path, fileEntry(asset.path, stored.content));
      }));
      const preview = doc.preview?.blob ? (await hydrateFile({ path: manifest.previewImage, encoding: 'utf8', content: '', blob: doc.preview.blob })).content : null;
      addToRegistry(next, assembleTemplate(manifest, files, preview));
    } catch (error) {
      problems.push({ id: doc.templateId, version: doc.version, code: error.code || 'TEMPLATE_INVALID', message: error.message });
    }
  }
  return finishRegistry(next, problems);
}

/** Startup: load the templates from their source (MongoDB, or the directory set by VEAVE_TEMPLATES_DIR). Returns how many versions loaded. */
async function preload() {
  if (registryRoot) { await preloadAssets({ root: registryRoot }); loadRegistry({ force: true }); }
  else registry = await loadFromDatabase();
  return [...registry.values()].reduce((sum, entry) => sum + entry.versions.size, 0);
}

function loadRegistry({ root = registryRoot, force = false } = {}) {
  if (!root) { if (!registry) { registry = finishRegistry(new Map(), []); } return registry; } // MongoDB mode: filled by preload()
  if (registry && !force && root === registryRoot) return registry;
  const next = new Map();
  const problems = [];
  if (fs.existsSync(root)) {
    for (const id of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      for (const version of fs.readdirSync(path.join(root, id), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
        try {
          addToRegistry(next, loadTemplateVersion(path.join(root, id, version)));
        } catch (error) {
          problems.push({ id, version, code: error.code || 'TEMPLATE_INVALID', message: error.message });
        }
      }
    }
  }
  finishRegistry(next, problems);
  registryRoot = root;
  registry = next;
  return registry;
}

/** Test and tooling hook: point the service at another directory (or null to use the default) and reload. */
function configure({ root = null } = {}) {
  registryRoot = root || process.env.VEAVE_TEMPLATES_DIR || null;
  registry = null;
  return loadRegistry();
}

/* ------------------------------ lookup ------------------------------ */

function userMayUse(template, user) {
  if (template.access.visibility === 'public') return true;
  const userId = String(user?.id || user?._id || user || '');
  if (!userId || userId === 'undefined') return false;
  if ((template.access.allowedUserIds || []).includes(userId)) return true;
  const plan = user?.plan || user?.subscription?.plan;
  return Boolean(plan && (template.access.allowedPlans || []).includes(plan));
}

/**
 * Resolves a template for a user, or throws a TemplateError with a precise code:
 * TEMPLATE_NOT_FOUND, TEMPLATE_FORBIDDEN, TEMPLATE_UNSUPPORTED_VERSION, TEMPLATE_INVALID, TEMPLATE_DEPENDENCY_MISSING.
 */
function resolveTemplate(id, { version = null, user = null } = {}) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TemplateError('A valid template id is required.', 'TEMPLATE_NOT_FOUND', 404);
  if (version !== null && version !== undefined && (typeof version !== 'string' || !VERSION_PATTERN.test(version))) {
    throw new TemplateError(`Template version "${String(version).slice(0, 20)}" is not valid.`, 'TEMPLATE_UNSUPPORTED_VERSION', 422);
  }
  const entries = loadRegistry();
  const entry = entries.get(id);
  if (!entry) {
    const broken = (entries.problems || []).find((problem) => problem.id === id);
    if (broken) throw new TemplateError(broken.message, broken.code, 422);
    throw new TemplateError(`Template "${id}" does not exist.`, 'TEMPLATE_NOT_FOUND', 404);
  }
  if (!version && !entry.latest) throw new TemplateError(`Template "${id}" is not published.`, 'TEMPLATE_NOT_FOUND', 404);
  const wanted = version || entry.latest;
  const template = wanted ? entry.versions.get(wanted) : null;
  if (!template) throw new TemplateError(`Template "${id}" has no ${version ? `version ${version}` : 'published version'}.`, 'TEMPLATE_UNSUPPORTED_VERSION', 422);
  if (template.status === 'draft') throw new TemplateError(`Template "${id}" is not published yet.`, 'TEMPLATE_NOT_FOUND', 404);
  if (!userMayUse(template, user)) throw new TemplateError(`Template "${id}" is not available to this account.`, 'TEMPLATE_FORBIDDEN', 403);
  return template;
}

const summarize = (template) => ({
  id: template.id,
  version: template.version,
  name: template.name,
  description: template.description,
  category: template.category,
  tags: template.tags,
  styleTags: template.styleTags,
  features: template.features,
  pageCount: template.pages.length,
  palette: [template.designTokens.colors.bg, template.designTokens.colors.surface, template.designTokens.colors.brand, template.designTokens.colors.accent],
  featured: Boolean(template.featured),
  popularity: template.popularity || 0,
  releasedAt: template.releasedAt || null,
  previewUrl: `/api/templates/${template.id}/preview?version=${template.version}`
});

function listTemplates({ user = null, category = null, q = '', sort = 'featured' } = {}) {
  const entries = loadRegistry();
  let items = [];
  for (const entry of entries.values()) {
    const template = entry.latest ? entry.versions.get(entry.latest) : null;
    if (template && !template.hidden && userMayUse(template, user)) items.push(template);
  }
  if (category) items = items.filter((template) => template.category.toLowerCase() === String(category).toLowerCase());
  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    items = items.filter((template) => [template.name, template.description, template.category, ...template.tags, ...template.styleTags].join(' ').toLowerCase().includes(needle));
  }
  const sorters = {
    featured: (a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name),
    newest: (a, b) => String(b.releasedAt || '').localeCompare(String(a.releasedAt || '')) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    popular: (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name)
  };
  items.sort(sorters[sort] || sorters.featured);
  return items.map(summarize);
}

function listCategories({ user = null } = {}) {
  const counts = new Map();
  for (const template of listTemplates({ user })) counts.set(template.category, (counts.get(template.category) || 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

function describeTemplate(template) {
  return {
    ...summarize(template),
    designTokens: template.designTokens,
    typography: template.typography,
    layout: template.layout,
    spacing: template.spacing,
    responsive: template.responsive,
    components: template.components,
    pages: template.pages,
    dependencies: template.dependencies,
    files: [...template._files.values()].map((file) => ({ path: file.path, size: file.content.length })),
    contentHash: template._contentHash
  };
}

function getPreviewImage(template) {
  return { contentType: 'image/svg+xml', body: template._preview };
}

/* ------------------------------ instantiation ------------------------------ */

/** Fresh, independent copies of the template's scaffold files (safe to mutate; the stored template never changes). */
function instantiateFiles(template) {
  return [...template._files.values()].map((file) => ({ path: file.path, content: String(file.content), language: file.language, encoding: 'utf8' }));
}

/** Confirms the stored template still matches what was loaded from disk (used by tests and as a safety net). */
function verifyIntegrity(template) {
  const files = [...template._files.values()];
  return sha(files.map((file) => `${file.path}:${sha(file.content)}`).join('\n')) === template._contentHash;
}

/* ------------------------------ design tokens ------------------------------ */

const hexToChannels = (hex) => {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(' ');
};

function tokensFromTemplate(template) {
  const colors = template.designTokens.colors;
  return {
    mood: template.designTokens.mood || template.name,
    primary: colors.brand,
    secondary: colors.muted,
    bg: colors.bg,
    cardBg: colors.surface,
    text: colors.fg,
    border: colors.line,
    accent: colors.accent,
    radius: template.designTokens.radius.card,
    font: template.typography.bodyFont
  };
}

/**
 * Token precedence: (1) explicit design requirements in the prompt are applied by the model on top of the result,
 * (2) explicit colour or design-token overrides from the request replace the template values, (3) the template's tokens,
 * (4) system defaults for any value the template does not define.
 * `overrides` uses the system token shape ({ primary, bg, text, ... }); only keys that are present replace template values.
 */
function resolveTokens(template, overrides = null, defaults = {}) {
  const base = { ...defaults, ...tokensFromTemplate(template) };
  if (!overrides || typeof overrides !== 'object') return { tokens: base, source: 'template', overridden: [] };
  const overridden = [];
  const tokens = { ...base };
  for (const key of ['primary', 'secondary', 'bg', 'cardBg', 'text', 'border', 'accent', 'radius', 'font']) {
    if (overrides[key] && overrides[key] !== base[key]) { tokens[key] = overrides[key]; overridden.push(key); }
  }
  if (overridden.length && overrides.mood) tokens.mood = overrides.mood;
  return { tokens, source: overridden.length ? 'template+overrides' : 'template', overridden };
}

const tokensToCssVars = (tokens, template) => {
  const colors = template.designTokens.colors;
  const vars = {
    '--bg': tokens.bg || colors.bg,
    '--surface': tokens.cardBg || colors.surface,
    '--surface-2': tokens.surface2 || colors.surface2,
    '--line': tokens.border || colors.line,
    '--fg': tokens.text || colors.fg,
    '--muted': tokens.secondary || colors.muted,
    '--brand': tokens.primary || colors.brand,
    '--on-brand': tokens.onPrimary || colors.onBrand
  };
  return Object.fromEntries(Object.entries(vars).map(([name, hex]) => [name, hexToChannels(hex)]).filter(([, value]) => value));
};

const rootBlock = /:root\s*\{[^}]*\}/;

/** Writes the resolved tokens into the candidate's theme file (src/index.css :root) and src/tokens.json. Pure: returns new files. */
function applyTokensToFiles(files, template, tokens) {
  const vars = tokensToCssVars(tokens, template);
  const themeFile = template.scaffold.themeFile || 'src/index.css';
  const out = files.map((file) => ({ ...file }));
  const css = out.find((file) => file.path === themeFile);
  if (css) {
    const block = rootBlock.exec(css.content);
    let body = block ? block[0] : ':root {\n}';
    const declared = { ...vars, ...(tokens.radius ? { '--radius-card': tokens.radius } : {}) };
    for (const [name, value] of Object.entries(declared)) {
      const declaration = new RegExp(`(${name.replace(/[-]/g, '\\-')}\\s*:\\s*)[^;]+;`);
      body = declaration.test(body) ? body.replace(declaration, `$1${value};`) : body.replace(/\}\s*$/, `  ${name}: ${value};\n}`);
    }
    css.content = block ? css.content.replace(rootBlock, body) : `${css.content}\n${body}\n`;
  }
  const tokensJson = JSON.stringify({ template: { id: template.id, version: template.version }, ...tokens, cssVariables: vars }, null, 2);
  const existing = out.find((file) => file.path === 'src/tokens.json');
  if (existing) existing.content = tokensJson;
  else out.push({ path: 'src/tokens.json', content: tokensJson, language: 'json', encoding: 'utf8' });
  return out;
}

/* ------------------------------ prompt context ------------------------------ */

const exportsOf = (content) => {
  const names = [];
  if (/export\s+default/.test(content)) names.push('default');
  for (const match of content.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z0-9_$]+)/g)) names.push(match[1]);
  return names.join(', ') || 'none';
};

/** Structured template context for contextBuilder: tokens, structure, summaries and the rules for what to keep or change. */
function buildPromptContext(template, { tokens = null, tokenSource = 'template', overridden = [] } = {}) {
  const resolved = tokens || tokensFromTemplate(template);
  const vars = tokensToCssVars(resolved, template);
  const roleOf = new Map(template.components.map((component) => [component.path, component]));
  const pageOf = new Map(template.pages.map((page) => [page.file, page]));
  const summaries = [...template._files.values()]
    .filter((file) => /^src\/.*\.(?:jsx?|css|json)$/.test(file.path))
    .map((file) => {
      const component = roleOf.get(file.path);
      const page = pageOf.get(file.path);
      const role = component ? `${component.role}${component.shared ? ' (shared)' : ''}` : page ? `page ${page.path}` : file.path === 'src/index.css' ? 'theme variables and Tailwind entry' : 'support file';
      return `- ${file.path} | ${file.content.split('\n').length} lines | ${role} | exports: ${exportsOf(file.content)}`;
    });
  const shown = template.scaffold.promptFiles.map((file) => `// File: ${file}\n${template._files.get(file).content}`).join('\n\n');
  return [
    '=== SELECTED TEMPLATE (THE REAL STARTING POINT) ===',
    `Template: ${template.name} | id: ${template.id} | version: ${template.version} | category: ${template.category}`,
    `Style: ${template.styleTags.join(', ')}. Features: ${template.features.join(', ')}.`,
    'The project ALREADY CONTAINS every template file listed below. You are customising this template into the website the user describes. You are NOT creating a new project and must not regenerate the template from scratch.',
    '',
    `DESIGN TOKENS (source: ${tokenSource}${overridden.length ? `; overridden by the user's custom design: ${overridden.join(', ')}` : ''}):`,
    ...Object.entries({ Mood: resolved.mood, Primary: resolved.primary, Secondary: resolved.secondary, Background: resolved.bg, Surface: resolved.cardBg, Text: resolved.text, Border: resolved.border, Accent: resolved.accent, 'Card radius': resolved.radius, Font: resolved.font }).map(([key, value]) => `- ${key}: ${value}`),
    `CSS variables already set in ${template.scaffold.themeFile || 'src/index.css'} :root (RGB channels): ${Object.entries(vars).map(([name, value]) => `${name}: ${value}`).join('; ')}`,
    'Use the semantic Tailwind colours (bg, surface, surface-2, line, fg, muted, brand, on-brand); do not hard-code new colours when a token fits.',
    `TYPOGRAPHY: headings ${template.typography.headingFont}; body ${template.typography.bodyFont}; ${template.typography.scale || ''}`.trim(),
    `LAYOUT: ${template.layout.summary}. Container ${template.layout.container}; section spacing ${template.spacing.section}; grid gap ${template.spacing.gap}.`,
    `RESPONSIVE: ${template.responsive.summary}`,
    '',
    'PAGES AND ROUTES (registered in src/App.jsx, listed in src/data/site.js):',
    ...template.pages.map((page) => `- ${page.path} -> ${page.file} "${page.title}"${page.sections?.length ? ` sections: ${page.sections.join(', ')}` : ''}`),
    '',
    'COMPONENT STRUCTURE:',
    ...template.components.map((component) => `- ${component.path}: ${component.role}${component.shared ? ' [SHARED - preserve]' : ''}`),
    '',
    'FILE SUMMARIES:',
    ...summaries,
    '',
    `REQUIRED DEPENDENCIES (already in package.json, keep them): ${Object.entries(template.dependencies).map(([name, range]) => `${name}@${range}`).join(', ')}`,
    `LOCKED FILES (do not modify): ${template.scaffold.protectedFiles.join(', ')}`,
    '',
    'PRESERVE: the visual identity, the typography hierarchy, the core layout and container widths, the shared components (their structure, class patterns and behaviour), the responsive behaviour, the working interactions (mobile menu, active links, forms) and the use of design tokens.',
    'YOU MAY CHANGE: brand name, copy, headings, images, section content and order inside pages, data arrays in src/data/site.js, and add pages, sections and components that follow the template\'s patterns. Change a shared component only when the user asks for it.',
    'ADDING PAGES: create src/pages/<Name>.jsx using the template\'s Section/Container patterns and tokens, register a <Route> in src/App.jsx, and add the entry to the nav (and footer) data in src/data/site.js. Every link must point to a registered route and no route may be an empty placeholder.',
    'EXPLICIT USER DESIGN REQUESTS (a different colour, theme or font) win over the template tokens: apply them through the CSS variables in the theme file and keep the rest of the template unchanged.',
    '',
    'FILE OPERATION RULES FOR THIS TEMPLATE: every operation targets the existing project files. Use "patch" (exact, unique search block copied from the code shown below) or "modify" (complete new content) for files that exist, and "create" only for new files. Never delete shared components or locked files. Files that are only summarised above are not shown: do not patch them blindly; compose them by importing, or rewrite them completely with "modify" if the request needs it.',
    '',
    'FILES SHOWN IN FULL:',
    '```jsx',
    shown,
    '```'
  ].join('\n');
}

/* ------------------------------ validation of generated output ------------------------------ */

const STOP_WORDS = new Set(['this', 'that', 'the', 'each', 'every', 'a', 'an', 'other', 'another', 'new', 'separate', 'extra', 'additional', 'multi', 'multiple', 'single', 'one', 'two', 'three', 'whole', 'entire', 'landing', 'home', 'main', 'first', 'last', 'web', 'website', 'full', 'these', 'those', 'my', 'your', 'our', 'their', 'its', 'of', 'and', 'or', 'for', 'with', 'by', 'no', 'more', 'few', 'several', 'many', 'some', 'all', 'any', 'dedicated', 'simple', 'nice', 'clean', 'modern', 'responsive', 'public', 'private', 'static', 'long', 'short', 'beautiful', 'professional', 'complete', 'basic', 'good', 'great', 'such', 'as', 'to', 'in', 'on', 'at', 'is', 'are', 'be', 'it', 'if', 'than', 'then', 'so']);

/** Page names the prompt asks for ("a careers page", "pages for blog, faq and careers"). */
function extractRequestedPages(prompt = '') {
  const text = String(prompt).toLowerCase();
  const found = new Set();
  for (const match of text.matchAll(/\b([a-z][a-z-]{2,24})\s+pages?\b/g)) if (!STOP_WORDS.has(match[1])) found.add(match[1]);
  for (const match of text.matchAll(/\bpages?\s+(?:for|like|such as|including|named|called|:)\s+([^.\n]+)/g)) {
    for (const part of match[1].split(/,|\band\b|&|\//)) {
      const word = part.trim().replace(/^(?:a|an|the|my|our)\s+/, '').replace(/\s+pages?$/, '').split(/\s+/)[0]?.replace(/[^a-z-]/g, '');
      if (word && word.length > 2 && !STOP_WORDS.has(word)) found.add(word);
    }
  }
  return [...found];
}

const singular = (word) => word.replace(/ies$/, 'y').replace(/s$/, '');

function routesIn(files) {
  const routes = new Set();
  for (const file of files) {
    if (!/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) || typeof file.content !== 'string') continue;
    for (const match of file.content.matchAll(/<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g)) routes.add(match[1] === '/' ? '/' : match[1].replace(/\/+$/, ''));
    if (/<Route\b[^>]*\bindex\b/.test(file.content)) routes.add('/');
  }
  return routes;
}

function linkTargetsIn(files) {
  const targets = [];
  for (const file of files) {
    if (!/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) || typeof file.content !== 'string') continue;
    const patterns = [
      /\b(?:to|href)\s*=\s*(?:\{\s*)?["'`](\/[^"'`{}$\s]*)["'`]/g,
      /\b(?:to|href|link)\s*:\s*["'`](\/[^"'`{}$\s]*)["'`]/g
    ];
    for (const pattern of patterns) for (const match of file.content.matchAll(pattern)) targets.push({ path: file.path, target: match[1] });
  }
  return targets;
}

const routeMatches = (route, target) => {
  const clean = target.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (route === clean) return true;
  if (!route.includes(':') && !route.includes('*')) return false;
  const pattern = new RegExp(`^${route.split('/').map((part) => (part === '*' ? '.*' : part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
  return pattern.test(clean);
};

const lineSet = (content) => new Set(String(content).split('\n').map((line) => line.trim()).filter((line) => line.length > 3));

function retention(original, generated) {
  const base = lineSet(original);
  if (!base.size) return 1;
  const next = lineSet(generated);
  let kept = 0;
  for (const line of base) if (next.has(line)) kept += 1;
  return kept / base.size;
}

const intentPattern = (file) => {
  const name = path.basename(file).replace(/\.[^.]+$/, '').toLowerCase();
  const aliases = { navbar: 'navbar|navigation|header|menu|nav\\b', footer: 'footer', section: 'section' };
  return new RegExp(`\\b(?:${aliases[name] || name})`, 'i');
};

/**
 * Template-specific checks, run with the existing static checks. Returns diagnostics in the pipeline's format
 * ({ category: 'template', path, message }). The messages say what to restore so the bounded repair can fix them without
 * replacing the template with a generic layout.
 */
function validateGenerated(files, template, { prompt = '', tokens = null, tokenSource = 'template', minRetention = 0.35 } = {}) {
  const diagnostics = [];
  const add = (pathName, message) => diagnostics.push({ category: 'template', path: pathName || null, message });
  const byPath = new Map(files.map((file) => [file.path, file]));
  const text = String(prompt);

  // 1. Required template files were instantiated correctly.
  for (const required of template.scaffold.requiredFiles) {
    if (!byPath.has(required)) add(required, `Template file ${required} (${template.id}@${template.version}) is missing. Restore it from the template.`);
  }
  // 2. Required dependencies are present.
  const pkgFile = byPath.get('package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const have = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const name of Object.keys(template.dependencies)) if (!have[name]) add('package.json', `Template dependency "${name}" is missing from package.json. Add it back (${name}@${template.dependencies[name]}).`);
    } catch { add('package.json', 'package.json is not valid JSON.'); }
  }
  // 3. Locked build configuration is untouched.
  for (const locked of template.scaffold.protectedFiles) {
    if (locked === 'package.json') continue;
    const current = byPath.get(locked);
    if (!current) add(locked, `Locked template file ${locked} was removed. Restore it exactly.`);
    else if (sha(current.content) !== template._files.get(locked).hash) add(locked, `Locked template file ${locked} was modified. Restore it exactly as in the template.`);
  }
  // 4. Design tokens were applied (the theme variables carry the resolved tokens), unless the user asked for a new theme.
  const themeFile = template.scaffold.themeFile || 'src/index.css';
  const css = byPath.get(themeFile);
  if (css) {
    const block = rootBlock.exec(css.content)?.[0] || '';
    const expected = tokensToCssVars(tokens || tokensFromTemplate(template), template);
    const themeRequest = /\b(?:colou?rs?|theme|palette|dark|light|brand|font|typograph|style|look|background|accent)\b/i.test(text);
    for (const [name, value] of Object.entries(expected)) {
      const found = new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`).exec(block)?.[1]?.trim();
      if (!found) add(themeFile, `The design token ${name} is missing from :root in ${themeFile}. Restore it (${value}).`);
      else if (found.replace(/\s+/g, ' ') !== value && (tokenSource !== 'template' || !themeRequest)) add(themeFile, `The design token ${name} is ${found} but the ${tokenSource === 'template' ? 'selected template' : 'chosen design'} defines ${value}. Restore it, unless the user asked for a different theme.`);
    }
  } else add(themeFile, `The theme file ${themeFile} is missing.`);
  // 5. Shared components remain intact unless the request is about them.
  for (const shared of template.scaffold.sharedFiles) {
    if (intentPattern(shared).test(text)) continue;
    const current = byPath.get(shared);
    if (!current) { add(shared, `Shared template component ${shared} was removed. Restore it; the user did not ask to change it.`); continue; }
    if (!/export\s+default/.test(current.content) && /export\s+default/.test(template._files.get(shared).content)) add(shared, `Shared template component ${shared} lost its default export.`);
    const kept = retention(template._files.get(shared).content, current.content);
    if (kept < minRetention) add(shared, `Shared template component ${shared} was rewritten (only ${Math.round(kept * 100)}% of its structure remains). Keep the template's markup, class patterns and behaviour; change only what the request needs.`);
  }
  // 6. Routes and navigation.
  const routes = routesIn(files);
  const requestedPages = extractRequestedPages(text);
  const labels = files.filter((file) => /^src\/(?:data|pages|components)\//.test(file.path)).map((file) => `${file.path} ${file.content.slice(0, 4000)}`.toLowerCase()).join('\n');
  for (const page of requestedPages) {
    const word = singular(page);
    const hasRoute = [...routes].some((route) => route.toLowerCase().includes(word)) || files.some((file) => /^src\/pages\//.test(file.path) && file.path.toLowerCase().includes(word));
    if (!hasRoute) add('src/App.jsx', `The user asked for a "${page}" page but no route for it exists. Create src/pages/${page.charAt(0).toUpperCase()}${page.slice(1)}.jsx, register its <Route> in src/App.jsx and add it to the navigation in src/data/site.js.`);
    else if (!routes.size && !labels.includes(word)) add('src/App.jsx', `The "${page}" page is not routed.`);
  }
  for (const page of template.pages) {
    if (!routes.has(page.path) && ![...routes].some((route) => routeMatches(route, page.path)) && !new RegExp(`\\b${singular(page.title.toLowerCase().split(' ')[0])}`, 'i').test(text)) {
      add('src/App.jsx', `Template page ${page.path} is no longer routed. Restore its <Route>, or remove it from the navigation too if the user asked to drop it.`);
    }
  }
  const staticRoutes = [...routes].filter((route) => route !== '*');
  const seenTargets = new Set();
  for (const { path: where, target } of linkTargetsIn(files)) {
    const clean = target.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (/^\/(?:images|assets|public|favicon|robots|sitemap|manifest)/i.test(clean) || /\.[a-z0-9]{2,5}$/i.test(clean)) continue;
    const key = `${where}|${clean}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    if (!staticRoutes.some((route) => routeMatches(route, clean))) add(where, `Navigation link "${target}" in ${where} does not match any registered <Route>. Create the page and route, or point the link at an existing route.`);
  }
  // 7. The result still reflects the template as a whole (not only its shared files).
  const sourceTemplateFiles = template.components.map((component) => component.path);
  const surviving = sourceTemplateFiles.filter((file) => byPath.has(file)).length;
  if (surviving < Math.ceil(sourceTemplateFiles.length * 0.6)) add(null, `Only ${surviving} of the template's ${sourceTemplateFiles.length} components remain, so the site no longer reflects the selected template (${template.id}). Restore the removed components.`);
  return diagnostics;
}

/** True when the candidate differs from the pristine template in at least one source file (the request was applied). */
function differsFromTemplate(files, template) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const [file, original] of template._files) {
    if (!/^src\//.test(file) || file === (template.scaffold.themeFile || 'src/index.css')) continue;
    const current = byPath.get(file);
    if (!current || sha(current.content) !== original.hash) return true;
  }
  for (const file of files) if (/^src\/(?:pages|components)\//.test(file.path) && !template._files.has(file.path)) return true;
  return false;
}

/**
 * Deterministic guard run before validation: locked build files are put back exactly as the template ships them, and
 * required files that were deleted are restored. The AI never gets to "fix" these by guessing.
 */
function enforceLocked(files, template, { prompt = '' } = {}) {
  const out = files.map((file) => ({ ...file }));
  const restored = [];
  const index = new Map(out.map((file, position) => [file.path, position]));
  const put = (file, reason) => {
    const original = template._files.get(file);
    const entry = { path: file, content: String(original.content), language: original.language, encoding: 'utf8' };
    if (index.has(file)) out[index.get(file)] = entry; else { index.set(file, out.length); out.push(entry); }
    restored.push(`${file} (${reason})`);
  };
  for (const locked of template.scaffold.protectedFiles) {
    if (locked === 'package.json') continue;
    const current = out[index.get(locked)];
    if (!current) put(locked, 'was missing');
    else if (sha(current.content) !== template._files.get(locked).hash) put(locked, 'was modified');
  }
  for (const required of template.scaffold.requiredFiles) {
    if (!index.has(required)) put(required, 'was missing');
  }
  for (const shared of template.scaffold.sharedFiles) {
    if (!index.has(shared) && !intentPattern(shared).test(String(prompt))) put(shared, 'shared component was missing');
  }
  return { files: out, restored };
}

/** What the repair model needs to restore template parts: the original source of every template file the diagnostics name. */
function buildRepairContext(template, diagnostics = [], files = []) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const named = [...new Set(diagnostics.filter((item) => item.category === 'template' && item.path && template._files.has(item.path)).map((item) => item.path))].slice(0, 4);
  const header = [
    `SELECTED TEMPLATE: ${template.name} (${template.id}@${template.version}).`,
    'REPAIR RULES: fix the reported problem by changing as little as possible. Keep the template\'s visual identity, typography, layout, shared components and design tokens. Do NOT replace the site with a generic layout, and do not delete template pages or components to make the build pass.',
    `TEMPLATE DESIGN TOKENS (CSS variables): ${Object.entries(tokensToCssVars(tokensFromTemplate(template), template)).map(([name, value]) => `${name}: ${value}`).join('; ')}`
  ];
  const originals = named.map((file) => {
    const current = byPath.get(file);
    const source = template._files.get(file).content;
    return `ORIGINAL TEMPLATE FILE ${file}${current ? ' (the project currently differs)' : ' (currently missing)'}:\n\`\`\`\n${source.slice(0, 9000)}\n\`\`\``;
  });
  return [...header, ...originals].join('\n');
}

/** Bundles the per-job template checks so validateCandidate can run them in its static phase and repair loop. */
function createChecker(template, { prompt = '', tokens = null, tokenSource = 'template' } = {}) {
  return {
    template,
    check: (files) => validateGenerated(files, template, { prompt, tokens, tokenSource }),
    repairContext: (diagnostics, files) => buildRepairContext(template, diagnostics, files)
  };
}

const provenanceFor = (template, { tokenSource = 'template', overridden = [] } = {}) => ({
  id: template.id,
  version: template.version,
  name: template.name,
  category: template.category,
  contentHash: template._contentHash,
  tokenSource,
  overridden
});

module.exports = {
  TemplateError,
  SUPPORTED_SCHEMA_VERSIONS,
  CATEGORIES,
  configure,
  loadRegistry,
  preload,
  preloadAssets,
  readTemplateDirectory,
  assembleTemplate,
  stubAssetsForTests,
  validateManifest,
  resolveTemplate,
  listTemplates,
  listCategories,
  describeTemplate,
  getPreviewImage,
  instantiateFiles,
  verifyIntegrity,
  tokensFromTemplate,
  resolveTokens,
  applyTokensToFiles,
  buildPromptContext,
  validateGenerated,
  enforceLocked,
  buildRepairContext,
  createChecker,
  differsFromTemplate,
  extractRequestedPages,
  provenanceFor
};
