/**
 * Branches: a safe place to experiment. A branch is its own working copy of a website, started from one version of another site (main).
 * It is a normal template site (pages, jobs, preview, revisions and versions all work on it unchanged), so editing it can never touch main.
 * A branch can be compared with main and, when it is good, promoted: its state becomes a NEW version of main (main's history is kept).
 */
const mongoose = require('mongoose');
const Project = require('../../models/Project');
const TemplateSite = require('../../models/TemplateSite');
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateVersion = require('../../models/TemplateVersion');
const versions = require('./templateVersionService');
const restore = require('./templateVersionRestore');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { getSite, cleanName, idOf } = require('./templateSiteService');
const { assertNoRunningJob } = require('./templatePageService');
const { ConflictError, ValidationError, NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const MAX_BRANCHES = Number.parseInt(process.env.TEMPLATE_MAX_BRANCHES, 10) || 10;

async function createBranch({ user, siteId, versionId, name }) {
  const main = await getSite(user, siteId);
  if (main.branchOf) throw new ValidationError('A branch cannot be branched again. Start a branch from the main website.');
  const version = await versions.getVersionDoc(main, versionId);
  if (version.status !== 'complete') throw new ConflictError('That version was never saved completely.', 'VERSION_INCOMPLETE');
  const branchName = cleanName(name, 'Branch name', 60);
  if (await TemplateSite.countDocuments({ userId: main.userId, 'branchOf.siteId': String(main._id), status: 'active' }) >= MAX_BRANCHES) throw new ConflictError(`A website can have at most ${MAX_BRANCHES} branches.`);
  const files = await versions.snapshotFiles(version);
  try { await hydrateFiles(files); } catch (error) { throw new ConflictError(`This version's files could not be read (${String(error.message).slice(0, 100)}). No branch was made.`, 'VERSION_CORRUPT'); }

  const created = { project: null, site: null };
  try {
    created.project = await Project.create({
      userId: main.userId, name: `${main.name} - ${branchName}`, description: `Branch "${branchName}" of ${main.name}`,
      files, template: { id: main.templateId, version: main.templateVersion }, provenance: { type: 'template-site', templateId: main.templateId, templateVersion: main.templateVersion, branchOf: String(main._id) }, lastEditedBy: main.userId
    });
    created.site = await TemplateSite.create({
      userId: main.userId, name: `${main.name} - ${branchName}`, category: main.category, templateId: main.templateId, templateVersion: main.templateVersion, projectId: created.project._id,
      description: `Branch of ${main.name}`, thumbnailUrl: main.thumbnailUrl, revision: 1, brief: version.brief || '', plan: version.plan || null,
      branchOf: { siteId: String(main._id), versionId: String(version._id), versionNumber: version.number, versionName: version.name, name: branchName, mainName: main.name }
    });
    const hydrated = await hydrateFiles(files.filter((file) => file.encoding !== 'base64'));
    const byPath = new Map(hydrated.map((file) => [file.path, file]));
    const pages = await TemplatePage.insertMany(version.pages.map((page) => ({
      siteId: created.site._id, userId: main.userId, name: page.name, description: page.description || '', route: page.route, componentPath: page.componentPath, order: page.order, currentRevision: 1, revisionCount: 1
    })), { ordered: true });
    await TemplateRevision.insertMany(pages.map((page) => {
      const file = byPath.get(page.componentPath);
      return { siteId: created.site._id, pageId: page._id, userId: main.userId, number: 1, kind: 'create', instruction: `Branched from ${main.name}, version ${version.number}`, files: file ? [{ path: file.path, content: file.content, language: file.language || 'javascript' }] : [], siteRevision: 1 };
    }));
    created.site.lastPageId = pages[0]?._id || null;
    await created.site.save();
    await versions.createVersion({ site: created.site, user, kind: 'branch', name: `Branched from ${main.name} v${version.number}`, description: `Started from version ${version.number} "${version.name}".`, origin: 'user', operation: 'branch', parentId: null });
    return { site: created.site, pages };
  } catch (error) {
    logger.error(`Branch creation failed: ${error.message}`);
    await Promise.allSettled([
      created.site ? TemplateVersion.deleteMany({ siteId: created.site._id }) : null, created.site ? TemplateRevision.deleteMany({ siteId: created.site._id }) : null,
      created.site ? TemplatePage.deleteMany({ siteId: created.site._id }) : null, created.site ? TemplateSite.deleteOne({ _id: created.site._id }) : null, created.project ? Project.findByIdAndDelete(created.project._id) : null
    ].filter(Boolean));
    throw error?.statusCode ? error : new ConflictError('The branch could not be created. Nothing was changed.', 'BRANCH_FAILED');
  }
}

async function listBranches(user, siteId) {
  const main = await getSite(user, siteId);
  const branches = await TemplateSite.find({ userId: main.userId, 'branchOf.siteId': String(main._id), status: 'active' }).sort({ createdAt: -1 }).lean();
  return branches.map((branch) => ({ id: String(branch._id), name: branch.name, branchName: branch.branchOf.name, fromVersion: branch.branchOf.versionNumber, createdAt: branch.createdAt, updatedAt: branch.updatedAt, promotedAt: branch.promotedAt || null }));
}

/** The branch's current state becomes a new version of main. Main's own history stays; the branch is kept (marked promoted). */
async function promoteBranch({ user, siteId }) {
  const branch = await getSite(user, siteId);
  if (!branch.branchOf) throw new ValidationError('This website is not a branch.');
  const main = await TemplateSite.findOne({ _id: branch.branchOf.siteId, userId: branch.userId, status: 'active' });
  if (!main) throw new NotFoundError('The main website of this branch');
  await assertNoRunningJob(branch._id);
  await assertNoRunningJob(main._id);
  const { version } = await versions.createVersion({ site: branch, user, kind: 'snapshot', name: 'Promoted to main', origin: 'system', operation: 'promote', dedupe: true });
  const files = await versions.snapshotFiles(version);
  const outcome = await restore.applySnapshot({
    site: main, user, kind: 'promote', name: `Promoted branch "${branch.branchOf.name}"`, description: `The branch "${branch.branchOf.name}" (started from version ${branch.branchOf.versionNumber}) became the main website.`,
    safetyName: `Before promoting branch "${branch.branchOf.name}"`,
    snapshot: { files, pages: version.pages.map((page) => (page.toObject ? page.toObject() : page)), brief: version.brief, plan: version.plan, treeHash: version.treeHash, pagesHash: version.pagesHash, label: `branch "${branch.branchOf.name}"` }
  });
  await TemplateSite.updateOne({ _id: branch._id }, { $set: { promotedAt: new Date() } });
  return { unchanged: outcome.unchanged, version: outcome.version ? versions.present(outcome.version, null) : null, mainSiteId: String(main._id) };
}

module.exports = { createBranch, listBranches, promoteBranch, MAX_BRANCHES };
