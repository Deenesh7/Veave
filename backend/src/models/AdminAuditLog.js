const mongoose = require('mongoose');

// Append-only record of sensitive admin actions. The model refuses updates and deletes, and no API offers them.
const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorEmail: { type: String, default: '' },
  action: { type: String, required: true, index: true },
  resourceType: { type: String, default: '' },
  resourceId: { type: String, default: '', index: true },
  before: { type: mongoose.Schema.Types.Mixed, default: undefined },
  after: { type: mongoose.Schema.Types.Mixed, default: undefined },
  meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  ip: { type: String, default: '' }
}, { timestamps: { createdAt: true, updatedAt: false } });

schema.index({ createdAt: -1 });

const blocked = () => { throw new Error('Audit records cannot be changed or deleted.'); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndRemove'].forEach((name) => schema.pre(name, blocked));
schema.pre('save', function immutable(next) { if (!this.isNew) return blocked(); return next(); });
schema.pre('deleteOne', { document: true, query: false }, blocked);

module.exports = mongoose.model('AdminAuditLog', schema);
