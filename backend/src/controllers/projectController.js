const projectService = require('../services/project/projectService');
const projectAccess = require('../services/collaboration/projectAccess');
const sharingService = require('../services/collaboration/sharingService');
const Project = require('../models/Project');
const { generateExport } = require('../services/project/exportService');

exports.createProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const project = await projectService.create(userId, req.body);
    res.status(201).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

// Lightweight "has anything changed?" probe used by open editors of shared projects.
exports.getProjectRevision = async (req, res, next) => {
  try {
    const ctx = await projectAccess.requireProjectAccess(req.params.id, req.user ? req.user.id : null, 'viewer');
    const doc = await Project.findById(req.params.id).select('revision updatedAt lastEditedBy').populate('lastEditedBy', 'name').lean();
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: {
      revision: doc.revision || 0, shared: ctx.level !== 'owner' || await projectAccess.isShared(req.params.id), updatedAt: doc.updatedAt, lastEditedBy: doc.lastEditedBy?.name || null,
      access: { level: ctx.level, canEdit: ctx.canEdit, canManage: ctx.canManage, isOwner: ctx.isOwner }
    } });
  } catch (error) {
    next(error);
  }
};

exports.getSharedProjects = async (req, res, next) => {
  try {
    if (!req.user) return res.status(200).json({ success: true, data: [] });
    res.status(200).json({ success: true, data: await sharingService.listSharedWithMe(req.user) });
  } catch (error) {
    next(error);
  }
};

exports.getProjects = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const projects = await projectService.getAll(userId);
    res.status(200).json({ success: true, data: projects });
  } catch (error) {
    next(error);
  }
};

exports.getProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const project = await projectService.getById(req.params.id, userId, { lite: req.query.binary === 'omit', withAccess: true });
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

exports.updateProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const project = await projectService.update(req.params.id, userId, req.body, {
      lite: req.query.binary === 'omit',
      baseRevision: req.body?.baseRevision ?? req.headers['x-base-revision']
    });
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

exports.deleteProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    await projectService.delete(req.params.id, userId);
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    next(error);
  }
};

exports.getProjectFiles = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const files = await projectService.getFiles(req.params.id, userId);
    res.status(200).json({ success: true, data: files });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/projects/:id/source
 *
 * Returns the full generated source tree from the relational ProjectFile
 * store (or the embedded files as a fallback). Useful for the Prompt
 * Engine result panel, the "View generated code" UI, and any external
 * export/download flow.
 */
exports.getProjectSource = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const source = await projectService.getSource(req.params.id, userId);
    res.status(200).json({ success: true, data: source });
  } catch (error) {
    next(error);
  }
};

exports.updateProjectFile = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const { path, content } = req.body;
    const project = await projectService.updateFile(req.params.id, userId, path, content, {
      baseRevision: req.body?.baseRevision ?? req.headers['x-base-revision']
    });
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

exports.exportProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const project = await projectService.getById(req.params.id, userId);
    const zipBuffer = await generateExport(project);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${project.name}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    next(error);
  }
};
