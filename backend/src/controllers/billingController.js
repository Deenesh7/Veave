const crypto = require('crypto');
const Razorpay = require('razorpay');
const User = require('../models/User');
const AIUsage = require('../models/AIUsage');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');

const { PLAN_LIMITS, isUnlimitedPlan, isAdminOnlyPlan, imageEnhanceCredits, limitsFor, resolvePlanName, CREDIT_PRICE_INR, MIN_CREDIT_PURCHASE, MAX_CREDIT_PURCHASE, canBuyExtraCredits, TOKENS_PER_CREDIT } = require('../services/billing/plans');
const { getProjectUsage, hasUnlimitedCredits } = require('../services/billing/usageService');

const razorpay = require('../services/billing/razorpayClient');
const payments = require('../services/billing/paymentService');
const isRazorpayConfigured = razorpay.isConfigured;
const getRazorpayInstance = razorpay.client;
const receiptId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

/**
 * GET /api/billing
 * Returns user's complete billing overview
 */
exports.getOverview = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store'); // usage is live; never serve a cached snapshot
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }

    const planName = resolvePlanName(user.plan);
    const limits = limitsFor(planName);

    // --- Billing period ---
    const now = new Date();
    let periodEnd = user.subscription?.renewsAt ? new Date(user.subscription.renewsAt) : null;
    let periodStart;

    if (periodEnd && periodEnd > now) {
      periodStart = new Date(periodEnd);
      periodStart.setMonth(periodStart.getMonth() - 1);
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

    // --- Storage + projects: measured from the user's real stored projects ---
    const { projectCount, storageBytes } = await getProjectUsage(userId);
    const unlimited = await hasUnlimitedCredits(userId);

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
          bonus: user.subscription?.bonusCredits || 0,
          pricePerCredit: CREDIT_PRICE_INR,
          imageEnhanceCredits: imageEnhanceCredits(),
          minPurchase: MIN_CREDIT_PURCHASE,
          maxPurchase: MAX_CREDIT_PURCHASE,
          canBuy: canBuyExtraCredits(planName) && !unlimited,
          unlimited,
          postPaid: isUnlimitedPlan(planName),
          percentage: creditsAllocated > 0
            ? Math.round(((creditsAllocated - creditsRemaining) / creditsAllocated) * 100)
            : 0,
        },
        tokens: {
          used: tokenUsage.totalTokens,
          inputTokens: tokenUsage.totalInputTokens,
          outputTokens: tokenUsage.totalOutputTokens,
          limit: limits.monthlyTokens + (user.subscription?.bonusCredits || 0) * TOKENS_PER_CREDIT,
          requests: tokenUsage.totalRequests,
          percentage: limits.monthlyTokens > 0
            ? Math.min(100, Math.round((tokenUsage.totalTokens / (limits.monthlyTokens + (user.subscription?.bonusCredits || 0) * TOKENS_PER_CREDIT)) * 100))
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
        razorpayKeyId: isRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null,
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
    if (isAdminOnlyPlan(plan)) return res.status(403).json({ success: false, error: { message: `${plan} is set up by an administrator. Contact support to be moved to it.` } });
    // Paid plans can only be activated by a verified payment (create-order -> verify-payment).
    if (limits.price > 0) {
      return res.status(402).json({
        success: false,
        error: { message: `${plan} requires payment. Use the checkout to upgrade.` },
      });
    }
    const balanceBefore = await User.findById(userId).select('credits plan subscription').lean();
    if (!balanceBefore) return res.status(404).json({ success: false, error: { message: 'User not found' } });
    if (isAdminOnlyPlan(resolvePlanName(balanceBefore.plan))) return res.status(403).json({ success: false, error: { message: 'Your plan is managed by an administrator. Contact support to change it.' } });
    // Choosing the plan you are already on changes nothing. (It used to refill the credits every time, so anyone could top up for free.)
    if (resolvePlanName(balanceBefore.plan) === plan) {
      return res.status(200).json({ success: true, data: { user: await User.findById(userId), plan: { name: plan, price: limits.price, credits: limits.credits, monthlyTokens: limits.monthlyTokens, storageBytes: limits.storageBytes, maxProjects: limits.maxProjects }, message: `You are already on ${plan}.` } });
    }
    const renewsAt = new Date();
    renewsAt.setMonth(renewsAt.getMonth() + 1);
    // Moving down to a plan with a smaller allowance never hands out new credits: the balance is capped, not refilled.
    const kept = Math.min(Number(balanceBefore.subscription?.creditsRemaining ?? balanceBefore.credits ?? 0), limits.credits);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        plan: plan,
        credits: kept,
        'subscription.tier': plan,
        'subscription.status': 'active',
        'subscription.creditsAllocated': limits.credits,
        'subscription.creditsRemaining': kept,
        'subscription.bonusCredits': 0,
        'subscription.renewsAt': renewsAt,
      },
      { new: true }
    );
    if (updatedUser && balanceBefore) await require('../services/admin/creditLedgerService').recordApplied({ userId, previousBalance: require('../services/admin/creditLedgerService').balanceOf(balanceBefore), newBalance: require('../services/admin/creditLedgerService').balanceOf(updatedUser), type: 'CREDIT_ADJUSTMENT', reason: `Plan changed to ${plan}` });

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
    if (isAdminOnlyPlan(plan)) return res.status(403).json({ success: false, error: { message: `${plan} is set up by an administrator and cannot be bought.` } });
    if (limits.price <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Free tier does not require payment. Use change-plan instead.' },
      });
    }

    const amountInPaise = Math.round(limits.price * 100);
    const receipt = receiptId('rcpt');

    const rzp = getRazorpayInstance();
    if (!rzp) {
      return res.status(503).json({
        success: false,
        error: { message: 'Payments are not configured on this server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' },
      });
    }

    let orderId;
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
      console.error('Razorpay order creation failed:', err.error?.description || err.message);
      return res.status(502).json({
        success: false,
        error: { message: `Could not start the payment: ${err.error?.description || err.message}` },
      });
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
        keyId: process.env.RAZORPAY_KEY_ID,
        plan,
        planName: plan,
        user: {
          name: user.name,
          email: user.email,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/verify-payment
 * Verifies the checkout signature, then delivers the plan. Always safe to repeat: a second call returns the same success.
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body || {};
    const userId = req.user._id;
    if (typeof razorpay_order_id !== 'string' || typeof razorpay_payment_id !== 'string' || typeof razorpay_signature !== 'string' || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: { message: 'Missing payment details for verification' } });
    }
    if (!isRazorpayConfigured()) return res.status(503).json({ success: false, error: { message: 'Payments are not configured on this server.' } });

    // The order must be one this user created. What was bought and for how much comes from that order, never from the browser.
    const pending = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId, kind: { $ne: 'credits' } });
    if (!pending || (plan && pending.plan !== plan) || !PLAN_LIMITS[pending.plan]) {
      return res.status(400).json({ success: false, error: { message: 'Unknown order for this account and plan.' } });
    }
    if (pending.status !== 'paid' && !payments.checkoutSignatureValid(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      // Not marked as failed: a real payment may still be on its way, and the webhook can complete it.
      return res.status(400).json({ success: false, error: { message: 'Invalid payment signature. Verification failed.' } });
    }
    if (pending.status !== 'paid') {
      const gateway = await payments.confirmWithGateway(pending, razorpay_payment_id);
      if (!gateway.ok) return res.status(400).json({ success: false, error: { message: gateway.message } });
    }
    const done = await payments.settle(pending, { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, source: 'checkout' });
    res.status(200).json({
      success: true,
      data: {
        user: await User.findById(userId),
        payment: { invoiceNumber: done.invoiceNumber, amount: done.amount, currency: done.currency || 'INR', plan: done.plan, status: 'paid', paymentId: done.razorpayPaymentId, paidAt: done.paidAt || done.createdAt },
        message: `Payment successful! You are now subscribed to ${done.plan}.`,
      },
    });
  } catch (error) {
    next(error);
  }
};

