/**
 * Putting an earlier state back (a website version, or a branch being promoted into main) without ever losing anything:
 *   1. the saved files are read and checked (a damaged or incomplete version is refused before anything is touched);
 *   2. a safety snapshot of the current site is taken (unless it already is a saved version);
 *   3. the site's files and pages are replaced by the old state; if any step fails, files and pages are put back exactly as they were;
 *   4. the pages whose content changed get a "restore" revision of their own, and the restored state is saved as a NEW version.
 * Versions 1..N are never removed or rewritten: v1 -> v2 -> v3 -> restore v1 -> v4 (a copy of v1's state).
 */
const mongoose = require('mongoose');
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateSite = require('../../models/TemplateSite');
const TemplateAsset = require('../../models/TemplateAsset');
const versions = require('./templateVersionService');
const store = require('./siteFileStore');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { getSite, idOf } = require('./templateSiteService');
const { assertNoRunningJob, bumpSite } = require('./templatePageService');
const { recordPageRevision } = require('./templateRevisionService');
const { ConflictError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const corrupt = (message) => new ConflictError(`${message} Nothing was changed.`, 'VERSION_CORRUPT');

/** The pictures the restored source points at must be in the restored files. Returns a list of problems (empty = fine). */
function missingReferences(files) {
  const present = new Set(files.map((file) => file.path));
  const missing = new Set();
  for (const file of files.filter((item) => item.encoding !== 'base64' && versions.TEXT_PATH.test(item.path))) {
    for (const match of String(file.content || '').matchAll(/(?:src|image)\s*[=:]\s*["'](\/(?:assets|images)\/[^"']+)["']/g)) if (!present.has(`public${match[1]}`)) missing.add(match[1]);
  }
  return [...missing];
}

/** Puts the page records back exactly as they were (used when a restore fails after it changed them). */
async function restorePageDocs(siteId, before, createdRevisionIds) {
  await TemplateRevision.deleteMany({ _id: { $in: createdRevisionIds } }).catch(() => {});
  await TemplatePage.deleteMany({ siteId, _id: { $nin: before.map((page) => page._id) } }).catch(() => {});
  // Routes first move out of the way so two pages can swap addresses without clashing.
  for (const page of before) await TemplatePage.updateOne({ _id: page._id }, { $set: { route: `/__undo_${page._id}` } }).catch(() => {});
  for (const page of before) await TemplatePage.replaceOne({ _id: page._id }, page, { upsert: true }).catch((error) => logger.error(`Could not put page ${page._id} back: ${error.message}`));
}

/** Makes the page records match the saved pages (matched by component file). Returns { pages, created } (the resulting docs). */
async function reconcilePages(site, snapshotPages) {
  const current = await TemplatePage.find({ siteId: site._id });
  const byComponent = new Map(current.map((page) => [page.componentPath, page]));
  const wanted = new Map(snapshotPages.map((page) => [page.componentPath, page]));
  for (const page of current) if (!wanted.has(page.componentPath)) await TemplatePage.deleteOne({ _id: page._id });
  for (const page of snapshotPages) {
    const existing = byComponent.get(page.componentPath);
    if (existing && existing.route !== page.route) await TemplatePage.updateOne({ _id: existing._id }, { $set: { route: `/__tmp_${existing._id}` } });
  }
  const result = [];
  for (const page of [...snapshotPages].sort((a, b) => a.order - b.order)) {
    const existing = byComponent.get(page.componentPath);
    if (existing) {
      await TemplatePage.updateOne({ _id: existing._id }, { $set: { name: page.name, description: page.description || '', route: page.route, order: page.order, status: 'ready', lastError: null }, $unset: { generation: '' } });
      result.push(await TemplatePage.findById(existing._id));
    } else {
      // A page that had been deleted comes back with its old id, so its revision history is attached to it again.
      const free = page.pageId && !(await TemplatePage.exists({ _id: page.pageId }));
      const id = free ? page.pageId : new mongoose.Types.ObjectId();
      const last = await TemplateRevision.findOne({ siteId: site._id, pageId: id }).sort({ number: -1 }).select('number').lean();
      result.push(await TemplatePage.create({ _id: id, siteId: site._id, userId: site.userId, name: page.name, description: page.description || '', route: page.route, componentPath: page.componentPath, order: page.order, currentRevision: last?.number || 0, revisionCount: last?.number || 0 }));
    }
  }
  return result;
}

/**
 * @param {object} p
 * @param {object} p.site       the site to change (a TemplateSite document)
 * @param {object} p.snapshot   { files (references), pages, brief, plan, treeHash, pagesHash, label }  the state to bring back
 * @param {string} p.kind       'restore' | 'rollback' | 'promote'
 * @param {string} p.name       the name of the new version
 * @param {string} p.exceptJobId  a running job that is allowed to be running (the job that asked for this)
 */
async function applySnapshot({ site, user, snapshot, kind, name, description = '', restoredFromId = null, exceptJobId = null, jobId = null, safetyName }) {
  await assertNoRunningJob(site._id, null, exceptJobId);
  const now = await versions.currentState(site);
  if (now.treeHash === snapshot.treeHash && now.pagesHash === snapshot.pagesHash) return { unchanged: true, version: null };

  // 1. The saved state must be complete and readable before anything is touched.
  let hydrated;
  try { hydrated = await hydrateFiles(snapshot.files); } catch (error) { throw corrupt(`This version's files could not be read (${String(error.message).slice(0, 120)}).`); }
  const dangling = missingReferences(hydrated);
  if (dangling.length) throw corrupt(`This version points at pictures that were not saved with it (${dangling.slice(0, 3).join(', ')}).`);

  // 2. A way back.
  await versions.snapshotBefore(site, user, safetyName || 'Before restoring a version', { operation: kind });

  // 3. Replace the files and the pages; undo everything if anything fails.
  const beforeFiles = (await store.readSite(site));
  const beforePages = await TemplatePage.find({ siteId: site._id }).lean();
  const beforeSite = await TemplateSite.findById(site._id).select('brief plan theme typography lastPageId').lean();
  const next = snapshot.files.map((file) => (file.encoding === 'base64' ? { path: file.path, content: '', language: file.language, encoding: 'base64', blob: file.blob } : { path: file.path, content: hydrated.find((item) => item.path === file.path).content, language: file.language, encoding: 'utf8' }));
  let written = null;
  const createdRevisions = [];
  try {
    for (let attempt = 0; attempt < 3 && written == null; attempt += 1) {
      const read = attempt === 0 ? beforeFiles : await store.readSite(site);
      try { written = await store.writeSite(site, next, read.projectRevision); }
      catch (error) { if (!(error instanceof ConflictError) || attempt === 2) throw error; }
    }
    const pages = await reconcilePages(site, snapshot.pages);
    await TemplateSite.updateOne({ _id: site._id }, { $set: { brief: snapshot.brief || '', plan: snapshot.plan || null, theme: require('./templateTheme').readTheme(hydrated), typography: require('./templateTheme').readTheme(hydrated)?.typography || null, lastPageId: pages[0]?._id || null } });
    const beforeByPath = new Map(beforeFiles.files.map((file) => [file.path, file]));
    for (const page of pages) {
      const after = hydrated.find((file) => file.path === page.componentPath);
      const was = beforeByPath.get(page.componentPath);
      if (!after || (was && was.content === after.content)) continue;
      const { revision } = await recordPageRevision({
        site, page, userId: idOf(user), kind: 'restore', instruction: `Restored ${snapshot.label}`,
        changed: [{ path: after.path, content: after.content, language: after.language || 'javascript', deleted: false }],
        previous: was ? [{ path: was.path, content: was.content, language: was.language || 'javascript', deleted: false }] : [], jobId: `restore:${restoredFromId || snapshot.treeHash.slice(0, 8)}:${page._id}:${Date.now()}`
      });
      createdRevisions.push(revision._id);
    }
    // The pictures the restored state uses are available again in the library.
    const referenced = hydrated.filter((file) => file.encoding === 'base64' && file.path.startsWith('public/')).map((file) => file.path);
    if (referenced.length) await TemplateAsset.updateMany({ siteId: site._id, projectPath: { $in: referenced }, source: 'upload', deletedAt: { $ne: null } }, { $set: { deletedAt: null, replacedBy: null } });
    const created = await versions.createVersion({ site, user, kind, name, description, origin: 'user', restoredFromId, operation: kind, jobId, dedupe: false });
    await bumpSite(site._id);
    return { unchanged: false, version: created.version, pages };
  } catch (error) {
    logger.error(`Restore of site ${site._id} failed, undoing: ${error.message}`);
    if (written != null) await store.rollbackSite(site, beforeFiles.files, written).catch((e) => logger.error(`Could not put the files back: ${e.message}`));
    await restorePageDocs(site._id, beforePages, createdRevisions);
    await TemplateSite.updateOne({ _id: site._id }, { $set: { brief: beforeSite?.brief || '', plan: beforeSite?.plan || null, theme: beforeSite?.theme || null, typography: beforeSite?.typography || null, lastPageId: beforeSite?.lastPageId || null } }).catch(() => {});
    if (error?.statusCode) throw error;
    throw new ConflictError('The version could not be restored. Your website was left exactly as it was.', 'RESTORE_FAILED');
  }
}

/** Restores one of the site's own versions. */
async function restoreVersion({ user, siteId, versionId, exceptJobId = null, kind = 'restore', auto = false }) {
  const site = await getSite(user, siteId);
  const version = await versions.getVersionDoc(site, versionId);
  if (version.status !== 'complete') throw new ConflictError('This version was never saved completely and cannot be restored.', 'VERSION_INCOMPLETE');
  const files = await versions.snapshotFiles(version);
  const label = `version ${version.number} "${version.name}"`;
  const outcome = await applySnapshot({
    site, user, kind, exceptJobId, restoredFromId: version._id,
    name: auto ? `Rolled back to version ${version.number}` : `Restored version ${version.number}`,
    description: auto ? `The generation failed, so the website was put back to ${label}.` : `Restored ${label}. Newer versions are kept.`,
    safetyName: `Before restoring version ${version.number}`,
    snapshot: { files, pages: version.pages.map((page) => (page.toObject ? page.toObject() : page)), brief: version.brief, plan: version.plan, treeHash: version.treeHash, pagesHash: version.pagesHash, label }
  });
  return { unchanged: outcome.unchanged, version: outcome.version ? versions.present(outcome.version, null) : null, restoredFrom: { id: String(version._id), number: version.number } };
}

module.exports = { applySnapshot, restoreVersion, reconcilePages, missingReferences };
