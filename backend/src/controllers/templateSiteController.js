const siteService = require('../services/templateSites/templateSiteService');
const pageService = require('../services/templateSites/templatePageService');
const revisionService = require('../services/templateSites/templateRevisionService');
const jobs = require('../services/templateSites/templateJobManager');
const TemplateGenerationJob = require('../models/TemplateGenerationJob');
const TemplateRevision = require('../models/TemplateRevision');
const uploads = require('../services/templateSites/templateUploadService');
const assets = require('../services/templateSites/templateAssetService');
const enhancements = require('../services/templateSites/templateEnhancementService');
const imageEnhancer = require('../services/templateSites/templateImageEnhancer');
const versionService = require('../services/templateSites/templateVersionService');
const versionRestore = require('../services/templateSites/templateVersionRestore');
const versionCompare = require('../services/templateSites/templateVersionCompare');
const branchService = require('../services/templateSites/templateBranchService');
const preview = require('../services/preview/previewService');
const { NotFoundError } = require('../utils/errors');

const site = (doc, pageCount) => ({
  id: String(doc._id), name: doc.name, category: doc.category, description: doc.description, templateId: doc.templateId, templateVersion: doc.templateVersion,
  projectId: String(doc.projectId), typography: doc.typography || null, theme: doc.theme || null, brief: doc.brief || '', plan: doc.plan ? { category: doc.plan.identity?.category, name: doc.plan.identity?.name, pageLimit: doc.plan.pageLimit || null, theme: doc.plan.theme ? { mood: doc.plan.theme.mood, brand: doc.plan.theme.colors.brand, bg: doc.plan.theme.colors.bg } : null, images: (doc.plan.images || []).map((item) => ({ key: item.key, page: item.page, status: item.status || 'pending', error: item.error || null })) } : null, branchOf: doc.branchOf || null, promotedAt: doc.promotedAt || null, thumbnailUrl: doc.thumbnailUrl, revision: doc.revision, lastPageId: doc.lastPageId ? String(doc.lastPageId) : null,
  ...(pageCount !== undefined ? { pageCount } : {}), createdAt: doc.createdAt, updatedAt: doc.updatedAt
});

// Where a page is in website generation. Pages that never had a generation are "completed" once they were regenerated or edited (revision 1 is the template's own page), else "not-started".
const generationOf = (doc) => {
  const state = doc.generation?.state;
  if (doc.status === 'generating') return { state: 'generating', error: null };
  if (doc.status === 'failed') return { state: 'failed', error: doc.generation?.error || doc.lastError || null };
  if (state) return { state, error: doc.generation.error || null };
  return { state: doc.currentRevision > 1 ? 'completed' : 'not-started', error: null };
};

const page = (doc) => ({
  id: String(doc._id), siteId: String(doc.siteId), name: doc.name, description: doc.description, route: doc.route, componentPath: doc.componentPath,
  order: doc.order, status: doc.status, generation: generationOf(doc), currentRevision: doc.currentRevision, lastInstruction: doc.lastInstruction, lastError: doc.lastError, updatedAt: doc.updatedAt
});

const job = (doc) => ({
  id: doc.jobId, siteId: String(doc.siteId), pageId: doc.pageId ? String(doc.pageId) : null, type: doc.type, status: doc.status, progress: doc.progress,
  stepName: doc.stepName, error: doc.error, errorCode: doc.errorCode, result: doc.result, instruction: doc.instruction,
  attachments: doc.attachments || [], plan: Array.isArray(doc.plan) ? doc.plan.map(({ pageId, name, route, state, error, revision }) => ({ pageId, name, route, state, error, revision })) : [], createdAt: doc.createdAt, completedAt: doc.completedAt
});

const send = (res, body, status = 200) => res.status(status).json({ success: true, ...body });
const wrap = (handler) => async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };

exports.createSite = wrap(async (req, res) => {
  const { templateId, templateVersion, name, description, theme, typography, idempotencyKey } = req.body || {};
  const result = await siteService.createSite({ user: req.user, templateId, templateVersion, name, description, theme, typography, idempotencyKey });
  send(res, { site: site(result.site, result.pages.length), pages: result.pages.map(page) }, result.created ? 201 : 200);
});

exports.listSites = wrap(async (req, res) => {
  const entries = await siteService.listSites(req.user);
  send(res, { sites: entries.map((entry) => site(entry.site, entry.pageCount)) });
});

