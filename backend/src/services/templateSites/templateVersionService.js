/**
 * Website versions of a template site (the third level next to page revisions and picture versions).
 *
 *   - A version is a complete, immutable snapshot of the site: every file, every page (route, order, component), the plan and the brief.
 *   - The files are NOT copied: a snapshot is a ProjectVersion whose files are references to content-addressed objects in object storage
 *     (named by their SHA-256, never overwritten, never deleted by the app). Versions of one site therefore share every unchanged byte.
 *   - A version only exists once it is complete (files saved and checked); a half-made version is deleted, never offered.
 *   - Restoring never removes history: it first takes a safety snapshot, then writes the old state and records a NEW version.
 *   - If a restore fails halfway, the files and pages are put back exactly as they were.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Project = require('../../models/Project');
const ProjectVersion = require('../../models/ProjectVersion');
const TemplateSite = require('../../models/TemplateSite');
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateAsset = require('../../models/TemplateAsset');
const TemplateVersion = require('../../models/TemplateVersion');
const User = require('../../models/User');
const store = require('./siteFileStore');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { getSite, idOf, objectId } = require('./templateSiteService');
const { NotFoundError, ValidationError, ConflictError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const TEXT_PATH = /^(src\/|index\.html$|tailwind\.config\.js$)/;

/** The SHA-256 of a stored file: the object-storage reference when there is one (no download), else of its content. */
function shaOfFile(file) {
  if (file.blob?.sha256) return file.blob.sha256;
  const body = file.encoding === 'base64' ? Buffer.from(String(file.content || ''), 'base64') : Buffer.from(String(file.content || ''), 'utf8');
  return sha(body);
}
const sizeOfFile = (file) => file.blob?.size ?? (file.encoding === 'base64' ? Buffer.from(String(file.content || ''), 'base64').length : Buffer.byteLength(String(file.content || ''), 'utf8'));

