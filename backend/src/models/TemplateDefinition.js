const mongoose = require('mongoose');

// One document per template version. The manifest and the text scaffold files are stored here; scaffold images and the gallery
// preview are stored in S3 and referenced by `blob` (same shape as project file blobs). Read once at startup by templateService.
const blobSchema = new mongoose.Schema({}, { strict: false, _id: false });

const templateDefinitionSchema = new mongoose.Schema({
  templateId: { type: String, required: true, index: true },
  version: { type: String, required: true },
  manifest: { type: mongoose.Schema.Types.Mixed, required: true },
  // Scaffold text files, paths relative to the scaffold root (e.g. src/App.jsx).
  files: [{ _id: false, path: { type: String, required: true }, content: { type: String, default: '' } }],
  // Scaffold images, paths relative to the scaffold root (e.g. public/images/hero.svg); content lives in S3.
  assets: [{ _id: false, path: { type: String, required: true }, blob: { type: blobSchema, required: true } }],
  preview: { type: new mongoose.Schema({ blob: { type: blobSchema, required: true } }, { _id: false }), required: true },
  contentHash: { type: String, default: '' }
}, { timestamps: true, collection: 'templatedefinitions' });

templateDefinitionSchema.index({ templateId: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('TemplateDefinition', templateDefinitionSchema);
