/**
 * Automatic AI enhancement of the photos a user uploads to a template site.
 *
 * Responsibilities, in order:
 *   queue     - checks ownership and billing, claims the photo (so repeated requests cannot start a second job), answers at once;
 *   run       - in the background: reads the stored ORIGINAL, sends it to the image-to-image model, validates the result, stores the
 *               enhanced picture as a SEPARATE asset linked to the original, then charges the credits (only on success);
 *   choose    - the owner decides: use the enhanced picture (every page that shows the original is switched, as a revision) or keep
 *               the original. Nothing is replaced automatically, and the original is never deleted.
 */
const crypto = require('node:crypto');
const TemplateAsset = require('../../models/TemplateAsset');
const AIUsage = require('../../models/AIUsage');
const TemplateSite = require('../../models/TemplateSite');
const Project = require('../../models/Project');
const store = require('./siteFileStore');
const uploads = require('./templateUploadService');
const enhancer = require('./templateImageEnhancer');
const assets = require('./templateAssetService');
const { getSite, idOf } = require('./templateSiteService');
const { assertNoRunningJob, bumpSite } = require('./templatePageService');
const { hydrateFile } = require('../storage/s3BlobStorage');
const billing = require('../billing/usageService');
const { imageEnhanceCredits } = require('../billing/plans');
const { ValidationError, ConflictError, NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const MAX_PARALLEL = Number.parseInt(process.env.IMAGE_ENHANCE_PARALLEL, 10) || 2;
let running = 0;
const waiting = [];
const deps = {}; // test seam: { requestModel }

/** At most MAX_PARALLEL model calls at a time; the rest wait their turn (they stay "queued" for the owner). */
function slot() {
  if (running < MAX_PARALLEL) { running += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve)).then(() => { running += 1; });
}
function release() { running -= 1; const next = waiting.shift(); if (next) next(); }

const setState = (assetId, set) => TemplateAsset.updateOne({ _id: assetId }, { $set: Object.fromEntries(Object.entries(set).map(([key, value]) => [`enhancement.${key}`, value])) });

/** The stored bytes of one asset of this site (never leaves the backend). */
async function readStored(site, asset) {
  const project = await Project.findOne({ _id: site.projectId, userId: site.userId, 'files.path': asset.projectPath }, { 'files.$': 1 }).lean();
  const stored = project?.files?.[0];
  if (!stored) throw new enhancer.EnhanceError('ORIGINAL_MISSING', 'The original photo could not be found in your site.', { retryable: false });
  const file = await hydrateFile(stored);
  return Buffer.from(file.content || '', 'base64');
}

/**
 * Starts (or reports) the enhancement of one uploaded photo. Safe to call twice: while one is running the second call just returns it.
 * `auto` is the call made right after an upload: if it cannot start (no credits) the upload still succeeds and the photo is marked skipped.
 */
async function queueEnhancement({ user, siteId, assetId, auto = false }) {
  const site = await getSite(user, siteId);
  await assets.reapStale(site._id);
  const asset = await assets.findAsset(site, assetId);
  if (asset.deletedAt) throw new ConflictError('This picture was removed from the library.');
  if (!enhancer.isEnabled()) {
    if (auto) return uploads.present(asset);
    throw new ValidationError('AI photo enhancement is not available right now.');
  }
  const credits = imageEnhanceCredits();
  try { await billing.assertCanSpendCredits(idOf(user), credits); }
  catch (error) {
    if (!auto) throw error;
    await TemplateAsset.updateOne({ _id: asset._id, 'enhancement.status': { $in: [null, 'none'] } }, { $set: { 'enhancement.status': 'skipped', 'enhancement.errorCode': 'PLAN_LIMIT', 'enhancement.error': String(error.message).slice(0, 300) } });
    return uploads.present(await TemplateAsset.findById(asset._id).lean());
  }

  // Only one job per photo: the claim succeeds only when nothing is running and nothing finished yet.
  const claimed = await TemplateAsset.findOneAndUpdate(
    { _id: asset._id, siteId: site._id, source: 'upload', deletedAt: null, 'enhancement.status': { $in: [null, 'none', 'failed', 'skipped'] } },
    { $set: { 'enhancement.status': 'queued', 'enhancement.error': null, 'enhancement.errorCode': null, 'enhancement.startedAt': new Date(), 'enhancement.completedAt': null }, $inc: { 'enhancement.attempts': 1 } },
    { new: true }
  ).lean();
  if (!claimed) {
    const current = await TemplateAsset.findById(asset._id).lean();
    if (current.enhancement?.status === 'completed') throw new ConflictError('This photo has already been enhanced.');
    return uploads.present(current); // already running: report it instead of starting a second one
  }
  setImmediate(() => run({ site, user, assetId: asset._id }).catch((error) => logger.error(`Enhancement ${asset._id} crashed: ${error.stack || error.message}`)));
  return uploads.present(claimed);
}

