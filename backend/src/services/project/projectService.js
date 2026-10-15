const Project = require('../../models/Project');
const ProjectFile = require('../../models/ProjectFile');
const Conversation = require('../../models/Conversation');
const ProjectVersion = require('../../models/ProjectVersion');
const { NotFoundError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const { dehydrateFiles, hydrateFiles } = require('../storage/s3BlobStorage');

/**
 * ProjectService
 *
 * Storage model
 * -------------
 * Project.files (embedded)   — the fast path for editor loads
 * ProjectFile (relational)   — one document per file, indexed by
 *                              (projectId, userId, path). This is the
 *                              queryable, exportable source of truth.
 *
 * Every write operation keeps both in sync via _syncFiles().
 */

class ProjectService {
  async create(userId, data) {
    const storedFiles = await dehydrateFiles(data.files || []);
    const project = new Project({
      userId,
      name: data.name,
      description: data.description || '',
      files: storedFiles,
      dependencies: data.dependencies || ['react', 'react-dom'],
      settings: data.settings || {}
    });
    await project.save();
    await this._syncFiles(project, data.origin);
    project.files = await hydrateFiles(project.files);
    return project;
  }

  async getAll(userId) {
    const query = userId
      ? { $or: [{ userId }, { userId: null }, { userId: { $exists: false } }], status: 'active' }
      : { status: 'active' };
    // Dashboard listings only need file metadata for the count. Returning every
    // source body makes large generated projects stall unrelated API requests.
    return await Project.find(query)
      .select('-files.content -files.blob')
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getById(id, userId) {
    const query = userId
      ? { _id: id, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
      : { _id: id };
    const project = await Project.findOne(query);
    if (!project) throw new NotFoundError('Project');
    project.files = await hydrateFiles(project.files);
    return project;
  }

  async update(id, userId, data) {
    // Extract versionLabel before persisting (it's not a Project field)
    const versionLabel = data.versionLabel;
    const persistData = { ...data };
    delete persistData.versionLabel;
    if (Array.isArray(persistData.files)) persistData.files = await dehydrateFiles(persistData.files);

    const query = userId
      ? { _id: id, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
      : { _id: id };
    const project = await Project.findOneAndUpdate(
      query,
      { $set: persistData },
      { new: true }
    );
    if (!project) throw new NotFoundError('Project');

    // If the update touched files, re-sync the relational store
    if (Array.isArray(data.files)) {
      await this._syncFiles(project, data.origin);

      // Auto-create version snapshot when files change
      try {
        const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });
        const newVersion = new ProjectVersion({
          projectId: project._id,
          userId: project.userId || null,
          version: versionCount + 1,
          label: versionLabel || `Auto-save v${versionCount + 1}`,
          files: project.files,
          dependencies: project.dependencies
        });
        await newVersion.save();
      } catch (versionErr) {
        // Version snapshot failures must never break project updates
        logger.error(`Version snapshot failed for ${project._id}: ${versionErr.message}`);
      }
    }
    project.files = await hydrateFiles(project.files);
    return project;
  }

  async createManualVersion(id, userId, label) {
    const project = await this.getById(id, userId);
    const storedFiles = await dehydrateFiles(project.files);
    const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });
    const newVersion = new ProjectVersion({
      projectId: project._id,
      userId: project.userId || null,
      version: versionCount + 1,
      label: label || `Manual Snapshot v${versionCount + 1}`,
      files: storedFiles,
      dependencies: project.dependencies
    });
    await newVersion.save();
    return newVersion;
  }

  async delete(id, userId) {
    const query = userId
      ? { _id: id, $or: [{ userId }, { userId: null }, { userId: { $exists: false } }] }
      : { _id: id };
    const project = await Project.findOneAndDelete(query);
    if (!project) throw new NotFoundError('Project');

    // Cascade
    await Promise.all([
      Conversation.deleteMany({ projectId: id }),
      ProjectVersion.deleteMany({ projectId: id }),
      ProjectFile.deleteMany({ projectId: id })
    ]);
    return project;
  }

  async getFiles(id, userId) {
    const project = await this.getById(id, userId);
    // Prefer the relational store when populated; fall back to embedded
    const rel = await ProjectFile.find({ projectId: project._id }).sort({ path: 1 }).lean();
    if (rel.length > 0) {
      return hydrateFiles(rel.map(this._toEmbedded));
    }
    return hydrateFiles(project.files);
  }

  /**
   * Returns everything about a project's source tree at once —
   * used by GET /api/projects/:id/source and by the Prompt Engine UI.
   */
  async getSource(id, userId) {
    const project = await this.getById(id, userId);
    const files = await ProjectFile.find({ projectId: project._id })
      .sort({ path: 1 })
      .lean();

    const effective = await hydrateFiles(files.length ? files : (project.files || []).map(f => ({
      path: f.path, content: f.content, language: f.language,
      encoding: f.encoding, blob: f.blob,
      size: Buffer.byteLength(f.content || '', 'utf8'),
      isEntry: false, isConfig: false
    })));

    return {
      projectId: project._id,
      name: project.name,
      description: project.description,
      framework: project.settings?.framework || 'react',
      styling: project.settings?.styling || 'tailwindcss',
      designSystem: project.settings?.designSystem,
      totalFiles: effective.length,
      totalSize: effective.reduce((s, f) => s + (f.size || 0), 0),
      tree: this._buildTree(effective.map(f => f.path)),
      files: effective.map(f => ({
        path: f.path,
        language: f.language,
        size: f.size || Buffer.byteLength(f.content || '', 'utf8'),
        isEntry: !!f.isEntry,
        isConfig: !!f.isConfig,
        content: f.content
      }))
    };
  }

  async updateFile(id, userId, path, content) {
    const project = await this.getById(id, userId);
    const fileIndex = project.files.findIndex(f => f.path === path);

    if (fileIndex > -1) {
      project.files[fileIndex].content = content;
    } else {
      project.files.push({ path, content, language: this._detectLanguage(path) });
    }

    project.files = await dehydrateFiles(project.files);
    await project.save();

    // Keep the relational store in sync
    await ProjectFile.findOneAndUpdate(
      { projectId: project._id, path },
      {
        $set: {
          content,
          blob: null,
          language: this._detectLanguage(path),
          userId: project.userId || null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    project.files = await hydrateFiles(project.files);
    return project;
  }

  /* ---------------------------- internals ---------------------------- */

  /**
   * Reconcile ProjectFile documents with `Project.files`.
   * - upserts each embedded file
   * - deletes any ProjectFile whose path is no longer present
   */
  async _syncFiles(project, origin = {}) {
    try {
      const embedded = Array.isArray(project.files) ? project.files : [];
      const paths = embedded.map(f => f.path);

      // Delete files that were removed
      if (paths.length) {
        await ProjectFile.deleteMany({
          projectId: project._id,
          path: { $nin: paths }
        });
      } else {
        await ProjectFile.deleteMany({ projectId: project._id });
        return;
      }

      // Upsert every embedded file
      const ops = embedded.map(f => ({
        updateOne: {
          filter: { projectId: project._id, path: f.path },
          update: {
            $set: {
              projectId: project._id,
              userId: project.userId || null,
              path: f.path,
              content: String(f.content || ''),
              language: f.language || this._detectLanguage(f.path),
              encoding: f.encoding || 'utf8',
              blob: f.blob || null,
              size: f.blob?.size ?? (f.encoding === 'base64' ? Buffer.byteLength(f.content || '', 'base64') : Buffer.byteLength(f.content || '', 'utf8')),
              isBinary: f.encoding === 'base64',
              origin: {
                generator: origin.generator || 'scaffolder',
                provider:  origin.provider  || '',
                model:     origin.model     || '',
                promptRunId: origin.promptRunId || null
              }
            }
          },
          upsert: true
        }
      }));
      if (ops.length) await ProjectFile.bulkWrite(ops, { ordered: false });
    } catch (err) {
      // Sync failures must never break Project.create — log and continue
      logger.error(`ProjectFile sync failed for ${project._id}: ${err.message}`);
    }
  }

  _toEmbedded(doc) {
    return {
      path: doc.path,
      content: doc.content,
      language: doc.language,
      encoding: doc.encoding || 'utf8',
      blob: doc.blob || null,
      size: doc.size,
      isEntry: doc.isEntry,
      isConfig: doc.isConfig
    };
  }

  _buildTree(paths) {
    const root = {};
    for (const p of paths) {
      const parts = p.split('/');
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const leaf = i === parts.length - 1;
        cur[name] = cur[name] || (leaf ? { __file: true, __path: p } : {});
        if (!leaf) cur = cur[name];
      }
    }
    return root;
  }

  _detectLanguage(path) {
    if (path.endsWith('.jsx')) return 'jsx';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    if (path.endsWith('.json')) return 'json';
    return 'text';
  }
}

module.exports = new ProjectService();
