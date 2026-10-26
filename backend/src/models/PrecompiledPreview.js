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
  html: { type: String, default: '' },
  assetPaths: { type: [String], default: [] },
  bytes: { type: Number, default: 0 },
  compileMs: { type: Number, default: 0 },
  error: { type: String, default: '' },
  compiledAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PrecompiledPreview', precompiledPreviewSchema);
