/**
 * Photos the user uploads next to the instruction. A photo becomes a normal file of the site (public/assets/images/uploaded-<hash>.<ext>,
 * stored in object storage like every other site file) and a TemplateAsset record, so it belongs to this site only, is stored once
 * per site however often it is uploaded, and shows in the preview and in the published site.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const TemplateAsset = require('../../models/TemplateAsset');
const store = require('./siteFileStore');
const { getSite, idOf } = require('./templateSiteService');
const { bumpSite } = require('./templatePageService');
const remoteImageLocalizer = require('../ai/remoteImageLocalizer');
const { ValidationError, ConflictError } = require('../../utils/errors');
const assetCaptions = require('./templateAssetCaptions');

const MAX_BYTES = Number.parseInt(process.env.TEMPLATE_UPLOAD_MAX_BYTES, 10) || 8 * 1024 * 1024;
const MIN_SIDE = 16;
// Vector and icon files are refused: only real photographs and raster graphics.
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_ATTACHMENTS = 8;
const PLACEMENTS = ['hero', 'about', 'gallery', 'project', 'background', 'section'];
const UPLOAD_NAME = /^uploaded-/;

async function dimensions(buffer) {
  try { const meta = await require('sharp')(buffer).metadata(); return { width: meta.width || 0, height: meta.height || 0 }; } catch { return null; }
}

const toPublic = (projectPath) => `/${String(projectPath).slice('public/'.length)}`;
const cleanName = (value) => String(value || 'photo').replace(/[\\/]/g, '').trim().slice(0, 120) || 'photo';

/** Checks the bytes of one picture and returns what they are. Throws a ValidationError a person can act on. */
async function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ValidationError('Choose a picture to upload.');
  if (buffer.length > MAX_BYTES) throw new ValidationError(`The picture is larger than ${Math.round(MAX_BYTES / 1048576)} MB.`);
  const sniffed = remoteImageLocalizer.sniffImage(buffer);
  if (!sniffed || !ALLOWED.has(sniffed.mime)) throw new ValidationError('Upload a PNG, JPEG, WebP, GIF or AVIF picture.');
  const size = await dimensions(buffer);
  if (!size || Math.min(size.width, size.height) < MIN_SIDE) throw new ValidationError('The picture could not be read, or it is too small.');
  return { sniffed, size };
}

/** A small WebP preview as a data URL (about 5-15 KB). Never blocks an upload: a picture without one is simply loaded in full. */
async function makeThumbnail(buffer) { // eslint-disable-line no-unused-vars
  try {
    const small = await require('sharp')(buffer, { animated: false }).rotate().resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return `data:image/webp;base64,${small.toString('base64')}`;
  } catch { return ''; }
}

const ENHANCE_STEPS = { none: '', queued: 'Waiting to start', analyzing: 'Analyzing image', enhancing: 'Enhancing image with AI', completed: 'Processing completed', failed: 'Enhancement failed', skipped: 'Enhancement skipped' };
const ENHANCE_ACTIVE = ['queued', 'analyzing', 'enhancing'];

/** The enhancement block of an uploaded picture: its state and (when done) the separate enhanced picture. */
function presentEnhancement(asset, enhanced = null) {
  const e = asset.enhancement || {};
  const status = e.status || 'none';
  return {
    status, step: ENHANCE_STEPS[status] || '', active: ENHANCE_ACTIVE.includes(status), error: e.error || null, errorCode: e.errorCode || null, attempts: e.attempts || 0,
    applied: e.applied || 'none', credits: Number.parseInt(process.env.IMAGE_ENHANCE_CREDITS, 10) >= 0 ? Number.parseInt(process.env.IMAGE_ENHANCE_CREDITS, 10) : 2,
    ...(status === 'completed' && enhanced ? { enhancedId: String(enhanced._id), enhancedPath: toPublic(enhanced.projectPath), enhancedWidth: enhanced.width || 0, enhancedHeight: enhanced.height || 0, enhancedSize: enhanced.size || 0, enhancedThumbnail: enhanced.thumbnail || '' } : {})
  };
}

/** Public view of an asset record (what the library shows). */
function present(asset, usage = null, enhanced = null) {
  return {
    id: String(asset._id),
    path: toPublic(asset.projectPath),
    name: asset.originalName || String(asset.attribution || '').replace(/^Uploaded by the owner: /, '') || asset.projectPath.split('/').pop(),
    mime: asset.mime, size: asset.size, width: asset.width || 0, height: asset.height || 0,
    alt: asset.alt || '', caption: asset.caption || '', tags: asset.tags || [], captionStatus: asset.captionStatus || 'none',
    pageIds: (asset.pageIds || []).map(String), placement: asset.placement || '', note: asset.note || '',
    thumbnail: asset.thumbnail || '', enhancement: presentEnhancement(asset, enhanced), deleted: Boolean(asset.deletedAt), createdAt: asset.createdAt,
    ...(usage ? { usedOn: usage.pageIds, usedElsewhere: usage.shared } : {})
  };
}

/**
 * Validates and stores one uploaded picture. The same bytes are stored once per site: uploading them again (a retry, or the same
 * file picked twice) returns the existing picture with reused: true instead of making a second copy. Returns the library entry.
 */