const parseCreditQty = (value) => {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < MIN_CREDIT_PURCHASE || qty > MAX_CREDIT_PURCHASE) return null;
  return qty;
};

/**
 * POST /api/billing/credits/create-order
 * Creates a Razorpay order for extra credits at CREDIT_PRICE_INR each (paid plans only).
 */
exports.createCreditOrder = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: { message: 'User not found' } });

    if (!canBuyExtraCredits(user.plan)) {
      return res.status(403).json({ success: false, error: { message: 'Extra credits are available on Plus and Pro plans. Upgrade to buy more credits.' } });
    }
    const qty = parseCreditQty(req.body.credits);
    if (!qty) {
      return res.status(400).json({ success: false, error: { message: `Enter a whole number of credits between ${MIN_CREDIT_PURCHASE} and ${MAX_CREDIT_PURCHASE}.` } });
    }

    const rzp = getRazorpayInstance();
    if (!rzp) {
      return res.status(503).json({ success: false, error: { message: 'Payments are not configured on this server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' } });
    }

    const amount = qty * CREDIT_PRICE_INR;
    const receipt = receiptId('cred');
    let orderId;
    try {
      const order = await rzp.orders.create({
        amount: amount * 100,
        currency: 'INR',
        receipt,
        notes: { userId: userId.toString(), userEmail: user.email, kind: 'credits', credits: String(qty) },
      });
      orderId = order.id;
    } catch (err) {
      console.error('Razorpay credit order failed:', err.error?.description || err.message);
      return res.status(502).json({ success: false, error: { message: `Could not start the payment: ${err.error?.description || err.message}` } });
    }

    await Payment.create({ userId, plan: 'Extra Credits', kind: 'credits', credits: qty, amount, currency: 'INR', status: 'created', razorpayOrderId: orderId, receipt });

    res.status(200).json({
      success: true,
      data: { orderId, amount: amount * 100, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, credits: qty, user: { name: user.name, email: user.email } },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/credits/verify-payment
 * Verifies the signature and adds the purchased credits (exactly once per order; repeating the call returns the same success).
 */
exports.verifyCreditPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const userId = req.user._id;
    if (typeof razorpay_order_id !== 'string' || typeof razorpay_payment_id !== 'string' || typeof razorpay_signature !== 'string' || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, error: { message: 'Missing payment details for verification' } });
    }
    if (!isRazorpayConfigured()) return res.status(503).json({ success: false, error: { message: 'Payments are not configured on this server.' } });

    const pending = await Payment.findOne({ razorpayOrderId: razorpay_order_id, userId, kind: 'credits' });
    if (!pending || pending.amount !== pending.credits * CREDIT_PRICE_INR) {
      return res.status(400).json({ success: false, error: { message: 'Unknown credit order for this account.' } });
    }
    if (pending.status !== 'paid' && !payments.checkoutSignatureValid(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid payment signature. Verification failed.' } });
    }
    if (pending.status !== 'paid') {
      const gateway = await payments.confirmWithGateway(pending, razorpay_payment_id);
      if (!gateway.ok) return res.status(400).json({ success: false, error: { message: gateway.message } });
    }
    const done = await payments.settle(pending, { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, source: 'checkout' });
    res.status(200).json({
      success: true,
      data: {
        user: await User.findById(userId),
        payment: { invoiceNumber: done.invoiceNumber, amount: done.amount, currency: done.currency || 'INR', plan: 'Extra Credits', credits: done.credits, status: 'paid', paymentId: done.razorpayPaymentId, paidAt: done.paidAt || done.createdAt },
        message: `${done.credits} credits added to your account.`,
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
      date: p.paidAt || p.createdAt,
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

/**
 * POST /api/billing/webhook  (called by Razorpay, not by the browser; no login, authenticated by its signature instead)
 * This is what delivers a purchase when the customer paid but closed the tab, lost the connection or never came back.
 * Answers 200 for everything it understood or can ignore, and 500 only when delivery failed so Razorpay retries it.
 */
exports.webhook = async (req, res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      logger.error('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set; it was rejected.');
      return res.status(503).json({ success: false });
    }
    if (!payments.webhookSignatureValid(req.body, req.get('x-razorpay-signature'))) return res.status(400).json({ success: false });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ success: false }); }
    const entity = event?.payload?.payment?.entity;
    const orderId = entity?.order_id || event?.payload?.order?.entity?.id;
    if (!orderId) return res.status(200).json({ success: true, ignored: true });
    const payment = await Payment.findOne({ razorpayOrderId: String(orderId) });
    if (!payment) return res.status(200).json({ success: true, ignored: true }); // not an order this server created

    if (event.event === 'payment.failed') {
      if (payment.status === 'created') await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'failed' } });
      return res.status(200).json({ success: true });
    }
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const matches = entity && Number(entity.amount) === Math.round(Number(payment.amount) * 100) && String(entity.currency || 'INR') === payment.currency;
      if (!matches) {
        logger.error(`Webhook for order ${orderId} reported a different amount/currency than the order; not delivered.`);
        return res.status(200).json({ success: true, ignored: true });
      }
      await payments.settle(payment, { razorpayPaymentId: String(entity.id), source: 'webhook' });
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Razorpay webhook failed: ${error.message}`);
    return res.status(500).json({ success: false });
  }
};
