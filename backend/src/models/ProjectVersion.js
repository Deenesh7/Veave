const mongoose = require('mongoose');
const { dehydrateFiles } = require('../services/storage/s3BlobStorage');

const projectVersionSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
  version: { type: Number, required: true },
  label: { type: String, default: '' },
  files: [{
    path: String,
    content: String,
    language: String,
    encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' },
    blob: { type: mongoose.Schema.Types.Mixed, default: null }
  }],
  dependencies: [String]
}, { timestamps: true });

projectVersionSchema.index({ projectId: 1, version: 1 }, { unique: true });

projectVersionSchema.pre('save', async function persistVersionFilesInObjectStorage() {
  if (this.isModified('files') && Array.isArray(this.files)) this.files = await dehydrateFiles(this.files);
});

module.exports = mongoose.model('ProjectVersion', projectVersionSchema);
