const mongoose = require('mongoose');

// A customer's purchase of a domain through Veave: they pay Veave (Razorpay), then Veave registers it on GoDaddy.
const domainOrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  kind: { type: String, enum: ['registration', 'renewal'], default: 'registration', index: true },
  domain: { type: String, required: true, lowercase: true, index: true },
  renewalId: String,
  newExpiresAt: Date,
  period: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ['awaiting_payment', 'paid', 'registering', 'registered', 'failed_refunded', 'failed_refund_needed', 'expired'],
    default: 'awaiting_payment'
  },
  goDaddyPrice: Number,
  goDaddyCurrency: String,
  chargedAmount: Number,          // what the customer pays, in `chargedCurrency`
  chargedCurrency: { type: String, default: 'INR' },
  quoteToken: String,
  agreements: [{ title: String, url: String, type: String }],
  agreedAt: Date,
  razorpayOrderId: { type: String, unique: true, sparse: true },
  razorpayPaymentId: String,
  refundId: String,
  goDaddyOperationId: String,
  error: String
}, { timestamps: true });

module.exports = mongoose.model('DomainOrder', domainOrderSchema);
