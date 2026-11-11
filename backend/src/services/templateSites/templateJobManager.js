/**
 * Background jobs of the template workspace: regenerate one page, or customise a whole new site.
 *
 * States:  queued -> processing -> validating <-> repairing -> committing -> completed   (any running state -> failed | cancelled)
 * Every transition is one atomic update that names the states it may come from, so an invalid transition (and a job that was
 * cancelled meanwhile) can never be overwritten. A running job holds a lease that it renews; a job whose lease expired belongs to
 * nobody and is recovered. Saving is idempotent: the revision is unique per job, credits are claimed once per job, and a save that
 * was interrupted is finished from the stored change instead of generating again.
 */
const os = require('node:os');
const crypto = require('node:crypto');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const TemplatePage = require('../../models/TemplatePage');
const TemplateSite = require('../../models/TemplateSite');
const TemplateRevision = require('../../models/TemplateRevision');
const templateService = require('../templates/templateService');
const siteService = require('./templateSiteService');
const store = require('./siteFileStore');
const revisions = require('./templateRevisionService');
const generator = require('./templatePageGenerator');
const { bumpSite, extractHeadings } = require('./templatePageService');
const templateValidation = require('./templateValidationService');
const planner = require('./templateSitePlanner');
const { routePhotos } = require('./templatePhotoRouting');
const identity = require('./templateSiteIdentity');
const intent = require('./templateIntent');
const siteImages = require('./templateSiteImages');
const versions = require('./templateVersionService');
const versionRestore = require('./templateVersionRestore');
const semantic = require('./templateSemanticValidator');
const { NotFoundError, ValidationError, ConflictError } = require('../../utils/errors');
const TemplateAsset = require('../../models/TemplateAsset');
const { dehydrateFiles } = require('../storage/s3BlobStorage');
const logger = require('../../utils/logger');

const INSTANCE_ID = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const LEASE_MS = Number.parseInt(process.env.TEMPLATE_JOB_LEASE_MS, 10) || 45000;
const HEARTBEAT_MS = Math.max(1000, Math.floor(LEASE_MS / 3));
const JOB_MAX_MS = Number.parseInt(process.env.TEMPLATE_JOB_MAX_MS, 10) || 30 * 60 * 1000;
const SITE_JOB_MAX_MS = Number.parseInt(process.env.TEMPLATE_SITE_JOB_MAX_MS, 10) || 3 * 60 * 60 * 1000; // a whole website takes a page-by-page run
const MAX_RECOVERIES = 2;

const ACTIVE = TemplateGenerationJob.ACTIVE_STATUSES;
// Where each state may be entered from.
const FROM = {
  processing: ['queued', 'processing'],
  validating: ['processing', 'validating', 'repairing'],
  repairing: ['processing', 'validating', 'repairing'],
  committing: ['processing', 'validating', 'repairing', 'committing'],
  completed: ['committing'],
  failed: ACTIVE,
  cancelled: ['queued', 'processing', 'validating', 'repairing']
};
const PROGRESS = { queued: 5, processing: 15, validating: 60, repairing: 70, committing: 90, completed: 100 };

/** New pictures of a change are stored in object storage first, so the saved change refers to them by reference (not by megabytes in the job). */
async function collectAssets(files, changedPaths) {
  const binary = files.filter((file) => file.encoding === 'base64' && changedPaths.includes(file.path));
  if (!binary.length) return [];
  const stored = await dehydrateFiles(binary);
  return stored.map((file) => ({ path: file.path, blob: file.blob, encoding: 'base64', language: file.language || 'binary', sha256: file.blob?.sha256 || null, size: file.blob?.size || 0, mime: file.blob?.contentType || '' }));
}

/** Records where a page is in website generation (and keeps the older `status` field in step with it). */
function setGeneration(pageId, state, error = null) {
  const legacy = state === 'generating' ? 'generating' : state === 'failed' ? 'failed' : 'ready';
  return TemplatePage.updateOne({ _id: pageId }, { $set: { status: legacy, 'generation.state': state, 'generation.error': error ? String(error).slice(0, 500) : null, 'generation.updatedAt': new Date(), ...(state === 'failed' ? { lastError: String(error || '').slice(0, 500) } : { lastError: null }) } });
}

/** Pages that were waiting or running when a website job stopped go back to what they were (derived from their revisions). */
function clearPending(plan = []) {
  const ids = plan.filter((entry) => ['queued', 'generating'].includes(entry.state)).map((entry) => entry.pageId);
  if (!ids.length) return Promise.resolve();
  return TemplatePage.updateMany({ _id: { $in: ids } }, { $set: { status: 'ready' }, $unset: { generation: '' } });
}

/** Website-level context given to every page generation: the website's name and brief, and every page with its purpose. */
function siteContextFor(site, pages, written = [], { plan = site.plan || null, mode = 'edit' } = {}) {
  return { name: plan?.identity?.name || site.name, brief: site.brief || '', theme: site.theme || null, pages: pages.map((item) => ({ name: item.name, route: item.route, description: item.description })), written, plan, mode };
}

/** What each page of a whole-website run is asked to do: the brief is website-level context, this line is the page-level task. */
function pagePrompt(site, page) {
  return `Write the "${page.name}" page (route ${page.route}) of this website.${page.description ? ` Purpose of the page: ${page.description}` : ''}\nMake it complete and specific to the website brief, with real, relevant copy and sections that suit this page, in the same voice and visual language as the rest of the website. Replace placeholder text from the template.`;
}

/**
 * A whole-website run that saved NO page leaves the site half-changed (pages renamed, identity rewritten). Put it back to the version
 * saved before the run, as a new version, so a failed generation never replaces a working website.
 */
async function rollbackIfUseless(job, user) {
  try {
    const fresh = await TemplateGenerationJob.findOne({ jobId: job.jobId }).select('plan snapshotVersionId siteId userId').lean();
    if (!fresh?.snapshotVersionId) return;
    if ((fresh.plan || []).some((entry) => entry.state === 'completed' || entry.state === 'needs-review')) return;
    const site = await TemplateSite.findOne({ _id: fresh.siteId, userId: fresh.userId, status: 'active' });
    if (!site) return;
    const snapshot = await require('../../models/TemplateVersion').findById(fresh.snapshotVersionId).lean();
    const state = await versions.currentState(site);
    if (!snapshot || (snapshot.treeHash === state.treeHash && snapshot.pagesHash === state.pagesHash)) return;
    await versionRestore.restoreVersion({ user: fresh.userId, siteId: site._id, versionId: fresh.snapshotVersionId, kind: 'rollback', auto: true, exceptJobId: job.jobId });
    logger.info(`Website job ${job.jobId} failed without saving a page: the site was put back to version ${snapshot.number}.`);
  } catch (error) { logger.error(`Website job ${job.jobId}: automatic rollback failed: ${error.message}`); }
}

// Errors that stop a whole-website run (every later page would fail the same way): the AI provider refused, or the account is out of credits.
const FATAL_PROVIDER = ['OPENROUTER_INSUFFICIENT_CREDITS', 'OPENROUTER_AUTH_ERROR', 'PLAN_LIMIT_REACHED'];

class JobCancelled extends Error { constructor() { super('Cancelled'); this.name = 'JobCancelled'; } }

