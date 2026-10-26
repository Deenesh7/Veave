const mongoose = require('mongoose');

const STAGES = ['preparing', 'building', 'uploading', 'publishing', 'verifying', 'published'];

const deploymentSchema = new mongoose.Schema({
  deploymentId: { type: String, required: true, unique: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'PublishedSite', required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  slug: { type: String, required: true },
  version: { type: String, required: true },
  status: { type: String, enum: ['running', 'succeeded', 'failed'], default: 'running' },
  stage: { type: String, enum: STAGES, default: 'preparing' },
  error: { type: mongoose.Schema.Types.Mixed, default: null },
  buildMode: { type: String, enum: ['docker', 'local', null], default: null },
  fileCount: { type: Number, default: 0 },
  bytes: { type: Number, default: 0 },
  publicCheck: { type: mongoose.Schema.Types.Mixed, default: null },
  logs: [{ _id: false, at: Date, level: String, message: String }],
  startedAt: { type: Date, default: Date.now },
  finishedAt: { type: Date, default: null }
}, { timestamps: true });

deploymentSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('Deployment', deploymentSchema);
module.exports.STAGES = STAGES;
