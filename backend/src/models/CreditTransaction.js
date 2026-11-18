const mongoose = require('mongoose');

// The credit ledger: one row per change of a user's credit balance. Rows are never edited or deleted by the application.
const TYPES = ['CREDIT_ALLOCATION', 'CREDIT_USAGE', 'CREDIT_DEDUCTION', 'CREDIT_ADJUSTMENT', 'CREDIT_REFUND', 'MONTHLY_CREDIT_ALLOCATION', 'CREDIT_EXPIRY'];

const creditTransactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  previousBalance: { type: Number, default: null },
  amount: { type: Number, required: true },            // signed: credits added (+) or deducted (-)
  newBalance: { type: Number, default: null },
  type: { type: String, enum: TYPES, required: true, index: true },
  reason: { type: String, default: '', maxlength: 500 },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },   // null: done by the system / the user's own activity
  // Repeating the same request (a double click, a retry) must not change the balance twice.
  idempotencyKey: { type: String, default: undefined },
  // Set when the change was to a PROJECT's own balance (previousBalance / newBalance are then the project's); userId is the project's owner.
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: undefined, index: true },
  status: { type: String, enum: ['pending', 'completed'], default: 'completed' },
  meta: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: { createdAt: true, updatedAt: false } });

creditTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
creditTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
module.exports.TYPES = TYPES;
