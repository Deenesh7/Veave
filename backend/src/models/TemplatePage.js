const mongoose = require('mongoose');

// One page of a template site: its route, the component file that renders it, and its generation state.
const templatePageSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSite', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, default: '', maxlength: 300 },
  route: { type: String, required: true },
  componentPath: { type: String, required: true },
  order: { type: Number, default: 0 },
  status: { type: String, enum: ['ready', 'generating', 'failed'], default: 'ready' },
  // Number of the revision whose files are currently live for this page (0 = the template's original page).
  currentRevision: { type: Number, default: 0 },
  // Highest revision number ever issued for this page (restoring an old revision moves currentRevision back, never this).
  revisionCount: { type: Number, default: 0 },
  // Where the page is in website generation: derived for pages that never had one (not-started / completed).
  generation: {
    type: new mongoose.Schema({
      state: { type: String, enum: ['not-started', 'queued', 'generating', 'completed', 'failed', 'needs-review'], default: 'not-started' },
      error: { type: String, default: null },
      updatedAt: { type: Date, default: null }
    }, { _id: false }),
    default: undefined
  },
  lastInstruction: { type: String, default: '' },
  lastError: { type: String, default: null }
}, { timestamps: true });

// A route and a component file belong to exactly one page of a site: this is what prevents duplicate pages.
templatePageSchema.index({ siteId: 1, route: 1 }, { unique: true });
templatePageSchema.index({ siteId: 1, componentPath: 1 }, { unique: true });
templatePageSchema.index({ siteId: 1, order: 1 });

module.exports = mongoose.model('TemplatePage', templatePageSchema);
