const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const subscriptionSchema = new mongoose.Schema({
  tier: { type: String, default: 'Free Tier' },
  status: { type: String, enum: ['active', 'inactive', 'trialing', 'canceled'], default: 'active' },
  billingCycle: { type: String, enum: ['monthly', 'yearly', 'lifetime'], default: 'monthly' },
  creditsAllocated: { type: Number, default: 50 },
  creditsRemaining: { type: Number, default: 50 },
  // Credits bought on top of the plan allowance; they also lift the monthly token cap (20,000 tokens each).
  bonusCredits: { type: Number, default: 0, min: 0 },
  renewsAt: { type: Date }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, minlength: 8 },
  googleId: { type: String, sparse: true },
  appleId: { type: String, sparse: true },
  avatar: { type: String, default: '' },
  plan: { type: String, default: 'Free Tier' },
  credits: { type: Number, default: 50, min: 0 },
  // Test/internal accounts: generation is never blocked or charged for credits or monthly tokens.
  creditsExempt: { type: Boolean, default: false },
  subscription: { type: subscriptionSchema, default: () => ({}) },
  // Ids of the payments already delivered to this account: makes delivery idempotent (see services/billing/paymentService).
  appliedPayments: { type: [String], default: undefined, select: false },
  // Account role: ADMIN can use the admin dashboard (/api/admin). Everyone else is USER.
  role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER', index: true },
  // The one root administrator. Only the root can create or remove other administrators, and nobody can demote, suspend or delete the root
  // through the API. It is set only by services/admin/rootAdminService (server start) or the command-line scripts, never from a request.
  isRootAdmin: { type: Boolean, default: false },
  // Kind of administrator (only meaningful when role is ADMIN): 'admin' = every area except what is root-only; 'support' = users and credits only.
  adminRole: { type: String, enum: ['admin', 'support'], default: 'admin' },
  // A suspended account cannot sign in or use the API until an admin restores it.
  status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
  suspendedAt: { type: Date, default: null },
  suspensionReason: { type: String, default: '' },
  lastActiveAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  // The same moment as createdAt, written in Indian time for anyone reading the database directly (createdAt itself stays UTC).
  createdAtIST: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('validate', function setIndianCreationTime() {
  if (this.isNew && !this.createdAtIST) this.createdAtIST = require('../utils/istTime').toIST(this.createdAt || new Date());
});

userSchema.pre('save', async function(next) {
  this.updatedAt = Date.now();
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.set('toJSON', {
  transform: function(doc, ret) {
    delete ret.password;
    return ret;
  }
});

// At most one root administrator can exist: the database itself refuses a second one.
userSchema.index({ isRootAdmin: 1 }, { unique: true, partialFilterExpression: { isRootAdmin: true } });

module.exports = mongoose.model('User', userSchema);
