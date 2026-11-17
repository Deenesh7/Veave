/**
 * Everything that turns a Razorpay payment into plan time or credits, built so that money is never lost and never counted twice:
 *
 *  - three independent paths lead here (the browser's verify call, Razorpay's webhook, and a background reconciler), so a closed tab or a
 *    dropped connection after paying still ends with the purchase delivered;
 *  - a payment is first marked PAID (one atomic flip), then DELIVERED. Delivery is a single atomic update of the user document that is
 *    guarded by the payment's id, so repeating it (retry, crash, two paths at once) can never grant twice;
 *  - the amount and the plan always come from the order the server created, never from the browser.
 */
const crypto = require('node:crypto');
const Payment = require('../../models/Payment');
const User = require('../../models/User');
const { PLAN_LIMITS } = require('./plans');
const razorpay = require('./razorpayClient');
const logger = require('../../utils/logger');

const STALE_APPLYING_MS = 2 * 60 * 1000;

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The signature the checkout hands to the browser: HMAC of "order|payment" with the key secret. */
function checkoutSignatureValid(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(signature, expected);
}

/** The webhook signature: HMAC of the exact raw request body with the webhook secret. */
function webhookSignatureValid(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  return safeEqual(signature, crypto.createHmac('sha256', secret).update(rawBody).digest('hex'));
}

const paise = (payment) => Math.round(Number(payment.amount) * 100);

/**
 * Asks Razorpay about the payment itself. Rejects a payment that belongs to another order, has another amount or has failed;
 * captures one that was only authorised. A gateway outage is NOT a rejection: the signature already proves the payment, so it passes.
 */
async function confirmWithGateway(payment, razorpayPaymentId) {
  const rzp = razorpay.client();
  if (!rzp) return { ok: true };
  let entity;
  try { entity = await rzp.payments.fetch(razorpayPaymentId); } catch (error) {
    logger.warn(`Razorpay payment ${razorpayPaymentId} could not be fetched (${error?.error?.description || error.message}); relying on the signature.`);
    return { ok: true };
  }
  if (entity.order_id !== payment.razorpayOrderId) return { ok: false, message: 'This payment belongs to a different order.' };
  if (Number(entity.amount) !== paise(payment) || String(entity.currency || 'INR') !== payment.currency) return { ok: false, message: 'The paid amount does not match the order.' };
  if (entity.status === 'failed') return { ok: false, message: 'The payment failed. You were not charged.' };
  if (entity.status === 'authorized') {
    try { await rzp.payments.capture(razorpayPaymentId, paise(payment), payment.currency); } catch (error) {
      logger.warn(`Razorpay payment ${razorpayPaymentId} could not be captured now: ${error?.error?.description || error.message}`);
    }
  }
  return { ok: true };
}

/** Marks the order paid. Atomic: exactly one caller flips it; everyone else gets the already-paid document back. */
async function markPaid(payment, { razorpayPaymentId, razorpaySignature = null, source }) {
  const invoiceNumber = payment.invoiceNumber || `INV-${new Date().getFullYear()}-${payment._id.toString().slice(-6).toUpperCase()}`;
  const flipped = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: 'paid' } },
    { $set: { status: 'paid', razorpayPaymentId, ...(razorpaySignature ? { razorpaySignature } : {}), invoiceNumber, paidAt: new Date(), source, fulfillment: 'pending' } },
    { new: true }
  );
  return flipped || Payment.findById(payment._id);
}

