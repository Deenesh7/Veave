const ProjectVersion = require('../models/ProjectVersion');
const Project = require('../models/Project');
const projectService = require('../services/project/projectService');
const { NotFoundError } = require('../utils/errors');
const projectAccess = require('../services/collaboration/projectAccess');
const logger = require('../utils/logger');
const { dehydrateFiles, hydrateFiles } = require('../services/storage/s3BlobStorage');

exports.getVersions = async (req, res, next) => {
  try {
    await projectAccess.requireProjectAccess(req.params.id, req.user, 'viewer');
    const query = { projectId: req.params.id };

    let versions = await ProjectVersion.find(query)
      .sort({ version: -1 })
      .select('-files.content'); // Exclude file content for listing to save bandwidth; paths are kept

    // If no versions exist yet, auto-seed v1 from current project files
    if (versions.length === 0) {
      const project = await Project.findById(req.params.id);
      if (project && project.files && project.files.length > 0) {
        try {
          const v1 = new ProjectVersion({
            projectId: project._id,
            userId: project.userId || null,
            version: 1,
            label: 'Initial Version',
            files: project.files,
            dependencies: project.dependencies || ['react', 'react-dom']
          });
          await v1.save();
          versions = [
            {
              _id: v1._id,
              projectId: v1.projectId,
              version: 1,
              label: v1.label,
              files: v1.files.map(f => ({ path: f.path, language: f.language })),
              dependencies: v1.dependencies,
              createdAt: v1.createdAt,
              updatedAt: v1.updatedAt
            }
          ];
        } catch (seedErr) {
          logger.error(`Failed to auto-seed v1 for project ${req.params.id}: ${seedErr.message}`);
        }
      }
    }

    res.status(200).json({ success: true, data: versions });
  } catch (error) {
    next(error);
  }
};

exports.getVersionById = async (req, res, next) => {
  try {
    await projectAccess.requireProjectAccess(req.params.id, req.user, 'viewer');
    const query = { _id: req.params.versionId, projectId: req.params.id };

    const version = await ProjectVersion.findOne(query);
    if (!version) throw new NotFoundError('Version');
    version.files = await hydrateFiles(version.files);

    res.status(200).json({ success: true, data: version });
  } catch (error) {
    next(error);
  }
};

exports.createVersion = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    await projectAccess.requireProjectAccess(req.params.id, req.user, 'editor');
    const project = await Project.findById(req.params.id);
    if (!project) throw new NotFoundError('Project');
    if (Array.isArray(req.body.files) && req.body.files.length > 0) {
      await projectService.assertBaseRevision(req.params.id, req.body.baseRevision ?? req.headers['x-base-revision']);
    }

    const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });

    // If client supplied updated files, update project and sync relational store
    let filesToSave = project.files;
    if (Array.isArray(req.body.files) && req.body.files.length > 0) {
      filesToSave = await dehydrateFiles(req.body.files);
      project.files = filesToSave;
      await project.save();
      await projectService._syncFiles(project);
    }
    
    const version = new ProjectVersion({
      projectId: project._id,
      userId: userId || null,
      version: versionCount + 1,
      label: req.body.label || `Manual Snapshot v${versionCount + 1}`,
      files: filesToSave,
      dependencies: project.dependencies
    });
    
    await version.save();
    version.files = await hydrateFiles(version.files);
    res.status(201).json({ success: true, data: version });
  } catch (error) {
    next(error);
  }
};

exports.restoreVersion = async (req, res, next) => {
  try {
    await projectAccess.requireProjectAccess(req.params.id, req.user, 'editor');
    const versionQuery = { _id: req.params.versionId, projectId: req.params.id };
    const version = await ProjectVersion.findOne(versionQuery);
    
    if (!version) throw new NotFoundError('Version');
    
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id },
      { $set: { files: version.files, dependencies: version.dependencies, ...(req.user ? { lastEditedBy: req.user.id } : {}) } },
      { new: true }
    );
    
    if (!project) throw new NotFoundError('Project');
    require('../services/search/projectIndexHooks').invalidate(project._id);

    // Sync relational ProjectFile collection so all queries and exports reflect restored version
    await projectService._syncFiles(project);
    project.files = await hydrateFiles(project.files);
    version.files = await hydrateFiles(version.files);

    res.status(200).json({ success: true, data: project, restoredVersion: version });
  } catch (error) {
    next(error);
  }
};

exports.deleteVersion = async (req, res, next) => {
  try {
    await projectAccess.requireProjectAccess(req.params.id, req.user, 'editor');
    const query = { _id: req.params.versionId, projectId: req.params.id };

    const deleted = await ProjectVersion.findOneAndDelete(query);
    if (!deleted) throw new NotFoundError('Version');

    res.status(200).json({ success: true, message: 'Version snapshot deleted' });
  } catch (error) {
    next(error);
  }
};
