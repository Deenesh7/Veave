const mongoose = require('mongoose');

// One saved state of a WHOLE template website. The files are not copied here: they live in a ProjectVersion (whose files are references
// to content-addressed, never-overwritten objects in object storage), so every version of a site shares the bytes it has in common.
// This document adds what a website version needs on top: its name, its pages (routes, order, components), where it came from and why.
const pageSnapshotSchema = new mongoose.Schema({
  pageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  name: String,
  description: { type: String, default: '' },
  route: String,
  componentPath: String,
  order: Number,
  currentRevision: { type: Number, default: 1 },
  generation: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const templateVersionSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSite', required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String, default: '' },
  // 1, 2, 3 ... per site, never reused (deleting a version does not renumber the others).
  number: { type: Number, required: true },
  name: { type: String, required: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 600 },
  // create: the original template. generate: the whole website written by the AI. snapshot: an automatic safety copy taken before a risky
  // operation. restore / rollback / promote: a state brought back from another version or branch. manual: saved by the owner.
  kind: { type: String, enum: ['create', 'generate', 'snapshot', 'restore', 'rollback', 'promote', 'manual', 'branch'], required: true },
  origin: { type: String, enum: ['system', 'ai', 'user'], default: 'system' },
  operation: { type: String, default: null },
  // 'pending' until every file and page of the version is saved and checked: a version that is not 'complete' is never offered or restored.
  status: { type: String, enum: ['pending', 'complete', 'failed'], default: 'pending', index: true },
  snapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectVersion', default: null },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateVersion', default: null },
  restoredFromId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateVersion', default: null },
  jobId: { type: String, default: null },
  pages: { type: [pageSnapshotSchema], default: [] },
  affectedPages: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  // The website plan and brief at that moment (so restoring a version also restores what the AI was told).
  brief: { type: String, default: '' },
  plan: { type: mongoose.Schema.Types.Mixed, default: null },
  // Pictures the version's files point at: [{ path, sha256, size, assetId, source }]
  assets: { type: mongoose.Schema.Types.Mixed, default: [] },
  // Integrity: what was saved, so it can be checked later without trusting the copy.
  fileCount: { type: Number, default: 0 },
  bytes: { type: Number, default: 0 },
  treeHash: { type: String, default: '' },
  pagesHash: { type: String, default: '' },
  protected: { type: Boolean, default: false },
  published: { type: Boolean, default: false },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true });

templateVersionSchema.index({ siteId: 1, number: 1 }, { unique: true });
templateVersionSchema.index({ siteId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('TemplateVersion', templateVersionSchema);