const lease = () => ({ leaseOwner: INSTANCE_ID, leaseExpiresAt: new Date(Date.now() + LEASE_MS) });
const leaseFilter = () => ({ $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: new Date() } }, { leaseOwner: INSTANCE_ID }] });

function failureCode(error, { timedOut = false } = {}) {
  if (timedOut) return 'JOB_TIMEOUT';
  if (error?.code && /^[A-Z_]+$/.test(error.code) && ['PAGE_VALIDATION_FAILED', 'BUILD_VALIDATION_FAILED', 'FINAL_CHECK_FAILED', 'MODEL_ANSWER_UNUSABLE', 'NO_USABLE_CHANGES', 'EMPTY_INSTRUCTION', 'PAGE_FILE_MISSING', 'SITE_CHANGED', 'PLAN_FAILED', 'PLAN_UNUSABLE', 'IDENTITY_FAILED', 'PLAN_LIMIT_REACHED'].includes(error.code)) return error.code;
  if (error?.code === 'OPENROUTER_INSUFFICIENT_CREDITS') return 'PROVIDER_CREDITS';
  if (error?.code === 'OPENROUTER_AUTH_ERROR') return 'PROVIDER_AUTH';
  if (error?.code === 'OPENROUTER_RATE_LIMIT') return 'PROVIDER_RATE_LIMIT';
  if (error?.code === 'OPENROUTER_MODEL_UNAVAILABLE') return 'PROVIDER_MODEL';
  if (error?.code === 'OPENROUTER_TIMEOUT') return 'PROVIDER_TIMEOUT';
  return 'JOB_FAILED';
}

class TemplateJobManager {
  constructor() {
    this.active = new Map();   // jobId -> AbortController (jobs running in THIS process)
    this.deps = {};            // test seam: { callModel, localizeImages, discoverImages, buildGate }
    this.sweeper = null;
  }

  /* ------------------------------------------------ starting ------------------------------------------------ */

  async startRegenerate({ user, siteId, pageId, instruction, attachments = [], idempotencyKey = null, rewrite = false }) {
    const text = String(instruction ?? '').trim();
    if (!text) throw new ValidationError('Describe the change you want for this page.');
    if (text.length > 4000) throw new ValidationError('The instruction must be 4000 characters or fewer.');
    const { site, page } = await siteService.getPage(user, siteId, pageId);
    const userId = siteService.idOf(user);
    const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
    if (key) {
      const existing = await TemplateGenerationJob.findOne({ userId, idempotencyKey: key });
      if (existing) return existing;
    }
    const photos = await require('./templateUploadService').resolveAttachments(site, attachments);
    await this.assertCanUseAI(userId);
    // A page and a whole-website run must never write at the same time.
    if (await TemplateGenerationJob.exists({ siteId: site._id, type: 'site-customize', status: { $in: ACTIVE } })) throw new ConflictError('The whole website is being generated. Wait for it to finish or cancel it first.');
    // The state the job starts from is saved first (nothing new is made when it already is a saved version).
    const base = (await versions.snapshotBefore(site, user, `Before regenerating the ${page.name} page`, { operation: 'regenerate-page' })).version;
    let job;
    try {
      job = await TemplateGenerationJob.create({
        jobId: `tjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, siteId: site._id, pageId: page._id, userId,
        type: 'page-regenerate', operation: 'regenerate-page', baseVersionId: base._id, snapshotVersionId: base._id, rewrite: Boolean(rewrite), instruction: text, attachments: photos.map((photo) => photo.path), attachmentPlacements: photos.map(({ path, placement, note }) => ({ path, placement, note })), status: 'queued', progress: PROGRESS.queued, stepName: 'Queued', idempotencyKey: key, activeKey: `page:${page._id}`
      });
    } catch (error) {
      if (error?.code === 11000) {
        const winner = key ? await TemplateGenerationJob.findOne({ userId, idempotencyKey: key }) : null;
        if (winner) return winner;
        throw new ConflictError('This page is already being regenerated. Wait for it to finish or cancel it first.');
      }
      throw error;
    }
    await setGeneration(page._id, 'generating');
    // The pictures chosen for this change are now tied to this page in the library.
    if (photos.length) await require('../../models/TemplateAsset').updateMany({ siteId: site._id, projectPath: { $in: photos.map((photo) => `public${photo.path}`) } }, { $addToSet: { pageIds: page._id } }).catch(() => {});
    this.schedule(job.jobId);
    return job;
  }

  /**
   * Starts writing EVERY page of the site, one after another, from one website description. The description is stored with the site
   * (so it is entered once and every later page generation gets it too); `brief` may be left out to reuse the stored one.
   */
  async startCustomize({ user, siteId, brief, photos = [], idempotencyKey = null }) {
    const site = await siteService.getSite(user, siteId);
    const text = String(brief ?? site.brief ?? '').trim();
    if (!text) throw new ValidationError('Describe the website you want.');
    if (text.length > 4000) throw new ValidationError('The description must be 4000 characters or fewer.');
    const userId = siteService.idOf(user);
    const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
    if (key) {
      const existing = await TemplateGenerationJob.findOne({ userId, idempotencyKey: key });
      if (existing) return existing;
    }
    if (await TemplateGenerationJob.exists({ siteId: site._id, status: { $in: ACTIVE } })) throw new ConflictError('A generation is already running for this site.');
    await this.assertCanUseAI(userId);
    const pages = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
    if (!pages.length) throw new ValidationError('This website has no pages to generate.');
    // Photos added while creating the site must really belong to it (the same check the page instructions use).
    const sitePhotos = (await require('./templateUploadService').resolveAttachments(site, photos)).map((photo) => ({ path: photo.path, placement: photo.placement, note: photo.note }));
    if (text !== site.brief) await TemplateSite.updateOne({ _id: site._id }, { $set: { brief: text } });
    const plan = pages.map((page) => ({ pageId: String(page._id), name: page.name, route: page.route, state: 'queued', error: null, revision: null, attempts: 0 }));
    // The whole website is about to be rewritten: the way back is saved first.
    const base = (await versions.snapshotBefore(site, user, 'Before generating the website', { operation: 'generate-site' })).version;
    let job;
    try {
      job = await TemplateGenerationJob.create({
        jobId: `tjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, siteId: site._id, pageId: null, userId, type: 'site-customize', operation: 'generate-site', baseVersionId: base._id, snapshotVersionId: base._id,
        instruction: text, plan, sitePhotos, status: 'queued', progress: PROGRESS.queued, stepName: 'Queued', idempotencyKey: key, activeKey: `site:${site._id}`
      });
    } catch (error) {
      if (error?.code === 11000) throw new ConflictError('A generation is already running for this site.');
      throw error;
    }
    await TemplatePage.updateMany({ _id: { $in: pages.map((page) => page._id) } }, { $set: { status: 'ready', 'generation.state': 'queued', 'generation.error': null, 'generation.updatedAt': new Date(), lastError: null } });
    this.schedule(job.jobId);
    return job;
  }

  /** Writes ONE page again from the stored website brief and the page's own purpose (no instruction to type). Same job as Regenerate Page. */
  async startRetryPage({ user, siteId, pageId, idempotencyKey = null }) {
    const { site, page } = await siteService.getPage(user, siteId, pageId);
    const instruction = pagePrompt(site, page);
    return this.startRegenerate({ user, siteId, pageId, instruction, attachments: await this.pageAttachmentInputs(site, page), idempotencyKey, rewrite: true });
  }

