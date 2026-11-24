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
// A video is much larger than a picture. It is kept as a normal file of the site (and read into memory with the other files), so it is capped.
const VIDEO_MAX_BYTES = Number.parseInt(process.env.TEMPLATE_VIDEO_MAX_BYTES, 10) || 25 * 1024 * 1024;
const MIN_SIDE = 16;
// Vector and icon files are refused: only real photographs and raster graphics.
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_ATTACHMENTS = 8;
const PLACEMENTS = ['hero', 'about', 'gallery', 'project', 'background', 'page-background', 'section'];
const UPLOAD_NAME = /^uploaded-/;

async function dimensions(buffer) {
  try {
    const meta = await require('sharp')(buffer).metadata();
    // Phone photos are often stored sideways with an EXIF rotation: report the size people actually see.
    const sideways = meta.orientation >= 5;
    return { width: (sideways ? meta.height : meta.width) || 0, height: (sideways ? meta.width : meta.height) || 0, format: meta.format, compression: meta.compression || null };
  } catch { return null; }
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
  // The header and the decoder must agree: a HEIC photo, a video or a renamed file that only starts like an AVIF is refused here.
  const decoded = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'heif' }[sniffed.mime];
  if (size.format !== decoded || (sniffed.mime === 'image/avif' && size.compression && size.compression !== 'av1')) throw new ValidationError('The file is not a valid picture of the type it claims to be.');
  return { sniffed, size };
}

/**
 * Is this an MP4 or a WebM that every browser can play? Decided from the bytes, never from the name. Returns { mime, extension } or null.
 * (A HEIC/AVIF picture and a QuickTime .mov also start with "ftyp", so the brand decides: only the MP4 family is accepted.)
 */
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'msdh', 'msix', 'mmp4', 'f4v ']);
function sniffVideo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer.toString('latin1', 4, 8) === 'ftyp') {
    const boxSize = Math.min(buffer.readUInt32BE(0) || 0, 256);
    const brands = [buffer.toString('latin1', 8, 12)];
    for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(buffer.toString('latin1', at, at + 4));
    if (brands[0] === 'avif' || brands[0] === 'avis' || brands[0] === 'heic' || brands[0] === 'heix' || brands[0] === 'mif1') return null;
    return brands.some((brand) => MP4_BRANDS.has(brand)) ? { mime: 'video/mp4', extension: 'mp4' } : null;
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    // Matroska and WebM share the container; the document type says which this is.
    return /webm/.test(buffer.toString('latin1', 0, Math.min(buffer.length, 128))) ? { mime: 'video/webm', extension: 'webm' } : null;
  }
  return null;
}

/** Length of an MP4 in seconds, from its movie header (null when it cannot be read; never blocks an upload). */
function videoDuration(buffer, mime) {
  if (mime !== 'video/mp4') return null;
  try {
    const at = buffer.indexOf('mvhd');
    if (at < 4) return null;
    const version = buffer[at + 4];
    const timescale = buffer.readUInt32BE(at + (version === 1 ? 24 : 16));
    const duration = version === 1 ? Number(buffer.readBigUInt64BE(at + 28)) : buffer.readUInt32BE(at + 20);
    const seconds = timescale ? duration / timescale : 0;
    return seconds > 0 && seconds < 86400 ? Math.round(seconds * 10) / 10 : null;
  } catch { return null; }
}

