const Project = require('../../models/Project');
const ProjectFile = require('../../models/ProjectFile');
const Conversation = require('../../models/Conversation');
const ProjectVersion = require('../../models/ProjectVersion');
const { NotFoundError, ValidationError, ConflictError, AppError } = require('../../utils/errors');
const projectAccess = require('../collaboration/projectAccess');
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

const base64ByteLength = (content = '') => {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
};

// Fields a client may never set through the generic update endpoint (ownership, concurrency and audit data).
const PROTECTED_FIELDS = ['_id', 'userId', 'revision', 'lastEditedBy', 'createdAt', 'updatedAt', '__v'];

const revisionFilter = (revision) => (revision === 0
  ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
  : { revision });

const parseRevision = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function revisionConflict(currentRevision) {
  return new ConflictError(
    'This project was changed by someone else since you opened it. Reload to get the latest version before saving.',
    'PROJECT_CONFLICT',
    { currentRevision }
  );
}

class ProjectService {
  /**
   * Lightweight view of a project for the editor: text files are returned in full, binary assets (images, fonts)
   * are listed with their size but no bytes. They are served on demand by the preview asset route, which keeps the
   * payload small (a 70 MB project becomes ~1 MB) and the editor opening quickly.
   */
  async toEditorView(project) {
    const plain = project.toObject ? project.toObject() : { ...project };
    const raw = plain.files || [];
    const text = await hydrateFiles(raw.filter((file) => file.encoding !== 'base64'));
    let next = 0;
    plain.files = raw.map((file) => (file.encoding === 'base64'
      ? { path: file.path, language: file.language, encoding: 'base64', size: file.blob?.size ?? base64ByteLength(file.content || ''), contentOmitted: true }
      : text[next++]));
    try {
      const doc = await require('../preview/previewService').ensurePrecompiled(plain._id);
      plain.previewAssetToken = doc?.token || null;
    } catch (error) {
      logger.warn(`Preview token unavailable for ${plain._id}: ${error.message}`);
      plain.previewAssetToken = null;
    }
    return plain;
  }

  /**
   * A file sent back WITHOUT a `content` property means "unchanged": keep the stored version. Clients that load the
   * lightweight view (or the project list, which also omits contents) save the whole file list, and must never
   * overwrite stored files with nothing.
   */
  async mergeUnchangedFiles(query, incoming) {
    if (!incoming.some((file) => file && typeof file.content !== 'string')) return incoming;
    const stored = await Project.findOne(query).select('files').lean();
    const byPath = new Map((stored?.files || []).map((file) => [file.path, file]));
    return incoming.map((file) => {
      if (file && typeof file.content === 'string') return file;
      const existing = file && byPath.get(file.path);
      if (!existing) throw new ValidationError(`File "${file?.path}" was sent without content and does not exist yet.`);
      return existing;
    });
  }

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
    // A logged-in user's list is exactly their own projects (the same set billing counts); a guest only sees
    // ownerless ones. It used to mix in everyone's ownerless projects, so the list and the usage numbers disagreed.
    const query = userId
      ? { userId, status: 'active' }
      : { $or: [{ userId: null }, { userId: { $exists: false } }], status: 'active' };
    // Dashboard listings only need file metadata for the count. Returning every
    // source body makes large generated projects stall unrelated API requests.
    return await Project.find(query)
      .select('-files.content -files.blob')
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getById(id, userId, { lite = false, withAccess = false, minLevel = 'viewer' } = {}) {
    const ctx = await projectAccess.requireProjectAccess(id, userId, minLevel);
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project');
    const accessInfo = { level: ctx.level, canEdit: ctx.canEdit, canManage: ctx.canManage, isOwner: ctx.isOwner };
    if (lite) {
      const view = await this.toEditorView(project);
      return withAccess ? { ...view, access: accessInfo } : view;
    }
    project.files = await hydrateFiles(project.files);
    if (!withAccess) return project;
    return { ...project.toObject(), access: accessInfo };
  }