  async assertCanUseAI(userId) {
    if (this.deps.skipCreditCheck) return;
    await require('../billing/usageService').assertCanUseAI(userId);
  }

  schedule(jobId) {
    setImmediate(() => this.execute(jobId).catch((error) => logger.error(`Template job ${jobId} crashed: ${error.message}`)));
  }

  /* ------------------------------------------------ reading and cancelling ------------------------------------------------ */

  async getJob(user, jobId) {
    const job = await TemplateGenerationJob.findOne({ jobId: String(jobId), userId: siteService.idOf(user) });
    if (!job) throw new NotFoundError('Job');
    return job;
  }

  async cancelJob(user, jobId) {
    const job = await this.getJob(user, jobId);
    if (job.status === 'committing') throw new ConflictError('The result is being saved and can no longer be cancelled.');
    if (!ACTIVE.includes(job.status)) return job;
    const cancelled = await this.move(job.jobId, 'cancelled', { stepName: 'Cancelled', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null });
    this.active.get(job.jobId)?.abort();
    if (job.pageId) await TemplatePage.updateOne({ _id: job.pageId }, { $set: { status: 'ready' }, $unset: { generation: '' } });
    if (job.type === 'site-customize') await clearPending(job.plan);
    return cancelled || await TemplateGenerationJob.findOne({ jobId: job.jobId });
  }

  /* ------------------------------------------------ state machine ------------------------------------------------ */

  /** One atomic transition. Returns the updated job, or null when the job is not in a state that may move there. */
  move(jobId, to, extra = {}) {
    return TemplateGenerationJob.findOneAndUpdate(
      { jobId, status: { $in: FROM[to] } },
      { $set: { status: to, progress: PROGRESS[to] ?? undefined, ...(['completed', 'failed', 'cancelled'].includes(to) ? { activeKey: null } : {}), ...extra } },
      { new: true }
    );
  }

  async progress(jobId, to, stepName, extra = {}) {
    const moved = await this.move(jobId, to, { stepName, ...lease(), ...extra });
    if (!moved) {
      const current = await TemplateGenerationJob.findOne({ jobId }).select('status').lean();
      if (current?.status === 'cancelled') throw new JobCancelled();
      throw new ConflictError(`Job ${jobId} cannot move to ${to} from ${current?.status || 'unknown'}.`);
    }
    return moved;
  }

  /* ------------------------------------------------ running ------------------------------------------------ */

  async execute(jobId) {
    if (this.active.has(jobId)) return;
    const claimed = await TemplateGenerationJob.findOneAndUpdate(
      { jobId, status: { $in: ['queued', 'processing', 'validating', 'repairing'] }, ...leaseFilter() },
      { $set: { status: 'processing', stepName: 'Starting', progress: PROGRESS.processing, ...lease() }, $min: { startedAt: new Date() }, $inc: { attempts: 1 } },
      { new: true }
    );
    if (!claimed) return;
    const controller = new AbortController();
    this.active.set(jobId, controller);
    let leaseLost = null;
    let timedOut = false;
    const heartbeat = setInterval(async () => {
      try {
        const renewed = await TemplateGenerationJob.updateOne({ jobId, leaseOwner: INSTANCE_ID, status: { $in: ACTIVE } }, { $set: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
        if (!renewed.matchedCount) {
          const current = await TemplateGenerationJob.findOne({ jobId }).select('status leaseOwner').lean();
          if (current && ACTIVE.includes(current.status) && current.leaseOwner && current.leaseOwner !== INSTANCE_ID) { leaseLost = 'another process took over this job'; controller.abort(); }
          else if (current?.status === 'cancelled') controller.abort();
        }
      } catch (error) { logger.warn(`Template job ${jobId} lease renewal failed: ${error.message}`); }
    }, HEARTBEAT_MS);
    const limit = claimed.type === 'site-customize' ? SITE_JOB_MAX_MS : JOB_MAX_MS;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limit);
    heartbeat.unref?.();
    timer.unref?.();
    try {
      if (claimed.pendingCommit) await this.finishCommit(claimed);
      else if (claimed.type === 'site-customize') await this.runCustomize(claimed, controller.signal);
      else await this.runRegenerate(claimed, controller.signal);
    } catch (error) {
      await this.fail(claimed, error, { timedOut, leaseLost });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timer);
      this.active.delete(jobId);
    }
  }

  async fail(job, error, { timedOut = false, leaseLost = null } = {}) {
    if (error instanceof JobCancelled || (error?.name === 'AbortError' && !timedOut && !leaseLost)) {
      if (job.pageId) await TemplatePage.updateOne({ _id: job.pageId }, { $set: { status: 'ready' }, $unset: { generation: '' } });
      if (job.type === 'site-customize') { await clearPending((await TemplateGenerationJob.findOne({ jobId: job.jobId }).select('plan').lean())?.plan); await rollbackIfUseless(job); }
      return;
    }
    const message = timedOut ? `The generation took longer than ${JOB_MAX_MS >= 60000 ? `${Math.round(JOB_MAX_MS / 60000)} minutes` : `${Math.round(JOB_MAX_MS / 1000)} seconds`} and was stopped. The page is unchanged.`
      : leaseLost ? `The generation was interrupted (${leaseLost}). The page is unchanged.`
      : String(error?.message || error).slice(0, 1500);
    const code = leaseLost && !timedOut ? 'JOB_LEASE_LOST' : failureCode(error, { timedOut });
    logger.warn(`Template job ${job.jobId} failed (${code}): ${message}`);
    // A website run that saved nothing puts the site back BEFORE it is reported as failed, so what the owner sees afterwards is the working website.
    if (job.type === 'site-customize') await rollbackIfUseless(job);
    const updated = await this.move(job.jobId, 'failed', { error: message, errorCode: code, stepName: 'Failed', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, result: error?.issues?.length ? { issues: error.issues.slice(0, 8) } : null });
    if (updated && job.pageId) await setGeneration(job.pageId, 'failed', message);
    if (updated && job.type === 'site-customize') await clearPending((await TemplateGenerationJob.findOne({ jobId: job.jobId }).select('plan').lean())?.plan);
  }

  async context(job) {
    const site = await TemplateSite.findOne({ _id: job.siteId, userId: job.userId, status: 'active' });
    if (!site) throw new NotFoundError('Site');
    const pages = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
    const { files, projectRevision } = await store.readSite(site);
    const template = templateService.resolveTemplate(site.templateId, { version: site.templateVersion });
    return { site, pages, files, projectRevision, template };
  }

  onState(job) {
    return (state, detail) => {
      const to = state === 'generating' ? 'processing' : state;
      this.progress(job.jobId, to, detail || state).catch(() => {});
    };
  }

