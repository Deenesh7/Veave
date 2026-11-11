/**
 * The picture library of a template site: list, describe, remove and replace the pictures the owner uploaded.
 *
 * Pictures belong to the site (never to another site or user). Removing one only hides it from the library and from new changes: the
 * file stays in the site, so a page or an older revision that still shows it keeps working. Replacing one points every place that
 * showed it at the new file and saves that as a new revision of each page it touched, so the swap can be undone from the history.
 */
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const TemplateAsset = require('../../models/TemplateAsset');
const TemplatePage = require('../../models/TemplatePage');
const Project = require('../../models/Project');
const store = require('./siteFileStore');
const uploads = require('./templateUploadService');
const { getSite, idOf, objectId } = require('./templateSiteService');
const { assertNoRunningJob, changeFiles, undoFiles, bumpSite } = require('./templatePageService');
const { recordPageRevision } = require('./templateRevisionService');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { NotFoundError, ValidationError, ConflictError } = require('../../utils/errors');

const isSource = (file) => file.encoding !== 'base64' && /^src\/.+\.(jsx?|tsx?|css|json)$/.test(file.path);

/** Text files of the site (small) with the path of every picture they mention. */
async function textFiles(site) {
  const project = await Project.findById(site.projectId).select('files userId').lean();
  if (!project || String(project.userId) !== String(site.userId)) throw new NotFoundError('Site files');
  return hydrateFiles((project.files || []).filter(isSource));
}

/** Which pages show which pictures: a page uses a picture when its own component file names it. Anything else (shared parts) counts as "elsewhere". */
function usageOf(assetPaths, files, pages) {
  const pageByFile = new Map(pages.map((page) => [page.componentPath, String(page._id)]));
  const usage = new Map(assetPaths.map((value) => [value, { pageIds: new Set(), shared: false }]));
  for (const file of files) {
    for (const [value, entry] of usage) {
      if (!file.content.includes(value)) continue;
      if (pageByFile.has(file.path)) entry.pageIds.add(pageByFile.get(file.path));
      else entry.shared = true;
    }
  }
  return new Map([...usage].map(([value, entry]) => [value, { pageIds: [...entry.pageIds], shared: entry.shared }]));
}

async function findAsset(site, assetId) {
  objectId(assetId, 'Image');
  await adoptLegacyUploads(site._id);
  const asset = await TemplateAsset.findOne({ _id: assetId, siteId: site._id, source: 'upload' });
  if (!asset) throw new NotFoundError('Image');
  return asset;
}

/**
 * Photos uploaded before the library existed were recorded without the "upload" marker. They are the owner's own photos, so they are
 * adopted into the library (their file name is recovered from the note saved with them).
 */
async function adoptLegacyUploads(siteId) {
  const legacy = await TemplateAsset.find({ siteId, source: { $ne: 'upload' }, attribution: /^Uploaded by the owner: / }).select('attribution').lean();
  for (const asset of legacy) {
    await TemplateAsset.updateOne({ _id: asset._id, source: { $ne: 'upload' } }, { $set: { source: 'upload', originalName: String(asset.attribution).replace(/^Uploaded by the owner: /, '').slice(0, 120) } });
  }
}

/** An enhancement that has been running far too long (the server restarted, the call hung) is reported as failed so it can be retried. */
const STALE_MS = 8 * 60 * 1000;
async function reapStale(siteId) {
  await TemplateAsset.updateMany(
    { siteId, source: 'upload', 'enhancement.status': { $in: uploads.ENHANCE_ACTIVE }, 'enhancement.startedAt': { $lt: new Date(Date.now() - STALE_MS) } },
    { $set: { 'enhancement.status': 'failed', 'enhancement.errorCode': 'TIMEOUT', 'enhancement.error': 'The enhancement did not finish. Try again.' } }
  );
}

/** The enhanced pictures of some originals, by original id. */
async function enhancedFor(siteId, assets) {
  const ids = assets.map((asset) => asset.enhancement?.enhancedAssetId).filter(Boolean);
  if (!ids.length) return new Map();
  const found = await TemplateAsset.find({ _id: { $in: ids }, siteId, source: 'enhanced' }).lean();
  return new Map(found.map((asset) => [String(asset.enhancedOf), asset]));
}