const treeHashOf = (files) => sha([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((file) => `${file.path}\0${shaOfFile(file)}`).join('\n'));
const pageView = (page) => ({ pageId: page._id, name: page.name, description: page.description || '', route: page.route, componentPath: page.componentPath, order: page.order ?? 0, currentRevision: page.currentRevision ?? 1, generation: page.generation || null });
const pagesHashOf = (pages) => sha(JSON.stringify([...pages].sort((a, b) => a.order - b.order).map((page) => [page.name, page.route, page.componentPath, page.description || '', page.order])));

/** The site as it is now, without downloading anything: file references with their hashes, and the pages. */
async function currentState(site) {
  const project = await Project.findById(site.projectId).select('files userId revision').lean();
  if (!project || String(project.userId) !== String(site.userId)) throw new NotFoundError('Site files');
  const pages = (await TemplatePage.find({ siteId: site._id }).sort({ order: 1 }).lean()).map(pageView);
  const files = (project.files || []).map(({ path, content, language, encoding, blob }) => ({ path, content: content || '', language, encoding: encoding || 'utf8', blob: blob || null }));
  return { files, pages, treeHash: treeHashOf(files), pagesHash: pagesHashOf(pages), projectRevision: project.revision || 0 };
}

async function assetsOf(site, files) {
  const binaries = files.filter((file) => file.encoding === 'base64' && file.path.startsWith('public/'));
  if (!binaries.length) return [];
  const records = await TemplateAsset.find({ siteId: site._id, projectPath: { $in: binaries.map((file) => file.path) } }).select('projectPath source').lean();
  const byPath = new Map(records.map((record) => [record.projectPath, record]));
  return binaries.map((file) => ({ path: `/${file.path.slice('public/'.length)}`, sha256: shaOfFile(file), size: sizeOfFile(file), assetId: byPath.get(file.path) ? String(byPath.get(file.path)._id) : null, source: byPath.get(file.path)?.source || null }));
}

async function nextNumber(siteId) {
  const site = await TemplateSite.findOneAndUpdate({ _id: siteId }, { $inc: { versionSeq: 1 } }, { new: true }).select('versionSeq').lean();
  return site.versionSeq;
}

async function nextProjectVersion(projectId) {
  const last = await ProjectVersion.findOne({ projectId }).sort({ version: -1 }).select('version').lean();
  return (last?.version || 0) + 1;
}

const present = (version, current = null) => ({
  id: String(version._id), siteId: String(version.siteId), number: version.number, name: version.name, description: version.description || '', kind: version.kind, origin: version.origin,
  operation: version.operation || null, status: version.status, createdAt: version.createdAt, createdBy: version.createdByName || '', parentId: version.parentId ? String(version.parentId) : null,
  restoredFromId: version.restoredFromId ? String(version.restoredFromId) : null, jobId: version.jobId || null, pageCount: (version.pages || []).length, affectedPages: (version.affectedPages || []).length,
  fileCount: version.fileCount, bytes: version.bytes, protected: Boolean(version.protected), published: Boolean(version.published),
  isCurrent: current ? version.treeHash === current.treeHash && version.pagesHash === current.pagesHash : false, verifiedAt: version.verifiedAt || null
});

/**
 * Saves the site as a new version. `dedupe`: when the site is exactly what a saved version already holds, that version is returned and
 * nothing new is made (so a safety snapshot never creates clutter). The version is only marked complete once its files are saved and checked.
 */
async function createVersion({ site, user, kind, name, description = '', origin = 'system', jobId = null, operation = null, parentId, restoredFromId = null, affectedPages = [], protectedFlag = false, dedupe = false, state = null }) {
  const now = state || await currentState(site);
  if (dedupe) {
    const same = await TemplateVersion.findOne({ siteId: site._id, status: 'complete', treeHash: now.treeHash, pagesHash: now.pagesHash }).sort({ number: -1 });
    if (same) return { version: same, created: false };
  }
  const head = parentId === undefined ? await TemplateVersion.findOne({ siteId: site._id, status: 'complete' }).sort({ number: -1 }).select('_id').lean() : null;
  const owner = await User.findById(idOf(user)).select('name').lean().catch(() => null);
  const number = await nextNumber(site._id);
  const fresh = await TemplateSite.findById(site._id).select('brief plan').lean();
  const doc = await TemplateVersion.create({
    siteId: site._id, projectId: site.projectId, userId: site.userId, createdByName: origin === 'user' ? (owner?.name || '') : origin === 'ai' ? 'Veave AI' : 'Veave', number, name: String(name).slice(0, 120), description: String(description || '').slice(0, 600),
    kind, origin, operation, status: 'pending', parentId: parentId === undefined ? (head?._id || null) : parentId, restoredFromId, jobId,
    pages: now.pages, affectedPages, brief: fresh?.brief || '', plan: fresh?.plan || null, assets: await assetsOf(site, now.files),
    fileCount: now.files.length, bytes: now.files.reduce((total, file) => total + sizeOfFile(file), 0), treeHash: now.treeHash, pagesHash: now.pagesHash, protected: protectedFlag
  });
  try {
    let snapshot = null;
    for (let attempt = 0; attempt < 5 && !snapshot; attempt += 1) {
      try {
        snapshot = await ProjectVersion.create({ projectId: site.projectId, userId: site.userId, version: await nextProjectVersion(site.projectId), label: `template-site:${site._id}:v${number}`, files: now.files, dependencies: [] });
      } catch (error) { if (error?.code !== 11000 || attempt === 4) throw error; }
    }
    // Checked before it is marked complete: every file has a stored copy and the same hash as the site had.
    const saved = await ProjectVersion.findById(snapshot._id).lean();
    if (!saved || saved.files.length !== now.files.length || saved.files.some((file) => !file.blob?.sha256 && !file.content)) throw new Error('The snapshot was not saved completely.');
    if (treeHashOf(saved.files) !== now.treeHash) throw new Error('The snapshot does not match the site it was taken from.');
    doc.snapshotId = snapshot._id;
    doc.status = 'complete';
    await doc.save();
  } catch (error) {
    await ProjectVersion.deleteMany({ projectId: site.projectId, label: `template-site:${site._id}:v${number}` }).catch(() => {});
    await TemplateVersion.deleteOne({ _id: doc._id }).catch(() => {});
    logger.error(`Version ${number} of site ${site._id} could not be saved: ${error.message}`);
    throw new ConflictError('The version could not be saved, so nothing was changed. Try again.', 'VERSION_NOT_SAVED');
  }
  await prune(site).catch((error) => logger.warn(`Version retention failed: ${error.message}`));
  return { version: doc, created: true };
}

/** A recoverable copy before a risky operation (nothing new is made when the site is already exactly a saved version). */
const snapshotBefore = (site, user, name, { operation = null, jobId = null } = {}) => createVersion({ site, user, kind: 'snapshot', name, origin: 'system', operation, jobId, dedupe: true });

/* ------------------------------------------------ reading ------------------------------------------------ */

const FILTERS = {
  all: {}, website: {}, ai: { $or: [{ origin: 'ai' }, { kind: 'generate' }] }, manual: { kind: 'manual' }
};

async function listVersions(user, siteId, { filter = 'all' } = {}) {
  const site = await getSite(user, siteId);
  const query = { siteId: site._id, status: 'complete', ...(FILTERS[filter] || {}) };
  const [versions, current] = await Promise.all([TemplateVersion.find(query).sort({ number: -1 }).lean(), currentState(site)]);
  const items = versions.map((version) => present(version, current));
  // The newest version that equals the site is "current" (older identical ones, e.g. a snapshot before a restore, are not).
  let marked = false;
  for (const item of items) { if (item.isCurrent && !marked) marked = true; else item.isCurrent = false; }
  return { versions: items, retention: { autoKeep: autoKeep(), protectedCount: items.filter((item) => item.protected).length }, dirty: !items.some((item) => item.isCurrent) };
}

/** Website versions and page revisions of the site in one list, newest first. */
async function history(user, siteId, { filter = 'all', limit = 200 } = {}) {
  const site = await getSite(user, siteId);
  const entries = [];
  if (['all', 'website', 'ai', 'manual'].includes(filter)) {
    const { versions } = await listVersions(user, siteId, { filter: filter === 'website' ? 'all' : filter });
    entries.push(...versions.map((version) => ({ type: 'website', at: version.createdAt, ...version })));
  }
  if (['all', 'page', 'ai'].includes(filter)) {
    const pages = await TemplatePage.find({ siteId: site._id }).select('name route currentRevision').lean();
    const names = new Map(pages.map((page) => [String(page._id), page]));
    const revisions = await TemplateRevision.find({ siteId: site._id, pageId: { $ne: null }, ...(filter === 'ai' ? { kind: 'regenerate' } : {}) }).sort({ createdAt: -1 }).limit(limit).select('-files -before').lean();
    entries.push(...revisions.filter((revision) => names.has(String(revision.pageId))).map((revision) => ({
      type: 'page', at: revision.createdAt, id: `${revision.pageId}:${revision.number}`, pageId: String(revision.pageId), pageName: names.get(String(revision.pageId)).name, route: names.get(String(revision.pageId)).route,
      number: revision.number, kind: revision.kind, name: `${names.get(String(revision.pageId)).name} · revision ${revision.number}`, description: revision.instruction || '', origin: revision.kind === 'regenerate' ? 'ai' : 'system',
      current: revision.number === names.get(String(revision.pageId)).currentRevision, jobId: revision.jobId || null, createdAt: revision.createdAt
    })));
  }
  entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { entries: entries.slice(0, limit) };
}

async function getVersionDoc(site, versionId) {
  objectId(versionId, 'Version');
  const version = await TemplateVersion.findOne({ _id: versionId, siteId: site._id });
  if (!version) throw new NotFoundError('Version');
  return version;
}

async function getVersion(user, siteId, versionId) {
  const site = await getSite(user, siteId);
  const version = await getVersionDoc(site, versionId);
  const current = await currentState(site);
  return { ...present(version, current), pages: version.pages.map((page) => ({ pageId: String(page.pageId), name: page.name, route: page.route, order: page.order })), assets: version.assets || [], brief: version.brief || '', hasPlan: Boolean(version.plan) };
}

/** The saved files of a version (references). */
async function snapshotFiles(version) {
  const snapshot = await ProjectVersion.findById(version.snapshotId).lean();
  if (!snapshot) throw new ConflictError('The saved files of this version are missing.', 'VERSION_CORRUPT');
  return (snapshot.files || []).map(({ path, content, language, encoding, blob }) => ({ path, content: content || '', language, encoding: encoding || 'utf8', blob: blob || null }));
}

/** Everything referenced by a version is still stored and still matches its hash. Returns { ok, problems }. */
async function verify(user, siteId, versionId) {
  const site = await getSite(user, siteId);
  const version = await getVersionDoc(site, versionId);
  const problems = [];
  let files = [];
  try { files = await snapshotFiles(version); } catch (error) { return { ok: false, problems: [error.message] }; }
  if (treeHashOf(files) !== version.treeHash) problems.push('The saved files no longer match the version.');
  if (files.length !== version.fileCount) problems.push(`The version should have ${version.fileCount} files but has ${files.length}.`);
  for (const file of files) {
    try { await hydrateFiles([file]); } catch { problems.push(`${file.path} is missing from storage.`); }
  }
  const present = new Set(files.map((file) => file.path));
  const text = (await hydrateFiles(files.filter((file) => file.encoding !== 'base64' && TEXT_PATH.test(file.path)).filter((file) => !problems.some((item) => item.startsWith(`${file.path} `))))).map((file) => file.content).join('\n');
  for (const match of text.matchAll(/(?:src|image)\s*[=:]\s*["'](\/(?:assets|images)\/[^"']+)["']/g)) {
    if (!present.has(`public${match[1]}`)) problems.push(`A picture is referenced but not saved: ${match[1]}`);
  }
  if (!problems.length) await TemplateVersion.updateOne({ _id: version._id }, { $set: { verifiedAt: new Date() } });
  return { ok: problems.length === 0, problems: [...new Set(problems)].slice(0, 20), checkedFiles: files.length };
}

/* ------------------------------------------------ naming, protection, deletion, retention ------------------------------------------------ */

async function updateVersion(user, siteId, versionId, { name, description, protected: protect } = {}) {
  const site = await getSite(user, siteId);
  const version = await getVersionDoc(site, versionId);
  if (name !== undefined) { const text = String(name).replace(/\s+/g, ' ').trim(); if (!text) throw new ValidationError('A version needs a name.'); version.name = text.slice(0, 120); }
  if (description !== undefined) version.description = String(description || '').slice(0, 600);
  if (protect !== undefined) version.protected = Boolean(protect);
  await version.save();
  return present(version, await currentState(site));
}

/** Deletes one version's record and snapshot. The stored files are shared and content-addressed, so nothing another version uses is touched. */
async function deleteVersion(user, siteId, versionId, { confirm = false } = {}) {
  const site = await getSite(user, siteId);
  const version = await getVersionDoc(site, versionId);
  const current = await currentState(site);
  const isSameState = (item) => item.treeHash === current.treeHash && item.pagesHash === current.pagesHash;
  // The website's present state must stay recoverable: the only saved copy of it cannot be deleted.
  if (isSameState(version) && !(await TemplateVersion.exists({ siteId: site._id, status: 'complete', _id: { $ne: version._id }, treeHash: current.treeHash, pagesHash: current.pagesHash }))) throw new ConflictError('This is the version your website is at right now. It cannot be deleted.', 'VERSION_CURRENT');
  if (version.protected) throw new ConflictError('This version is protected. Remove the protection first.', 'VERSION_PROTECTED');
  if (version.published) throw new ConflictError('This version is published and cannot be deleted.', 'VERSION_PUBLISHED');
  const branches = await TemplateSite.countDocuments({ 'branchOf.versionId': String(version._id), status: 'active' });
  if (branches) throw new ConflictError(`${branches} branch${branches === 1 ? ' was' : 'es were'} started from this version. Delete or promote them first.`, 'VERSION_HAS_BRANCHES');
  if (!confirm) throw new ConflictError(`Delete version ${version.number} "${version.name}" permanently? It cannot be restored afterwards. Send confirm=true to delete it.`, 'CONFIRM_REQUIRED');
  await TemplateVersion.updateMany({ parentId: version._id }, { $set: { parentId: version.parentId || null } });
  await ProjectVersion.deleteOne({ _id: version.snapshotId });
  await TemplateVersion.deleteOne({ _id: version._id });
  return { deleted: true, number: version.number };
}

const autoKeep = () => { const value = Number.parseInt(process.env.TEMPLATE_VERSION_AUTO_KEEP, 10); return Number.isInteger(value) && value > 0 ? value : 0; };

/**
 * Optional retention (off unless TEMPLATE_VERSION_AUTO_KEEP is set): only the OLDEST automatic safety snapshots beyond the limit are removed.
 * Website versions, restores, manual saves, protected and published versions, the current one and branch bases are never touched, and what
 * was pruned is recorded on the site so it is never silent.
 */
async function prune(site) {
  const keep = autoKeep();
  if (!keep) return 0;
  const snapshots = await TemplateVersion.find({ siteId: site._id, status: 'complete', kind: 'snapshot', protected: false, published: false }).sort({ number: -1 }).select('_id snapshotId number').lean();
  const surplus = snapshots.slice(keep);
  if (!surplus.length) return 0;
  const current = await currentState(site);
  let removed = 0;
  for (const version of surplus) {
    const doc = await TemplateVersion.findById(version._id).select('treeHash pagesHash').lean();
    if (doc.treeHash === current.treeHash && doc.pagesHash === current.pagesHash) continue;
    if (await TemplateSite.exists({ 'branchOf.versionId': String(version._id) })) continue;
    await ProjectVersion.deleteOne({ _id: version.snapshotId });
    await TemplateVersion.deleteOne({ _id: version._id });
    removed += 1;
  }
  if (removed) await TemplateSite.updateOne({ _id: site._id }, { $inc: { versionsPruned: removed }, $set: { versionsPrunedAt: new Date() } }, { strict: false });
  return removed;
}

/** The life of one picture: the original, the AI-enhanced copy, and what replaced it, and which website versions use each. */
async function assetVersions(user, siteId, assetId) {
  const site = await getSite(user, siteId);
  const assets = require('./templateAssetService');
  const uploads = require('./templateUploadService');
  const asset = await assets.findAsset(site, assetId);
  const publicPath = (item) => uploads.toPublic(item.projectPath);
  const seen = new Set([String(asset._id)]);
  const back = [];
  for (let cursor = asset; ;) {
    const previous = await TemplateAsset.findOne({ siteId: site._id, source: 'upload', replacedBy: publicPath(cursor) });
    if (!previous || seen.has(String(previous._id))) break;
    seen.add(String(previous._id)); back.unshift(previous); cursor = previous;
  }
  const forward = [];
  for (let cursor = asset; cursor.replacedBy;) {
    const next = await TemplateAsset.findOne({ siteId: site._id, projectPath: `public${cursor.replacedBy}` });
    if (!next || seen.has(String(next._id))) break;
    seen.add(String(next._id)); forward.push(next); cursor = next;
  }
  const chain = [...back, asset, ...forward];
  const twins = await TemplateAsset.find({ siteId: site._id, source: 'enhanced', enhancedOf: { $in: chain.map((item) => item._id) } }).lean();
  const usedBy = async (path) => (await TemplateVersion.find({ siteId: site._id, status: 'complete', 'assets.path': path }).sort({ number: 1 }).select('number name').lean()).map((item) => ({ number: item.number, name: item.name }));
  const versionsOf = [];
  for (const item of chain) {
    const path = publicPath(item);
    versionsOf.push({ id: String(item._id), role: item === chain[0] ? 'original' : 'replacement', path, name: item.originalName || path.split('/').pop(), size: item.size, width: item.width || 0, height: item.height || 0, createdAt: item.createdAt, active: !item.deletedAt, replacedBy: item.replacedBy || null, usedInVersions: await usedBy(path) });
    const twin = twins.find((entry) => String(entry.enhancedOf) === String(item._id));
    if (twin) versionsOf.push({ id: String(twin._id), role: 'enhanced', of: String(item._id), path: publicPath(twin), name: twin.originalName, size: twin.size, width: twin.width || 0, height: twin.height || 0, createdAt: twin.createdAt, active: item.enhancement?.applied === 'enhanced', usedInVersions: await usedBy(publicPath(twin)) });
  }
  return { assetId: String(asset._id), versions: versionsOf };
}

module.exports = { assetVersions, shaOfFile, treeHashOf, pagesHashOf, currentState, createVersion, snapshotBefore, listVersions, history, getVersion, getVersionDoc, snapshotFiles, verify, updateVersion, deleteVersion, prune, present, pageView, assetsOf, TEXT_PATH };