  /**
   * "Make this page for a college website": an instruction that changes WHAT the website is, not how one thing looks. The planner (the
   * same call that plans a whole website) decides the kind of website; when it differs from the site's current one, the plan is cut down
   * to the existing pages (nothing is added, deleted or moved), pictures for this page and the sample cards are made, and the shared
   * identity (brand, menu, footer, sample records, title) is rewritten, so the page and the shared parts agree. The page is then written
   * in website mode (replace the old subject, semantic checks on). Returns true when it did so.
   */
  async adaptToCategory({ job, site, pages, files, template, page, signal }) {
    if (job.rewrite || !intent.mayChangeCategory(job.instruction) || !planner.isEnabled(this.deps)) return false;
    await this.progress(job.jobId, 'processing', 'Understanding the website you want', { progress: 5 });
    const brief = site.brief && site.brief !== job.instruction ? `${job.instruction}\n\n(An earlier description of this website, which the instruction above overrides where they differ: ${site.brief})` : job.instruction;
    const created = await planner.createPlan({ template, pages, files, brief, ownerName: planner.ownerNameFor(site.name, template), deps: this.deps, signal });
    let spent = Number(created.usage?.totalTokens ?? created.usage?.total_tokens ?? 0) || 0;
    const current = site.plan?.identity?.category;
    const same = current ? intent.sameCategory(current, created.plan.identity.category) : created.plan.matchesTemplate;
    if (same) { await this.noteExtraTokens(job, spent); return false; } // the instruction was about the page, not about what the website is
    signal.throwIfAborted();
    const restricted = planner.restrictToExisting(created.plan, pages, page);
    let sitePlan = { ...restricted, jobId: job.jobId, sitemapApplied: true, identityApplied: false, imagesApplied: false };
    await TemplateSite.updateOne({ _id: site._id }, { $set: { plan: sitePlan, ...(site.brief ? {} : { brief: job.instruction.slice(0, 4000) }) } });
    // The existing pages take the planner's names (routes never change), so the menu and the page list say the same thing.
    for (const entry of restricted.pages) {
      const existing = pages.find((item) => item.route === entry.route);
      if (existing && entry.name && (entry.name !== existing.name || (entry.purpose && entry.purpose !== existing.description))) {
        await require('./templatePageService').renamePage({ user: job.userId, siteId: site._id, pageId: existing._id, name: entry.name, description: entry.purpose || existing.description, exceptJobId: job.jobId });
      }
    }
    if (sitePlan.images?.length) {
      await this.progress(job.jobId, 'processing', 'Creating pictures for the website', { progress: 8 });
      const outcome = await siteImages.generateSiteImages({ userId: job.userId, projectId: site.projectId, plan: sitePlan, deps: this.deps, signal, persist: ({ file }) => this.persistPicture(job, file) });
      sitePlan.images = outcome.images;
      sitePlan.imagesApplied = true;
      await TemplateSite.updateOne({ _id: site._id }, { $set: { plan: sitePlan } });
    }
    signal.throwIfAborted();
    await this.progress(job.jobId, 'processing', 'Writing the website identity', { progress: 12 });
    const ctx = await this.context(job);
    const rewritten = await identity.transformIdentity({ template: ctx.template, plan: sitePlan, files: ctx.files, deps: this.deps, signal, onState: () => {} });
    spent += Number(rewritten.usage?.totalTokens ?? rewritten.usage?.total_tokens ?? 0) || 0;
    if (ctx.site.theme) rewritten.files = require('./templateTheme').applyTheme(rewritten.files, ctx.site.theme, ctx.template);
    const diff = store.diffFiles(ctx.files, rewritten.files);
    if (diff.changed.length) {
      await this.applyChange({ job, site: ctx.site, page: null, pending: { changed: diff.changed, previous: diff.previous, assets: await collectAssets(rewritten.files, diff.changed.map((file) => file.path)), validation: { mode: 'identity' } }, revisionJobId: `${job.jobId}:identity`, instruction: 'Website identity' });
    }
    sitePlan.identityApplied = true;
    await TemplateSite.updateOne({ _id: site._id }, { $set: { plan: sitePlan } });
    await this.noteExtraTokens(job, spent);
    return true;
  }