/** The library: every uploaded picture of the site, newest first, with the pages that show it (the original or its applied enhanced version). */
async function listAssets(user, siteId, { includeDeleted = false } = {}) {
  const site = await getSite(user, siteId);
  await adoptLegacyUploads(site._id);
  await reapStale(site._id);
  const filter = { siteId: site._id, source: 'upload', ...(includeDeleted ? {} : { deletedAt: null }) };
  const [assets, pages, files] = await Promise.all([TemplateAsset.find(filter).sort({ createdAt: -1 }).lean(), TemplatePage.find({ siteId: site._id }).lean(), textFiles(site)]);
  const enhanced = await enhancedFor(site._id, assets);
  const paths = assets.flatMap((asset) => [uploads.toPublic(asset.projectPath), ...(enhanced.get(String(asset._id)) ? [uploads.toPublic(enhanced.get(String(asset._id)).projectPath)] : [])]);
  const usage = usageOf(paths, files, pages);
  return assets.map((asset) => {
    const twin = enhanced.get(String(asset._id)) || null;
    const a = usage.get(uploads.toPublic(asset.projectPath));
    const b = twin ? usage.get(uploads.toPublic(twin.projectPath)) : { pageIds: [], shared: false };
    return uploads.present(asset, { pageIds: [...new Set([...a.pageIds, ...b.pageIds])], shared: a.shared || b.shared }, twin);
  });
}

async function describeUsage(site, asset) {
  const [pages, files] = await Promise.all([TemplatePage.find({ siteId: site._id }).lean(), textFiles(site)]);
  const twin = (await enhancedFor(site._id, [asset])).get(String(asset._id)) || null;
  const own = uploads.toPublic(asset.projectPath);
  const other = twin ? uploads.toPublic(twin.projectPath) : null;
  const usage = usageOf([own, ...(other ? [other] : [])], files, pages);
  const a = usage.get(own);
  const b = other ? usage.get(other) : { pageIds: [], shared: false };
  return { pageIds: [...new Set([...a.pageIds, ...b.pageIds])], shared: a.shared || b.shared, twin };
}

/** Owner-written details: alt text, a note, a placement hint, the pages it is for. */
async function updateAsset(user, siteId, assetId, body = {}) {
  const site = await getSite(user, siteId);
  const asset = await findAsset(site, assetId);
  const set = {};
  if (body.alt !== undefined) set.alt = String(body.alt ?? '').trim().slice(0, 200);
  if (body.caption !== undefined) set.caption = String(body.caption ?? '').trim().slice(0, 400);
  if (body.note !== undefined) set.note = String(body.note ?? '').trim().slice(0, 300);
  if (body.placement !== undefined) {
    const placement = uploads.cleanPlacement(body.placement);
    if (body.placement && !placement) throw new ValidationError(`Placement must be one of: ${uploads.PLACEMENTS.join(', ')}.`);
    set.placement = placement;
  }
  if (body.pageIds !== undefined) {
    const ids = [...new Set((Array.isArray(body.pageIds) ? body.pageIds : []).map(String))];
    if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new ValidationError('One of the pages is not valid.');
    const owned = await TemplatePage.countDocuments({ siteId: site._id, _id: { $in: ids } });
    if (owned !== ids.length) throw new ValidationError('One of the pages does not belong to this site.');
    set.pageIds = ids;
  }
  const doc = Object.keys(set).length ? await TemplateAsset.findOneAndUpdate({ _id: asset._id }, { $set: set }, { new: true }) : asset;
  const usage = await describeUsage(site, doc);
  return uploads.present(doc, usage, usage.twin);
}

/** Hides a picture from the library. The file stays, so pages and revisions that show it are not broken. */
async function removeAsset(user, siteId, assetId) {
  const site = await getSite(user, siteId);
  const asset = await findAsset(site, assetId);
  const usage = await describeUsage(site, asset);
  await TemplateAsset.updateOne({ _id: asset._id }, { $set: { deletedAt: new Date() } });
  return { removed: true, stillShownOn: usage.pageIds, stillShownElsewhere: usage.shared };
}

/**
 * Points every source file that names `fromPath` at `toPath`, and records a revision for each page that changed. Returns the ids of
 * the pages that changed. If a later step fails the files are put back. Nothing else (other pages, routing) is touched.
 */
