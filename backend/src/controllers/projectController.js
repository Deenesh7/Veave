const projectService = require('../services/project/projectService');
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
    const project = await projectService.getById(req.params.id, userId);
    res.status(200).json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

exports.updateProject = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const project = await projectService.update(req.params.id, userId, req.body);
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
    const project = await projectService.updateFile(req.params.id, userId, path, content);
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
