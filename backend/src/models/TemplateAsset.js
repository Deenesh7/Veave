const mongoose = require('mongoose');

// An image or file that belongs to ONE template site (never shared between sites or jobs). The bytes live in the site's project
// files (and S3); this keeps what they are, where they came from and what they are used for.
const templateAssetSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateSite', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pageId: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplatePage', default: null },
  projectPath: { type: String, required: true },
  sourceUrl: { type: String, default: null },
  sourcePage: { type: String, default: null },
  attribution: { type: String, default: '' },
  entity: { type: String, default: '' },
  sha256: { type: String, required: true },
  mime: { type: String, default: '' },
  size: { type: Number, default: 0 },
  jobId: { type: String, default: null },
  // Library fields of a picture the owner uploaded.
  source: { type: String, enum: ['upload', 'generated', 'enhanced'], default: 'generated' },
  // On an AI-enhanced picture: the owner's original it was made from (the original is never changed or removed).
  enhancedOf: { type: mongoose.Schema.Types.ObjectId, ref: 'TemplateAsset', default: null, index: true },
  // On an uploaded original: the state of its AI enhancement. The enhanced picture is a separate asset (enhancedAssetId).
  enhancement: {
    type: new mongoose.Schema({
      status: { type: String, enum: ['none', 'queued', 'analyzing', 'enhancing', 'completed', 'failed', 'skipped'], default: 'none' },
      error: { type: String, default: null },
      errorCode: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      enhancedAssetId: { type: mongoose.Schema.Types.ObjectId, default: null },
      // Which picture the website uses: nothing chosen yet, the enhanced one, or the original.
      applied: { type: String, enum: ['none', 'enhanced', 'original'], default: 'none' },
      credits: { type: Number, default: 0 },
      chargedAt: { type: Date, default: null },
      model: { type: String, default: '' }
    }, { _id: false }),
    default: () => ({})
  },
  originalName: { type: String, default: '' },
  width: { type: Number, default: 0 },
  height: { type: Number, default: 0 },
  alt: { type: String, default: '', maxlength: 200 },
  // A small preview (data URL) so the library can show pictures without loading the originals.
  thumbnail: { type: String, default: '' },
  // What the picture shows, written once by a vision model after upload (never required: generation works without it).
  caption: { type: String, default: '', maxlength: 400 },
  tags: { type: [String], default: [] },
  captionStatus: { type: String, enum: ['none', 'pending', 'ready', 'failed', 'skipped'], default: 'none' },
  // Where the owner wants it: the pages it is meant for, and a section hint (hero, about, gallery, project, background, other).
  pageIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  placement: { type: String, default: '' },
  note: { type: String, default: '', maxlength: 300 },
  // Soft delete: the file stays in the site so older revisions that still show it keep rendering.
  deletedAt: { type: Date, default: null },
  replacedBy: { type: String, default: null }
}, { timestamps: true });

// The same bytes are stored once per site.
templateAssetSchema.index({ siteId: 1, sha256: 1 }, { unique: true });
templateAssetSchema.index({ siteId: 1, projectPath: 1 }, { unique: true });

module.exports = mongoose.model('TemplateAsset', templateAssetSchema);
