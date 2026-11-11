const mongoose = require('mongoose');

// Checkpoint of one website-prototype run: the crawl, design system, asset manifest, inventory and the status of every
// page. It lives outside the job document because it can be large, and so that a restarted job resumes from it.
const prototypeRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, index: true }, // the generation job id
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  url: { type: String, default: '' },
  state: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedAt: { type: Date, default: Date.now, index: { expires: 60 * 60 * 24 * 30 } }
});

module.exports = mongoose.model('PrototypeRun', prototypeRunSchema);