exports.getSite = wrap(async (req, res) => {
  const doc = await siteService.getSite(req.user, req.params.siteId);
  const pages = await pageService.listPagesFor(doc);
  const active = await TemplateGenerationJob.findOne({ siteId: doc._id, status: { $in: TemplateGenerationJob.ACTIVE_STATUSES } }).sort({ createdAt: -1 });
  send(res, { site: site(doc, pages.length), pages: pages.map(page), activeJob: active ? job(active) : null });
});

exports.updateSite = wrap(async (req, res) => {
  const { name, description } = req.body || {};
  const doc = await siteService.renameSite(req.user, req.params.siteId, { name, description });
  send(res, { site: site(doc) });
});

exports.deleteSite = wrap(async (req, res) => {
  await siteService.deleteSite(req.user, req.params.siteId);
  send(res, { deleted: true });
});

exports.listPages = wrap(async (req, res) => {
  const pages = await siteService.listPages(req.user, req.params.siteId);
  send(res, { pages: pages.map(page) });
});

exports.createPage = wrap(async (req, res) => {
  const { name, description, route } = req.body || {};
  const result = await pageService.addPage({ user: req.user, siteId: req.params.siteId, name, description, route });
  send(res, { page: page(result.page), warnings: result.warnings }, 201);
});

exports.getPage = wrap(async (req, res) => {
  const { site: owner, page: doc } = await siteService.getPage(req.user, req.params.siteId, req.params.pageId);
  await siteService.rememberPage(req.user, owner._id, doc._id);
  const sections = await pageService.describeSections(owner, doc).catch(() => []);
  send(res, { page: { ...page(doc), sections } });
});

exports.updatePage = wrap(async (req, res) => {
  const { name, description, route } = req.body || {};
  const result = await pageService.renamePage({ user: req.user, siteId: req.params.siteId, pageId: req.params.pageId, name, description, route });
  send(res, { page: page(result.page) });
});

exports.deletePage = wrap(async (req, res) => {
  const result = await pageService.deletePage({ user: req.user, siteId: req.params.siteId, pageId: req.params.pageId });
  send(res, { deleted: true, retargeted: result.retargeted });
});

exports.reorderPages = wrap(async (req, res) => {
  const result = await pageService.reorderPages({ user: req.user, siteId: req.params.siteId, pageIds: req.body?.pageIds });
  send(res, { pages: result.pages.map(page) });
});

exports.listRevisions = wrap(async (req, res) => {
  const result = await revisionService.listRevisions(req.user, req.params.siteId, req.params.pageId);
  send(res, { revisions: result.revisions.map((revision) => ({ number: revision.number, kind: revision.kind, instruction: revision.instruction, current: revision.current, restoredFrom: revision.restoredFrom, createdAt: revision.createdAt })) });
});

exports.getRevision = wrap(async (req, res) => {
  const { site: owner, page: doc } = await siteService.getPage(req.user, req.params.siteId, req.params.pageId);
  const revision = await TemplateRevision.findOne({ siteId: owner._id, pageId: doc._id, number: Number(req.params.number) }).lean();
  if (!revision) throw new NotFoundError('Revision');
  send(res, { revision: { number: revision.number, kind: revision.kind, instruction: revision.instruction, createdAt: revision.createdAt, files: revision.files.filter((file) => !file.deleted).map((file) => ({ path: file.path, content: file.content })) } });
});

exports.restoreRevision = wrap(async (req, res) => {
  const result = await revisionService.restoreRevision({ user: req.user, siteId: req.params.siteId, pageId: req.params.pageId, number: req.params.number });
  send(res, { unchanged: result.unchanged, page: page(result.page) });
});

exports.generateSite = wrap(async (req, res) => {
  const doc = await jobs.startCustomize({ user: req.user, siteId: req.params.siteId, brief: req.body?.brief, photos: req.body?.photos, idempotencyKey: req.body?.idempotencyKey });
  send(res, { job: job(doc) }, 202);
});

exports.uploadPhoto = wrap(async (req, res) => {
  const { photo, reused } = await uploads.addUpload({ user: req.user, siteId: req.params.siteId, buffer: req.file?.buffer, originalName: req.file?.originalname, pageId: req.body?.pageId });
  let result = photo;
  // Every new photo is enhanced automatically in the background; the upload itself never waits for it or fails because of it.
  if (!reused && imageEnhancer.autoEnabled()) {
    result = await enhancements.queueEnhancement({ user: req.user, siteId: req.params.siteId, assetId: photo.id, auto: true }).catch(() => photo);
  }
  send(res, { photo: { ...result, reused } }, reused ? 200 : 201);
});

