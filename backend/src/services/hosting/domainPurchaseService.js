const crypto = require('node:crypto');
const Razorpay = require('razorpay');
const Project = require('../../models/Project');
const PublishedSite = require('../../models/PublishedSite');
const DomainOrder = require('../../models/DomainOrder');
const User = require('../../models/User');
const { AppError, NotFoundError, ValidationError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const godaddy = require('./godaddyService');
const domains = require('./domainService');

const toInr = (usd) => {
  const rate = Number.parseFloat(process.env.USD_INR_RATE) || 90;
  const markup = Number.parseFloat(process.env.DOMAIN_MARKUP_PERCENT);
  return Math.ceil(usd * rate * (1 + (Number.isFinite(markup) ? markup : 15) / 100));
};

const razorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw new AppError('Payments are not configured on this server.', 503);
  return new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
};

async function assertOwnsProject(projectId, userId) {
  const project = await Project.findOne({ _id: projectId, userId }).select('_id').lean();
  if (!project) throw new NotFoundError('Project');
}

/** Availability + 1-year price (what the customer will pay) for the Domain tab. */
async function search(domainInput) {
  const found = await godaddy.checkAvailability(domainInput);
  const term = (found.terms || []).find((t) => Number(t.period) === 1) || found.terms?.[0];
  const usd = term ? Number.parseFloat(term.price) : null;
  const result = {
    domain: found.domain,
    available: found.available,
    price: usd == null ? null : { period: 1, usd, renewalUsd: term.renewalPrice ? Number.parseFloat(term.renewalPrice) : null, inr: toInr(usd) },
    suggestions: []
  };
  if (!found.available) {
    const base = found.domain.split('.')[0];
    result.suggestions = await godaddy.suggestDomains(base, 5).catch(() => []);
  }
  return result;
}

/** Locks the GoDaddy price, creates the Razorpay order for exactly that price. */
async function createOrder({ projectId, userId, domain: domainInput, contact }) {
  await assertOwnsProject(projectId, userId);
  const quote = await godaddy.withContact(contact, () => godaddy.quoteDomain(domainInput, { period: 1 }));
  if (quote.currency !== 'USD') throw new AppError(`Unsupported GoDaddy currency ${quote.currency}.`, 502);
  const amountInr = toInr(quote.price);
  const user = await User.findById(userId).select('name email').lean();

  const order = await razorpay().orders.create({
    amount: amountInr * 100, currency: 'INR', receipt: `dom_${Date.now()}`,
    notes: { userId: String(userId), projectId: String(projectId), domain: quote.domain }
  });
  const record = await DomainOrder.create({
    userId, projectId, domain: quote.domain, period: 1, goDaddyPrice: quote.price, goDaddyCurrency: quote.currency,
    chargedAmount: amountInr, chargedCurrency: 'INR', quoteToken: quote.quoteToken, agreements: quote.agreements,
    razorpayOrderId: order.id
  });
  return {
    orderId: order.id, amount: amountInr * 100, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID,
    domain: quote.domain, agreements: quote.agreements, expiresAt: quote.expiresAt, priceUsd: quote.price,
    user: { name: user?.name || '', email: user?.email || '' }, id: String(record._id)
  };
}

async function refund(order, reason) {
  try {
    const r = await razorpay().payments.refund(order.razorpayPaymentId, { speed: 'normal', notes: { reason: String(reason).slice(0, 200) } });
    order.refundId = r.id; order.status = 'failed_refunded';
  } catch (error) {
    logger.error(`DOMAIN REFUND NEEDED for order ${order._id}: ${error.error?.description || error.message}`);
    order.status = 'failed_refund_needed';
  }
}

function verifySignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex');
  const given = Buffer.from(String(signature || ''));
  const want = Buffer.from(expected);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// The domain now lives in Veave's GoDaddy account: attach it to the project and point its DNS automatically.
async function attachToProject(order) {
  try {
    if (await PublishedSite.exists({ projectId: order.projectId, userId: order.userId })) {
      await domains.connectDomain(order.projectId, order.userId, order.domain);
      await domains.configureWithGoDaddy(order.projectId, order.userId).catch((e) => logger.warn(`Auto DNS for ${order.domain}: ${e.message}`));
    }
  } catch (error) {
    logger.warn(`Could not attach ${order.domain} to project ${order.projectId}: ${error.message}`);
  }
}