async function fail(assetId, error) {
  const known = error instanceof enhancer.EnhanceError;
  if (!known) logger.error(`Enhancement ${assetId} failed unexpectedly: ${error.stack || error.message}`);
  else logger.warn(`Enhancement ${assetId} failed (${error.code}): ${error.message}`);
  await setState(assetId, { status: 'failed', errorCode: known ? error.code : 'FAILED', error: known ? error.message : 'The enhancement failed. Your original photo is safe. Try again.', completedAt: new Date() });
}

async function run({ site, user, assetId }) {
  await slot();
  try {
    const original = await TemplateAsset.findOne({ _id: assetId, siteId: site._id, source: 'upload' }).lean();
    if (!original || original.deletedAt) return;
    await setState(assetId, { status: 'analyzing' });
    const buffer = await readStored(site, original);
    await setState(assetId, { status: 'enhancing' });
    // Older photos have no recorded size: read it from the picture itself.
    let { width, height } = original;
    if (!width || !height) {
      const meta = await require('sharp')(buffer).metadata();
      width = meta.width; height = meta.height;
      await TemplateAsset.updateOne({ _id: assetId }, { $set: { width, height } });
    }
    const result = await enhancer.enhance({ buffer, mime: original.mime, sha256: original.sha256, width, height }, { deps });
    const enhanced = await storeEnhanced({ site, user, original, result });
    // Done only now, when a valid enhanced picture is stored.
    await TemplateAsset.updateOne({ _id: assetId }, { $set: { 'enhancement.status': 'completed', 'enhancement.error': null, 'enhancement.errorCode': null, 'enhancement.completedAt': new Date(), 'enhancement.enhancedAssetId': enhanced._id, 'enhancement.model': result.model } });
    await charge({ userId: idOf(user), assetId, projectId: site.projectId, result });
  } catch (error) {
    await fail(assetId, error);
  } finally { release(); }
}

/** Stores the enhanced picture as its own file and asset (never over the original). */
async function storeEnhanced({ site, user, original, result }) {
  const sha256 = crypto.createHash('sha256').update(result.buffer).digest('hex');
  const filePath = `public/assets/images/enhanced-${sha256.slice(0, 16)}.${result.extension}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { files, projectRevision } = await store.readSite(site);
    if (!files.some((file) => file.path === filePath)) {
      try { await store.writeSite(site, [...files, { path: filePath, content: result.buffer.toString('base64'), language: 'binary', encoding: 'base64' }], projectRevision); }
      catch (error) {
        if (!(error instanceof ConflictError) || attempt === 4) throw new enhancer.EnhanceError('STORAGE', 'The enhanced photo could not be saved. Your original is safe. Try again.');
        continue;
      }
    }
    const thumbnail = await uploads.makeThumbnail(result.buffer);
    const base = String(original.originalName || 'photo').replace(/\.[^.]+$/, '');
    const doc = await TemplateAsset.findOneAndUpdate({ siteId: site._id, sha256 }, {
      $setOnInsert: {
        userId: idOf(user), projectPath: filePath, sha256, mime: result.mime, size: result.buffer.length, attribution: `AI-enhanced from the owner's upload: ${original.originalName || ''}`.trim(),
        source: 'enhanced', enhancedOf: original._id, originalName: `${base}-enhanced.${result.extension}`, width: result.width, height: result.height, thumbnail,
        alt: original.alt || '', caption: original.caption || '', tags: original.tags || [], pageIds: original.pageIds || [], placement: original.placement || '', note: original.note || ''
      }
    }, { upsert: true, new: true }).catch((error) => { if (error?.code === 11000) return TemplateAsset.findOne({ siteId: site._id, sha256 }); throw error; });
    await bumpSite(site._id);
    return doc;
  }
  throw new enhancer.EnhanceError('STORAGE', 'The site was busy and the enhanced photo could not be saved. Try again.');
}