async function addUpload({ user, siteId, buffer, originalName = 'photo', pageId = null }) {
  const site = await getSite(user, siteId);
  const { sniffed, size } = await inspectImage(buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const name = cleanName(originalName);
  const pageIds = pageId && mongoose.isValidObjectId(pageId) ? [pageId] : [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { files, projectRevision } = await store.readSite(site);
    const known = await TemplateAsset.findOne({ siteId: site._id, sha256 });
    if (known && files.some((file) => file.path === known.projectPath)) {
      // Already here (possibly removed from the library earlier): bring it back instead of storing a second copy.
      const set = { ...(known.deletedAt ? { deletedAt: null, replacedBy: null } : {}) };
      const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(pageIds.length ? { $addToSet: { pageIds: { $each: pageIds } } } : {}) };
      const doc = Object.keys(update).length ? await TemplateAsset.findOneAndUpdate({ _id: known._id }, update, { new: true }) : known;
      return { photo: present(doc), reused: true };
    }
    // The file name carries part of the hash; a longer one is used if a different picture already owns that name.
    let hashLength = 16;
    let filePath = `public/assets/images/uploaded-${sha256.slice(0, hashLength)}.${sniffed.extension}`;
    while (files.some((file) => file.path === filePath) && hashLength < 64) { hashLength += 16; filePath = `public/assets/images/uploaded-${sha256.slice(0, hashLength)}.${sniffed.extension}`; }
    try {
      await store.writeSite(site, [...files, { path: filePath, content: buffer.toString('base64'), language: 'binary', encoding: 'base64' }], projectRevision);
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt === 4) throw error; // someone saved at the same moment: read again and retry
      continue;
    }
    let doc;
    const thumbnail = await makeThumbnail(buffer);
    try {
      doc = await TemplateAsset.findOneAndUpdate({ siteId: site._id, sha256 }, {
        $setOnInsert: { userId: idOf(user), projectPath: filePath, sha256, mime: sniffed.mime, size: buffer.length, attribution: `Uploaded by the owner: ${name}`, source: 'upload', originalName: name, thumbnail, width: size.width, height: size.height, pageIds, captionStatus: assetCaptions.enabled() ? 'pending' : 'skipped' }
      }, { upsert: true, new: true });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      doc = await TemplateAsset.findOne({ siteId: site._id, sha256 });
    }
    await bumpSite(site._id);
    if (assetCaptions.enabled() && doc.captionStatus === 'pending') assetCaptions.captionInBackground(doc._id, buffer, sniffed.mime);
    return { photo: present(doc), reused: false };
  }
  throw new ConflictError('The site was busy. Try uploading again.');
}

const cleanPlacement = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return PLACEMENTS.includes(text) ? text : '';
};

/**
 * Turns what a request names into pictures that really belong to this site (anything else is refused). Each entry is a path or
 * { path, placement, note }. Pictures removed from the library cannot be used for a new change.
 */
async function resolveAttachments(site, items = []) {
  const entries = (Array.isArray(items) ? items : []).map((item) => (typeof item === 'string' ? { path: item } : { path: item?.path, placement: item?.placement, note: item?.note })).filter((item) => item.path);
  const byPath = new Map();
  for (const item of entries) byPath.set(String(item.path), { placement: cleanPlacement(item.placement), note: String(item.note ?? '').trim().slice(0, 300) });
  if (byPath.size > MAX_ATTACHMENTS) throw new ValidationError(`Attach at most ${MAX_ATTACHMENTS} photos to one instruction.`);
  if (!byPath.size) return [];
  const wanted = [...byPath.keys()];
  const assets = await TemplateAsset.find({ siteId: site._id, projectPath: { $in: wanted.map((value) => `public${value}`) } }).lean();
  const known = new Map(assets.map((asset) => [toPublic(asset.projectPath), asset]));
  for (const value of wanted) {
    const asset = known.get(value);
    if (!asset) throw new ValidationError('One of the attached photos does not belong to this site. Upload it again.');
    if (asset.deletedAt) throw new ValidationError(`"${asset.originalName || 'A photo'}" was removed from the library. Restore it by uploading it again.`);
  }
  // A picture whose enhanced version the owner applied is used as that enhanced picture (the original stays as the alternative).
  const enhancedIds = assets.map((asset) => (asset.enhancement?.applied === 'enhanced' ? asset.enhancement.enhancedAssetId : null)).filter(Boolean);
  const enhancedAssets = enhancedIds.length ? await TemplateAsset.find({ _id: { $in: enhancedIds }, siteId: site._id, source: 'enhanced' }).lean() : [];
  const enhancedById = new Map(enhancedAssets.map((asset) => [String(asset._id), asset]));
  return wanted.map((value) => {
    const asset = known.get(value);
    const choice = byPath.get(value);
    const swap = asset.enhancement?.applied === 'enhanced' ? enhancedById.get(String(asset.enhancement.enhancedAssetId)) : null;
    const use = swap || asset;
    return {
      path: toPublic(use.projectPath), name: present(asset).name, width: use.width || 0, height: use.height || 0, alt: asset.alt || '', caption: asset.caption || '', tags: asset.tags || [],
      placement: choice.placement || asset.placement || '', note: choice.note || asset.note || ''
    };
  });
}

module.exports = { makeThumbnail, ENHANCE_ACTIVE, addUpload, resolveAttachments, inspectImage, present, toPublic, cleanName, cleanPlacement, MAX_BYTES, MAX_ATTACHMENTS, PLACEMENTS, UPLOAD_NAME };
