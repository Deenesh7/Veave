const mongoose = require('mongoose');

// A website created from a template. The files live in the linked Project (so storage, S3 offloading, the precompiled preview and
// version history are the existing ones); this document is the template workspace's own record: owner, template, name, pages' parent.
const templateSiteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  category: { type: String, default: '' },
  templateId: { type: String, required: true },
  templateVersion: { type: String, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  description: { type: String, default: '', maxlength: 500 },
  // The owner's description of the whole website, written once. Every page generation (one page or all) is given it as website-level context.
  brief: { type: String, default: '', maxlength: 4000 },
  // Website versions: a counter that never repeats a number.
  versionSeq: { type: Number, default: 0 },
  // A branch is its own working copy of a website, started from one version of another site ("main"); main is never touched while it is edited.
  branchOf: { type: mongoose.Schema.Types.Mixed, default: null },
  promotedAt: { type: Date, default: null },
  // The website plan made from the brief before any page is written (identity, sitemap, navigation, terminology, terms to avoid). Every page job reads it.
  plan: { type: mongoose.Schema.Types.Mixed, default: null },
  // The typography theme chosen for the site (fonts, weights, spacing); null = the template's own. The same settings are written into the site's index.css/index.html.
  typography: { type: mongoose.Schema.Types.Mixed, default: null },
  // The whole theme chosen before creation: { typography, colors, appearance }; null = the template's own. Written into the site's files as one managed block.
  theme: { type: mongoose.Schema.Types.Mixed, default: null },
  // Thumbnail: the template's preview image until the site has its own.
  thumbnailUrl: { type: String, default: '' },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  // Counts every committed change to the site's files (page edits, page add/delete/reorder, restores).
  revision: { type: Number, default: 0 },
  // The page the workspace shows first after a reload.
  lastPageId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // A repeated "create site" request with the same key returns the site that the first one made.
  idempotencyKey: { type: String, default: null }
}, { timestamps: true });

templateSiteSchema.index({ userId: 1, status: 1, updatedAt: -1 });
templateSiteSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

module.exports = mongoose.model('TemplateSite', templateSiteSchema);
