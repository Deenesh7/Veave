/**
 * Global template management for admins: ZIP upload, editing, versions, publish / archive, duplicate, delete, usage and preview.
 *
 * Templates are stored exactly like the existing ones (TemplateDefinition: manifest + text files in MongoDB, images in S3) and loaded
 * into the same registry that Template Studio reads. Rules that keep user websites safe:
 *  - a version is immutable once published: new files always mean a new version, and sites already created keep their own copy;
 *  - only versions with status "published" are visible in Template Studio (draft and archived are not resolvable by users);
 *  - a template used by any website cannot be deleted, only archived.
 */
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const TemplateDefinition = require('../../models/TemplateDefinition');
const TemplateSite = require('../../models/TemplateSite');
const templates = require('../templates/templateService');
const { uploadFile, hydrateFile } = require('../storage/s3BlobStorage');
const audit = require('./auditService');
const notifications = require('./notificationService');
const analytics = require('./adminAnalyticsService');
const { ValidationError, NotFoundError, ConflictError } = require('../../utils/errors');

const LIMITS = { zipBytes: 25 * 1024 * 1024, entries: 2000, fileBytes: 5 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, manifestBytes: 512 * 1024, imageBytes: 2 * 1024 * 1024, gallery: 6 };
const IMAGE = /\.(svg|png|jpe?g|webp|gif|avif|ico)$/i;
const STATUS_TO_MANIFEST = { draft: 'draft', published: 'published', archived: 'deprecated' };
const MANIFEST_TO_STATUS = { draft: 'draft', published: 'published', deprecated: 'archived' };
const decoder = () => new TextDecoder('utf-8', { fatal: true });

/* ------------------------------ the ZIP ------------------------------ */