/** Checks the bytes of one upload (a picture or a video) and says which it is. Throws a ValidationError a person can act on. */
async function inspectMedia(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ValidationError('Choose a picture or a video to upload.');
  const video = sniffVideo(buffer);
  if (video) {
    if (buffer.length > VIDEO_MAX_BYTES) throw new ValidationError(`The video is larger than ${Math.round(VIDEO_MAX_BYTES / 1048576)} MB. Shorten it or compress it, then upload it again.`);
    // A file with no movie box cannot be played (an unfinished download or recording).
    if (video.mime === 'video/mp4' && buffer.indexOf('moov') < 0) throw new ValidationError('The video file looks incomplete. Export it again as an MP4 (H.264) or WebM video.');
    return { kind: 'video', sniffed: video, size: { width: 0, height: 0, duration: videoDuration(buffer, video.mime) } };
  }
  try {
    return { kind: 'image', ...(await inspectImage(buffer)) };
  } catch (error) {
    if (error instanceof ValidationError && /^Upload a PNG/.test(error.message)) throw new ValidationError('Upload a PNG, JPEG, WebP, GIF or AVIF picture, or an MP4 or WebM video.');
    throw error;
  }
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
    kind: asset.kind || (String(asset.mime || '').startsWith('video/') ? 'video' : 'image'), durationSeconds: asset.durationSeconds || null,
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
// Uploads to the same site run one after another inside this process: the same picture sent several times at once (a double click,
// a retry) is then stored once, and different pictures do not fight over the site's files. Other servers rely on the unique
// (site, hash) index and the revision check below.
const siteQueues = new Map();
function inSiteQueue(siteId, task) {
  const key = String(siteId);
  const run = (siteQueues.get(key) || Promise.resolve()).catch(() => {}).then(task);
  const tail = run.catch(() => {});
  siteQueues.set(key, tail);
  tail.then(() => { if (siteQueues.get(key) === tail) siteQueues.delete(key); });
  return run;
}

async function addUpload(args) {
  return inSiteQueue(args.siteId, () => storeUpload(args));
}

async function storeUpload({ user, siteId, buffer, originalName = 'photo', pageId = null }) {
  const site = await getSite(user, siteId);
  const { kind, sniffed, size } = await inspectMedia(buffer);
  const folder = kind === 'video' ? 'videos' : 'images';
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const name = cleanName(originalName);
  const pageIds = pageId && mongoose.isValidObjectId(pageId) ? [pageId] : [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { files, projectRevision } = await store.readSite(site);
    const known = await TemplateAsset.findOne({ siteId: site._id, sha256 });
    // The library entry exists but its file is gone from the site: put the file back at the SAME path so the entry is valid again.
    if (known && !files.some((file) => file.path === known.projectPath)) {
      try {
        await store.writeSite(site, [...files, { path: known.projectPath, content: buffer.toString('base64'), language: 'binary', encoding: 'base64' }], projectRevision);
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt === 4) throw error;
        continue;
      }
      const restored = await TemplateAsset.findOneAndUpdate({ _id: known._id }, { $set: { deletedAt: null, replacedBy: null }, ...(pageIds.length ? { $addToSet: { pageIds: { $each: pageIds } } } : {}) }, { new: true });
      await bumpSite(site._id);
      return { photo: present(restored), reused: true };
    }
    if (known) {
      // Already here (possibly removed from the library earlier): bring it back instead of storing a second copy.
      const set = { ...(known.deletedAt ? { deletedAt: null, replacedBy: null } : {}) };
      const update = { ...(Object.keys(set).length ? { $set: set } : {}), ...(pageIds.length ? { $addToSet: { pageIds: { $each: pageIds } } } : {}) };
      const doc = Object.keys(update).length ? await TemplateAsset.findOneAndUpdate({ _id: known._id }, update, { new: true }) : known;
      return { photo: present(doc), reused: true };
    }
    // The file name carries part of the hash; a longer one is used if a different picture already owns that name.
    let hashLength = 16;
    const pathFor = (length) => `public/assets/${folder}/uploaded-${sha256.slice(0, length)}.${sniffed.extension}`;
    let filePath = pathFor(hashLength);
    while (files.some((file) => file.path === filePath) && hashLength < 64) { hashLength += 16; filePath = pathFor(hashLength); }
    try {
      await store.writeSite(site, [...files, { path: filePath, content: buffer.toString('base64'), language: 'binary', encoding: 'base64' }], projectRevision);
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt === 4) throw error; // someone saved at the same moment: read again and retry
      continue;
    }
    let doc;
    const thumbnail = kind === 'video' ? '' : await makeThumbnail(buffer);
    try {
      doc = await TemplateAsset.findOneAndUpdate({ siteId: site._id, sha256 }, {
        $setOnInsert: { userId: idOf(user), projectPath: filePath, sha256, mime: sniffed.mime, size: buffer.length, attribution: `Uploaded by the owner: ${name}`, source: 'upload', originalName: name, thumbnail, width: size.width, height: size.height, kind, ...(kind === 'video' ? { durationSeconds: size.duration || null } : {}), pageIds, captionStatus: kind === 'image' && assetCaptions.enabled() ? 'pending' : 'skipped' }
      }, { upsert: true, new: true });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      doc = await TemplateAsset.findOne({ siteId: site._id, sha256 });
    }
    await bumpSite(site._id);
    if (kind === 'image' && assetCaptions.enabled() && doc.captionStatus === 'pending') assetCaptions.captionInBackground(doc._id, buffer, sniffed.mime);
    return { photo: present(doc), reused: false };
  }
  throw new ConflictError('The site was busy. Try uploading again.');
}

const cleanPlacement = (value) => {
  const raw = String(value ?? '').trim();
  // A named section of the page (chosen from the page's own section list): "section:<name>".
  const named = /^section:(.+)$/i.exec(raw);
  if (named) { const name = named[1].replace(/\s+/g, ' ').trim().slice(0, 80); return name ? `section:${name}` : ''; }
  const text = raw.toLowerCase();
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
      path: toPublic(use.projectPath), name: present(asset).name, kind: present(asset).kind, mime: use.mime || asset.mime || '', durationSeconds: asset.durationSeconds || null, width: use.width || 0, height: use.height || 0, alt: asset.alt || '', caption: asset.caption || '', tags: asset.tags || [],
      // A saved default must never carry a page-specific placement (page background, a named section) over to another page.
      // A video has one use on a website: it plays behind a section (or the page), so that is its default.
      placement: choice.placement || (/^(page-background|section)/.test(asset.placement || '') ? '' : asset.placement) || (present(asset).kind === 'video' ? 'background' : ''), note: choice.note || asset.note || ''
    };
  });
}

module.exports = { sniffVideo, videoDuration, inspectMedia, VIDEO_MAX_BYTES, makeThumbnail, ENHANCE_ACTIVE, addUpload, resolveAttachments, inspectImage, present, toPublic, cleanName, cleanPlacement, MAX_BYTES, MAX_ATTACHMENTS, PLACEMENTS, UPLOAD_NAME };
