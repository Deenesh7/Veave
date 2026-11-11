const mongoose = require('mongoose');

// One saved state of a page (or of the site, for page add/delete/reorder). `files` holds the full content of every file the change
// touched AFTER the change, so any revision can be restored without replaying others. `before` lists their previous content.
const fileSchema = new mongoose.Schema({
  path: { type: String, required: true },
  content: { type: String, default: '' },
  language: { type: String, default: 'plaintext' },
  deleted: { type: Boolean, default: false }
}, { _id: false });

const templateRevisionSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSite', required: true, index: true },
  pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplatePage', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Per page (or per site for site-level revisions): 1, 2, 3 ...
  number: { type: Number, required: true },
  kind: { type: String, enum: ['create', 'regenerate', 'restore', 'page-add', 'page-delete', 'page-rename', 'page-reorder', 'replace-image'], required: true },
  instruction: { type: String, default: '' },
  status: { type: String, enum: ['committed', 'failed'], default: 'committed' },
  files: { type: [fileSchema], default: [] },
  before: { type: [fileSchema], default: [] },
  validation: { type: mongoose.Schema.Types.Mixed, default: null },
  jobId: { type: String, default: null },
  restoredFrom: { type: Number, default: null },
  siteRevision: { type: Number, default: null }
}, { timestamps: true });

templateRevisionSchema.index({ siteId: 1, pageId: 1, number: 1 }, { unique: true });
// A job saves at most one revision: a retried or recovered job cannot save twice.
templateRevisionSchema.index({ jobId: 1 }, { unique: true, partialFilterExpression: { jobId: { $type: 'string' } } });

module.exports = mongoose.model('TemplateRevision', templateRevisionSchema);