exports.listImages = wrap(async (req, res) => {
  send(res, { images: await assets.listAssets(req.user, req.params.siteId) });
});

exports.enhanceImage = wrap(async (req, res) => {
  send(res, { image: await enhancements.queueEnhancement({ user: req.user, siteId: req.params.siteId, assetId: req.params.imageId }) }, 202);
});

exports.chooseEnhancement = wrap(async (req, res) => {
  send(res, await enhancements.choose({ user: req.user, siteId: req.params.siteId, assetId: req.params.imageId, choice: req.body?.choice }));
});

exports.imageFile = wrap(async (req, res) => {
  const file = await assets.readAssetFile(req.user, req.params.siteId, req.params.imageId, { version: req.query.version === 'enhanced' ? 'enhanced' : 'original' });
  res.set({ 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  res.send(file.buffer);
});

exports.updateImage = wrap(async (req, res) => {
  send(res, { image: await assets.updateAsset(req.user, req.params.siteId, req.params.imageId, req.body || {}) });
});

exports.deleteImage = wrap(async (req, res) => {
  send(res, await assets.removeAsset(req.user, req.params.siteId, req.params.imageId));
});

exports.replaceImage = wrap(async (req, res) => {
  const result = await assets.replaceAsset({ user: req.user, siteId: req.params.siteId, assetId: req.params.imageId, buffer: req.file?.buffer, originalName: req.file?.originalname });
  send(res, result);
});

/** A past revision of a page, compiled and shown read-only (nothing is saved). */
exports.previewRevision = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { site: owner, page: doc } = await siteService.getPage(req.user, req.params.siteId, req.params.pageId);
  const revision = await TemplateRevision.findOne({ siteId: owner._id, pageId: doc._id, number: Number(req.params.number) }).lean();
  if (!revision) throw new NotFoundError('Revision');
  const files = revision.files.filter((file) => !file.deleted && /^src\//.test(file.path) && file.content && !revisionService.NOT_RESTORED.has(file.path));
  if (!files.length) throw new NotFoundError('Revision files');
  const result = await preview.compileWithOverrides(owner.projectId, files);
  if (!result) throw new NotFoundError('Preview');
  send(res, { preview: { html: result.html, token: result.token, route: doc.route, number: revision.number } });
});

exports.regeneratePage = wrap(async (req, res) => {
  const doc = await jobs.startRegenerate({ user: req.user, siteId: req.params.siteId, pageId: req.params.pageId, instruction: req.body?.instruction, attachments: req.body?.attachments, idempotencyKey: req.body?.idempotencyKey });
  send(res, { job: job(doc) }, 202);
});

exports.retryPage = wrap(async (req, res) => {
  const doc = await jobs.startRetryPage({ user: req.user, siteId: req.params.siteId, pageId: req.params.pageId, idempotencyKey: req.body?.idempotencyKey });
  send(res, { job: job(doc) }, 202);
});

exports.getJob = wrap(async (req, res) => {
  const doc = await jobs.getJob(req.user, req.params.jobId);
  send(res, { job: job(doc) });
});

exports.cancelJob = wrap(async (req, res) => {
  const doc = await jobs.cancelJob(req.user, req.params.jobId);
  send(res, { job: job(doc) });
});

/** The compiled website of the site (served to a sandboxed iframe by the frontend). The page version also says which route to show. */
async function previewFor(req, res, pageId = null) {
  res.set('Cache-Control', 'no-store');
  const owner = pageId ? (await siteService.getPage(req.user, req.params.siteId, pageId)).site : await siteService.getSite(req.user, req.params.siteId);
  const pages = await siteService.listPages(req.user, owner._id);
  const selected = pageId ? pages.find((item) => String(item._id) === String(pageId)) : null;
  const doc = await preview.ensurePrecompiled(owner.projectId);
  if (!doc) throw new NotFoundError('Preview');
  const base = { status: doc.status, sourceHash: doc.sourceHash, compiledAt: doc.compiledAt, error: doc.error || null, siteRevision: owner.revision, route: selected?.route || '/', pages: pages.map((item) => ({ id: String(item._id), name: item.name, route: item.route })) };
  if (doc.status !== 'ready') return send(res, { preview: base });
  const clientHash = String(req.query.hash || '');
  if (clientHash && clientHash === doc.sourceHash) return send(res, { preview: { ...base, token: doc.token, unchanged: true } });
  return send(res, { preview: { ...base, token: doc.token, html: doc.html, bytes: doc.bytes } });
}

exports.getSitePreview = wrap((req, res) => previewFor(req, res));
exports.getPagePreview = wrap((req, res) => previewFor(req, res, req.params.pageId));


/* ------------------------------------------------ website versions, branches, comparison ------------------------------------------------ */

exports.listVersions = wrap(async (req, res) => send(res, await versionService.listVersions(req.user, req.params.siteId, { filter: String(req.query.filter || 'all') })));
exports.history = wrap(async (req, res) => send(res, await versionService.history(req.user, req.params.siteId, { filter: String(req.query.filter || 'all') })));
exports.getVersion = wrap(async (req, res) => send(res, { version: await versionService.getVersion(req.user, req.params.siteId, req.params.versionId) }));

exports.saveVersion = wrap(async (req, res) => {
  const owner = await siteService.getSite(req.user, req.params.siteId);
  const name = String(req.body?.name || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new (require('../utils/errors').ValidationError)('Give the version a name.');
  const { version, created } = await versionService.createVersion({ site: owner, user: req.user, kind: 'manual', name, description: req.body?.description, origin: 'user', operation: 'manual-save', protectedFlag: Boolean(req.body?.protected) });
  send(res, { version: versionService.present(version, null), created }, created ? 201 : 200);
});

exports.updateVersion = wrap(async (req, res) => send(res, { version: await versionService.updateVersion(req.user, req.params.siteId, req.params.versionId, req.body || {}) }));
exports.deleteVersion = wrap(async (req, res) => send(res, await versionService.deleteVersion(req.user, req.params.siteId, req.params.versionId, { confirm: String(req.query.confirm || req.body?.confirm) === 'true' })));
exports.verifyVersion = wrap(async (req, res) => send(res, await versionService.verify(req.user, req.params.siteId, req.params.versionId)));

exports.restoreVersion = wrap(async (req, res) => {
  const result = await versionRestore.restoreVersion({ user: req.user, siteId: req.params.siteId, versionId: req.params.versionId });
  send(res, result);
});

exports.previewVersion = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const owner = await siteService.getSite(req.user, req.params.siteId);
  const version = await versionService.getVersionDoc(owner, req.params.versionId);
  if (version.status !== 'complete') throw new NotFoundError('Version');
  const { hydrateFiles } = require('../services/storage/s3BlobStorage');
  const refs = await versionService.snapshotFiles(version);
  const files = [...(await hydrateFiles(refs.filter((file) => file.encoding !== 'base64'))), ...refs.filter((file) => file.encoding === 'base64')];
  const result = await preview.compileFilesPreview(owner.projectId, files);
  send(res, { preview: { html: result.html, token: result.token, route: '/', number: version.number, name: version.name } });
});

