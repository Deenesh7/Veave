const mongoose = require('mongoose');

const checkpointSchema = new mongoose.Schema({
  checkpointId: { type: String, required: true, index: true },
  stepNumber: { type: Number, required: true },
  userPrompt: { type: String, default: '' },
  changeSummary: { type: String, default: '' },
  filesSnapshot: [{
    path: String,
    content: String,
    language: String,
    encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' }
  }],
  activeCode: { type: String, default: '' },
  designTokens: { type: mongoose.Schema.Types.Mixed, default: {} },
  dependencies: [{ type: String }],
  validation: { type: mongoose.Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const generationSchema = new mongoose.Schema({
  generationId: { type: String, required: true, index: true },
  parentGenerationId: { type: String, default: null },
  versionNumber: { type: Number, default: 1 },
  userPrompt: { type: String, required: true },
  changeSummary: { type: String, default: '' },
  filesSnapshot: [{
    path: String,
    content: String,
    language: String,
    encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' }
  }],
  activeCode: { type: String, default: '' },
  designTokens: { type: mongoose.Schema.Types.Mixed, default: {} },
  assets: [{ type: String }],
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
    default: null,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null,
    index: true
  },
  title: {
    type: String,
    default: 'New Prototype Generation'
  },
  activeGenerationId: {
    type: String,
    default: null
  },
  currentIndex: {
    type: Number,
    default: 0
  },
  checkpoints: [checkpointSchema],
  generations: [generationSchema],
  latestState: {
    files: [{
      path: String,
      content: String,
      language: String,
      encoding: { type: String, enum: ['utf8', 'base64'], default: 'utf8' }
    }],
    activeCode: String,
    designTokens: mongoose.Schema.Types.Mixed,
    dependencies: [String],
    validation: mongoose.Schema.Types.Mixed,
    updatedAt: { type: Date, default: Date.now }
  },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, default: '' },
    generationId: { type: String, default: null },
    changeSummary: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
    actions: [{
      type: { type: String }, // 'create_file', 'modify_file', 'delete_file', 'rollback', 'redo'
      path: String,
      reason: String
    }],
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  }],
  designTokens: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  designSystemSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  contextSummary: {
    type: String,
    default: ''
  },
  // 1-day retention expiration: automatically removed after 24 hours
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000)
  },
  lastActivityAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

conversationSchema.pre('validate', function(next) {
  if (!this.conversationId) {
    this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  next();
});

module.exports = mongoose.model('Conversation', conversationSchema);