/** Reads a ZIP held in memory into Map<path, Buffer>, refusing anything unsafe. Nothing is ever written to disk. */
function readZip(buffer) {
  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22) return reject(new ValidationError('The uploaded file is not a ZIP archive.'));
    if (buffer.length > LIMITS.zipBytes) return reject(new ValidationError(`The ZIP is larger than ${LIMITS.zipBytes / 1024 / 1024} MB.`));
    if (buffer.readUInt32LE(0) !== 0x04034b50 && buffer.readUInt32LE(0) !== 0x06054b50) return reject(new ValidationError('The uploaded file is not a ZIP archive.'));
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(new ValidationError(`The ZIP could not be read: ${error.message}`));
      const out = new Map();
      let count = 0;
      let total = 0;
      const fail = (message) => { zip.close(); reject(new ValidationError(message)); };
      zip.on('error', (err) => reject(new ValidationError(`The ZIP could not be read: ${err.message}`)));
      zip.on('end', () => resolve(out));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        count += 1;
        if (count > LIMITS.entries) return fail(`The ZIP has more than ${LIMITS.entries} entries.`);
        if (/\/$/.test(name)) return zip.readEntry();
        if (/^__MACOSX\//.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name)) return zip.readEntry();
        if (name.length > 300 || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split('/').some((part) => part === '..' || part === '.')) return fail(`The ZIP contains an unsafe path: ${name.slice(0, 120)}`);
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) return fail(`The ZIP contains a symbolic link (${name.slice(0, 120)}), which is not allowed.`);
        if (entry.isEncrypted()) return fail('Encrypted ZIP files are not supported.');
        if (entry.uncompressedSize > LIMITS.fileBytes) return fail(`${name.slice(0, 120)} is larger than ${LIMITS.fileBytes / 1024 / 1024} MB.`);
        total += entry.uncompressedSize;
        if (total > LIMITS.totalBytes) return fail(`The ZIP expands to more than ${LIMITS.totalBytes / 1024 / 1024} MB.`);
        return zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(`${name.slice(0, 120)} could not be read: ${streamError.message}`);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', (err) => fail(`${name.slice(0, 120)} could not be read: ${err.message}`));
          stream.on('end', () => { out.set(name, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

const text = (path, buffer) => {
  try { return decoder().decode(buffer); } catch { throw new ValidationError(`${path} is not a text file. Template files must be text (SVG is the only supported image format inside a template).`); }
};

/** Turns the ZIP's entries into a validated, assembled template. */
function parseTemplate(entries, overrides = {}) {
  // A single wrapper folder around everything is accepted.
  if (!entries.has('template.json')) {
    const roots = new Set([...entries.keys()].map((key) => key.split('/')[0]));
    if (roots.size === 1) {
      const root = [...roots][0];
      const stripped = new Map([...entries].filter(([key]) => key.includes('/')).map(([key, value]) => [key.slice(root.length + 1), value]));
      if (stripped.has('template.json')) entries = stripped;
    }
  }
  const raw = entries.get('template.json');
  if (!raw) throw new ValidationError('The ZIP must contain template.json at its top level (next to a files/ folder).');
  if (raw.length > LIMITS.manifestBytes) throw new ValidationError('template.json is too large.');
  let manifest;
  try { manifest = JSON.parse(text('template.json', raw)); } catch (error) { if (error instanceof ValidationError) throw error; throw new ValidationError(`template.json is not valid JSON: ${error.message}`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new ValidationError('template.json must be a JSON object.');

  // What the admin typed in the form wins over the file, and the template always starts as a public draft.
  const next = { ...manifest };
  if (overrides.name) next.name = String(overrides.name).trim().slice(0, 80);
  if (overrides.description) next.description = String(overrides.description).trim().slice(0, 600);
  if (overrides.category) next.category = String(overrides.category);
  if (overrides.tags) next.tags = cleanList(overrides.tags, 20, 40);
  if (overrides.keywords) next.keywords = cleanList(overrides.keywords, 30, 40);
  if (overrides.pages) next.pages = overrides.pages;
  next.status = 'draft';
  next.access = { visibility: 'public', allowedUserIds: [], allowedPlans: [] };
  next.featured = Boolean(next.featured);
  next.releasedAt = next.releasedAt || new Date().toISOString().slice(0, 10);
  const problems = templates.validateManifest(next);
  if (problems.length) throw new ValidationError(`The template is not valid: ${problems.join(' ')}`);

  const prefix = `${next.scaffold.dir}/`;
  const files = new Map();
  for (const [path, buffer] of entries) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (!relative || !templates.safeRelativePath(relative)) throw new ValidationError(`The template contains an unsafe path: ${path.slice(0, 120)}`);
    if (/(^|\/)\.env(\.|$)/i.test(relative)) throw new ValidationError(`${relative} must not be part of a template (environment files are not allowed).`);
    files.set(relative, templates.fileEntry(relative, text(path, buffer)));
  }
  if (!files.size) throw new ValidationError('The ZIP has no files inside the files/ folder.');
  const previewBuffer = entries.get(next.previewImage);
  if (!previewBuffer) throw new ValidationError(`The preview image ${next.previewImage} is missing from the ZIP.`);
  const preview = text(next.previewImage, previewBuffer);
  let assembled;
  try { assembled = templates.assembleTemplate(next, files, preview); } catch (error) { throw new ValidationError(error.message); }
  return { manifest: next, files, preview, assembled };
}

const cleanList = (value, max, each) => (Array.isArray(value) ? value : String(value || '').split(',')).map((item) => String(item).trim().slice(0, each)).filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).slice(0, max);

/* ------------------------------ storing ------------------------------ */

async function store({ manifest, files, preview }, adminId, existing = null) {
  const text = [];
  const assets = [];
  for (const file of files.values()) {
    if (IMAGE.test(file.path) && file.path.startsWith('public/')) assets.push({ path: file.path, blob: await uploadFile({ path: `files/${file.path}`, content: file.content, encoding: 'utf8' }) });
    else text.push({ path: file.path, content: file.content });
  }
  const previewBlob = await uploadFile({ path: manifest.previewImage, content: preview, encoding: 'utf8' });
  const contentHash = crypto.createHash('sha256').update(JSON.stringify([manifest, text, assets.map((asset) => asset.blob.sha256)])).digest('hex');
  const fields = { manifest, files: text, assets, preview: { blob: previewBlob }, contentHash };
  if (existing) return TemplateDefinition.findOneAndUpdate({ _id: existing._id }, { $set: fields }, { new: true });
  return TemplateDefinition.create({ templateId: manifest.id, version: manifest.version, ...fields, createdBy: adminId || null });
}

const reload = () => templates.reloadFromDatabase();

/* ------------------------------ views ------------------------------ */

const latestOf = (docs) => [...docs].sort((a, b) => templates.compareVersions(b.version, a.version))[0];
const view = (doc) => ({
  id: doc.templateId, version: doc.version, name: doc.manifest.name, description: doc.manifest.description, category: doc.manifest.category,
  tags: doc.manifest.tags || [], styleTags: doc.manifest.styleTags || [], keywords: doc.manifest.keywords || [], featured: Boolean(doc.manifest.featured), hidden: Boolean(doc.manifest.hidden),
  status: MANIFEST_TO_STATUS[doc.manifest.status] || 'draft', pages: doc.manifest.pages || [], features: doc.manifest.features || [], palette: doc.manifest.designTokens?.colors || null,
  fileCount: (doc.files?.length || 0) + (doc.assets?.length || 0), createdAt: doc.createdAt, updatedAt: doc.updatedAt, contentHash: doc.contentHash,
  gallery: (doc.gallery || []).map((image) => ({ kind: image.kind, name: image.name, contentType: image.contentType, key: image.blob?.sha256 }))
});

async function usageFor(ids) {
  const rows = await TemplateSite.aggregate([{ $match: { templateId: { $in: ids } } }, { $group: { _id: { id: '$templateId', version: '$templateVersion' }, websites: { $sum: 1 }, users: { $addToSet: '$userId' }, last30: { $sum: { $cond: [{ $gte: ['$createdAt', new Date(Date.now() - 30 * 86_400_000)] }, 1, 0] } }, lastUsed: { $max: '$createdAt' } } }]);
  const out = new Map();
  for (const row of rows) {
    const entry = out.get(row._id.id) || { websites: 0, users: new Set(), last30: 0, lastUsed: null, versions: {} };
    entry.websites += row.websites; row.users.forEach((user) => entry.users.add(String(user))); entry.last30 += row.last30;
    entry.lastUsed = !entry.lastUsed || row.lastUsed > entry.lastUsed ? row.lastUsed : entry.lastUsed;
    entry.versions[row._id.version] = row.websites;
    out.set(row._id.id, entry);
  }
  return out;
}

async function list(query = {}) {
  const docs = await TemplateDefinition.find({}, { templateId: 1, version: 1, manifest: 1, createdAt: 1, updatedAt: 1, contentHash: 1, 'files.path': 1, 'assets.path': 1, gallery: 1 }).lean();
  const groups = new Map();
  for (const doc of docs) groups.set(doc.templateId, [...(groups.get(doc.templateId) || []), doc]);
  const usage = await usageFor([...groups.keys()]);
  const needle = String(query.q || '').trim().toLowerCase();
  let rows = [...groups.entries()].map(([id, versions]) => {
    const latest = latestOf(versions);
    const publishedVersion = latestOf(versions.filter((doc) => doc.manifest.status === 'published').length ? versions.filter((doc) => doc.manifest.status === 'published') : [latest]);
    const used = usage.get(id);
    return { ...view(latest), status: MANIFEST_TO_STATUS[publishedVersion.manifest.status] || 'draft', versionCount: versions.length, liveVersion: versions.some((doc) => doc.manifest.status === 'published') ? publishedVersion.version : null, hasThumbnail: versions.some((doc) => (doc.gallery || []).some((image) => image.kind === 'thumbnail')), usage: { websites: used?.websites || 0, users: used?.users.size || 0, last30Days: used?.last30 || 0 } };
  });
  if (needle) rows = rows.filter((row) => [row.name, row.id, row.description, row.category, ...row.tags, ...row.keywords].join(' ').toLowerCase().includes(needle));
  if (['draft', 'published', 'archived'].includes(query.status)) rows = rows.filter((row) => row.status === query.status);
  if (query.category) rows = rows.filter((row) => row.category === String(query.category));
  rows.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const problems = (templates.loadRegistry().problems || []).map((problem) => ({ id: problem.id, version: problem.version, message: problem.message }));
  return { templates: rows, total: rows.length, categories: templates.CATEGORIES, problems };
}

async function mustFindDoc(id, version) {
  if (!templates.ID_PATTERN.test(String(id || ''))) throw new NotFoundError('Template');
  const doc = version ? await TemplateDefinition.findOne({ templateId: id, version }) : latestOf(await TemplateDefinition.find({ templateId: id }));
  if (!doc) throw new NotFoundError('Template');
  return doc;
}

async function detail(id) {
  const docs = await TemplateDefinition.find({ templateId: id }, { templateId: 1, version: 1, manifest: 1, createdAt: 1, updatedAt: 1, contentHash: 1, 'files.path': 1, 'assets.path': 1, gallery: 1 }).lean();
  if (!docs.length) throw new NotFoundError('Template');
  const usage = (await usageFor([id])).get(id);
  const versions = docs.sort((a, b) => templates.compareVersions(b.version, a.version)).map((doc) => ({ ...view(doc), websites: usage?.versions?.[doc.version] || 0 }));
  const latest = versions[0];
  return { template: { ...latest, versions, filePaths: (docs.find((doc) => doc.version === latest.version).files || []).map((file) => file.path).slice(0, 500) }, usage: { websites: usage?.websites || 0, users: usage?.users.size || 0, last30Days: usage?.last30 || 0, lastUsed: usage?.lastUsed || null }, categories: templates.CATEGORIES };
}

/* ------------------------------ operations ------------------------------ */

async function upload(admin, { buffer, fields = {}, templateId = null }, req) {
  const entries = await readZip(buffer);
  const parsed = parseTemplate(entries, fields);
  const { manifest } = parsed;
  if (templateId && manifest.id !== templateId) throw new ValidationError(`The ZIP is for "${manifest.id}", not "${templateId}".`);
  const existing = await TemplateDefinition.find({ templateId: manifest.id }, { version: 1, manifest: 1 }).lean();
  const same = existing.find((doc) => doc.version === manifest.version);
  if (same && same.manifest.status !== 'draft') throw new ConflictError(`Version ${manifest.version} of "${manifest.id}" already exists and is ${MANIFEST_TO_STATUS[same.manifest.status]}. Published versions never change: bump "version" in template.json to upload new files.`, 'VERSION_EXISTS');
  if (templateId && !existing.length) throw new NotFoundError('Template');
  if (templateId && !same && existing.some((doc) => templates.compareVersions(doc.version, manifest.version) >= 0)) throw new ValidationError(`The new version must be higher than ${latestOf(existing).version}.`);
  if (!templateId && existing.length && !same) throw new ConflictError(`A template with the id "${manifest.id}" already exists. Use "Replace files" on it to add a new version.`, 'TEMPLATE_EXISTS');
  const doc = await store(parsed, admin._id, same ? await TemplateDefinition.findOne({ templateId: manifest.id, version: manifest.version }) : null);
  await reload();
  await audit.record(admin, templateId ? 'TEMPLATE_VERSION_UPLOADED' : 'TEMPLATE_UPLOADED', { resourceType: 'template', resourceId: manifest.id, after: { version: manifest.version, name: manifest.name, category: manifest.category, files: parsed.files.size, replacedDraft: Boolean(same) }, req });
  const problem = (templates.loadRegistry().problems || []).find((item) => item.id === manifest.id && item.version === manifest.version);
  return { template: view(doc.toObject ? doc.toObject() : doc), warning: problem ? problem.message : null };
}

const EDITABLE = ['name', 'description', 'category', 'tags', 'styleTags', 'keywords', 'featured', 'hidden', 'pages'];

async function updateInfo(admin, id, version, patch, req) {
  const doc = await mustFindDoc(id, version);
  const before = {};
  const next = { ...doc.manifest };
  for (const key of EDITABLE) {
    if (patch[key] === undefined) continue;
    before[key] = doc.manifest[key];
    if (key === 'name') next.name = String(patch.name || '').trim().slice(0, 80);
    else if (key === 'description') next.description = String(patch.description || '').trim().slice(0, 600);
    else if (key === 'category') next.category = String(patch.category || '');
    else if (['tags', 'styleTags', 'keywords'].includes(key)) next[key] = cleanList(patch[key], 30, 40);
    else if (['featured', 'hidden'].includes(key)) next[key] = Boolean(patch[key]);
    else if (key === 'pages') {
      if (!Array.isArray(patch.pages)) throw new ValidationError('pages must be a list.');
      const known = new Set([...(doc.files || []).map((file) => file.path), ...(doc.assets || []).map((asset) => asset.path)]);
      next.pages = patch.pages.slice(0, 30).map((page) => {
        const route = String(page?.path || '').trim();
        const file = String(page?.file || '').trim();
        if (!route.startsWith('/') || route.length > 120 || !known.has(file)) throw new ValidationError(`Page ${route || '(no route)'} must have a route starting with "/" and an existing source file.`);
        return { ...page, path: route, file };
      });
    }
  }
  if (!Object.keys(before).length) throw new ValidationError('Nothing to change.');
  const problems = templates.validateManifest(next);
  if (problems.length) throw new ValidationError(problems.join(' '));
  doc.manifest = next;
  doc.markModified('manifest');
  await doc.save();
  await reload();
  const after = Object.fromEntries(Object.keys(before).map((key) => [key, next[key]]));
  await audit.record(admin, 'TEMPLATE_UPDATED', { resourceType: 'template', resourceId: id, before, after, meta: { version: doc.version }, req });
  return view(doc.toObject());
}

async function setStatus(admin, id, version, status, req) {
  if (!STATUS_TO_MANIFEST[status]) throw new ValidationError('Status must be draft, published or archived.');
  const doc = await mustFindDoc(id, version);
  const previous = MANIFEST_TO_STATUS[doc.manifest.status];
  if (previous === status) throw new ValidationError(`This version is already ${status}.`);
  if (status === 'published') {
    // Publishing re-runs the full validation: a template that does not load cannot be shown to users.
    await reload();
    if (!templates.inspectTemplate(id, doc.version)) {
      const problem = (templates.loadRegistry().problems || []).find((item) => item.id === id && item.version === doc.version);
      throw new ValidationError(`This version cannot be published: ${problem?.message || 'it did not load.'}`);
    }
  }
  doc.manifest = { ...doc.manifest, status: STATUS_TO_MANIFEST[status] };
  doc.markModified('manifest');
  await doc.save();
  await reload();
  await audit.record(admin, status === 'published' ? 'TEMPLATE_PUBLISHED' : status === 'archived' ? 'TEMPLATE_ARCHIVED' : 'TEMPLATE_UNPUBLISHED', { resourceType: 'template', resourceId: id, before: { status: previous }, after: { status }, meta: { version: doc.version }, req });
  if (status === 'published') await notifications.create({ type: 'TEMPLATE_PUBLISHED', title: 'Template published', message: `${doc.manifest.name} ${doc.version} is now available to all users.`, data: { templateId: id, version: doc.version }, dedupeKey: `published:${id}:${doc.version}:${Date.now()}` });
  return view(doc.toObject());
}

async function duplicate(admin, id, version, req) {
  const source = await mustFindDoc(id, version);
  const taken = new Set((await TemplateDefinition.distinct('templateId')));
  let newId = `${id}-copy`.slice(0, 64);
  for (let n = 2; taken.has(newId); n += 1) newId = `${id}-copy-${n}`.slice(0, 64);
  const data = source.toObject();
  const manifest = { ...data.manifest, id: newId, version: '1.0.0', name: `${data.manifest.name} (Copy)`.slice(0, 80), status: 'draft', featured: false };
  const copy = await TemplateDefinition.create({ templateId: newId, version: '1.0.0', manifest, files: data.files, assets: data.assets, preview: data.preview, gallery: data.gallery, contentHash: data.contentHash, createdBy: admin._id });
  await reload();
  await audit.record(admin, 'TEMPLATE_DUPLICATED', { resourceType: 'template', resourceId: newId, meta: { from: id, version: data.version }, req });
  return view(copy.toObject());
}

async function remove(admin, id, confirm, req) {
  const docs = await TemplateDefinition.find({ templateId: id });
  if (!docs.length) throw new NotFoundError('Template');
  if (confirm !== id) throw new ValidationError(`Type the template id "${id}" to confirm the deletion.`);
  const sites = await TemplateSite.countDocuments({ templateId: id });
  if (sites > 0) throw new ConflictError(`${sites} website${sites === 1 ? ' uses' : 's use'} this template, so it cannot be deleted. Archive it instead: it disappears from Template Studio and existing websites keep working.`, 'TEMPLATE_IN_USE', { websites: sites });
  if (docs.some((doc) => doc.manifest.status === 'published')) throw new ConflictError('Unpublish or archive the template before deleting it.', 'TEMPLATE_PUBLISHED');
  await TemplateDefinition.deleteMany({ templateId: id });
  await reload();
  await audit.record(admin, 'TEMPLATE_DELETED', { resourceType: 'template', resourceId: id, before: { name: docs[0].manifest.name, versions: docs.map((doc) => doc.version) }, req });
  return { deleted: true, versions: docs.length };
}

/* ------------------------------ pictures ------------------------------ */

function sniff(buffer) {
  if (buffer.length > 12 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length > 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

async function addImage(admin, id, version, { kind, buffer, name }, req) {
  if (!['thumbnail', 'preview'].includes(kind)) throw new ValidationError('The picture must be a thumbnail or a preview image.');
  if (!buffer?.length) throw new ValidationError('Choose a picture to upload.');
  if (buffer.length > LIMITS.imageBytes) throw new ValidationError(`The picture is larger than ${LIMITS.imageBytes / 1024 / 1024} MB.`);
  const contentType = sniff(buffer);
  if (!contentType) throw new ValidationError('Use a PNG, JPEG or WebP picture.');
  const doc = await mustFindDoc(id, version);
  const kept = (doc.gallery || []).filter((image) => kind === 'preview' || image.kind !== 'thumbnail');
  if (kept.filter((image) => image.kind === 'preview').length >= LIMITS.gallery && kind === 'preview') throw new ValidationError(`A template can have up to ${LIMITS.gallery} preview images.`);
  const blob = await uploadFile({ path: `template-gallery/${id}/${crypto.randomUUID()}.${contentType.split('/')[1]}`, content: buffer.toString('base64'), encoding: 'base64' });
  doc.gallery = [...kept, { kind, name: String(name || '').slice(0, 120), contentType, blob }];
  await doc.save();
  await audit.record(admin, 'TEMPLATE_IMAGE_ADDED', { resourceType: 'template', resourceId: id, meta: { kind, version: doc.version }, req });
  return view(doc.toObject());
}

async function removeImage(admin, id, version, key, req) {
  const doc = await mustFindDoc(id, version);
  const before = (doc.gallery || []).length;
  doc.gallery = (doc.gallery || []).filter((image) => image.blob?.sha256 !== key);
  if (doc.gallery.length === before) throw new NotFoundError('Picture');
  await doc.save();
  await audit.record(admin, 'TEMPLATE_IMAGE_REMOVED', { resourceType: 'template', resourceId: id, meta: { version: doc.version }, req });
  return view(doc.toObject());
}

async function imageBytes(id, version, key) {
  const doc = await mustFindDoc(id, version);
  const image = (doc.gallery || []).find((item) => item.blob?.sha256 === key);
  if (!image) throw new NotFoundError('Picture');
  const file = await hydrateFile({ path: image.name || 'image', encoding: 'base64', content: '', blob: image.blob });
  return { contentType: image.contentType, body: Buffer.from(file.content, 'base64') };
}

/* ------------------------------ preview ------------------------------ */

const compiled = new Map();
async function previewHtml(id, version) {
  const doc = await mustFindDoc(id, version);
  let template = templates.inspectTemplate(id, doc.version);
  if (!template) { await reload(); template = templates.inspectTemplate(id, doc.version); }
  if (!template) {
    const problem = (templates.loadRegistry().problems || []).find((item) => item.id === id && item.version === doc.version);
    throw new ValidationError(`This version cannot be previewed: ${problem?.message || 'it did not load.'}`);
  }
  let html = compiled.get(template._contentHash);
  if (!html) {
    html = await require('../preview/previewService').compileTemplateFiles(templates.instantiateFiles(template));
    if (compiled.size > 20) compiled.clear();
    compiled.set(template._contentHash, html);
  }
  return { html, version: doc.version, hash: template._contentHash };
}

module.exports = { list, detail, upload, updateInfo, setStatus, duplicate, remove, addImage, removeImage, imageBytes, previewHtml, readZip, parseTemplate, LIMITS };