/** Registers a PAID order on GoDaddy (this charges Veave's GoDaddy account). Safe to call twice: it claims the order first. */
async function registerPaidOrder(orderId, paymentId) {
  const claimed = await DomainOrder.findOneAndUpdate(
    { _id: orderId, status: 'awaiting_payment' },
    { status: 'registering', razorpayPaymentId: paymentId, agreedAt: new Date() },
    { new: true }
  );
  if (!claimed) return DomainOrder.findById(orderId);
  if (claimed.kind === 'renewal') return executeRenewal(claimed);
  try {
    let result;
    try {
      result = await godaddy.purchaseDomain(claimed.quoteToken);
    } catch {
      // The quote lasts ~10 minutes; a slow payment needs a fresh one, but never at a higher price than was charged.
      const fresh = await godaddy.quoteDomain(claimed.domain, { period: 1 });
      if (toInr(fresh.price) > claimed.chargedAmount) throw new AppError('The registry price changed while you were paying.', 409);
      result = await godaddy.purchaseDomain(fresh.quoteToken);
    }
    if (result.status === 'FAILED') throw new AppError('The registry could not register the domain.', 502);
    claimed.goDaddyOperationId = result.operationId;
    if (result.status === 'COMPLETED') { claimed.status = 'registered'; await claimed.save(); await attachToProject(claimed); }
    else await claimed.save(); // still 'registering': refreshOrder() finishes it
  } catch (error) {
    claimed.error = String(error.message).slice(0, 500);
    await refund(claimed, claimed.error);
    await claimed.save();
  }
  return claimed;
}

// ---- Renewals: customer pays Veave (Razorpay), then Veave renews through GoDaddy's renewal API ----------------------
async function executeRenewal(claimed) {
  try {
    const r = await godaddy.renewDomain({ domain: claimed.domain, quoteToken: claimed.quoteToken, period: claimed.period, idempotencyKey: `veave-${claimed._id}` });
    claimed.renewalId = r.renewalId;
    for (let i = 0; i < 12 && r.renewalId; i += 1) {
      const current = await godaddy.getRenewal(r.renewalId);
      if (current.status === 'COMPLETED') { claimed.status = 'registered'; claimed.newExpiresAt = current.newExpiresAt || null; break; }
      if (current.status === 'FAILED') throw new AppError('GoDaddy could not renew the domain.', 502);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    await claimed.save(); // still 'registering' if GoDaddy has not finished: getOrder() completes it
  } catch (error) {
    claimed.error = String(error.message).slice(0, 500);
    await refund(claimed, claimed.error);
    await claimed.save();
  }
  return claimed;
}

async function assertOwnsDomain(userId, domainInput) {
  const domain = godaddy.normalizeDomain(domainInput);
  const owned = domain && await DomainOrder.exists({ userId, domain, kind: 'registration', status: 'registered' });
  if (!owned) throw new NotFoundError('Domain');
  return domain;
}

/** The customer's purchased domains with expiry and renewal state. */
async function listMyDomains(userId) {
  const orders = await DomainOrder.find({ userId, kind: 'registration', status: 'registered' }).sort({ createdAt: -1 }).lean();
  const out = [];
  for (const order of orders) {
    const renewal = await DomainOrder.findOne({ userId, domain: order.domain, kind: 'renewal', status: 'registered', newExpiresAt: { $ne: null } }).sort({ newExpiresAt: -1 }).lean();
    const details = await godaddy.getDomainDetails(order.domain).catch(() => null);
    const expiresAt = details?.expiresAt || renewal?.newExpiresAt || null;
    const days = expiresAt ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) : null;
    out.push({ domain: order.domain, projectId: String(order.projectId), expiresAt, daysLeft: days, expiringSoon: days != null && days <= 60, status: details?.status || 'ACTIVE' });
  }
  return out;
}

/** Price of renewing for 1 year, in what the customer will pay. */
async function renewalPrice(userId, domainInput, period = 1) {
  const domain = await assertOwnsDomain(userId, domainInput);
  const quote = await godaddy.quoteRenewal(domain, { period });
  return { domain, period: quote.period, usd: quote.price, inr: toInr(quote.price), currentExpiresAt: quote.currentExpiresAt, newExpiresAt: quote.newExpiresAt };
}

async function createRenewalOrder({ userId, domain: domainInput, period = 1 }) {
  const domain = await assertOwnsDomain(userId, domainInput);
  const years = Math.min(Math.max(Number.parseInt(period, 10) || 1, 1), 10);
  const quote = await godaddy.quoteRenewal(domain, { period: years });
  if (quote.currency !== 'USD') throw new AppError(`Unsupported GoDaddy currency ${quote.currency}.`, 502);
  const amountInr = toInr(quote.price);
  const base = await DomainOrder.findOne({ userId, domain, kind: 'registration' }).select('projectId').lean();
  const user = await User.findById(userId).select('name email').lean();
  const order = await razorpay().orders.create({
    amount: amountInr * 100, currency: 'INR', receipt: `ren_${Date.now()}`,
    notes: { userId: String(userId), domain, kind: 'renewal' }
  });
  const record = await DomainOrder.create({
    kind: 'renewal', userId, projectId: base.projectId, domain, period: years, goDaddyPrice: quote.price, goDaddyCurrency: quote.currency,
    chargedAmount: amountInr, chargedCurrency: 'INR', quoteToken: quote.quoteToken, razorpayOrderId: order.id
  });
  return { orderId: order.id, amount: amountInr * 100, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, domain, id: String(record._id),
    newExpiresAt: quote.newExpiresAt, user: { name: user?.name || '', email: user?.email || '' } };
}

