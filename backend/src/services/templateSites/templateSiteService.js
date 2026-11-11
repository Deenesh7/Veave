/**
 * Template sites: a website the user created from a template, managed page by page.
 *
 * The files are stored in a regular Project (its S3 offloading, precompiled preview and version history all keep working); the
 * TemplateSite / TemplatePage / TemplateRevision documents add what the project model does not have: the owner's list of sites,
 * the pages of a site with their routes and components, and a revision history per page.
 *
 * Every function takes the signed-in user and only ever touches that user's sites ("not found" for anyone else's, so ids cannot
 * be probed).
 */
const mongoose = require('mongoose');
const TemplateSite = require('../../models/TemplateSite');
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const TemplateAsset = require('../../models/TemplateAsset');
const Project = require('../../models/Project');
const templateService = require('../templates/templateService');
const { createTemplateCandidate } = require('../project/reactScaffolder');
const { hydrateFiles } = require('../storage/s3BlobStorage');
const { AppError, NotFoundError, ValidationError, ConflictError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const idOf = (user) => String(user?._id || user?.id || user || '');

function requireUser(user) {
  const id = idOf(user);
  if (!mongoose.isValidObjectId(id)) throw new ValidationError('Sign in to use the template workspace.');
  return id;
}

function cleanName(value, label = 'Name', max = 80) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new ValidationError(`${label} is required.`);
  if (name.length > max) throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  return name;
}

function objectId(value, label) {
  if (!mongoose.isValidObjectId(value)) throw new NotFoundError(label);
  return value;
}