async function swapReferences({ site, user, fromPath, toPath, instruction }) {
  const pages = await TemplatePage.find({ siteId: site._id });
  const change = await changeFiles(site, (files) => ({
    files: files.map((file) => (isSource(file) && file.content.includes(fromPath) ? { ...file, content: file.content.split(fromPath).join(toPath) } : file))
  }));
  const touched = [];
  try {
    for (const page of pages) {
      const mine = change.changed.filter((file) => file.path === page.componentPath);
      if (!mine.length) continue;
      const previous = change.previous.filter((file) => file.path === page.componentPath);
      await recordPageRevision({ site, page, userId: idOf(user), kind: 'replace-image', instruction, changed: mine, previous, jobId: `replace_${crypto.randomBytes(6).toString('hex')}` });
      touched.push(String(page._id));
    }
  } catch (error) {
    await undoFiles(site, change);
    throw error;
  }
  return touched;
}

/**
 * Swaps one picture for another everywhere it is shown. The new file is stored like any upload; every source file that named the
 * old path now names the new one; each page that changed gets a new revision; the old picture leaves the library but stays in the site.
 */
async function replaceAsset({ user, siteId, assetId, buffer, originalName }) {
  const site = await getSite(user, siteId);
  const asset = await findAsset(site, assetId);
  if (asset.deletedAt) throw new ConflictError('This picture was removed. Upload a new one instead.');
  await assertNoRunningJob(site._id);
  await require('./templateVersionService').snapshotBefore(site, user, `Before replacing the photo ${asset.originalName || ''}`.trim(), { operation: 'replace-asset' });
  const uploaded = await uploads.addUpload({ user, siteId, buffer, originalName });
  const next = uploaded.photo;
  if (next.id === String(asset._id)) return { photo: next, replaced: false, pages: [] };

  const label = `Replaced photo "${asset.originalName || asset.projectPath}" with "${next.name}"`;
  const touched = await swapReferences({ site, user, fromPath: uploads.toPublic(asset.projectPath), toPath: next.path, instruction: label });
  // A page that shows the applied AI-enhanced version of the old picture is switched too.
  const twin = asset.enhancement?.enhancedAssetId ? await TemplateAsset.findOne({ _id: asset.enhancement.enhancedAssetId, siteId: site._id, source: 'enhanced' }).lean() : null;
  if (twin) touched.push(...(await swapReferences({ site, user, fromPath: uploads.toPublic(twin.projectPath), toPath: next.path, instruction: label })).filter((id) => !touched.includes(id)));
  // The new picture takes over the old one's details and the old one leaves the library.
  await TemplateAsset.updateOne({ _id: next.id }, { $set: { alt: next.alt || asset.alt, note: asset.note, placement: asset.placement, deletedAt: null }, $addToSet: { pageIds: { $each: [...(asset.pageIds || []), ...touched] } } });
  await TemplateAsset.updateOne({ _id: asset._id }, { $set: { deletedAt: new Date(), replacedBy: next.path } });
  if (!touched.length) await bumpSite(site._id);
  const fresh = await TemplateAsset.findById(next.id).lean();
  return { photo: uploads.present(fresh), replaced: true, pages: touched };
}

/** The original bytes of one library picture (for the large preview). */
async function readAssetFile(user, siteId, assetId, { version = 'original' } = {}) {
  const site = await getSite(user, siteId);
  let asset = await findAsset(site, assetId);
  if (version === 'enhanced') {
    const twin = asset.enhancement?.enhancedAssetId ? await TemplateAsset.findOne({ _id: asset.enhancement.enhancedAssetId, siteId: site._id, source: 'enhanced' }) : null;
    if (!twin) throw new NotFoundError('Enhanced image');
    asset = twin;
  }
  const project = await Project.findOne({ _id: site.projectId, userId: site.userId, 'files.path': asset.projectPath }, { 'files.$': 1 }).lean();
  const stored = project?.files?.[0];
  if (!stored) throw new NotFoundError('Image file');
  const file = await require('../storage/s3BlobStorage').hydrateFile(stored);
  return { buffer: Buffer.from(file.content || '', 'base64'), mime: asset.mime || 'application/octet-stream', name: asset.originalName || 'image' };
}

module.exports = { swapReferences, reapStale, findAsset, readAssetFile, listAssets, updateAsset, removeAsset, replaceAsset, textFiles, usageOf };
