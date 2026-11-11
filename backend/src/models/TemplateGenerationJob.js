const mongoose = require('mongoose');

// A background AI job of the template workspace (regenerate one page, or customise a whole new site). Same lease / timeout /
// error-code conventions as GenerationJob, but with its own state machine (validating and repairing are real states here).
const STATUSES = ['queued', 'processing', 'validating', 'repairing', 'committing', 'completed', 'failed', 'cancelled'];
const ACTIVE = ['queued', 'processing', 'validating', 'repairing', 'committing'];

const templateGenerationJobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSite', required: true, index: true },
  pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplatePage', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['page-regenerate', 'site-customize'], required: true },
  instruction: { type: String, default: '', maxlength: 4000 },
  // Photos the user attached to the instruction: paths of pictures already uploaded to the site (e.g. /assets/images/uploaded-ab12.jpg).
  attachments: { type: [String], default: [] },
  // Per-photo placement the owner chose: [{ path, placement, note }].
  // Website generation: one entry per page, in order: [{ pageId, name, route, state: queued|generating|completed|failed|needs-review, error, revision, attempts }]. Saved after every page, so a resumed job skips the finished ones.
  plan: { type: mongoose.Schema.Types.Mixed, default: [] },
  // Version control: the version the job started from, the safety snapshot taken before it, the version it produced, and what it was.
  baseVersionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  snapshotVersionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  resultVersionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  operation: { type: String, default: null },
  // A page job that rewrites the page for the planned website (retry of a page), instead of editing it.
  rewrite: { type: Boolean, default: false },
  attachmentPlacements: { type: mongoose.Schema.Types.Mixed, default: [] },
  status: { type: String, enum: STATUSES, default: 'queued', index: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  stepName: { type: String, default: 'Queued' },
  error: { type: String, default: null },
  errorCode: { type: String, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  // The validated change waiting to be saved (set when the job enters `committing`), so an interrupted save is finished, not regenerated.
  pendingCommit: { type: mongoose.Schema.Types.Mixed, default: null },
  attempts: { type: Number, default: 0 },
  repairRounds: { type: Number, default: 0 },
  // Charge once per job (same claim pattern as GenerationJob).
  // Photos the owner added while creating the site: [{ path, placement, note }]. They are given to the pages they belong to once the sitemap exists.
  sitePhotos: { type: mongoose.Schema.Types.Mixed, default: [] },
  creditChargedAt: { type: Date, default: null },
  // Credits already taken for this job, and the tokens already recorded in the usage log: a job is charged as it goes and never twice.
  creditsCharged: { type: Number, default: 0 },
  tokensRecorded: { type: Number, default: 0 },
  // Tokens spent before the page was written (understanding and rewriting the website for a one-page transformation).
  extraTokens: { type: Number, default: 0 },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
  leaseOwner: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null },
  recoveryAttempts: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  idempotencyKey: { type: String, default: null },
  activeKey: { type: String, default: null }
}, { timestamps: true });

// One running job per page: a second regenerate of the same page while one is active is refused, not queued behind it. `activeKey` is
// set while the job is active and cleared when it ends, so the rule is a plain unique index that every MongoDB version supports.
templateGenerationJobSchema.index({ activeKey: 1 }, { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } });
templateGenerationJobSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

const model = mongoose.model('TemplateGenerationJob', templateGenerationJobSchema);
model.STATUSES = STATUSES;
model.ACTIVE_STATUSES = ACTIVE;
module.exports = model;
