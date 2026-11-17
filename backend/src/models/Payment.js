const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  plan: {
    type: String,
    required: true,
  },
  kind: { type: String, enum: ['plan', 'credits'], default: 'plan' },
  credits: { type: Number, default: 0 },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  status: {
    type: String,
    enum: ['created', 'paid', 'failed'],
    default: 'created',
  },
  razorpayOrderId: {
    type: String,
    required: true,
    index: true,
  },
  razorpayPaymentId: {
    type: String,
    sparse: true,
  },
  razorpaySignature: {
    type: String,
  },
  receipt: {
    type: String,
  },
  invoiceNumber: {
    type: String,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  paidAt: { type: Date, default: null },
  // Where the confirmation came from: the browser's verify call, Razorpay's webhook, or the background reconciler.
  source: { type: String, enum: ['checkout', 'webhook', 'reconcile'], default: undefined },
  // Delivery of what was bought. 'pending' -> 'applying' -> 'done'. Rows paid before this field existed have none and are never touched.
  fulfillment: { type: String, enum: ['pending', 'applying', 'done'], default: undefined },
  fulfillStartedAt: { type: Date, default: null },
  fulfilledAt: { type: Date, default: null },
  fulfillError: { type: String, default: '' },
});

// One Razorpay payment can belong to one order only, and the reconciler looks up stuck rows by state.
paymentSchema.index({ razorpayPaymentId: 1 }, { name: 'razorpayPaymentId_unique', unique: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string' } } });
paymentSchema.index({ status: 1, fulfillment: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