/** The brand name inside the template's src/data/site.js follows the site name (deterministic, no AI needed). */
function applySiteName(files, name) {
  return files.map((file) => {
    if (file.path !== 'src/data/site.js' || typeof file.content !== 'string') return file;
    const replaced = file.content.replace(/(export const site\s*=\s*\{\s*(?:\/\/[^\n]*\n\s*)*name:\s*)(['"`])(?:(?!\2).)*\2/, (_, head, quote) => `${head}${quote}${name.replace(/\\/g, '\\\\').split(quote).join(`\\${quote}`)}${quote}`);
    return replaced === file.content ? file : { ...file, content: replaced };
  });
}

function describePage(entry) {
  const sections = Array.isArray(entry.sections) ? entry.sections.filter(Boolean) : [];
  return sections.length ? sections.join(' · ').slice(0, 300) : '';
}

async function getSite(user, siteId) {
  const userId = requireUser(user);
  objectId(siteId, 'Site');
  const site = await TemplateSite.findOne({ _id: siteId, userId, status: 'active' });
  if (!site) throw new NotFoundError('Site');
  return site;
}

async function getPage(user, siteId, pageId) {
  const site = await getSite(user, siteId);
  objectId(pageId, 'Page');
  const page = await TemplatePage.findOne({ _id: pageId, siteId: site._id });
  if (!page) throw new NotFoundError('Page');
  return { site, page };
}

async function listPages(user, siteId) {
  const site = await getSite(user, siteId);
  return TemplatePage.find({ siteId: site._id }).sort({ order: 1, createdAt: 1 });
}

async function listSites(user) {
  const userId = requireUser(user);
  const sites = await TemplateSite.find({ userId, status: 'active' }).sort({ updatedAt: -1 });
  const counts = await TemplatePage.aggregate([{ $match: { siteId: { $in: sites.map((site) => site._id) } } }, { $group: { _id: '$siteId', count: { $sum: 1 } } }]);
  const byId = new Map(counts.map((item) => [String(item._id), item.count]));
  return sites.map((site) => ({ site, pageCount: byId.get(String(site._id)) || 0 }));
}

/**
 * Creates the site: an isolated copy of the template's files in a new Project, one page record per template page and a first
 * revision of each page. The stored template is never changed. If any step fails, everything made so far is removed.
 */
async function createSite({ user, templateId, templateVersion = null, name, description = '', theme: themeInput = null, typography = null, idempotencyKey = null }) {
  const userId = requireUser(user);
  const siteName = cleanName(name, 'Site name');
  const key = idempotencyKey ? String(idempotencyKey).slice(0, 120) : null;
  if (key) {
    const existing = await TemplateSite.findOne({ userId, idempotencyKey: key });
    if (existing) return { site: existing, pages: await TemplatePage.find({ siteId: existing._id }).sort({ order: 1 }), created: false };
  }

  let template;
  try {
    template = templateService.resolveTemplate(String(templateId || ''), { version: templateVersion || undefined, user });
    templateService.verifyIntegrity(template);
  } catch (error) {
    // Template problems (unknown, not allowed, damaged) are client errors with their own codes, not server faults.
    if (error?.name === 'TemplateError') throw Object.assign(new AppError(error.message, error.status || error.statusCode || 422), { code: error.code });
    throw error;
  }

  const themes = require('./templateTheme');
  const { theme } = themes.normalize(themeInput || (typography ? { typography } : null), template);
  const files = themes.applyTheme(applySiteName(createTemplateCandidate(template, { projectName: siteName }), siteName), theme, template);
  const created = { project: null, site: null };
  try {
    created.project = await Project.create({
      userId,
      name: siteName,
      description: String(description || '').slice(0, 500),
      files,
      template: { id: template.id, version: template.version },
      provenance: { type: 'template-site', templateId: template.id, templateVersion: template.version, contentHash: template._contentHash || null },
      lastEditedBy: userId
    });
    created.site = await TemplateSite.create({
      userId, name: siteName, category: template.category || '', templateId: template.id, templateVersion: template.version,
      projectId: created.project._id, description: String(description || '').slice(0, 500),
      thumbnailUrl: `/api/templates/${encodeURIComponent(template.id)}/preview?version=${encodeURIComponent(template.version)}`,
      theme, typography: theme?.typography || null, revision: 1, idempotencyKey: key
    });
    const byPath = new Map(files.map((file) => [file.path, file]));
    const pages = await TemplatePage.insertMany(template.pages.map((entry, index) => ({
      siteId: created.site._id, userId, name: entry.title, description: describePage(entry), route: entry.path,
      componentPath: entry.file, order: index, currentRevision: 1, revisionCount: 1
    })), { ordered: true });
    await TemplateRevision.insertMany(pages.map((page) => {
      const file = byPath.get(page.componentPath);
      return {
        siteId: created.site._id, pageId: page._id, userId, number: 1, kind: 'create', instruction: `Created from the ${template.name} template`,
        files: file ? [{ path: file.path, content: file.content, language: file.language || 'javascript' }] : [], siteRevision: 1
      };
    }));
    created.site.lastPageId = pages[0]?._id || null;
    await created.site.save();
    // Version 1: the template exactly as it was copied. Every later version can be compared with it and restored to it.
    await require('./templateVersionService').createVersion({ site: created.site, user, kind: 'create', name: 'Original template', description: `Created from the ${template.name} template.`, origin: 'system', operation: 'create', parentId: null });
    return { site: created.site, pages, created: true };
  } catch (error) {
    // Nothing half-made stays behind: a failed creation leaves no project, site, page or revision.
    await Promise.allSettled([
      created.site ? require('../../models/TemplateVersion').deleteMany({ siteId: created.site._id }) : null,
      created.project ? require('../../models/ProjectVersion').deleteMany({ projectId: created.project._id }) : null,
      created.site ? TemplateRevision.deleteMany({ siteId: created.site._id }) : null,
      created.site ? TemplatePage.deleteMany({ siteId: created.site._id }) : null,
      created.site ? TemplateSite.deleteOne({ _id: created.site._id }) : null,
      created.project ? Project.findByIdAndDelete(created.project._id) : null
    ].filter(Boolean));
    if (error?.code === 11000 && key) {
      const winner = await TemplateSite.findOne({ userId, idempotencyKey: key });
      if (winner) return { site: winner, pages: await TemplatePage.find({ siteId: winner._id }).sort({ order: 1 }), created: false };
    }
    logger.error(`Template site creation failed: ${error.message}`);
    throw error;
  }
}

async function renameSite(user, siteId, { name, description }) {
  const site = await getSite(user, siteId);
  if (name !== undefined) site.name = cleanName(name, 'Site name');
  if (description !== undefined) site.description = String(description).slice(0, 500);
  await site.save();
  if (name !== undefined) await Project.updateOne({ _id: site.projectId }, { $set: { name: site.name } });
  return site;
}

async function deleteSite(user, siteId) {
  const site = await getSite(user, siteId);
  const running = await TemplateGenerationJob.exists({ siteId: site._id, status: { $in: TemplateGenerationJob.ACTIVE_STATUSES } });
  if (running) throw new ConflictError('A generation is still running for this site. Cancel it or wait for it to finish before deleting the site.');
  await Promise.all([
    TemplateRevision.deleteMany({ siteId: site._id }),
    require('../../models/TemplateVersion').deleteMany({ siteId: site._id }),
    require('../../models/ProjectVersion').deleteMany({ projectId: site.projectId }),
    TemplatePage.deleteMany({ siteId: site._id }),
    TemplateAsset.deleteMany({ siteId: site._id }),
    TemplateGenerationJob.deleteMany({ siteId: site._id })
  ]);
  await TemplateSite.deleteOne({ _id: site._id });
  await Project.findByIdAndDelete(site.projectId);
  return { deleted: true };
}

/** The site's current files (hydrated from S3 where needed), with the project they belong to. */
async function loadSiteFiles(site) {
  const project = await Project.findById(site.projectId).lean();
  if (!project || String(project.userId) !== String(site.userId)) throw new NotFoundError('Site files');
  const files = await hydrateFiles(project.files || []);
  return { project, files };
}

async function rememberPage(user, siteId, pageId) {
  const { site, page } = await getPage(user, siteId, pageId);
  if (String(site.lastPageId) !== String(page._id)) { site.lastPageId = page._id; await site.save(); }
  return site;
}

module.exports = { idOf, requireUser, cleanName, objectId, getSite, getPage, listPages, listSites, createSite, renameSite, deleteSite, loadSiteFiles, rememberPage, applySiteName };
