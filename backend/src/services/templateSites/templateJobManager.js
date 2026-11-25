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
const { mergeText } = require('../ai/threeWayMerge');
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
  processing: ['queued', 'processing', 'validating', 'repairing'],
  validating: ['processing', 'validating', 'repairing'],
  repairing: ['processing', 'validating', 'repairing'],
  committing: ['processing', 'validating', 'repairing', 'committing'],
  completed: ['committing'],
  failed: ACTIVE,
  cancelled: ['queued', 'processing', 'validating', 'repairing']
};
const PROGRESS = { queued: 5, processing: 15, validating: 60, repairing: 70, committing: 90, completed: 100 };
// The bar for a page job, by step: writing, checking against the request, the browser tests, the build stages, saving.
const STEP_PROGRESS = [
  [/^Understanding/, 8], [/^Searching the web/, 12], [/^Creating the pictures|^Creating pictures/, 14], [/^Writing the page/, 18], [/^Fixing \d+ problem/, 30],
  [/^Checking the change against/, 40], [/^Writing browser tests/, 50], [/^Building the site and testing/, 56], [/^Checking the code/, 60],
  [/^Installing/, 64], [/^Building the website/, 70], [/^Starting the website/, 74], [/^Testing every page/, 78], [/^Fixing a build/, 80],
  [/^Retrying the build|^Checking the build without|^Retrying the browser test/, 82], [/^Finishing the checks/, 86], [/^Checking the final result/, 88], [/^Checks passed/, 89]
];

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
/**
 * The website brief as the AI may read it. A brief saved from a page instruction (older sites: "rewrite the page for X and remove the rent
 * content" followed by the studio's PAGE CONTEXT of the Listings page) is cut to the owner's own words, so no later job of another page is
 * judged against that page's request.
 */
const cleanBrief = (brief) => require('./templateValidationService').ownerWords(String(brief || '')).trim();

/** A website description for the brief, written from the plan (what the website is and is for), never from an instruction. */
function briefFromPlan(plan, subject = '') {
  const identity = plan?.identity || {};
  const who = subject || identity.name || '';
  const kind = [identity.organizationType, identity.category].filter(Boolean).join(', ');
  return [`A website for ${who || 'the organisation'}${kind ? ` (${kind})` : ''}.`, identity.purpose || '', identity.audience?.length ? `Audience: ${identity.audience.join(', ')}.` : ''].filter(Boolean).join(' ').slice(0, 4000);
}

// A brief that carries the studio's page context was saved from one page's instruction, not written as a description of the website.
const briefIsInstruction = (brief) => /\n\n(?:PAGE CONTEXT|PAGE CONTENT|SECTION(?: \d+)? CONTENT|\(The owner)/.test(String(brief || ''));
const usableBrief = (site, plan) => (plan?.identity && briefIsInstruction(site.brief) ? briefFromPlan(plan) : cleanBrief(site.brief));

function siteContextFor(site, pages, written = [], { plan = site.plan || null, mode = 'edit' } = {}) {
  return { name: plan?.identity?.name || site.name, brief: usableBrief(site, plan), theme: site.theme || null, pages: pages.map((item) => ({ name: item.name, route: item.route, description: item.description })), written, plan, mode };
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
// Tries per page of a whole-website run (the first, and one more told what went wrong).
const WEBSITE_PAGE_TRIES = Number(process.env.TEMPLATE_WEBSITE_PAGE_TRIES) > 0 ? Number(process.env.TEMPLATE_WEBSITE_PAGE_TRIES) : 2;

class JobCancelled extends Error { constructor() { super('Cancelled'); this.name = 'JobCancelled'; } }

const lease = () => ({ leaseOwner: INSTANCE_ID, leaseExpiresAt: new Date(Date.now() + LEASE_MS) });
const leaseFilter = () => ({ $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: new Date() } }, { leaseOwner: INSTANCE_ID }] });

const HEAL_TRIES = Number(process.env.TEMPLATE_HEAL_TRIES) > 0 ? Number(process.env.TEMPLATE_HEAL_TRIES) : 3;
// Failures a new try can fix. Never retried: cancelling, a missing key or credits, an empty instruction, a missing page, or a site that someone else changed.
const NOT_HEALABLE = /^(EMPTY_INSTRUCTION|PAGE_FILE_MISSING|SITE_CHANGED|UNDO_USES_VERSIONS|OPENROUTER_AUTH_ERROR|OPENROUTER_INSUFFICIENT_CREDITS|OPENROUTER_CONTEXT_TOO_LONG|PLAN_LIMIT.*)$/;
function isHealable(error) {
  if (!error || error instanceof JobCancelled || error?.name === 'AbortError' || error?.name === 'OpenRouterAuthError' || error?.name === 'PlanLimitError') return false;
  return !NOT_HEALABLE.test(String(error.code || ''));
}
// What the owner reads when every try failed: plain words, never a build log. The technical text stays in the server log.
const FRIENDLY_CODES = new Set(['PAGE_VALIDATION_FAILED', 'BUILD_VALIDATION_FAILED', 'FINAL_CHECK_FAILED', 'MODEL_ANSWER_UNUSABLE', 'NO_USABLE_CHANGES']);
const FRIENDLY_MESSAGE = 'The AI tried several times but could not apply this change safely, so your page is exactly as it was. Please try again, describe the change in smaller steps, or tick the section you mean.';

/** What a finished job tells the owner besides "done": a part that was skipped and why (a picture that could not be made, the menu kept). */
const noticesOf = (job) => [...new Set((job?.timeline || []).filter((entry) => entry?.state === 'notice').map((entry) => entry.step))];
const addNotice = (job, message) => TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $push: { timeline: { $each: [{ state: 'notice', step: String(message).slice(0, 400), at: new Date() }], $slice: -60 } } }).catch(() => {});