/** Bills one successful enhancement exactly once and records the model's real usage. */
async function charge({ userId, assetId, projectId, result }) {
  const credits = imageEnhanceCredits();
  const claimed = await TemplateAsset.findOneAndUpdate({ _id: assetId, 'enhancement.chargedAt': null }, { $set: { 'enhancement.chargedAt': new Date(), 'enhancement.credits': credits } });
  if (!claimed) return;
  try {
    await AIUsage.create({ userId, projectId, model: result.model, provider: 'openrouter', inputTokens: result.usage.promptTokens, outputTokens: result.usage.completionTokens, totalTokens: 0, cost: result.usage.cost, usageSource: 'reported' });
    await billing.chargeFixedCredits(userId, credits);
  } catch (error) {
    await TemplateAsset.updateOne({ _id: assetId }, { $set: { 'enhancement.chargedAt': null } }).catch(() => {});
    logger.error(`Enhancement ${assetId}: billing failed: ${error.message}`);
  }
}

/**
 * The owner's decision. 'enhanced': every page that shows the original now shows the enhanced picture (saved as a revision of each
 * page; no page is regenerated). 'original': keep the original (and switch back if the enhanced one had been applied).
 */
async function choose({ user, siteId, assetId, choice }) {
  if (!['enhanced', 'original'].includes(choice)) throw new ValidationError('Choose "enhanced" or "original".');
  const site = await getSite(user, siteId);
  const original = await assets.findAsset(site, assetId);
  const state = original.enhancement || {};
  const twin = state.enhancedAssetId ? await TemplateAsset.findOne({ _id: state.enhancedAssetId, siteId: site._id, source: 'enhanced' }).lean() : null;
  if (choice === 'enhanced' && (state.status !== 'completed' || !twin)) throw new ConflictError('There is no enhanced version of this photo yet.');
  const applied = state.applied || 'none';
  let pages = [];
  if ((choice === 'enhanced' && applied !== 'enhanced') || (choice === 'original' && applied === 'enhanced')) await require('./templateVersionService').snapshotBefore(site, user, `Before switching the photo ${original.originalName || ''}`.trim(), { operation: 'switch-asset' });
  if (choice === 'enhanced' && applied !== 'enhanced') {
    await assertNoRunningJob(site._id);
    pages = await assets.swapReferences({ site, user, fromPath: uploads.toPublic(original.projectPath), toPath: uploads.toPublic(twin.projectPath), instruction: `Used the AI-enhanced version of "${original.originalName || 'a photo'}"` });
  } else if (choice === 'original' && applied === 'enhanced' && twin) {
    await assertNoRunningJob(site._id);
    pages = await assets.swapReferences({ site, user, fromPath: uploads.toPublic(twin.projectPath), toPath: uploads.toPublic(original.projectPath), instruction: `Went back to the original "${original.originalName || 'photo'}"` });
  }
  await TemplateAsset.updateOne({ _id: original._id }, { $set: { 'enhancement.applied': choice } });
  if (pages.length) await TemplateAsset.updateMany({ _id: { $in: [original._id, twin?._id].filter(Boolean) } }, { $addToSet: { pageIds: { $each: pages } } });
  const fresh = await TemplateAsset.findById(original._id).lean();
  return { photo: uploads.present(fresh, null, twin), pages };
}

module.exports = { queueEnhancement, choose, deps, run };
