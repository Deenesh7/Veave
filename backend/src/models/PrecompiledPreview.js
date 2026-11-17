const mongoose = require('mongoose');

// The compiled (Babel + Tailwind already applied) preview document for a project's current source.
// One per project: it is replaced when the source changes, so the editor never has to compile in the browser.
const precompiledPreviewSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
  // Capability token in asset URLs (/api/preview-assets/<token>/...). Rotates whenever the source changes.
  token: { type: String, required: true, unique: true },
  sourceHash: { type: String, required: true },
  // Fingerprint of the preview compiler that produced `html`; a stored document from an older compiler is rebuilt.
  compilerVersion: { type: String, default: '' },
  sourceUpdatedAt: { type: Date, default: null },
  status: { type: String, enum: ['ready', 'skipped', 'failed'], default: 'ready' },
  // The compiled page (1-4 MB) lives in S3 when it is configured: `htmlBlob` is its reference and `html` stays empty. Without S3 it is kept here.
  html: { type: String, default: '' },
  htmlBlob: { type: mongoose.Schema.Types.Mixed, default: null },
  assetPaths: { type: [String], default: [] },
  // Result of checking the compiled page against the project's files: { checked, missingCount, missing[] } (see validateCompiledAssets).
  assetReport: { type: mongoose.Schema.Types.Mixed, default: null },
  bytes: { type: Number, default: 0 },
  compileMs: { type: Number, default: 0 },
  error: { type: String, default: '' },
  compiledAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PrecompiledPreview', precompiledPreviewSchema);