/**
 * What a failed try is "about", to tell whether the next try failed the same way. A validation failure is compared by its problems; a build
 * or browser failure by its errors with the test server's port and the bundle's file name left out (they differ on every build). A dropped
 * connection or a timeout is the build machine's, not the page's: it is never "the same problem", so it is simply tried again.
 */
function repeatSignature(error, generator) {
  if (error?.code === 'PAGE_VALIDATION_FAILED') return generator.problemSignature(error.issues);
  if (error?.code !== 'BUILD_VALIDATION_FAILED') return '';
  const issues = Array.isArray(error.issues) ? error.issues : [];
  if (!issues.length || issues.some((item) => /ECONNRESET|socket hang up|EPIPE|ECONNREFUSED|timed? ?out|Timeout/i.test(String(item?.message || '')))) return '';
  return `build|${require('../ai/validationGate').diagnosticSignature(issues)}`;
}

function failureCode(error, { timedOut = false } = {}) {
  if (timedOut) return 'JOB_TIMEOUT';
  if (error?.code && /^[A-Z_]+$/.test(error.code) && ['PAGE_VALIDATION_FAILED', 'BUILD_VALIDATION_FAILED', 'FINAL_CHECK_FAILED', 'MODEL_ANSWER_UNUSABLE', 'NO_USABLE_CHANGES', 'INTENT_NOT_MET', 'NO_EFFECTIVE_CHANGE', 'EMPTY_INSTRUCTION', 'PAGE_FILE_MISSING', 'SITE_CHANGED', 'UNDO_USES_VERSIONS', 'NEEDS_CLARIFICATION', 'PLAN_FAILED', 'PLAN_UNUSABLE', 'IDENTITY_FAILED', 'PLAN_LIMIT_REACHED'].includes(error.code)) return error.code;
  if (error?.code === 'OPENROUTER_INSUFFICIENT_CREDITS') return 'PROVIDER_CREDITS';
  if (error?.code === 'OPENROUTER_AUTH_ERROR') return 'PROVIDER_AUTH';
  if (error?.code === 'OPENROUTER_RATE_LIMIT') return 'PROVIDER_RATE_LIMIT';
  if (error?.code === 'OPENROUTER_MODEL_UNAVAILABLE') return 'PROVIDER_MODEL';
  if (error?.code === 'OPENROUTER_TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (error?.code === 'OPENROUTER_CONTEXT_TOO_LONG') return 'PROVIDER_CONTEXT_TOO_LONG';
  // The rest is classified the way the incremental editor classifies it (malformed answers, repairs used up, validation kinds).
  return require('../ai/jobSupport/failureCode').failureCode(error, { timedOut });
}

class TemplateJobManager {
  constructor() {
    this.active = new Map();   // jobId -> AbortController (jobs running in THIS process)
    this.deps = {};            // test seam: { callModel, localizeImages, discoverImages, buildGate }
    this.sweeper = null;
  }

  /* ------------------------------------------------ starting ------------------------------------------------ */

  async startRegenerate({ user, siteId, pageId, instruction, attachments = [], focusSection = '', idempotencyKey = null, rewrite = false }) {
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
    await this.assertCanUseAI(userId, site.projectId, { pages: 1 });
    // A page and a whole-website run must never write at the same time.
    if (await TemplateGenerationJob.exists({ siteId: site._id, type: 'site-customize', status: { $in: ACTIVE } })) throw new ConflictError('The whole website is being generated. Wait for it to finish or cancel it first.');
    // The state the job starts from is saved first (nothing new is made when it already is a saved version).
    const base = (await versions.snapshotBefore(site, user, `Before regenerating the ${page.name} page`, { operation: 'regenerate-page' })).version;
    let job;
    try {
      job = await TemplateGenerationJob.create({
        jobId: `tjob_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, siteId: site._id, pageId: page._id, userId,
        type: 'page-regenerate', operation: 'regenerate-page', baseVersionId: base._id, snapshotVersionId: base._id, rewrite: Boolean(rewrite), instruction: text, focusSection: String(focusSection || '').replace(/\s+/g, ' ').trim().slice(0, 120), attachments: photos.map((photo) => photo.path), attachmentPlacements: photos.map(({ path, placement, note }) => ({ path, placement, note })), status: 'queued', progress: PROGRESS.queued, stepName: 'Queued', idempotencyKey: key, activeKey: `page:${page._id}`
      });
    } catch (error) {
      if (error?.code === 11000) {
        const winner = key ? await TemplateGenerationJob.findOne({ userId, idempotencyKey: key }) : null;
        if (winner) return winner;
        throw new ConflictError('This page is already being regenerated. Wait for it to finish or cancel it first.');
      }
      throw error;
    }
    // The check above and the creation are two steps: a website run started in between would write at the same time. Checked again now
    // that this job exists; the later one gives way.
    if (await this.lostRace(job, { type: 'site-customize' })) throw new ConflictError('The whole website is being generated. Wait for it to finish or cancel it first.');
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
    const pages = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
    if (!pages.length) throw new ValidationError('This website has no pages to generate.');
    await this.assertCanUseAI(userId, site.projectId, { pages: pages.length });
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
    if (await this.lostRace(job, {})) throw new ConflictError('A generation is already running for this site.');
    await TemplatePage.updateMany({ _id: { $in: pages.map((page) => page._id) } }, { $set: { status: 'ready', 'generation.state': 'queued', 'generation.error': null, 'generation.updatedAt': new Date(), lastError: null } });
    this.schedule(job.jobId);
    return job;
  }

  /**
   * Another active job of the site that `job` must not run beside (matching `filter`) and that was created first: then `job` is withdrawn
   * (cancelled, its active key freed) and true is returned.
   */
  async lostRace(job, filter) {
    const other = await TemplateGenerationJob.findOne({ siteId: job.siteId, jobId: { $ne: job.jobId }, status: { $in: ACTIVE }, ...filter }).sort({ createdAt: 1, _id: 1 }).select('jobId createdAt _id').lean();
    if (!other || String(other._id) > String(job._id)) return false;
    await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { status: 'cancelled', stepName: 'Cancelled', activeKey: null, completedAt: new Date(), error: 'Another generation was already running for this site.' } });
    return true;
  }

  /** Writes ONE page again from the stored website brief and the page's own purpose (no instruction to type). Same job as Regenerate Page. */
  async startRetryPage({ user, siteId, pageId, idempotencyKey = null }) {
    const { site, page } = await siteService.getPage(user, siteId, pageId);
    const instruction = pagePrompt(site, page);
    return this.startRegenerate({ user, siteId, pageId, instruction, attachments: await this.pageAttachmentInputs(site, page), idempotencyKey, rewrite: true });
  }

  async assertCanUseAI(userId, projectId = null, { pages = 0 } = {}) {
    if (this.deps.skipCreditCheck) return;
    const usage = require('../billing/usageService');
    await usage.assertCanUseAI(userId, { projectId });
    // Tell the user BEFORE the prompt runs when its estimated cost is more than the credits they have.
    // TEMPLATE_PREFLIGHT_ESTIMATE=off turns the up-front estimate off (the run then simply stops when the credits run out).
    if (pages > 0 && String(process.env.TEMPLATE_PREFLIGHT_ESTIMATE || '').toLowerCase() !== 'off') {
      const perPage = require('../billing/plans').creditsForTokens(Number.parseInt(process.env.TEMPLATE_ESTIMATED_TOKENS_PER_PAGE, 10) || 20000);
      await usage.assertCanSpendCredits(userId, pages * perPage, { projectId, estimate: true });
    }
  }

  schedule(jobId) {
    logger.info(`Template job ${jobId} queued.`);
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
    // Progress only goes forward: a retry ("Improving the result, try 2 of 3") or a repair moves the state back, never the bar.
    const { progress, ...rest } = extra;
    const value = progress ?? PROGRESS[to];
    return TemplateGenerationJob.findOneAndUpdate(
      { jobId, status: { $in: FROM[to] } },
      { $set: { status: to, ...(['completed', 'failed', 'cancelled'].includes(to) ? { activeKey: null } : {}), ...rest }, ...(Number.isFinite(value) ? { $max: { progress: value } } : {}) },
      { new: true }
    );
  }

  async progress(jobId, to, stepName, extra = {}) {
    const moved = await this.move(jobId, to, { stepName, ...lease(), ...extra });
    if (moved) logger.info(`Template job ${jobId}: ${String(stepName).slice(0, 120)}`);
    if (moved) TemplateGenerationJob.updateOne({ jobId }, { $push: { timeline: { $each: [{ state: to, step: String(stepName).slice(0, 120), at: new Date() }], $slice: -80 } } }).catch(() => {});
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
    logger.info(`Template job ${jobId} started (${claimed.type}${claimed.focusSection ? `, section "${String(claimed.focusSection).slice(0, 60)}"` : ''}).`);
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
      else await require('../../utils/modelScope').run(process.env.TEMPLATE_EDIT_MODEL, () => this.runRegenerate(claimed, controller.signal)); // the page and section editors use their own model
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
    const limit = job.type === 'site-customize' ? SITE_JOB_MAX_MS : JOB_MAX_MS;
    const message = timedOut ? `The generation took longer than ${limit >= 60000 ? `${Math.round(limit / 60000)} minutes` : `${Math.round(limit / 1000)} seconds`} and was stopped. The page is unchanged.`
      : leaseLost ? `The generation was interrupted (${leaseLost}). The page is unchanged.`
      : error?.code === 'OPENROUTER_CONTEXT_TOO_LONG' ? 'This page is too large for the AI to change in one go, so nothing was changed. Tick only the section you want to change, or ask for a smaller change.'
      : String(error?.message || error).slice(0, 1500);
    const code = leaseLost && !timedOut ? 'JOB_LEASE_LOST' : failureCode(error, { timedOut });
    // The owner is told the real reason in plain words (the checks' own sentences are written to be read), not only "could not apply safely".
    const reason = String(error?.issues?.[0]?.message || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const shown = !timedOut && !leaseLost && FRIENDLY_CODES.has(code) ? `${FRIENDLY_MESSAGE}${reason ? ` What stopped it: ${reason}` : ''}` : message;
    try {
      const fresh = await TemplateGenerationJob.findOne({ jobId: job.jobId }).lean();
      const page = job.pageId ? await TemplatePage.findById(job.pageId).select('name route').lean() : null;
      const pages = await TemplatePage.find({ siteId: job.siteId }).select('name route').lean();
      const first = (fresh?.timeline || [])[0]?.at || fresh?.createdAt || job.createdAt;
      logger.warn(require('./templateJobLog').failureReport({ job: { ...(fresh || job), stepName: (fresh || job).stepName }, code, error, pageName: page?.name || '', pageRoute: page?.route || '', pages, elapsedMs: Date.now() - new Date(first).getTime(), timedOut: Boolean(timedOut) }));
    } catch (reportError) {
      logger.warn(`Template job ${job.jobId} failed (${code}): ${message.slice(0, 400)}`);
    }
    // A website run that saved nothing puts the site back BEFORE it is reported as failed, so what the owner sees afterwards is the working website.
    if (job.type === 'site-customize') await rollbackIfUseless(job);
    const updated = await this.move(job.jobId, 'failed', { error: shown, errorCode: code, stepName: 'Failed', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, result: { detail: message.slice(0, 600), ...(error?.issues?.length ? { issues: error.issues.slice(0, 8).map((item) => ({ stage: item.stage, path: item.path, message: String(item.message || '').slice(0, 300) })) } : {}) } });
    if (updated && job.pageId) await setGeneration(job.pageId, 'failed', shown);
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
      // Where the step is in the whole run (the bar only ever moves forward, see move()).
      const step = STEP_PROGRESS.find(([pattern]) => pattern.test(String(detail || '')));
      this.progress(job.jobId, to, detail || state, step ? { progress: step[1] } : {}).catch(() => {});
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
    if (job.rewrite || !planner.isEnabled(this.deps)) return false;
    // The owner ticked one section (or wrote "In section 04 ..."): that is a change to that section. It never turns the whole website into another
    // kind of website (a new plan, new pictures, a rewritten brand and menu), whatever the words say.
    if (job.focusSection || require('./templateValidationService').namedSections(job.instruction).length) return false;
    const owner = require('./templateValidationService').ownerWords(job.instruction);
    if (!intent.mayChangeCategory(owner) && !(await this.namesNewSubject({ job, page, pages, files, site, signal }))) return false;
    await this.progress(job.jobId, 'processing', 'Understanding the website you want', { progress: 5 });
    // The planner reads what the owner typed, not the section list the studio appends (it names the OLD website's sections).
    const typed = require('./templateValidationService').ownerWords(job.instruction).trim() || job.instruction;
    const earlier = cleanBrief(site.brief);
    const brief = earlier && earlier !== typed ? `${typed}\n\n(An earlier description of this website, which the instruction above overrides where they differ: ${earlier})` : typed;
    const created = await planner.createPlan({ template, pages, files, brief, ownerName: planner.ownerNameFor(site.name, template), deps: this.deps, signal });
    let spent = Number(created.usage?.totalTokens ?? created.usage?.total_tokens ?? 0) || 0;
    const current = site.plan?.identity?.category;
    const same = current ? intent.sameCategory(current, created.plan.identity.category) : created.plan.matchesTemplate;
    if (same) { await this.noteExtraTokens(job, spent); return false; } // the instruction was about the page, not about what the website is
    signal.throwIfAborted();
    const restricted = planner.restrictToExisting(created.plan, pages, page);
    let sitePlan = { ...restricted, jobId: job.jobId, sitemapApplied: true, identityApplied: false, imagesApplied: false };
    // The brief describes the WEBSITE (from the plan), never this page's instruction: it is read by every later job of every page.
    await TemplateSite.updateOne({ _id: site._id }, { $set: { plan: sitePlan, ...(site.brief ? {} : { brief: briefFromPlan(sitePlan, (() => { try { return require('../ai/intentUnderstandingService').namedSubject(owner) || ''; } catch { return ''; } })()) }) } });
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
      // A picture that could not be made leaves a neutral photo slot; the owner is told which and why.
      for (const failed of outcome.images.filter((item) => item.status === 'failed')) await addNotice(job, `The picture "${failed.alt || failed.key}" could not be made, so a neutral photo placeholder is shown instead (${String(failed.error || 'unknown reason').slice(0, 200)}).`);
    }
    signal.throwIfAborted();
    await this.progress(job.jobId, 'processing', 'Writing the website identity', { progress: 12 });
    const ctx = await this.context(job);
    let rewritten;
    try {
      rewritten = await identity.transformIdentity({ template: ctx.template, plan: sitePlan, files: ctx.files, deps: this.deps, signal, onState: () => {} });
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code !== 'IDENTITY_FAILED') throw error;
      // Self-healing: the shared brand, menu and sample records could not be made to match the plan. That is no reason to give up the page
      // the owner asked for: the page is still written for the new website (website mode, the same checks), the shared parts stay as they
      // were, and the owner is told what was kept and why. A later job retries the identity (identityApplied stays false).
      logger.warn(`Template job ${job.jobId}: the website identity was kept as it was; the page is written anyway. ${error.message}`);
      await addNotice(job, `The menu, footer and sample records were kept as they were: ${String(error.message).replace(/^The website identity (did not match the plan|could not be written):\s*/, '').slice(0, 240)}`);
      await TemplateSite.updateOne({ _id: site._id }, { $set: { plan: sitePlan } });
      await this.noteExtraTokens(job, spent);
      return true;
    }
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

  /**
   * With the intent engine on, "rewirte this page for Saveetha Medical College" is read for what it means: it names a NEW SUBJECT, so the
   * website is adapted to it (plan, terms to avoid, shared records and identity) and the page is written against that plan. The words
   * alone ("rewirte" is not in any verb list) cannot decide this.
   */
  async namesNewSubject({ job, page, pages, files, site, signal }) {
    const engine = require('../ai/intentUnderstandingService');
    if (!engine.enabled(this.deps)) return false;
    try {
      const history = await this.pageHistory(job, page);
      const context = generator.intentContext({ page, pages, files, instruction: job.instruction, siteContext: siteContextFor(site, pages), history });
      const result = await engine.understand({ instruction: job.instruction, context, deps: this.deps, signal });
      if (result.usage) await this.noteExtraTokens(job, Number(result.usage.total_tokens ?? result.usage.totalTokens ?? 0) || 0);
      if (!engine.changesSubject(result.intent)) return false;
      // "Rewrite THIS PAGE for Saveetha" changes this page only: the rest of the website is adapted only when the owner asked for the website.
      if (result.intent.scope !== 'entire_website' && !['website_wide_change', 'new_website'].includes(result.intent.intent)) {
        logger.info(`Template job ${job.jobId}: the request is about this page (scope ${result.intent.scope}); the rest of the website is not adapted.`);
        return false;
      }
      // A subject that is the website's own (the college the site is already about, even misspelt: "Savitam" for "Saveetha") is not a new one.
      const known = [site.name, generator.brandOf(files), site.plan?.identity?.name, site.plan?.identity?.category].filter(Boolean).join(' ');
      if (require('./templateWebResearch').samesOrganisation(result.intent.subject, known)) {
        logger.info(`Template job ${job.jobId}: "${result.intent.subject}" is what the website is already about; the website is not adapted.`);
        return false;
      }
      return true;
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn(`Template job ${job.jobId}: the subject check was skipped: ${error.message}`);
      return false;
    }
  }

  /** The last instructions on this page: "do the same again" and "make it like before" are read against them. */
  async pageHistory(job, page) {
    const rows = await TemplateGenerationJob.find({ pageId: page._id, status: 'completed', jobId: { $ne: job.jobId } }).sort({ createdAt: -1 }).limit(3).select('instruction result.changedPaths intent.intent').lean().catch(() => []);
    return rows.map((item) => ({ instruction: require('./templateValidationService').ownerWords(item.instruction), changedPaths: item.result?.changedPaths || [], intent: item.intent?.intent || null }));
  }

  /** Tokens spent before the page itself is written (planning, rewriting the shared parts) are charged with the page's own. */
  async noteExtraTokens(job, tokens) {
    if (!tokens) return;
    job.extraTokens = (job.extraTokens || 0) + tokens;
    await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $inc: { extraTokens: tokens } });
  }

  async runRegenerate(job, signal) {
    let { site, pages, files, template } = await this.context(job);
    // A brief saved from an earlier page instruction is replaced, once, by a description of the website from its plan.
    if (site.plan?.identity && briefIsInstruction(site.brief)) {
      const fixed = briefFromPlan(site.plan);
      await TemplateSite.updateOne({ _id: site._id, brief: site.brief }, { $set: { brief: fixed } });
      logger.info(`Site ${site._id}: its brief was a page instruction; it now describes the website.`);
      site.brief = fixed;
    }
    // A detail page whose sample record is gone opens on "not found": it is moved to a record that exists before it is written.
    if ((await require('./templatePageService').healSampleRoutes(site, { pages, files }).catch(() => [])).length) ({ site, pages, files, template } = await this.context(job));
    let page = pages.find((item) => String(item._id) === String(job.pageId));
    if (!page) throw new NotFoundError('Page');
    this.placeNamedSection(job, files, page);
    let adapted = false;
    try {
      adapted = await this.adaptToCategory({ job, site, pages, files, template, page, signal });
    } catch (error) {
      // Nothing is left half-changed: the site goes back to the version saved before this job.
      await rollbackIfUseless(job).catch(() => {});
      if (signal?.aborted || error instanceof JobCancelled || error?.name === 'AbortError' || !isHealable(error)) throw error;
      // Self-healing: adapting the whole website (plan, pictures, menu) is a help for the page, not the page itself. When it fails the page
      // is still written, as an edit of this page, and the owner is told the website itself was not adapted and why.
      logger.warn(`Template job ${job.jobId}: adapting the website failed (${error?.code || 'error'}); the page is written as an edit of this page. ${error.message}`);
      await addNotice(job, `The website as a whole (menu, footer, sample records) was not adapted to the new subject this time: ${String(error.message).slice(0, 240)}. Only this page was changed.`);
      ({ site, pages, files, template } = await this.context(job));
      page = pages.find((item) => String(item._id) === String(job.pageId)) || page;
      adapted = false;
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
    let photos = await require('./templateUploadService').resolveAttachments(site, job.attachmentPlacements?.length ? job.attachmentPlacements : job.attachments);
    // The owner asks for pictures that do not exist yet ("add a photo of the campus"): the image model makes them, and they are placed like
    // uploaded photos (in the section named, every one checked to be on the page). A website adaptation made its own pictures already.
    if (!adapted && !job.rewrite) {
      const made = await this.makePagePictures({ job, site, files, page, photos, signal });
      if (made.length) { photos = [...photos, ...made]; ({ site, pages, files, template } = await this.context(job)); }
    }
    // Self-healing: a failed try (the AI's answer was unusable, a check or the build failed) is tried again, with what went wrong told to the AI
    // so it takes another way. The owner only sees a failure when every try has failed, and then in plain words.
    // Every name is quoted on its own: the names come from the instruction's "In section 01 ("A"), section 02 ("B"):" lead when it has one
    // (a name may contain a comma), otherwise from what the panel sent.
    const tickedNames = (() => { const named = require('./templateValidationService').namedSections(job.instruction); return named.length ? named : [String(job.focusSection || '').trim()].filter(Boolean); })();
    const baseInstruction = job.focusSection ? `${job.instruction}\n\n(The owner ticked only the section(s) ${tickedNames.map((name) => `"${name.replace(/"/g, "'")}"`).join(', ')} of this page. Change ONLY those sections. Every other section must stay exactly as it is, character for character; do not touch, restyle, reword, reorder or remove them. Use small exact "patch" edits for wording, attributes and classes. When the change wraps or restructures markup (a background picture, a new layout, moving blocks), return the complete file with "modify" so every opening tag keeps its closing tag.)` : job.instruction;
    let lastProblem = '';
    let result;
    // The last instructions on this page: "do the same again" and "make it like before" are read against them.
    const history = await this.pageHistory(job, page);
    const onResearch = (research) => { TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { research } }).catch(() => {}); };
    const onIntent = (intent) => { TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { intent } }).catch(() => {}); };
    let lastSignature = '';
    for (let attemptNo = 1; attemptNo <= HEAL_TRIES; attemptNo += 1) {
      const attemptInstruction = (text) => (lastProblem ? `${text}\n\n(A previous try at this same instruction failed: ${lastProblem}. Take a different, simpler and safer way to make the same change: keep every import and component name valid, make sure every opening tag has its closing tag and the code builds. If the failure was a syntax or build error, return the complete file with "modify" instead of patches. If it was content of the old website, change exactly the file and text it names, or stop rendering that component on this page.)` : text);
      try {
        result = await generator.regeneratePage({ template, page, pages, files, instruction: attemptInstruction(baseInstruction), attachments: photos, deps: this.deps, signal, onState: this.onState(job), onTiming: (entry) => { TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $push: { callTimings: { $each: [entry], $slice: -40 } } }).catch(() => {}); }, siteContext: siteContextFor(site, pages, [], { mode: (job.rewrite || adapted) ? 'website' : 'edit' }), history, onIntent, onResearch });
        break;
      } catch (error) {
        if (signal?.aborted || !isHealable(error) || attemptNo === HEAL_TRIES) throw error;
        // A whole new try only helps when the last one failed differently: the same deterministic problem twice means the page cannot get
        // past it this way, and a third try would only repeat it (and its cost).
        const signature = repeatSignature(error, generator);
        if (signature && signature === lastSignature) {
          logger.warn(`Template job ${job.jobId}: try ${attemptNo} failed with the same problem as the try before; not trying again.`);
          throw error;
        }
        lastSignature = signature;
        lastProblem = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400);
        logger.warn(require('./templateJobLog').retryLine({ jobId: job.jobId, attemptNo, tries: HEAL_TRIES, code: error?.code, error }));
        await this.progress(job.jobId, 'processing', `Improving the result (try ${attemptNo + 1} of ${HEAL_TRIES})`);
        if (/RATE_LIMIT|TIMEOUT/.test(error?.code || '')) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
    signal.throwIfAborted();
    for (const note of result.notices || []) await addNotice(job, note);
    await this.progress(job.jobId, 'validating', 'Checks passed');
    // From here the result is stored on the job before anything else is written: whatever happens next, saving can be finished.
    const assets = await collectAssets(result.files, result.changedPaths);
    const pendingCommit = { pageId: String(page._id), changed: result.changed, previous: result.previous, assets, validation: { mode: result.report?.validationMode || null, status: result.report?.status || null, attempts: result.attempts, functional: result.report?.functional || null }, usage: result.usage, entity: result.entity, intent: result.intent || null, research: result.research || null };
    await this.progress(job.jobId, 'committing', 'Saving the new version');
    await TemplateGenerationJob.updateOne({ jobId: job.jobId }, { $set: { pendingCommit, usage: result.usage } });
    await this.finishCommit(await TemplateGenerationJob.findOne({ jobId: job.jobId }));
  }

  /**
   * Writes a validated change to the site: files, pictures, and the page's revision. Repeating it is safe (a file already saved is skipped,
   * the revision is unique per `revisionJobId`). Used for a single-page job and, page by page, for a whole-website job.
   */
  async applyChange(args) {
    // Another job (another page, a picture) saved the site between reading and writing: the site is read again and the change saved on
    // top of it, like the incremental editor does, instead of failing a page that passed every check.
    for (let tryNumber = 1; ; tryNumber += 1) {
      try { return await this.applyChangeOnce(args); }
      catch (error) {
        if (!(error instanceof ConflictError) || error.code === 'SITE_CHANGED' || tryNumber >= 3) throw error;
        logger.warn(`Template job ${args.job.jobId}: the site changed while saving (try ${tryNumber} of 3); saving again on top of it.`);
        await new Promise((resolve) => setTimeout(resolve, 150 * tryNumber));
      }
    }
  }

  async applyChangeOnce({ job, site, page, pending, revisionJobId, instruction }) {
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
      // Rebase: the page may be saved even if other pages changed meanwhile, but never over someone else's edit of the same file. Edits of
      // different parts of the same file are merged (the incremental editor's three-way merge); only overlapping edits are refused.
      if ((expected && now && now.content !== expected.content) || (!expected && now)) {
        // The page's own component edited elsewhere at the same time is never merged into (someone is working on this page).
        const mergeable = expected && change.path !== page?.componentPath && typeof now.content === 'string' && typeof expected.content === 'string';
        const merged = mergeable ? mergeText(expected.content, now.content, change.content) : null;
        if (merged === null) throw Object.assign(new ConflictError(`${change.path} was changed while the new version was being prepared. Nothing was saved; regenerate the page again.`), { code: 'SITE_CHANGED' });
        logger.info(`Template job ${job.jobId}: ${change.path} was changed by another job meanwhile; both changes were merged.`);
        toWrite.push({ ...change, content: merged });
        continue;
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
        const written = new Map(toWrite.map((change) => [change.path, change]));
        await revisions.recordPageRevision({ site, page, userId: job.userId, kind: 'regenerate', instruction: instruction ?? job.instruction, changed: pending.changed.map((change) => written.get(change.path) || change), previous: pending.previous, jobId: revisionJobId, validation: pending.validation });
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
    // The change may have rewritten the records a detail page shows (its sample /listings/k-1001 is gone): that page is moved to one that exists.
    await require('./templatePageService').healSampleRoutes(site).catch((error) => logger.warn(`Template job ${job.jobId}: sample routes were not checked: ${error.message}`));
    if (page) await setGeneration(page._id, 'completed');
    const flaggedPages = await this.flagOtherPages(job, site, page, pending);
    for (const entry of pending.pageRevisions || []) {
      const target = await TemplatePage.findOne({ _id: entry.pageId, siteId: site._id });
      if (!target) continue;
      await revisions.recordPageRevision({ site, page: target, userId: job.userId, kind: 'regenerate', instruction: job.instruction, changed: pending.changed.filter((file) => file.path === entry.path), previous: pending.previous.filter((file) => file.path === entry.path), jobId: `${job.jobId}:${entry.pageId}`, validation: pending.validation });
    }
    await this.chargeOnce(job);
    const fresh = page ? await TemplatePage.findById(page._id) : null;
    const done = await this.move(job.jobId, 'completed', {
      stepName: 'Completed', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, pendingCommit: null,
      result: { changedPaths: pending.changed.map((file) => file.path), revision: fresh?.currentRevision ?? null, pageId: pending.pageId || null, flaggedPages, validation: pending.validation, entity: pending.entity || null, intent: pending.intent || null, research: pending.research || null, notices: noticesOf(job) }
    });
    if (!done) throw new ConflictError('The job was no longer committing when it finished.');
    logger.info(`Template job ${job.jobId} completed in ${Math.round((Date.now() - new Date(job.startedAt || job.createdAt).getTime()) / 1000)}s.`);
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
      if (delta) await billing.chargeFixedCredits(job.userId, delta, { projectId: (await TemplateSite.findById(fresh.siteId).select('projectId').lean())?.projectId });
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
    const owner = await TemplateSite.findById(job.siteId).select('projectId').lean();
    await require('../billing/usageService').assertCanUseAI(job.userId, { projectId: owner?.projectId });
  }

  /**
   * After a page change was saved: does any OTHER page now have a broken link or a missing picture because of it? The change is never
   * undone for that (it passed its own checks). Each page that got worse is marked "Needs review" with the reason, so the owner edits
   * that page later; a page that was marked this way earlier and is fine again is cleared. Returns [{ pageId, name, messages }].
   */
  async flagOtherPages(job, site, editedPage, pending) {
    try {
      const { files: after } = await store.readSite(site);
      const previous = new Map((pending.previous || []).map((file) => [file.path, file]));
      const added = new Set((pending.changed || []).filter((file) => !file.deleted && !previous.has(file.path)).map((file) => file.path));
      const removed = (pending.changed || []).filter((file) => file.deleted && previous.has(file.path)).map((file) => previous.get(file.path));
      const before = [...after.filter((file) => !added.has(file.path)).map((file) => (previous.has(file.path) && file.encoding !== 'base64' ? { ...file, content: previous.get(file.path).content } : file)), ...removed.map((file) => ({ ...file, encoding: file.encoding || 'utf8' }))];
      const pages = await TemplatePage.find({ siteId: site._id });
      const checks = require('./templateValidationService').finalSiteChecks;
      const nowProblems = checks(after, pages);
      const wasKeys = new Set(checks(before, pages).map((item) => `${item.pageId}|${item.message}`));
      const editedId = editedPage ? String(editedPage._id) : null;
      const byPage = new Map();
      for (const item of nowProblems) {
        if (item.pageId === editedId || wasKeys.has(`${item.pageId}|${item.message}`)) continue;
        byPage.set(item.pageId, [...(byPage.get(item.pageId) || []), item.message]);
      }
      const lead = editedPage ? `After a change to the ${editedPage.name} page: ` : 'After a change to the website: ';
      const flagged = [];
      for (const [pageId, messages] of byPage) {
        const target = pages.find((item) => String(item._id) === pageId);
        const state = target?.generation?.state;
        if (!target || state === 'generating' || state === 'queued') continue;
        await setGeneration(pageId, 'needs-review', `${lead}${[...new Set(messages)].slice(0, 3).join(' ')} Edit this page to fix it.`);
        flagged.push({ pageId, name: target.name, messages: [...new Set(messages)].slice(0, 3) });
      }
      // A page marked this way before that has no problem any more (a later change fixed it) is cleared.
      const stillBroken = new Set(nowProblems.map((item) => item.pageId));
      for (const target of pages) {
        if (target.generation?.state === 'needs-review' && /^After a change to the /.test(target.generation?.error || '') && !stillBroken.has(String(target._id)) && !byPage.has(String(target._id))) await setGeneration(target._id, 'completed');
      }
      if (flagged.length) await addNotice(job, `This change affected ${flagged.length} other page${flagged.length === 1 ? '' : 's'} (${flagged.map((item) => item.name).join(', ')}). ${flagged.length === 1 ? 'It is' : 'They are'} marked "Needs review" in the page list so you can edit ${flagged.length === 1 ? 'it' : 'them'} later.`);
      return flagged;
    } catch (error) {
      logger.warn(`Template job ${job.jobId}: the other pages were not checked after the change: ${error.message}`);
      return [];
    }
  }

  /** Saves one finished picture into the site (right away, so an interrupted run keeps what it already paid for). */
  async persistPicture(job, file) {
    const fresh = await this.context(job);
    const next = [...fresh.files.filter((item) => item.path !== file.path), file];
    const diff = store.diffFiles(fresh.files, next);
    await this.applyChange({ job, site: fresh.site, page: null, pending: { changed: diff.changed, previous: diff.previous, assets: await collectAssets(next, [file.path]), validation: { mode: 'picture' } }, revisionJobId: `${job.jobId}:img:${file.path}`, instruction: 'Website picture' });
  }

  /**
   * 'In the section "Anatomy and Physiology": ...' from the section pop-up names the block by its first heading, which on a grid of cards is
   * the first CARD. The name is placed on the page's real section ('In section 02 ("Neighbourhood Tile"): ...', so the section is known,
   * numbered and every other section locked), with a note of the card the owner opened. Changes the job in memory only.
   */
  placeNamedSection(job, files, page) {
    const lead = /^In the section "([^"]+)":\s*/.exec(String(job.instruction || ''));
    if (!lead) return;
    let found = null;
    try { found = require('./templatePageService').resolveSection(files, page, lead[1]); } catch { found = null; }
    if (!found) return;
    const note = found.record ? `\n\n(The owner opened this section on the card "${found.record}", one of the ${found.records.length || 'several'} records of ${found.dataPath} that it shows${found.records.length ? `: ${found.records.map((item) => `"${item}"`).join(', ')}` : ''}. "All", "every" or "each" means all of those records.)` : '';
    job.instruction = `In section ${String(found.number).padStart(2, '0')} ("${found.name}"): ${job.instruction.slice(lead[0].length)}${note}`.slice(0, 6000);
    job.focusSection = found.name;
    logger.info(`Template job ${job.jobId}: the section "${lead[1]}" is section ${found.number} "${found.name}" of the ${page.name} page${found.record ? ` (a card of ${found.dataPath})` : ''}.`);
  }

  /** Pictures the owner's instruction asks for, made by the image model and saved to the site. Returns them as attachments ([] when none). */
  async makePagePictures({ job, site, files, page, photos, signal }) {
    const pictures = require('./templatePagePictures');
    const owner = require('./templateValidationService').ownerWords(job.instruction);
    // Wanted pictures are planned even when picture generation is off or fails: what cannot be made becomes a placeholder below.
    if (!pictures.wantsPictures(owner, photos)) return [];
    let sections = [];
    try { sections = require('./templatePageService').extractSections((files.find((file) => file.path === page.componentPath) || {}).content || '').map((item) => item.name); } catch { /* sections are optional */ }
    const brand = generator.brandOf(files);
    // A section drawn once per record (department cards): the picture planner is told the records, so "all the cards" is one picture each.
    const named = require('./templateValidationService').namedSections(job.instruction)[0];
    let section = null;
    try { section = named ? require('./templatePageService').resolveSection(files, page, named) : null; } catch { section = null; }
    const planned = await pictures.planPictures({ ownerWords: owner, page, sections, website: brand || site.name, records: section?.records || [], recordsPath: section?.dataPath || '', focus: section?.name || '', deps: this.deps, signal });
    await this.noteExtraTokens(job, Number(planned.usage?.total_tokens ?? planned.usage?.totalTokens ?? 0) || 0);
    if (!planned.pictures.length) return [];
    await this.progress(job.jobId, 'processing', `Creating the pictures for this page (${planned.pictures.length})`);
    const identity = site.plan?.identity || { category: brand || site.name, name: brand || site.name };
    const outcome = await siteImages.generateSiteImages({ userId: job.userId, projectId: site.projectId, plan: { identity, images: pictures.entriesFor(planned.pictures, page, job.jobId) }, deps: this.deps, signal, persist: ({ file }) => this.persistPicture(job, file) });
    logger.info(`Template job ${job.jobId}: ${outcome.ready} of ${planned.pictures.length} picture(s) made for the ${page.name} page${outcome.notes.length ? ` (${outcome.notes.join('; ')})` : ''}.`);
    // A picture that could not be made (nothing came back, no credits, generation off) is not dropped: a neutral placeholder takes its place,
    // in the shape that was asked for, so the page still has the picture where the owner wanted it and the owner can swap a real one in later.
    const images = [];
    for (const entry of outcome.images) {
      if (entry.status === 'ready') { images.push(entry); continue; }
      try {
        const file = pictures.placeholderFile(entry);
        await this.persistPicture(job, file);
        images.push({ ...entry, status: 'ready', placeholder: true, path: file.path.replace(/^public/, ''), width: 0, height: 0 });
        await addNotice(job, `The picture "${entry.alt || entry.subject}" could not be made (${String(entry.error || 'no picture came back').slice(0, 120)}), so a placeholder was put there. Change it later with the image button.`);
      } catch (error) {
        logger.warn(`Template job ${job.jobId}: the placeholder for "${entry.key}" could not be saved: ${error.message}`);
      }
    }
    return pictures.asAttachments(images);
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
      let rewritten = null;
      try {
        rewritten = await identity.transformIdentity({ template: ctx.template, plan: sitePlan, files: ctx.files, deps: this.deps, signal, onState: () => {} });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError' || error?.code !== 'IDENTITY_FAILED') throw error;
        // Self-healing: the pages are still written for the new website; the shared menu and records stay as they were (a retry tries again).
        logger.warn(`Website job ${job.jobId}: the website identity was kept as it was; the pages are written anyway. ${error.message}`);
        await addNotice(job, `The menu, footer and sample records were kept as they were: ${String(error.message).replace(/^The website identity (did not match the plan|could not be written):\s*/, '').slice(0, 240)}`);
      }
      if (rewritten) {
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
        // Self-healing per page, like a single-page job: a page that failed in a way a new try can fix is written once more, told what
        // went wrong; a rate limit is waited out first. The same problem twice is not tried a third time.
        let result;
        let lastProblem = '';
        for (let tryNumber = 1; ; tryNumber += 1) {
          try {
            result = await generator.regeneratePage({
              template: ctx.template, page, pages: ctx.pages, files: ctx.files, instruction: lastProblem ? `${pagePrompt(ctx.site, page)}\n\n(A previous try at this page failed: ${lastProblem}. Take a different, simpler and safer way: keep every import valid, close every tag, and fix exactly what was named.)` : pagePrompt(ctx.site, page), attachments: photos,
              deps: { ...this.deps, buildGate: null }, signal, onState: () => {}, siteContext: siteContextFor(ctx.site, ctx.pages, written, { plan: sitePlan, mode: 'website' })
            });
            break;
          } catch (error) {
            if (signal.aborted || tryNumber >= WEBSITE_PAGE_TRIES || !isHealable(error) || FATAL_PROVIDER.includes(error?.code)) throw error;
            logger.warn(`Website job ${job.jobId}: page ${page.name} try ${tryNumber} failed (${error?.code || 'error'}); trying once more.`);
            lastProblem = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 400);
            await this.progress(job.jobId, 'processing', `Improving ${page.name} (try ${tryNumber + 1} of ${WEBSITE_PAGE_TRIES})`);
            if (/RATE_LIMIT/.test(error?.code || '')) await new Promise((resolve) => setTimeout(resolve, 10000));
          }
        }
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
    const result = { pages: plan.map(({ pageId, name, route, state, error, revision }) => ({ pageId, name, route, state, error, revision })), completed: doneCount(), total, needsAttention: attention.length, validation, ...(imageSummary ? { images: imageSummary } : {}), notices: noticesOf(await TemplateGenerationJob.findOne({ jobId: job.jobId }).select('timeline').lean()) };
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
        if (failed) { abandoned += 1; if (job.pageId) await setGeneration(job.pageId, 'failed', 'The generation was interrupted repeatedly. The page is unchanged.'); }
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
module.exports.__test = { briefIsInstruction, siteContextFor, briefFromPlan, repeatSignature };
