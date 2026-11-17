const mongoose = require('mongoose');

// Internal notes about a user, visible to admins only.
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  adminName: { type: String, default: '' },
  note: { type: String, required: true, maxlength: 2000 }
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('AdminNote', schema);
