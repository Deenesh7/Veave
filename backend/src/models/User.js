const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const subscriptionSchema = new mongoose.Schema({
  tier: { type: String, default: 'Free Tier' },
  status: { type: String, enum: ['active', 'inactive', 'trialing', 'canceled'], default: 'active' },
  billingCycle: { type: String, enum: ['monthly', 'yearly', 'lifetime'], default: 'monthly' },
  creditsAllocated: { type: Number, default: 50 },
  creditsRemaining: { type: Number, default: 50 },
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
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
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

module.exports = mongoose.model('User', userSchema);