/** Applies the purchase to the user's account in ONE guarded update. Safe to run any number of times. */
async function applyToUser(payment) {
  const key = String(payment._id);
  const guard = { _id: payment.userId, appliedPayments: { $ne: key } };
  let before;
  if (payment.kind === 'credits') {
    before = await User.findOneAndUpdate(guard, {
      $inc: { credits: payment.credits, 'subscription.creditsRemaining': payment.credits, 'subscription.creditsAllocated': payment.credits, 'subscription.bonusCredits': payment.credits },
      $push: { appliedPayments: key }
    }, { new: false }).select('credits subscription').lean();
  } else {
    const limits = PLAN_LIMITS[payment.plan];
    if (!limits) throw new Error(`Payment ${key} is for an unknown plan "${payment.plan}".`);
    const renewsAt = new Date();
    renewsAt.setMonth(renewsAt.getMonth() + 1);
    before = await User.findOneAndUpdate(guard, {
      $set: { plan: payment.plan, credits: limits.credits, 'subscription.tier': payment.plan, 'subscription.status': 'active', 'subscription.creditsAllocated': limits.credits, 'subscription.creditsRemaining': limits.credits, 'subscription.bonusCredits': 0, 'subscription.renewsAt': renewsAt },
      $push: { appliedPayments: key }
    }, { new: false }).select('credits subscription').lean();
  }
  if (!before) return { applied: false }; // already delivered earlier (or the account is gone)
  try {
    const ledger = require('../admin/creditLedgerService');
    const previous = ledger.balanceOf(before);
    const next = payment.kind === 'credits' ? previous + payment.credits : PLAN_LIMITS[payment.plan].credits;
    await ledger.recordApplied({
      userId: payment.userId, previousBalance: previous, newBalance: next,
      type: payment.kind === 'credits' ? 'CREDIT_ALLOCATION' : 'CREDIT_ADJUSTMENT',
      reason: payment.kind === 'credits' ? 'Credits purchased' : `Plan changed to ${payment.plan}`,
      idempotencyKey: `payment:${key}`, meta: { paymentId: key }
    });
  } catch (error) { logger.warn(`Ledger row for payment ${key} was not written: ${error.message}`); }
  return { applied: true };
}

/** Delivers a paid order. Whoever claims it does the work; the others see it done. Failures are left for the reconciler to retry. */
async function fulfill(paymentId) {
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, status: 'paid', $or: [{ fulfillment: 'pending' }, { fulfillment: 'applying', fulfillStartedAt: { $lt: new Date(Date.now() - STALE_APPLYING_MS) } }] },
    { $set: { fulfillment: 'applying', fulfillStartedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return Payment.findById(paymentId);
  try {
    await applyToUser(claimed);
    return await Payment.findByIdAndUpdate(paymentId, { $set: { fulfillment: 'done', fulfilledAt: new Date(), fulfillError: '' } }, { new: true });
  } catch (error) {
    logger.error(`Payment ${paymentId} was paid but could not be delivered yet (${error.message}); it will be retried.`);
    await Payment.updateOne({ _id: paymentId }, { $set: { fulfillment: 'pending', fulfillError: String(error.message).slice(0, 300) } }).catch(() => {});
    throw error;
  }
}

/** Mark paid + deliver, in one call. */
async function settle(payment, details) {
  const paid = await markPaid(payment, details);
  return fulfill(paid._id);
}

/** Recovery: deliver anything paid but not delivered, and pick up payments whose browser and webhook never reported back. */
async function reconcile() {
  let recovered = 0;
  const stuck = await Payment.find({ status: 'paid', $or: [{ fulfillment: 'pending' }, { fulfillment: 'applying', fulfillStartedAt: { $lt: new Date(Date.now() - STALE_APPLYING_MS) } }] }).limit(100).lean();
  for (const row of stuck) {
    try { await fulfill(row._id); recovered += 1; } catch { /* logged in fulfill; tried again next round */ }
  }
  const rzp = razorpay.client();
  if (rzp) {
    const open = await Payment.find({ status: { $in: ['created', 'failed'] }, createdAt: { $gt: new Date(Date.now() - 3 * 24 * 3600 * 1000), $lt: new Date(Date.now() - 3 * 60 * 1000) } }).sort({ createdAt: -1 }).limit(50).lean();
    for (const row of open) {
      try {
        const list = await rzp.orders.fetchPayments(row.razorpayOrderId);
        const captured = (list.items || []).find((item) => item.status === 'captured' && Number(item.amount) === paise(row) && item.currency === row.currency);
        if (!captured) continue;
        await settle(row, { razorpayPaymentId: captured.id, source: 'reconcile' });
        recovered += 1;
        logger.warn(`Recovered payment ${captured.id} for order ${row.razorpayOrderId}: it was paid but never reported back.`);
      } catch (error) { logger.warn(`Reconcile of order ${row.razorpayOrderId} skipped: ${error?.error?.description || error.message}`); }
    }
  }
  return recovered;
}

let timer = null;
function startReconciler({ everyMs = 5 * 60 * 1000 } = {}) {
  if (timer || process.env.NODE_ENV === 'test') return;
  setTimeout(() => reconcile().catch((error) => logger.warn(`Payment reconcile failed: ${error.message}`)), 20_000).unref();
  timer = setInterval(() => reconcile().catch((error) => logger.warn(`Payment reconcile failed: ${error.message}`)), everyMs);
  timer.unref();
}

module.exports = { checkoutSignatureValid, webhookSignatureValid, confirmWithGateway, markPaid, fulfill, settle, reconcile, startReconciler, applyToUser };