  async update(id, userId, data, { lite = false, baseRevision = null } = {}) {
    const ctx = await projectAccess.requireProjectAccess(id, userId, 'editor');
    // Extract versionLabel before persisting (it's not a Project field)
    const versionLabel = data.versionLabel;
    const persistData = { ...data };
    delete persistData.versionLabel;
    delete persistData.baseRevision;
    delete persistData.origin;
    for (const field of PROTECTED_FIELDS) delete persistData[field];
    // Archiving / restoring changes the project's lifecycle: that needs project admin rights.
    if (persistData.status !== undefined && !ctx.canManage) delete persistData.status;

    const query = { _id: id };
    const expected = parseRevision(baseRevision ?? data.baseRevision);
    // Collaborative projects must say which revision the edit is based on, so two people never silently overwrite each other.
    if (await projectAccess.isShared(id)) {
      if (expected === null) {
        throw new AppError('Reload this shared project before saving: the save did not say which version it was based on.', 428);
      }
      Object.assign(query, revisionFilter(expected));
    }
    if (Array.isArray(persistData.files)) {
      persistData.files = await this.mergeUnchangedFiles({ _id: id }, persistData.files);
      persistData.files = await dehydrateFiles(persistData.files);
    }
    if (userId) persistData.lastEditedBy = userId;
    const project = await Project.findOneAndUpdate(
      query,
      { $set: persistData },
      { new: true }
    );
    if (!project) {
      const current = await Project.findById(id).select('revision').lean();
      if (!current) throw new NotFoundError('Project');
      throw revisionConflict(current.revision || 0);
    }
    if (Array.isArray(data.files)) require('../search/projectIndexHooks').invalidate(project._id); // manual save: cached symbols are stale

    // If the update touched files, re-sync the relational store
    if (Array.isArray(data.files)) {
      await this._syncFiles(project, data.origin);

      // Auto-create version snapshot when files change
      try {
        const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });
        const newVersion = new ProjectVersion({
          projectId: project._id,
          userId: userId || project.userId || null,
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
    const access = { level: ctx.level, canEdit: ctx.canEdit, canManage: ctx.canManage, isOwner: ctx.isOwner };
    if (lite) return { ...(await this.toEditorView(project)), access };
    project.files = await hydrateFiles(project.files);
    return { ...project.toObject(), access };
  }

  /** Shared projects only accept a write that names the revision it was based on, and that revision must still be current. */
  async assertBaseRevision(id, baseRevision) {
    if (!(await projectAccess.isShared(id))) return;
    const expected = parseRevision(baseRevision);
    if (expected === null) throw new AppError('Reload this shared project before saving: the save did not say which version it was based on.', 428);
    const current = await Project.findById(id).select('revision').lean();
    if (!current) throw new NotFoundError('Project');
    if ((current.revision || 0) !== expected) throw revisionConflict(current.revision || 0);
  }

  async createManualVersion(id, userId, label) {
    const project = await this.getById(id, userId, { minLevel: 'editor' });
    const storedFiles = await dehydrateFiles(project.files);
    const versionCount = await ProjectVersion.countDocuments({ projectId: project._id });
    const newVersion = new ProjectVersion({
      projectId: project._id,
      userId: userId || project.userId || null,
      version: versionCount + 1,
      label: label || `Manual Snapshot v${versionCount + 1}`,
      files: storedFiles,
      dependencies: project.dependencies
    });
    await newVersion.save();
    return newVersion;
  }

  async delete(id, userId) {
    // Deleting a project (and its conversations, versions and sharing) is reserved for its owner.
    await projectAccess.requireProjectAccess(id, userId, 'owner');
    const project = await Project.findOneAndDelete({ _id: id });
    if (!project) throw new NotFoundError('Project');

    // Cascade
    await Promise.all([
      Conversation.deleteMany({ projectId: id }),
      ProjectVersion.deleteMany({ projectId: id }),
      ProjectFile.deleteMany({ projectId: id }),
      require('../../models/ProjectSharing').deleteMany({ projectId: id })
    ]);
    require('../search/projectIndexHooks').dispose(id); // project closed: stop its language servers
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

  async updateFile(id, userId, path, content, { baseRevision = null } = {}) {
    await projectAccess.requireProjectAccess(id, userId, 'editor');
    if (typeof path !== 'string' || !path.trim() || typeof content !== 'string') throw new ValidationError('A file path and string content are required.');
    const project = await Project.findById(id);
    if (!project) throw new NotFoundError('Project');
    const expected = parseRevision(baseRevision);
    if (await projectAccess.isShared(id)) {
      if (expected === null) throw new AppError('Reload this shared project before saving: the save did not say which version it was based on.', 428);
      if (expected !== (project.revision || 0)) throw revisionConflict(project.revision || 0);
    }
    const language = this._detectLanguage(path);
    const files = project.files.map((f) => (typeof f.toObject === 'function' ? f.toObject() : f));
    const fileIndex = files.findIndex((f) => f.path === path);
    if (fileIndex > -1) files[fileIndex] = { ...files[fileIndex], content, blob: null, encoding: 'utf8' };
    else files.push({ path, content, language });

    const stored = await dehydrateFiles(files);
    // Compare-and-set on the revision we read: a concurrent writer makes this fail instead of being overwritten.
    const saved = await Project.findOneAndUpdate(
      { _id: id, ...revisionFilter(project.revision || 0) },
      { $set: { files: stored, ...(userId ? { lastEditedBy: userId } : {}) } },
      { new: true }
    );
    if (!saved) {
      const current = await Project.findById(id).select('revision').lean();
      throw revisionConflict(current?.revision || 0);
    }

    // Keep the relational store in sync
    await ProjectFile.findOneAndUpdate(
      { projectId: saved._id, path },
      { $set: { content, blob: null, language, userId: saved.userId || null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    require('../search/projectIndexHooks').invalidate(saved._id); // manual save: cached symbols are stale
    saved.files = await hydrateFiles(saved.files);
    return saved;
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
module.exports.revisionFilter = revisionFilter;
module.exports.revisionConflict = revisionConflict;
