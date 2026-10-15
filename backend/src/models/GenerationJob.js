const mongoose = require('mongoose');

const generationJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null,
    index: true
  },
  conversationId: {
    type: String,
    default: null,
    index: true
  },
  generationId: {
    type: String,
    default: null,
    index: true
  },
  parentGenerationId: {
    type: String,
    default: null
  },
  changeSummary: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['generate', 'modify', 'screenshot', 'clone'],
    default: 'generate'
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'committing', 'completed', 'failed', 'blocked', 'cancelled'],
    default: 'queued',
    index: true
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  step: {
    type: Number,
    default: 0
  },
  stepName: {
    type: String,
    default: 'Initializing generation...'
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  error: {
    type: String,
    default: null
  },
  validation: { type: mongoose.Schema.Types.Mixed, default: null },
  analysis: { type: mongoose.Schema.Types.Mixed, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
  // Plan approval gate: { state: 'pending'|'approved'|'cancelled', plan, requestedAt, decidedAt }
  approval: { type: mongoose.Schema.Types.Mixed, default: null },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// TTL index to automatically clean up completed/failed jobs after 7 days
generationJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

module.exports = mongoose.model('GenerationJob', generationJobSchema);

