const mongoose = require('mongoose');

const aiUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
  model: String,
  provider: String,
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  requestDuration: { type: Number, default: 0 },
  cost: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('AIUsage', aiUsageSchema);
