const mongoose = require('mongoose');

// Key/value platform settings (credit defaults, plan overrides, thresholds) edited from the admin dashboard.
const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('PlatformSetting', schema);