exports.compareVersions = wrap(async (req, res) => {
  const ref = (value, fallbackSite) => (String(value) === 'current' ? { siteId: fallbackSite, current: true } : { siteId: fallbackSite, versionId: String(value) });
  const siteA = req.query.aSite || req.params.siteId;
  const siteB = req.query.bSite || req.params.siteId;
  send(res, { comparison: await versionCompare.compare(req.user, ref(req.query.a || 'current', siteA), ref(req.query.b || 'current', siteB)) });
});
exports.comparePage = wrap(async (req, res) => send(res, { comparison: await versionCompare.comparePageRevision(req.user, req.params.siteId, req.params.pageId, req.params.number) }));

exports.createBranch = wrap(async (req, res) => {
  const { site: branch, pages } = await branchService.createBranch({ user: req.user, siteId: req.params.siteId, versionId: req.params.versionId, name: req.body?.name });
  send(res, { site: site(branch, pages.length), pages: pages.map(page) }, 201);
});
exports.listBranches = wrap(async (req, res) => send(res, { branches: await branchService.listBranches(req.user, req.params.siteId) }));
exports.promoteBranch = wrap(async (req, res) => send(res, await branchService.promoteBranch({ user: req.user, siteId: req.params.siteId })));
exports.assetVersions = wrap(async (req, res) => send(res, await versionService.assetVersions(req.user, req.params.siteId, req.params.imageId)));
