const mongoose = require('mongoose');
const Project = require('../../models/Project');
const ProjectFile = require('../../models/ProjectFile');
const ProjectVersion = require('../../models/ProjectVersion');
const ProjectSharing = require('../../models/ProjectSharing');
const Conversation = require('../../models/Conversation');
const GenerationJob = require('../../models/GenerationJob');
const PrototypeRun = require('../../models/PrototypeRun');
const PublishedSite = require('../../models/PublishedSite');
const Deployment = require('../../models/Deployment');
const DomainConnection = require('../../models/DomainConnection');
const PrecompiledPreview = require('../../models/PrecompiledPreview');
const TemplateSite = require('../../models/TemplateSite');
const TemplatePage = require('../../models/TemplatePage');
const TemplateAsset = require('../../models/TemplateAsset');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateVersion = require('../../models/TemplateVersion');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const User = require('../../models/User');
const projectAccess = require('../collaboration/projectAccess');
const { audit, notify, withTransaction } = require('../collaboration/support');
const { AppError, NotFoundError, ValidationError, ConflictError, AuthError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/**
 * Project lifecycle actions behind the project card menu: info, duplicate, transfer ownership and delete.
 * Authorization always comes from the authenticated user and the stored project (projectAccess), never from the request body.
 */

const NAME_MAX = 100;
const ACTIVE_JOB_STATUSES = ['queued', 'processing', 'committing'];
const PAGE_FILE = /^src\/pages\/.+\.(jsx|tsx|js|ts)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sid = (value) => (value && value._id ? String(value._id) : value ? String(value) : '');

function requireUser(user) {
  if (!user) throw new AuthError('Log in to manage projects.');
  return sid(user._id || user.id);
}

function assertProjectId(projectId) {
  if (!mongoose.isValidObjectId(projectId)) throw new NotFoundError('Project');
}

function cleanName(value, label = 'Project name') {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ValidationError(`${label} is required.`);
  if (name.length > NAME_MAX) throw new ValidationError(`${label} must be ${NAME_MAX} characters or fewer.`);
  return name;
}

const ownerView = (user, { withEmail = false } = {}) => (user
  ? { id: sid(user._id), name: user.name, ...(withEmail ? { email: user.email } : {}) }
  : null);

/* ----------------------------------------------------------------------------------------------- info */

async function getInfo(user, projectId) {
  assertProjectId(projectId);
  const ctx = await projectAccess.requireProjectAccess(projectId, user, 'viewer');
  const project = await Project.findById(projectId)
    .select('name description status userId createdBy lastEditedBy createdAt updatedAt revision provenance settings.framework files.path')
    .lean();
  if (!project) throw new NotFoundError('Project');

  const [people, jobs, site, deployment, shareCount] = await Promise.all([
    User.find({ _id: { $in: [project.userId, project.createdBy, project.lastEditedBy].filter(Boolean) } }).select('name email').lean(),
    GenerationJob.find({ projectId }).sort({ createdAt: -1 }).limit(25)
      .select('jobId type status stepName progress completedAt createdAt error payload.sourceUrl').lean(),
    TemplateSite.findOne({ projectId }).select('_id').lean(),
    Deployment.findOne({ projectId, status: 'succeeded' }).sort({ finishedAt: -1 }).select('version finishedAt slug').lean(),
    ProjectSharing.countDocuments({ projectId })
  ]);
  const person = (id) => people.find((p) => sid(p._id) === sid(id)) || null;
  const owner = person(project.userId);
  const creator = person(project.createdBy) || owner;

  const latest = jobs[0] || null;
  const cloneJob = jobs.find((job) => job.type === 'clone') || null;
  const provenance = project.provenance || {};
  const origin = provenance.origin || provenance.type;
  const type = origin === 'website-prototype' ? 'Prototype' : (cloneJob || origin === 'clone') ? 'Clone' : 'Generate';
  const sourceUrl = provenance.sourceUrl || cloneJob?.payload?.sourceUrl || null;

  let status;
  if (latest && ACTIVE_JOB_STATUSES.includes(latest.status)) status = { state: 'generating', label: latest.stepName || 'Generating...' };
  else if (project.status === 'archived') status = { state: 'archived', label: 'Archived' };
  else if (latest && ['failed', 'blocked'].includes(latest.status)) status = { state: 'failed', label: 'Last generation failed' };
  else status = { state: 'ready', label: 'Ready' };

  let pages = (project.files || []).filter((file) => PAGE_FILE.test(file.path || '')).length;
  if (!pages && site) pages = await TemplatePage.countDocuments({ siteId: site._id });

  const lastJob = jobs.find((job) => job.status === 'completed') || null;
  let published = null;
  try {
    const record = await PublishedSite.findOne({ projectId }).select('slug status lastPublishedAt').lean();
    if (record?.status === 'published') published = { url: require('../hosting/config').siteUrl(record.slug), at: record.lastPublishedAt || null };
  } catch (error) {
    logger.warn(`Could not read hosting info for project ${projectId}: ${error.message}`);
  }

  return {
    id: sid(project._id),
    name: project.name,
    description: project.description || '',
    type,
    status,
    createdBy: ownerView(creator),
    owner: ownerView(owner, { withEmail: ctx.isOwner }),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceUrl,
    pages,
    fileCount: (project.files || []).length,
    framework: project.settings?.framework || null,
    revision: project.revision || 0,
    shared: shareCount > 0,
    access: { level: ctx.level, isOwner: ctx.isOwner, canEdit: ctx.canEdit, canManage: ctx.canManage },
    lastBuild: lastJob ? { at: lastJob.completedAt || lastJob.createdAt, type: lastJob.type } : null,
    lastDeployment: deployment ? { version: deployment.version, at: deployment.finishedAt } : null,
    published
  };
}

/* ------------------------------------------------------------------------------------------ duplicate */

async function uniqueName(userId, base) {
  const stem = base.length > NAME_MAX - 6 ? base.slice(0, NAME_MAX - 6).trim() : base;
  for (let n = 1; n <= 200; n += 1) {
    const candidate = n === 1 ? stem : `${stem} ${n}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await Project.exists({ userId, status: 'active', name: candidate });
    if (!taken) return candidate;
  }
  throw new ConflictError('Could not find a free project name. Please choose another one.', 'NAME_TAKEN');
}

async function duplicateProject(user, projectId, { name } = {}) {
  const userId = requireUser(user);
  assertProjectId(projectId);
  const ctx = await projectAccess.requireProjectAccess(projectId, user, 'editor');

  // Lean read keeps S3 blob references instead of downloading every file: blobs are content-addressed and
  // immutable, so the copy shares the stored bytes but owns its own file list and can be edited independently.
  const source = await Project.findOne({ _id: projectId, status: 'active' }).lean();
  if (!source) throw new NotFoundError('Project');

  const requested = name === undefined || name === null || String(name).trim() === ''
    ? `${source.name} (Copy)`
    : cleanName(name, 'Project name');
  const finalName = await uniqueName(userId, requested);

  const files = (source.files || [])
    .filter((file) => file && file.path)
    .map((file) => ({ path: file.path, content: file.content || '', language: file.language, encoding: file.encoding || 'utf8', blob: file.blob || null }));

  const provenance = {
    type: 'duplicate',
    origin: source.provenance?.origin || source.provenance?.type || null,
    sourceUrl: source.provenance?.sourceUrl || null,
    duplicatedFrom: String(source._id),
    duplicatedAt: new Date()
  };
  if (Array.isArray(source.provenance?.routes)) provenance.routes = source.provenance.routes;

  const settings = { ...(source.settings || {}) };
  delete settings.lastTokenUsage;

  const copy = new Project({
    userId,
    createdBy: userId,
    lastEditedBy: userId,
    name: finalName,
    description: source.description || '',
    files,
    dependencies: source.dependencies || [],
    settings,
    template: source.template || undefined,
    validation: source.validation || undefined,
    provenance,
    status: 'active'
  });
  await copy.save(); // plan limits (project count, storage) are enforced by the model hook

  // The mirror table is written by a save hook that never fails the save. Verify it and undo the duplicate if it is incomplete.
  const expected = files.length;
  const mirrored = await ProjectFile.countDocuments({ projectId: copy._id });
  if (mirrored !== expected) {
    await Project.findOneAndDelete({ _id: copy._id }).catch(() => {});
    await ProjectFile.deleteMany({ projectId: copy._id }).catch(() => {});
    throw new AppError('The project files could not be copied completely. Nothing was created; please try again.', 500);
  }

  await audit(userId, 'project.duplicated', { projectId: copy._id, meta: { sourceProjectId: String(source._id), name: finalName, via: ctx.via } });
  return { id: String(copy._id), name: finalName, sourceProjectId: String(source._id), fileCount: expected };
}

/* ------------------------------------------------------------------------------------------ transfer */

async function transferOwnership(user, projectId, { email, confirm } = {}) {
  const actorId = requireUser(user);
  assertProjectId(projectId);
  const ctx = await projectAccess.requireProjectAccess(projectId, user, 'owner');
  const project = await Project.findById(projectId).select('name userId status').lean();
  if (!project) throw new NotFoundError('Project');
  if (!project.userId || sid(project.userId) !== actorId || !ctx.isOwner) {
    throw new AppError('Only the project owner can transfer ownership.', 403);
  }

  const target = String(email ?? '').trim().toLowerCase();
  if (!target || target.length > 254 || !EMAIL.test(target)) throw new ValidationError('Enter a valid email address.');
  if (confirm !== true) throw new ValidationError('Confirm the transfer to continue.');

  const newOwner = await User.findOne({ email: target }).select('name email').lean();
  if (!newOwner) throw new AppError('No Veave account uses that email address.', 404);
  const newOwnerId = sid(newOwner._id);
  if (newOwnerId === actorId) throw new ConflictError('That account already owns this project.', 'ALREADY_OWNER');

  // The new owner's plan must have room for the project (project count and storage).
  await require('../billing/usageService').assertCanCreate(newOwnerId, { newProject: true });

  const sites = await TemplateSite.find({ projectId }).select('_id').lean();
  const siteIds = sites.map((site) => site._id);

  await withTransaction(async (session) => {
    const opts = session ? { session } : {};
    // Conditional on the current owner, so two concurrent transfers (or a stale request) cannot both succeed.
    const moved = await Project.findOneAndUpdate(
      { _id: projectId, userId: project.userId },
      { $set: { userId: newOwnerId, lastEditedBy: actorId } },
      { new: true, projection: { _id: 1 }, ...opts }
    );
    if (!moved) throw new ConflictError('The project changed while transferring. Reload and try again.', 'PROJECT_CONFLICT');

    try {
      await Promise.all([
        ProjectFile.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        Conversation.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        PublishedSite.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        Deployment.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        DomainConnection.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        TemplateSite.updateMany({ projectId }, { $set: { userId: newOwnerId } }, opts),
        siteIds.length ? TemplateGenerationJob.updateMany({ siteId: { $in: siteIds } }, { $set: { userId: newOwnerId } }, opts) : null,
        // The new owner no longer needs a direct share; the previous owner keeps editor access until the new owner removes it.
        ProjectSharing.deleteMany({ projectId, targetType: 'user', userId: newOwnerId }, opts)
      ].filter(Boolean));
      await ProjectSharing.updateOne(
        { projectId, targetType: 'user', userId: actorId },
        { $set: { permission: 'editor', grantedBy: newOwnerId } },
        { upsert: true, ...opts }
      );
    } catch (error) {
      // Without transactions (standalone MongoDB) put the owner back so the project is never left half-transferred.
      if (!session) await Project.updateOne({ _id: projectId, userId: newOwnerId }, { $set: { userId: project.userId } }).catch(() => {});
      throw error;
    }
  });

  await audit(actorId, 'project.ownership_transferred', {
    projectId, targetUserId: newOwnerId, meta: { name: project.name, fromUserId: actorId, toEmail: target }
  });
  await notify([newOwnerId], {
    type: 'ownership_transferred',
    title: 'You now own a project',
    message: `${user.name || 'A teammate'} transferred "${project.name}" to you.`,
    data: { projectId: String(projectId) }
  });

  // The previous owner now has editor access; return the project as they can see it.
  return getInfo(user, projectId);
}

/* -------------------------------------------------------------------------------------------- delete */

async function cancelActiveJobs(projectId) {
  const active = await GenerationJob.find({ projectId, status: { $in: ['queued', 'processing'] } }).select('jobId').lean();
  if (!active.length) return;
  const jobManager = require('../ai/jobManager');
  for (const job of active) {
    // eslint-disable-next-line no-await-in-loop
    await jobManager.cancelJob(job.jobId);
  }
}

async function removeHosting(project) {
  const projectId = project._id;
  const site = await PublishedSite.findOne({ projectId });
  if (await DomainConnection.exists({ projectId })) {
    await require('../hosting/domainConnectionService').disconnect({ projectId, userId: project.userId });
    await DomainConnection.deleteMany({ projectId });
  }
  if (site) {
    require('../hosting/staticServer').invalidateSite(site.slug);
    await require('../hosting/storage').removeSite(site._id);
    await Deployment.deleteMany({ siteId: site._id });
    await PublishedSite.deleteOne({ _id: site._id });
  }
  await Deployment.deleteMany({ projectId });
}

async function removeRecords(projectId) {
  const sites = await TemplateSite.find({ projectId }).select('_id').lean();
  const siteIds = sites.map((site) => site._id);
  if (siteIds.length) {
    await Promise.all([
      TemplateRevision.deleteMany({ siteId: { $in: siteIds } }),
      TemplateVersion.deleteMany({ siteId: { $in: siteIds } }),
      TemplatePage.deleteMany({ siteId: { $in: siteIds } }),
      TemplateAsset.deleteMany({ siteId: { $in: siteIds } }),
      TemplateGenerationJob.deleteMany({ siteId: { $in: siteIds } })
    ]);
    await TemplateSite.deleteMany({ _id: { $in: siteIds } });
  }
  await Promise.all([
    TemplateVersion.deleteMany({ projectId }),
    ProjectVersion.deleteMany({ projectId }),
    Conversation.deleteMany({ projectId }),
    ProjectFile.deleteMany({ projectId }),
    ProjectSharing.deleteMany({ projectId }),
    PrecompiledPreview.deleteMany({ projectId }),
    PrototypeRun.deleteMany({ projectId }),
    GenerationJob.deleteMany({ projectId })
  ]);
}

/**
 * Deletes a project and everything that belongs to it. Order matters: guard against running work, hide the project
 * (archived), clean up hosting, and only then remove the records. If cleanup fails the project is restored and the
 * error is reported, so data is never lost without the cleanup having succeeded. S3 blobs are content-addressed and
 * shared between projects, so they are intentionally never deleted here.
 */
async function deleteProject(user, projectId, { confirmName } = {}) {
  const actorId = requireUser(user);
  assertProjectId(projectId);
  await projectAccess.requireProjectAccess(projectId, user, 'owner');
  const project = await Project.findById(projectId).select('name userId status').lean();
  if (!project) throw new NotFoundError('Project');
  if (confirmName !== undefined && String(confirmName).trim() !== String(project.name).trim()) {
    throw new ValidationError('The name you typed does not match the project name.');
  }

  const sites = await TemplateSite.find({ projectId }).select('_id').lean();
  const [committing, templateRunning, publishing] = await Promise.all([
    GenerationJob.exists({ projectId, status: 'committing' }),
    sites.length ? TemplateGenerationJob.exists({ siteId: { $in: sites.map((s) => s._id) }, status: { $in: TemplateGenerationJob.ACTIVE_STATUSES } }) : null,
    PublishedSite.exists({ projectId, publishingSince: { $gt: new Date(Date.now() - 10 * 60 * 1000) } })
  ]);
  if (committing) throw new ConflictError('A build is saving its result right now. Try again in a moment.', 'JOB_COMMITTING');
  if (templateRunning) throw new ConflictError('A generation is still running for this project. Cancel it or wait for it to finish before deleting.', 'JOB_RUNNING');
  if (publishing) throw new ConflictError('A publish is in progress. Try again when it finishes.', 'PUBLISH_IN_PROGRESS');

  await cancelActiveJobs(projectId);
  // Hide the project first; this is not a hook-triggering write. Repeating the request just repeats idempotent steps.
  await Project.updateOne({ _id: projectId }, { $set: { status: 'archived' } });
  try {
    await removeHosting(project);
  } catch (error) {
    await Project.updateOne({ _id: projectId, status: 'archived' }, { $set: { status: project.status || 'active' } }).catch(() => {});
    logger.error(`Project ${projectId} cleanup failed: ${error.message}`);
    throw new AppError('The project could not be deleted because its hosting cleanup failed. Nothing was removed; please try again.', 502);
  }

  await removeRecords(projectId);
  await Project.findOneAndDelete({ _id: projectId }); // the model hook cascades the remaining per-project records
  // A job queued while we were deleting must not rebuild the project.
  await cancelActiveJobs(projectId);
  await GenerationJob.deleteMany({ projectId, status: { $nin: ACTIVE_JOB_STATUSES } });
  require('../search/projectIndexHooks').dispose(projectId);

  await audit(actorId, 'project.deleted', { projectId, meta: { name: project.name, ownerId: sid(project.userId) } });
  return { id: String(projectId), deleted: true };
}

module.exports = { getInfo, duplicateProject, transferOwnership, deleteProject };
