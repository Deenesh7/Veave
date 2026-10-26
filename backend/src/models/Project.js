const mongoose = require('mongoose');
const { dehydrateFiles } = require('../services/storage/s3BlobStorage');

const projectSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null, index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  files: [{
    path: String,
    content: String,
    language: String,
    encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' },
    blob: { type: mongoose.Schema.Types.Mixed, default: null }
  }],
  dependencies: { type: [String], default: ['react', 'react-dom'] },
  validation: { type: mongoose.Schema.Types.Mixed, default: null },
  provenance: { type: mongoose.Schema.Types.Mixed, default: null },
  settings: {
    framework: { type: String, default: 'react' },
    styling: { type: String, default: 'tailwindcss' },
    designSystem: { type: String, default: 'Modern' },
    aiModel: { type: String, default: 'Auto' },
    lastTokenUsage: { type: mongoose.Schema.Types.Mixed, default: null },
    theme: {
      primary: { type: String, default: '#6366f1' },
      secondary: { type: String, default: '#38bdf8' },
      background: { type: String, default: '#09090b' },
      foreground: { type: String, default: '#fafafa' },
      radius: { type: String, default: '0.5rem' }
    }
  },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  // Monotonic change counter used for optimistic concurrency on shared projects (bumped by every write below).
  revision: { type: Number, default: 0 },
  lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

projectSchema.post('init', function rememberLoadedRevision() {
  if (this.isSelected('revision')) this.$locals.loadedRevision = this.revision || 0;
});

// Every document save bumps the revision. On a project that is shared, the save is also conditional on the revision
// the document was loaded at, so a stale copy (e.g. an AI run that started before a teammate saved) fails instead of
// silently overwriting the teammate's work.
projectSchema.pre('save', async function bumpRevisionOnSave() {
  if (this.isNew || !this.isModified() || this.isModified('revision')) return;
  const loaded = this.$locals.loadedRevision;
  if (loaded !== undefined && await require('./ProjectSharing').exists({ projectId: this._id })) {
    this.$where = loaded === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: loaded };
  }
  this.revision = (loaded ?? this.revision ?? 0) + 1;
});

projectSchema.post('save', function trackSavedRevision(doc) {
  doc.$locals.loadedRevision = doc.revision || 0;
});

projectSchema.post('save', function translateStaleSave(error, doc, next) {
  if (error && error.name === 'DocumentNotFoundError') {
    const { ConflictError } = require('../utils/errors');
    return next(new ConflictError('This project was changed by someone else while you were working. Reload to get the latest version, then try again.', 'PROJECT_CONFLICT'));
  }
  return next(error);
});

projectSchema.pre('findOneAndUpdate', function bumpRevisionOnUpdate() {
  const update = this.getUpdate() || {};
  if (update.$inc && 'revision' in update.$inc) return;
  const next = {};
  const plain = {};
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith('$')) next[key] = value; else plain[key] = value;
  }
  if (Object.keys(plain).length) next.$set = { ...(next.$set || {}), ...plain };
  next.$inc = { ...(next.$inc || {}), revision: 1 };
  this.setUpdate(next);
});

// Plan limits are enforced where projects are actually created, so no creation path (API, AI job, import) can skip them.
projectSchema.pre('save', async function enforcePlanLimits() {
  if (!this.isNew) return;
  if (!this.userId) throw new (require('../utils/errors').AuthError)('Log in to create a project.');
  await require('../services/billing/usageService').assertCanCreate(this.userId, { newProject: true });
});

projectSchema.pre('save', async function persistFilesInObjectStorage() {
  if (this.isModified('files') && Array.isArray(this.files)) this.files = await dehydrateFiles(this.files);
});

projectSchema.pre('findOneAndUpdate', async function persistUpdatedFilesInObjectStorage() {
  const update = this.getUpdate();
  const files = update?.$set?.files || update?.files;
  if (!Array.isArray(files)) return;
  const stored = await dehydrateFiles(files);
  if (update.$set?.files) update.$set.files = stored;
  else update.files = stored;
});

/* ------------------------------------------------------------------ *
 * Fan-out to the relational ProjectFile collection.
 *
 * Every Project write persists `files` twice:
 *   1. embedded in Project.files       (fast, single-query editor load)
 *   2. one ProjectFile per file        (queryable, exportable, relational)
 *
 * We register the hooks lazily to avoid a require cycle
 * (ProjectFile.js does not depend on Project.js).
 * ------------------------------------------------------------------ */