  /** Tokens spent before the page itself is written (planning, rewriting the shared parts) are charged with the page's own. */
  async noteExtraTokens(job, tokens) {
    if (!tokens) return;
    job.extraTokens = (job.extraTokens || 0) + tokens;
    await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $inc: { extraTokens: tokens } });
  }

  async runRegenerate(job, signal) {
    let { site, pages, files, template } = await this.context(job);
    const page = pages.find((item) => String(item._id) === String(job.pageId));
    if (!page) throw new NotFoundError('Page');
    let adapted = false;
    try {
      adapted = await this.adaptToCategory({ job, site, pages, files, template, page, signal });
    } catch (error) {
      // Nothing is left half-changed: the site goes back to the version saved before this job.
      await rollbackIfUseless(job).catch(() => {});
      throw error;
    }
    if (adapted) ({ site, pages, files, template } = await this.context(job));
    try { await this.writePage({ job, signal, site, pages, files, template, page, adapted }); }
    catch (error) { if (adapted) await rollbackIfUseless(job).catch(() => {}); throw error; }
  }

  async writePage({ job, signal, site, pages, files, template, page, adapted }) {
    // Retrying a page of a planned website also makes the pictures planned for it that are still missing.
    const missing = (job.rewrite && !adapted) && site.plan?.images ? site.plan.images.filter((item) => item.page === page.route && item.status !== 'ready') : [];
    if (missing.length) {
      await this.progress(job.jobId, 'processing', 'Creating the pictures for this page');
      const plan = site.plan;
      const outcome = await siteImages.generateSiteImages({ userId: job.userId, projectId: site.projectId, plan: { ...plan, images: plan.images.filter((item) => item.page === page.route) }, deps: this.deps, signal, persist: ({ file }) => this.persistPicture(job, file) });
      plan.images = plan.images.map((item) => outcome.images.find((made) => made.key === item.key) || item);
      await TemplateSite.updateOne({ _id: site._id }, { $set: { plan } });
      ({ site, pages, files, template } = await this.context(job));
    }
    await this.progress(job.jobId, 'processing', 'Writing the page');
    const photos = await require('./templateUploadService').resolveAttachments(site, job.attachmentPlacements?.length ? job.attachmentPlacements : job.attachments);
    const result = await generator.regeneratePage({ template, page, pages, files, instruction: job.instruction, attachments: photos, deps: this.deps, signal, onState: this.onState(job), siteContext: siteContextFor(site, pages, [], { mode: (job.rewrite || adapted) ? 'website' : 'edit' }) });
    signal.throwIfAborted();
    await this.progress(job.jobId, 'validating', 'Checks passed');
    // From here the result is stored on the job before anything else is written: whatever happens next, saving can be finished.
    const assets = await collectAssets(result.files, result.changedPaths);
    const pendingCommit = { pageId: String(page._id), changed: result.changed, previous: result.previous, assets, validation: { mode: result.report?.validationMode || null, status: result.report?.status || null, attempts: result.attempts }, usage: result.usage, entity: result.entity };
    await this.progress(job.jobId, 'committing', 'Saving the new version');
    await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { pendingCommit, usage: result.usage } });
    await this.finishCommit(await TemplateGenerationJob.findOne({ jobId: job.jobId }));
  }

  /**
   * Writes a validated change to the site: files, pictures, and the page's revision. Repeating it is safe (a file already saved is skipped,
   * the revision is unique per `revisionJobId`). Used for a single-page job and, page by page, for a whole-website job.
   */
  async applyChange({ job, site, page, pending, revisionJobId, instruction }) {
    const { files: current, projectRevision } = await store.readSite(site);
    const byPath = new Map(current.map((file) => [file.path, file]));
    const textOf = (file) => (file ? file.content : undefined);
    const previousByPath = new Map(pending.previous.map((file) => [file.path, file]));
    const toWrite = [];
    const assetPaths = new Set((pending.assets || []).map((asset) => asset.path));
    for (const change of pending.changed) {
      const now = byPath.get(change.path);
      if (assetPaths.has(change.path)) continue; // pictures are added below from their stored copy
      if (change.deleted) { if (now) toWrite.push(change); continue; }
      if (textOf(now) === change.content) continue; // already saved by an earlier, interrupted attempt
      const expected = previousByPath.get(change.path);
      // Rebase: the page may be saved even if other pages changed meanwhile, but never over someone else's edit of the same file.
      if ((expected && now && now.content !== expected.content) || (!expected && now)) {
        throw Object.assign(new ConflictError(`${change.path} was changed while the new version was being prepared. Nothing was saved; regenerate the page again.`), { code: 'SITE_CHANGED' });
      }
      toWrite.push(change);
    }
    const newAssets = (pending.assets || []).filter((asset) => !byPath.has(asset.path));
    let writtenRevision = null;
    if (toWrite.length || newAssets.length) {
      let next = current;
      for (const change of toWrite) {
        if (change.deleted) next = next.filter((file) => file.path !== change.path);
        else if (byPath.has(change.path)) next = next.map((file) => (file.path === change.path ? { ...file, content: change.content } : file));
        else next = [...next, { path: change.path, content: change.content, language: change.language, encoding: 'utf8' }];
      }
      for (const asset of newAssets) next = [...next, { path: asset.path, content: '', blob: asset.blob, encoding: 'base64', language: asset.language }];
      store.assertNoNewProblems(current, next);
      writtenRevision = await store.writeSite(site, next, projectRevision);
    }
    for (const asset of pending.assets || []) {
      // The site's own record of the picture: the same bytes are stored once per site.
      await TemplateAsset.updateOne({ siteId: site._id, sha256: asset.sha256 }, { $setOnInsert: { userId: job.userId, pageId: page?._id || null, projectPath: asset.path, sha256: asset.sha256, mime: asset.mime, size: asset.size, jobId: job.jobId } }, { upsert: true }).catch((error) => { if (error?.code !== 11000) throw error; });
    }
    try {
      if (page) {
        await revisions.recordPageRevision({ site, page, userId: job.userId, kind: 'regenerate', instruction: instruction ?? job.instruction, changed: pending.changed, previous: pending.previous, jobId: revisionJobId, validation: pending.validation });
      } else {
        await bumpSite(site._id);
      }
    } catch (error) {
      if (writtenRevision != null) await store.rollbackSite(site, current, writtenRevision).catch(() => {});
      throw error;
    }
  }

  /**
   * Saves a validated change: files, revision, page state, credits, completion. Every step is safe to repeat, so a save that was
   * interrupted is simply run again.
   */
  async finishCommit(job) {
    if (job.status !== 'committing') await this.progress(job.jobId, 'committing', 'Saving the new version');
    const pending = job.pendingCommit;
    const site = await TemplateSite.findOne({ _id: job.siteId, userId: job.userId });
    if (!site) throw new NotFoundError('Site');
    const targets = pending.pageId ? [await TemplatePage.findOne({ _id: pending.pageId, siteId: site._id })] : [];
    const page = targets[0] || null;
    if (pending.pageId && !page) throw new NotFoundError('Page');

    await this.applyChange({ job, site, page, pending, revisionJobId: job.jobId });
    if (page) await setGeneration(page._id, 'completed');
    for (const entry of pending.pageRevisions || []) {
      const target = await TemplatePage.findOne({ _id: entry.pageId, siteId: site._id });
      if (!target) continue;
      await revisions.recordPageRevision({ site, page: target, userId: job.userId, kind: 'regenerate', instruction: job.instruction, changed: pending.changed.filter((file) => file.path === entry.path), previous: pending.previous.filter((file) => file.path === entry.path), jobId: `${job.jobId}:${entry.pageId}`, validation: pending.validation });
    }
    await this.chargeOnce(job);
    const fresh = page ? await TemplatePage.findById(page._id) : null;
    const done = await this.move(job.jobId, 'completed', {
      stepName: 'Completed', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, pendingCommit: null,
      result: { changedPaths: pending.changed.map((file) => file.path), revision: fresh?.currentRevision ?? null, pageId: pending.pageId || null, validation: pending.validation, entity: pending.entity || null }
    });
    if (!done) throw new ConflictError('The job was no longer committing when it finished.');
  }

  /**
   * Charges the job's AI use against the account's credits (the same credits, usage log and monthly allowance as every other AI task:
   * 1 credit per 20,000 tokens). `totalTokens` is the job's running total; only the part not yet charged is taken, so calling this after
   * every page and again at the end charges each token exactly once, and a recovered job never charges twice.
   */
  async chargeUsage(job, totalTokens) {
    if (this.deps.skipCreditCheck || !totalTokens) return;
    const billing = require('../billing/usageService');
    const expected = require('../billing/plans').creditsForTokens(totalTokens);
    const fresh = await TemplateGenerationJob.findOne({ jobId: job.jobId }).select('creditsCharged tokensRecorded siteId').lean();
    const already = fresh?.creditsCharged || 0;
    const recorded = fresh?.tokensRecorded || 0;
    if (expected <= already && totalTokens <= recorded) return;
    // Claim the difference first (compare-and-set), so two writers cannot both charge it.
    const claimed = await TemplateGenerationJob.findOneAndUpdate(
      { jobId: job.jobId, creditsCharged: already === 0 ? { $in: [0, null] } : already, tokensRecorded: recorded === 0 ? { $in: [0, null] } : recorded },
      { $set: { creditsCharged: Math.max(already, expected), tokensRecorded: Math.max(recorded, totalTokens), creditChargedAt: new Date() } }
    );
    if (!claimed) return;
    try {
      const delta = Math.max(0, expected - already);
      const tokens = Math.max(0, totalTokens - recorded);
      if (tokens) {
        const site = await TemplateSite.findById(fresh.siteId).select('projectId').lean();
        await require('../../models/AIUsage').create({ userId: job.userId, projectId: site?.projectId, model: 'template-studio', provider: 'openrouter', inputTokens: 0, outputTokens: tokens, totalTokens: tokens, usageSource: 'reported' });
      }
      if (delta) await billing.chargeFixedCredits(job.userId, delta);
    } catch (error) {
      await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { creditsCharged: already, tokensRecorded: recorded } }).catch(() => {});
      logger.error(`Template job ${job.jobId}: credit charge failed: ${error.message}`);
    }
  }

  /** The final charge of a page job: what the page cost plus what was spent before it (planning, rewriting the shared parts). */
  async chargeOnce(job) {
    if (this.deps.skipCreditCheck) return;
    await this.chargeUsage(job, (job.pendingCommit?.usage?.totalTokens || job.usage?.totalTokens || 0) + (job.extraTokens || 0));
  }

  /** Before paid work continues: the account must still have credits (and monthly allowance). Throws the billing error otherwise. */
  async assertCredits(job) {
    if (this.deps.skipCreditCheck) return;
    await require('../billing/usageService').assertCanUseAI(job.userId);
  }

  /** Saves one finished picture into the site (right away, so an interrupted run keeps what it already paid for). */
  async persistPicture(job, file) {
    const fresh = await this.context(job);
    const next = [...fresh.files.filter((item) => item.path !== file.path), file];
    const diff = store.diffFiles(fresh.files, next);
    await this.applyChange({ job, site: fresh.site, page: null, pending: { changed: diff.changed, previous: diff.previous, assets: await collectAssets(next, [file.path]), validation: { mode: 'picture' } }, revisionJobId: `${job.jobId}:img:${file.path}`, instruction: 'Website picture' });
  }

  /** The pictures the owner tied to this page (and only those), as inputs for resolveAttachments. */
  async pageAttachmentInputs(site, page) {
    const uploads = require('./templateUploadService');
    const tagged = await TemplateAsset.find({ siteId: site._id, source: 'upload', deletedAt: null, pageIds: page._id }).sort({ createdAt: 1 }).limit(uploads.MAX_ATTACHMENTS).lean();
    return tagged.map((asset) => ({ path: uploads.toPublic(asset.projectPath), placement: asset.placement, note: asset.note }));
  }

  savePlan(jobId, plan, extra = {}) {
    return TemplateGenerationJob.updateOne({ jobId }, { $set: { plan, ...extra } });
  }

  /**
   * Writes every page of the site, in order, one at a time, with the existing page generator. Each page is checked and SAVED (with its
   * own revision) before the next one starts, so finished pages are in the preview while the rest are written, a failed page never
   * undoes the others, and a resumed job skips what is already saved. When all pages are done the whole site is checked once.
   */
  async runCustomize(job, signal) {
    let ctx = await this.context(job);
    let tokens = job.usage?.totalTokens || 0;
    const tokensOf = (usage) => Number(usage?.totalTokens ?? usage?.total_tokens ?? 0) || 0;

    /* 1. Understand the website: category, sitemap, navigation, vocabulary, what to avoid. Saved on the site; every page job reads it. */
    let sitePlan = ctx.site.plan && ctx.site.plan.jobId === job.jobId ? ctx.site.plan : null;
    if (!sitePlan && planner.isEnabled(this.deps)) {
      await this.progress(job.jobId, 'processing', 'Planning the website', { progress: 6 });
      const created = await planner.createPlan({ template: ctx.template, pages: ctx.pages, files: ctx.files, brief: job.instruction, ownerName: planner.ownerNameFor(ctx.site.name, ctx.template), deps: this.deps, signal });
      tokens += tokensOf(created.usage);
      sitePlan = { ...created.plan, jobId: job.jobId, sitemapApplied: false, identityApplied: false };
      // A colour palette the owner chose is final: a palette guessed from the description never replaces it.
      if (ctx.site.theme?.colors) sitePlan.theme = null;
      await TemplateSite.updateOne({ _id: ctx.site._id }, { $set: { plan: sitePlan } });
    }
    const savePlanState = () => TemplateSite.updateOne({ _id: ctx.site._id }, { $set: { plan: sitePlan } });

    /* 2. Make the pages match the plan (existing page operations keep routes, menu and links consistent). */
    let plan;
    if (sitePlan && !sitePlan.sitemapApplied) {
      signal.throwIfAborted();
      await this.progress(job.jobId, 'processing', 'Setting up the pages', { progress: 10 });
      const planned = await planner.applySitemap({ user: job.userId, site: ctx.site, plan: sitePlan, exceptJobId: job.jobId });
      sitePlan.sitemapApplied = true;
      await savePlanState();
      plan = planned.map((page) => ({ pageId: String(page._id), name: page.name, route: page.route, state: 'queued', error: null, revision: null, attempts: 0 }));
      await TemplatePage.updateMany({ _id: { $in: planned.map((page) => page._id) } }, { $set: { status: 'ready', 'generation.state': 'queued', 'generation.error': null, 'generation.updatedAt': new Date(), lastError: null } });
      ctx = await this.context(job);
    } else {
      plan = (Array.isArray(job.plan) && job.plan.length ? job.plan : ctx.pages.map((page) => ({ pageId: String(page._id), name: page.name, route: page.route, state: 'queued', error: null, revision: null, attempts: 0 }))).map((entry) => ({ ...entry }));
    }
    await this.savePlan(job.jobId, plan);

    /* 2a. The owner's own photos (added while creating the site) go to the pages they belong to; the pictures planned for those spots are not made. */
    if (sitePlan && job.sitePhotos?.length && !sitePlan.photosApplied) {
      const routed = routePhotos(job.sitePhotos, ctx.pages, require('./templateUploadService').MAX_ATTACHMENTS);
      for (const { photo, page } of routed) {
        await TemplateAsset.updateOne({ siteId: ctx.site._id, projectPath: `public${photo.path}`, source: 'upload' }, { $addToSet: { pageIds: page._id }, $set: { ...(photo.placement ? { placement: photo.placement } : {}), ...(photo.note ? { note: photo.note } : {}) } });
      }
      const heroRoutes = new Set(routed.filter(({ photo }) => photo.placement === 'hero').map(({ page }) => page.route));
      if (heroRoutes.size) sitePlan.images = (sitePlan.images || []).filter((image) => !(image.aspect === '16:9' && heroRoutes.has(image.page)));
      sitePlan.photosApplied = true;
      await savePlanState();
    }

    /* 2b. Real pictures for the website (one AI photograph each, saved as soon as it exists). A picture that cannot be made leaves a neutral slot. */
    let imageSummary = null;
    if (sitePlan && !sitePlan.imagesApplied && sitePlan.images?.length) {
      signal.throwIfAborted();
      await this.progress(job.jobId, 'processing', 'Creating pictures for the website', { progress: 12 });
      const outcome = await siteImages.generateSiteImages({
        userId: job.userId, projectId: ctx.site.projectId, plan: sitePlan, deps: this.deps, signal,
        persist: ({ file }) => this.persistPicture(job, file),
        progress: async (list) => { sitePlan.images = list; await savePlanState(); }
      });
      sitePlan.images = outcome.images;
      sitePlan.imagesApplied = true;
      await savePlanState();
      imageSummary = { ready: outcome.ready, failed: outcome.failed, skipped: outcome.skipped, notes: outcome.notes };
      ctx = await this.context(job);
    }

    /* 3. The template's own identity (brand, menu, footer, sample data, title) becomes the website's. Pages may never touch these files. */
    if (sitePlan && !sitePlan.identityApplied) {
      signal.throwIfAborted();
      await this.progress(job.jobId, 'processing', 'Writing the website identity', { progress: 14 });
      const rewritten = await identity.transformIdentity({ template: ctx.template, plan: sitePlan, files: ctx.files, deps: this.deps, signal, onState: () => {} });
      tokens += tokensOf(rewritten.usage);
      // The model rewrites index.html and the data files; the owner's theme (fonts link, theme block) is put back exactly.
      if (ctx.site.theme) rewritten.files = require('./templateTheme').applyTheme(rewritten.files, ctx.site.theme, ctx.template);
      const diff = store.diffFiles(ctx.files, rewritten.files);
      if (diff.changed.length) {
        await this.applyChange({ job, site: ctx.site, page: null, pending: { changed: diff.changed, previous: diff.previous, assets: await collectAssets(rewritten.files, diff.changed.map((file) => file.path)), validation: { mode: 'identity' } }, revisionJobId: `${job.jobId}:identity`, instruction: 'Website identity' });
      }
      sitePlan.identityApplied = true;
      await savePlanState();
      ctx = await this.context(job);
    }

    for (const entry of plan) if (entry.state === 'generating') entry.state = 'queued'; // an interrupted page starts again
    const total = plan.length;
    const doneCount = () => plan.filter((entry) => entry.state === 'completed').length;
    await this.savePlan(job.jobId, plan, { usage: { totalTokens: tokens } });
    let stoppedEarly = null;

    for (const entry of plan) {
      if (entry.state !== 'queued') continue;
      signal.throwIfAborted();
      ctx = await this.context(job); // the site as it is now: earlier pages are already saved
      const page = ctx.pages.find((item) => String(item._id) === entry.pageId);
      if (!page) { entry.state = 'failed'; entry.error = 'This page no longer exists.'; await this.savePlan(job.jobId, plan); continue; }
      entry.state = 'generating'; entry.attempts += 1; entry.error = null;
      await setGeneration(page._id, 'generating');
      await this.savePlan(job.jobId, plan);
      await this.progress(job.jobId, 'processing', `Writing ${page.name} (${doneCount() + 1} of ${total})`, { progress: Math.round(10 + (80 * doneCount()) / total) });
      try {
        await this.assertCredits(job); // every page is paid work: stop cleanly when the credits are used up
        const photos = await require('./templateUploadService').resolveAttachments(ctx.site, await this.pageAttachmentInputs(ctx.site, page));
        const written = plan.filter((item) => item.state === 'completed').map((item) => {
          const done = ctx.pages.find((other) => String(other._id) === item.pageId);
          const file = done && ctx.files.find((candidate) => candidate.path === done.componentPath);
          return { name: item.name, headings: file ? extractHeadings(String(file.content || '')).slice(0, 4) : [] };
        }).filter((item) => item.headings.length);
        const result = await generator.regeneratePage({
          template: ctx.template, page, pages: ctx.pages, files: ctx.files, instruction: pagePrompt(ctx.site, page), attachments: photos,
          deps: { ...this.deps, buildGate: null }, signal, onState: () => {}, siteContext: siteContextFor(ctx.site, ctx.pages, written, { plan: sitePlan, mode: 'website' })
        });
        signal.throwIfAborted();
        const assets = await collectAssets(result.files, result.changedPaths);
        const pending = { pageId: String(page._id), changed: result.changed, previous: result.previous, assets, validation: { mode: result.report?.validationMode || null, status: result.report?.status || null, attempts: result.attempts } };
        await this.applyChange({ job, site: ctx.site, page, pending, revisionJobId: `${job.jobId}:${entry.pageId}:${entry.attempts}`, instruction: `Website generation: ${page.name}` });
        const fresh = await TemplatePage.findById(page._id);
        entry.revision = fresh?.currentRevision ?? null;
        tokens += result.usage?.totalTokens || 0;
        await this.chargeUsage(job, tokens); // charged as the pages are saved, so the balance and the next check are always current
        if (result.reviewNotes?.length) {
          // Saved and relevant, but the reviewer still had remarks: the owner is told, nothing is regenerated.
          entry.state = 'needs-review'; entry.error = result.reviewNotes.slice(0, 2).map((item) => item.message).join(' ').slice(0, 500);
          await setGeneration(page._id, 'needs-review', entry.error);
        } else {
          entry.state = 'completed';
          await setGeneration(page._id, 'completed');
        }
      } catch (error) {
        if (signal.aborted || error instanceof JobCancelled || error?.name === 'AbortError') { entry.state = 'queued'; await this.savePlan(job.jobId, plan); throw error; }
        entry.state = 'failed'; entry.error = String(error?.message || error).slice(0, 500);
        await setGeneration(page._id, 'failed', entry.error);
        logger.warn(`Website job ${job.jobId}: page ${page.name} failed: ${entry.error}`);
        if (FATAL_PROVIDER.includes(error?.code)) { stoppedEarly = error; await this.savePlan(job.jobId, plan, { usage: { totalTokens: tokens } }); break; }
      }
      await this.savePlan(job.jobId, plan, { usage: { totalTokens: tokens } });
    }

    if (stoppedEarly) {
      // The AI provider refused (no credit, bad key): the pages already saved stay; the rest go back to not started and nothing is marked done.
      await clearPending(plan);
      throw stoppedEarly;
    }
    const saved = () => plan.filter((entry) => entry.state === 'completed' || entry.state === 'needs-review').length;
    if (!saved()) {
      await clearPending(plan);
      throw Object.assign(new Error(plan.find((entry) => entry.state === 'failed')?.error || 'No page could be generated.'), { code: 'PAGE_VALIDATION_FAILED' });
    }

    // The whole site, once: every page file and route, links, pictures, then the build and a browser test of every route.
    await this.progress(job.jobId, 'validating', 'Checking the whole website', { progress: 92 });
    signal.throwIfAborted();
    ctx = await this.context(job);
    const flags = new Map();
    const flag = (pageId, message) => { if (!flags.has(pageId)) flags.set(pageId, []); flags.get(pageId).push(message); };
    const generatedIds = new Set(plan.filter((entry) => entry.state === 'completed' || entry.state === 'needs-review').map((entry) => entry.pageId));
    for (const found of templateValidation.finalSiteChecks(ctx.files, ctx.pages)) if (generatedIds.has(found.pageId)) flag(found.pageId, found.message);
    if (sitePlan?.images?.length) {
      // Every picture that was made exists as a readable image and is really placed on its page.
      const bad = await siteImages.checkPictures({ plan: sitePlan, files: ctx.files, pages: ctx.pages });
      for (const problem of bad) {
        const target = ctx.pages.find((page) => page.route === problem.route);
        if (problem.broken) { const entry = sitePlan.images.find((item) => item.key === problem.key); if (entry) { entry.status = 'failed'; entry.error = problem.message; } }
        if (target && generatedIds.has(String(target._id))) flag(String(target._id), problem.message);
      }
      // A picture that could not be made leaves its page on a neutral slot: say so on the page (Retry makes the picture again).
      const imageGen = require('./templateImageGenerator');
      for (const entry of sitePlan.images) {
        if (!entry.page || !(entry.status === 'failed' || (entry.status === 'skipped' && imageGen.isEnabled(this.deps)))) continue;
        const target = ctx.pages.find((page) => page.route === entry.page);
        if (target && generatedIds.has(String(target._id))) flag(String(target._id), `A picture for this page could not be made (${String(entry.error || 'unknown reason').slice(0, 120)}), so it shows a neutral photo slot. Use Retry to make it again.`);
      }
      if (bad.length) { await savePlanState(); if (imageSummary) imageSummary.problems = bad.map((item) => item.message); }
    }
    if (sitePlan?.avoidTerms?.length) {
      // Anything of the template's original website that is still visible on a finished page.
      for (const page of ctx.pages) {
        if (!generatedIds.has(String(page._id))) continue;
        const source = ctx.files.find((file) => file.path === page.componentPath)?.content || '';
        const leaked = semantic.findAvoided(semantic.visibleText(source), sitePlan.avoidTerms);
        if (leaked.length) flag(String(page._id), `Still contains content from the template's original website: ${leaked.slice(0, 5).join(', ')}.`);
      }
    }
    if (sitePlan) {
      // The finished website as a whole: shared files, placeholders, brand-name consistency, menu links, pages left as the template had them.
      const homeId = String((ctx.pages.find((page) => page.route === '/') || ctx.pages[0])?._id || '');
      const problems = semantic.siteWideProblems({ plan: sitePlan, files: ctx.files, pages: ctx.pages, originalFiles: templateService.instantiateFiles(ctx.template), brief: ctx.site.brief || job.instruction });
      for (const problem of problems) {
        const target = problem.pageId || homeId;
        if (target && (problem.pageId ? generatedIds.has(target) : true)) flag(target, problem.message);
      }
    }
    let validation = { status: 'passed', mode: 'static-only', warning: null };
    const gate = this.deps.buildGate === undefined ? templateValidation.runBuildGate : this.deps.buildGate;
    if (gate) {
      try {
        const gated = await gate(ctx.files, { routes: ['/', ...ctx.pages.map((page) => page.route)], signal, maxRepairs: 0, onProgress: () => {} });
        validation = { status: gated.report?.status || 'passed', mode: gated.report?.validationMode || null, warning: null };
        const diff = store.diffFiles(ctx.files, gated.files);
        if (diff.changed.length) await this.applyChange({ job, site: ctx.site, page: null, pending: { changed: diff.changed, previous: diff.previous, assets: await collectAssets(gated.files, diff.changed.map((file) => file.path)), validation }, revisionJobId: `${job.jobId}:site` });
      } catch (error) {
        if (signal.aborted || error?.name === 'AbortError') throw error;
        const reason = String(error?.report?.reason || error?.message || 'The build check failed.').slice(0, 400);
        validation = { status: 'failed', mode: error?.report?.validationMode || null, warning: reason };
        // Blame only the pages the build report points at; a problem it cannot attribute is reported, never "fixed" by regenerating.
        const text = JSON.stringify(error?.report?.history?.at(-1)?.diagnostics || []) + reason;
        for (const page of ctx.pages) if (generatedIds.has(String(page._id)) && (text.includes(page.componentPath) || text.includes(`Route ${page.route}`))) flag(String(page._id), `The site check reported a problem on this page: ${reason}`);
      }
    }
    for (const [pageId, messages] of flags) {
      const entry = plan.find((item) => item.pageId === pageId);
      if (entry) { entry.state = 'needs-review'; entry.error = messages.slice(0, 3).join(' ').slice(0, 500); }
      await setGeneration(pageId, 'needs-review', messages.slice(0, 3).join(' '));
    }

    const attention = plan.filter((entry) => entry.state === 'failed' || entry.state === 'needs-review');
    const result = { pages: plan.map(({ pageId, name, route, state, error, revision }) => ({ pageId, name, route, state, error, revision })), completed: doneCount(), total, needsAttention: attention.length, validation, ...(imageSummary ? { images: imageSummary } : {}) };
    // The finished website is saved as a version of its own (after every page is saved and checked). A failure here never undoes the pages.
    let resultVersion = null;
    try {
      const made = await versions.createVersion({
        site: ctx.site, user: job.userId, kind: 'generate', origin: 'ai', operation: 'generate-site', jobId: job.jobId, parentId: job.snapshotVersionId || undefined,
        name: sitePlan?.identity?.name ? `${sitePlan.identity.name} website generated` : 'Website generated',
        description: `${doneCount()} of ${total} pages written from the description${attention.length ? `; ${attention.length} need attention` : ''}.`,
        affectedPages: plan.filter((entry) => entry.state === 'completed' || entry.state === 'needs-review').map((entry) => entry.pageId)
      });
      resultVersion = made.version;
      await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { resultVersionId: resultVersion._id } });
    } catch (error) { logger.error(`Website job ${job.jobId}: the result version could not be saved: ${error.message}`); }
    result.versionId = resultVersion ? String(resultVersion._id) : null;
    await this.progress(job.jobId, 'committing', 'Finishing', { progress: 98 });
    await this.savePlan(job.jobId, plan, { usage: { totalTokens: tokens } });
    await this.chargeOnce(await TemplateGenerationJob.findOne({ jobId: job.jobId }));
    const done = await this.move(job.jobId, 'completed', {
      stepName: attention.length ? `Finished: ${attention.length} page${attention.length === 1 ? '' : 's'} need attention` : 'Completed', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, pendingCommit: null, result
    });
    if (!done) throw new ConflictError('The job was no longer running when it finished.');
  }

  /* ------------------------------------------------ recovery ------------------------------------------------ */

  /** Takes over jobs whose process died (their lease expired). A saved-but-unfinished change is finished; the rest are re-run, a limited number of times. */
  async recover() {
    const orphan = { $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: new Date() } }], leaseOwner: { $ne: INSTANCE_ID }, updatedAt: { $lt: new Date(Date.now() - LEASE_MS) } };
    const stale = await TemplateGenerationJob.find({ status: { $in: ACTIVE }, ...orphan });
    let resumed = 0;
    let abandoned = 0;
    for (const job of stale) {
      if (this.active.has(job.jobId)) continue;
      if (job.status === 'committing' && job.pendingCommit) {
        const claimed = await TemplateGenerationJob.findOneAndUpdate({ _id: job._id, status: 'committing', leaseOwner: job.leaseOwner }, { $set: lease() }, { new: true });
        if (claimed) { resumed += 1; this.finishCommit(claimed).catch((error) => this.fail(claimed, error)); }
        continue;
      }
      if (job.recoveryAttempts >= MAX_RECOVERIES) {
        const failed = await TemplateGenerationJob.findOneAndUpdate({ _id: job._id, status: { $in: ACTIVE } }, { $set: { status: 'failed', error: 'The generation was interrupted repeatedly. The page is unchanged.', errorCode: 'JOB_ABANDONED', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, activeKey: null } });
        if (failed) { abandoned += 1; if (job.pageId) await TemplatePage.updateOne({ _id: job.pageId }, { $set: { status: 'failed' } }); }
        continue;
      }
      const requeued = await TemplateGenerationJob.findOneAndUpdate({ _id: job._id, status: { $in: ACTIVE }, recoveryAttempts: job.recoveryAttempts, ...orphan }, { $set: { status: 'queued', stepName: 'Resuming', leaseOwner: null, leaseExpiresAt: null }, $inc: { recoveryAttempts: 1 } }, { new: true });
      if (requeued) { resumed += 1; this.schedule(requeued.jobId); }
    }
    return { resumed, abandoned };
  }

  startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.recover().catch((error) => logger.warn(`Template job recovery failed: ${error.message}`)), Number.parseInt(process.env.TEMPLATE_JOB_SWEEP_MS, 10) || 30000);
    this.sweeper.unref?.();
  }
}

module.exports = new TemplateJobManager();
module.exports.TemplateJobManager = TemplateJobManager;
module.exports.INSTANCE_ID = INSTANCE_ID;
module.exports.FROM = FROM;
