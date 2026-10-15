const crypto = require('crypto');
const Razorpay = require('razorpay');
const User = require('../models/User');
const AIUsage = require('../models/AIUsage');
const Project = require('../models/Project');
const ProjectFile = require('../models/ProjectFile');
const Payment = require('../models/Payment');

// Plan configuration with limits
const PLAN_LIMITS = {
  'Free Tier': {
    price: 0,
    credits: 50,
    monthlyTokens: 1_000_000,
    storageBytes: 5 * 1024 * 1024 * 1024,   // 5 GB
    maxProjects: 5,
  },
  'Plus Plan': {
    price: 2999,
    credits: 250,
    monthlyTokens: 5_000_000,
    storageBytes: 50 * 1024 * 1024 * 1024,  // 50 GB
    maxProjects: 15,
  },
  'Pro Plan': {
    price: 5999,
    credits: 750,
    monthlyTokens: 15_000_000,
    storageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    maxProjects: 100,
  },
};

// Initialize Razorpay instance
let razorpayInstance = null;
const isRazorpayConfigured = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return (
    keyId &&
    keySecret &&
    keyId !== 'rzp_test_YourKeyIdHere' &&
    keySecret !== 'YourSecretHere'
  );
};

const getRazorpayInstance = () => {
  if (!razorpayInstance && isRazorpayConfigured()) {
    razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayInstance;
};

/**
 * GET /api/billing
 * Returns user's complete billing overview
 */
exports.getOverview = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    const planName = user.plan || 'Free Tier';
    const limits = PLAN_LIMITS[planName] || PLAN_LIMITS['Free Tier'];

    // --- Billing period ---
    const now = new Date();
    let periodEnd = user.subscription?.renewsAt ? new Date(user.subscription.renewsAt) : null;
    let periodStart;

    if (periodEnd && periodEnd > now) {
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - 30);
    } else {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // --- Credits ---
    const creditsAllocated = user.subscription?.creditsAllocated ?? limits.credits;
    const creditsRemaining = user.subscription?.creditsRemaining ?? user.credits ?? limits.credits;

    // --- Token usage in current billing period ---
    const tokenAgg = await AIUsage.aggregate([
      {
        $match: {
          userId: userId,
          createdAt: { $gte: periodStart, $lte: periodEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalInputTokens: { $sum: '$inputTokens' },
          totalOutputTokens: { $sum: '$outputTokens' },
          totalRequests: { $sum: 1 },
        },
      },
    ]);

    const tokenUsage = tokenAgg.length > 0
      ? tokenAgg[0]
      : { totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalRequests: 0 };

    // --- Storage usage ---
    const userProjects = await Project.find({ userId }, '_id');
    const projectIds = userProjects.map((p) => p._id);

    let storageBytes = 0;
    if (projectIds.length > 0) {
      const storageAgg = await ProjectFile.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        {
          $project: {
            size: {
              $cond: {
                if: { $isArray: '$content' },
                then: { $sum: { $map: { input: '$content', as: 'c', in: { $strLenBytes: { $ifNull: ['$$c', ''] } } } } },
                else: { $strLenBytes: { $ifNull: ['$content', ''] } },
              },
            },
          },
        },
        { $group: { _id: null, totalBytes: { $sum: '$size' } } },
      ]);
      storageBytes = storageAgg.length > 0 ? storageAgg[0].totalBytes : 0;
    }

    const projectCount = projectIds.length;

    res.status(200).json({
      success: true,
      data: {
        plan: {
          name: planName,
          price: limits.price,
          billingCycle: user.subscription?.billingCycle || 'monthly',
          status: user.subscription?.status || 'active',
        },
        credits: {
          allocated: creditsAllocated,
          remaining: creditsRemaining,
          used: creditsAllocated - creditsRemaining,
          percentage: creditsAllocated > 0
            ? Math.round(((creditsAllocated - creditsRemaining) / creditsAllocated) * 100)
            : 0,
        },
        tokens: {
          used: tokenUsage.totalTokens,
          inputTokens: tokenUsage.totalInputTokens,
          outputTokens: tokenUsage.totalOutputTokens,
          limit: limits.monthlyTokens,
          requests: tokenUsage.totalRequests,
          percentage: limits.monthlyTokens > 0
            ? Math.min(100, Math.round((tokenUsage.totalTokens / limits.monthlyTokens) * 100))
            : 0,
        },
        storage: {
          usedBytes: storageBytes,
          limitBytes: limits.storageBytes,
          percentage: limits.storageBytes > 0
            ? Math.min(100, Math.round((storageBytes / limits.storageBytes) * 100))
            : 0,
        },
        projects: {
          count: projectCount,
          limit: limits.maxProjects,
          percentage: limits.maxProjects > 0
            ? Math.min(100, Math.round((projectCount / limits.maxProjects) * 100))
            : 0,
        },
        billingPeriod: {
          start: periodStart,
          end: periodEnd,
        },
        renewsAt: user.subscription?.renewsAt || null,
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyIdHere',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/change-plan
 * Direct plan switch (mainly for Free Tier or admin downgrades)
 */
exports.changePlan = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const userId = req.user._id;

    if (!plan || !PLAN_LIMITS[plan]) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid plan. Choose one of: ${Object.keys(PLAN_LIMITS).join(', ')}` },
      });
    }

    const limits = PLAN_LIMITS[plan];
    const renewsAt = new Date();
    renewsAt.setDate(renewsAt.getDate() + 30);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        plan: plan,
        credits: limits.credits,
        'subscription.tier': plan,
        'subscription.status': 'active',
        'subscription.creditsAllocated': limits.credits,
        'subscription.creditsRemaining': limits.credits,
        'subscription.renewsAt': renewsAt,
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    res.status(200).json({
      success: true,
      data: {
        user: updatedUser,
        plan: {
          name: plan,
          price: limits.price,
          credits: limits.credits,
          monthlyTokens: limits.monthlyTokens,
          storageBytes: limits.storageBytes,
          maxProjects: limits.maxProjects,
        },
        message: `Successfully switched to ${plan}`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/create-order
 * Creates a Razorpay Order for a paid plan
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    if (!plan || !PLAN_LIMITS[plan]) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid plan. Choose one of: ${Object.keys(PLAN_LIMITS).join(', ')}` },
      });
    }

    const limits = PLAN_LIMITS[plan];
    if (limits.price <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Free tier does not require payment. Use change-plan instead.' },
      });
    }

    const amountInPaise = Math.round(limits.price * 100);
    const receipt = `rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    let orderId;
    let isTestMode = false;
    const rzp = getRazorpayInstance();

    if (rzp) {
      try {
        const order = await rzp.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt,
          notes: {
            userId: userId.toString(),
            userEmail: user.email,
            plan,
          },
        });
        orderId = order.id;
      } catch (err) {
        console.warn('Razorpay live order creation failed, falling back to simulated order:', err.message);
        orderId = `order_sim_${Date.now()}`;
        isTestMode = true;
      }
    } else {
      orderId = `order_sim_${Date.now()}`;
      isTestMode = true;
    }

    // Save pending payment record
    await Payment.create({
      userId,
      plan,
      amount: limits.price,
      currency: 'INR',
      status: 'created',
      razorpayOrderId: orderId,
      receipt,
    });

    res.status(200).json({
      success: true,
      data: {
        orderId,
        amount: amountInPaise,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_YourKeyIdHere',
        plan,
        planName: plan,
        user: {
          name: user.name,
          email: user.email,
        },
        isTestMode,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/verify-payment
 * Verifies Razorpay signature and activates subscription
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
    const userId = req.user._id;

    if (!razorpay_order_id || !plan || !PLAN_LIMITS[plan]) {
      return res.status(400).json({
        success: false,
        error: { message: 'Missing order_id or invalid plan' },
      });
    }

    const limits = PLAN_LIMITS[plan];
    const isSimulated = razorpay_order_id.startsWith('order_sim_');

    // Signature verification for live Razorpay payments
    if (!isSimulated && isRazorpayConfigured()) {
      if (!razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
          success: false,
          error: { message: 'Missing payment_id or signature for live verification' },
        });
      }

      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid payment signature. Verification failed.' },
        });
      }
    }

    // Generate unique invoice number
    const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    const paymentId = razorpay_payment_id || `pay_sim_${Date.now()}`;

    // Update payment record in database
    const payment = await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      {
        status: 'paid',
        razorpayPaymentId: paymentId,
        razorpaySignature: razorpay_signature || 'simulated_signature',
        invoiceNumber,
      },
      { new: true, upsert: true }
    );

    // Activate the subscription on the user document
    const renewsAt = new Date();
    renewsAt.setDate(renewsAt.getDate() + 30);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        plan: plan,
        credits: limits.credits,
        'subscription.tier': plan,
        'subscription.status': 'active',
        'subscription.creditsAllocated': limits.credits,
        'subscription.creditsRemaining': limits.credits,
        'subscription.renewsAt': renewsAt,
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: {
        user: updatedUser,
        payment: {
          invoiceNumber: payment.invoiceNumber,
          amount: limits.price,
          currency: 'INR',
          plan,
          status: 'paid',
          paymentId,
          paidAt: new Date(),
        },
        message: `Payment successful! You are now subscribed to ${plan}.`,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/billing/invoices
 * Returns user payment & invoice history
 */
exports.getInvoices = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const payments = await Payment.find({ userId, status: 'paid' })
      .sort({ createdAt: -1 })
      .limit(50);

    const invoices = payments.map((p) => ({
      id: p._id,
      invoiceNumber: p.invoiceNumber || `INV-${new Date(p.createdAt).getFullYear()}-${p._id.toString().slice(-6).toUpperCase()}`,
      date: p.createdAt,
      plan: p.plan,
      amount: p.amount,
      currency: p.currency || 'INR',
      status: p.status,
      paymentId: p.razorpayPaymentId,
      receipt: p.receipt,
    }));

    res.status(200).json({
      success: true,
      data: invoices,
    });
  } catch (error) {
    next(error);
  }
};