/** DNS for a purchased domain, through GoDaddy's DNS API. */
async function dnsList(userId, domainInput) {
  const domain = await assertOwnsDomain(userId, domainInput);
  const rows = await godaddy.listDnsRecords(domain);
  return rows.map((r) => ({ type: r.type, name: r.name, data: r.data, ttl: r.ttl, priority: r.priority })).filter((r) => r.type && r.type !== 'SOA');
}
async function dnsSet(userId, domainInput, record) {
  const domain = await assertOwnsDomain(userId, domainInput);
  if (String(record?.type).toUpperCase() === 'NS') throw new ValidationError('Nameserver records are managed by GoDaddy.');
  return godaddy.setDnsRecord(domain, record);
}
async function dnsDelete(userId, domainInput, record) {
  const domain = await assertOwnsDomain(userId, domainInput);
  return godaddy.deleteDnsRecord(domain, record);
}

/** Called by the browser after Razorpay's checkout succeeds. */
async function verifyAndRegister({ projectId, userId, razorpay_order_id, razorpay_payment_id, razorpay_signature, agreed }) {
  const order = await DomainOrder.findOne({ razorpayOrderId: String(razorpay_order_id), userId, projectId });
  if (!order) throw new NotFoundError('Order');
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) throw new ValidationError('Invalid payment signature.');
  return summarize(await registerPaidOrder(order._id, razorpay_payment_id));
}

/** Polled by the UI: finishes registrations that were still pending when the payment was confirmed. */
async function getOrder({ orderId, userId }) {
  let order = await DomainOrder.findOne({ _id: orderId, userId });
  if (!order) throw new NotFoundError('Order');
  if (order.status === 'registering' && order.kind === 'renewal' && order.renewalId) {
    const current = await godaddy.getRenewal(order.renewalId).catch(() => null);
    if (current?.status === 'COMPLETED') { order.status = 'registered'; order.newExpiresAt = current.newExpiresAt || null; await order.save(); }
    else if (current?.status === 'FAILED') { order.error = 'GoDaddy could not renew the domain.'; await refund(order, order.error); await order.save(); }
  } else if (order.status === 'registering' && order.goDaddyOperationId) {
    const owned = await godaddy.ownsDomain(order.domain).catch(() => false);
    if (owned) {
      order = await DomainOrder.findOneAndUpdate({ _id: order._id, status: 'registering' }, { status: 'registered' }, { new: true }) || order;
      if (order.status === 'registered') await attachToProject(order);
    } else if (Date.now() - new Date(order.updatedAt).getTime() > 30 * 60 * 1000) {
      order.error = 'Registration did not complete in time.';
      await refund(order, order.error);
      await order.save();
    }
  }
  return summarize(order);
}

/** Razorpay webhook (payment.captured): registers the domain even if the customer closed the browser after paying. */
async function handleWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError('Webhook not configured.', 503);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = Buffer.from(String(signature || ''));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new AppError('Bad signature.', 400);
  const event = JSON.parse(rawBody.toString('utf8'));
  const payment = event?.payload?.payment?.entity;
  if (event?.event !== 'payment.captured' || !payment?.order_id) return { ignored: true };
  const order = await DomainOrder.findOne({ razorpayOrderId: payment.order_id });
  if (!order) return { ignored: true };
  await registerPaidOrder(order._id, payment.id);
  return { ok: true };
}

function summarize(order) {
  return {
    id: String(order._id), kind: order.kind, newExpiresAt: order.newExpiresAt || null, domain: order.domain, status: order.status, amount: order.chargedAmount, currency: order.chargedCurrency,
    error: order.error || null, refunded: order.status === 'failed_refunded', done: ['registered', 'failed_refunded', 'failed_refund_needed', 'expired'].includes(order.status)
  };
}

module.exports = { listMyDomains, renewalPrice, createRenewalOrder, dnsList, dnsSet, dnsDelete, search, createOrder, verifyAndRegister, getOrder, handleWebhook, toInr };