// Compile the preview once, right after the source is saved, so opening the editor never compiles in the browser.
projectSchema.post('save', function precompilePreviewAfterSave(doc) {
  require('../services/preview/previewService').schedulePrecompile(doc._id);
});
projectSchema.post('findOneAndUpdate', function precompilePreviewAfterUpdate(doc) {
  if (doc) require('../services/preview/previewService').schedulePrecompile(doc._id);
});

projectSchema.post('save', async function syncFilesAfterSave(doc) {
  try {
    if (!Array.isArray(doc.files) || doc.files.length === 0) return;
    const ProjectFile = require('./ProjectFile');
    const paths = doc.files.map(f => f.path).filter(Boolean);

    // Delete files that were removed
    await ProjectFile.deleteMany({
      projectId: doc._id,
      path: { $nin: paths }
    });

    // Upsert each file
    if (paths.length) {
      const ops = doc.files.filter(f => f && f.path).map(f => ({
        updateOne: {
          filter: { projectId: doc._id, path: f.path },
          update: {
            $set: {
              projectId: doc._id,
              userId: doc.userId || null,
              path: f.path,
              content: String(f.content || ''),
              language: f.language || undefined,
              encoding: f.encoding || 'utf8',
              blob: f.blob || null,
              size: f.blob?.size ?? Buffer.byteLength(f.content || '', f.encoding === 'base64' ? 'base64' : 'utf8'),
              isBinary: f.encoding === 'base64'
            }
          },
          upsert: true
        }
      }));
      if (ops.length) await ProjectFile.bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    // Never fail the parent save if the mirror sync fails
    // eslint-disable-next-line no-console
    console.warn('[Project] ProjectFile sync failed:', err.message);
  }
});

/**
 * `Project.create({...})` calls `.save()` internally so the post-save hook
 * above already fires. `findOneAndUpdate` however does NOT trigger save hooks,
 * so we register a dedicated post hook for that path.
 */
projectSchema.post('findOneAndUpdate', async function syncFilesAfterUpdate(doc) {
  if (!doc) return;
  try {
    const ProjectFile = require('./ProjectFile');
    if (!Array.isArray(doc.files)) return;
    const paths = doc.files.map(f => f.path).filter(Boolean);
    await ProjectFile.deleteMany({ projectId: doc._id, path: { $nin: paths } });
    if (paths.length) {
      const ops = doc.files.filter(f => f && f.path).map(f => ({
        updateOne: {
          filter: { projectId: doc._id, path: f.path },
          update: {
            $set: {
              projectId: doc._id,
              userId: doc.userId || null,
              path: f.path,
              content: String(f.content || ''),
              language: f.language || undefined,
              encoding: f.encoding || 'utf8',
              blob: f.blob || null,
              size: f.blob?.size ?? Buffer.byteLength(f.content || '', f.encoding === 'base64' ? 'base64' : 'utf8'),
              isBinary: f.encoding === 'base64'
            }
          },
          upsert: true
        }
      }));
      if (ops.length) await ProjectFile.bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Project] ProjectFile sync (update) failed:', err.message);
  }
});

/**
 * Cascade delete files, versions, and conversations when a Project is removed.
 */
projectSchema.post('findOneAndDelete', async function cascadeDelete(doc) {
  if (!doc) return;
  try {
    const ProjectFile     = require('./ProjectFile');
    const ProjectVersion  = require('./ProjectVersion');
    const Conversation    = require('./Conversation');
    await Promise.all([
      require('./PrecompiledPreview').deleteMany({ projectId: doc._id }),
      require('./ProjectSharing').deleteMany({ projectId: doc._id }),
      ProjectFile.deleteMany({ projectId: doc._id }),
      ProjectVersion.deleteMany({ projectId: doc._id }),
      Conversation.deleteMany({ projectId: doc._id })
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Project] cascade delete failed:', err.message);
  }
});

projectSchema.post('deleteOne', { document: true, query: false }, async function cascadeDeleteDoc() {
  try {
    const ProjectFile     = require('./ProjectFile');
    const ProjectVersion  = require('./ProjectVersion');
    const Conversation    = require('./Conversation');
    await Promise.all([
      require('./PrecompiledPreview').deleteMany({ projectId: this._id }),
      ProjectFile.deleteMany({ projectId: this._id }),
      ProjectVersion.deleteMany({ projectId: this._id }),
      Conversation.deleteMany({ projectId: this._id })
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Project] cascade deleteOne failed:', err.message);
  }
});

module.exports = mongoose.model('Project', projectSchema);
