const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  sourceHash: { type: String, required: true },
  files: [{ _id: false, path: String, content: String, encoding: { type: String, default: 'base64' }, blob: mongoose.Schema.Types.Mixed }],
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
});

module.exports = mongoose.model('PreviewArtifact', schema);
