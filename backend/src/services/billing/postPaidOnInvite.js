/**
 * Whoever invites one of the watched accounts (testveave@gmail.com by default; POSTPAID_INVITEE_EMAILS = comma separated emails) is put
 * on the Post Paid Plan (no credit or token limit, billed after use). Nothing is shown to the inviter: the invited account gets a
 * notification saying who was moved, and the audit log records it.
 */
const User = require('../../models/User');
const plans = require('./plans');
const audit = require('../admin/auditService');
const { notify } = require('../collaboration/support');
const logger = require('../../utils/logger');

const watched = () => String(process.env.POSTPAID_INVITEE_EMAILS || 'testveave@gmail.com').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);

/** @returns {Promise<{ changed: boolean, reason?: string }>} Never throws: an invitation must not fail because of this. */
async function onInvitation({ inviter, inviteeEmail, invitationId = null }) {
  try {
    const email = String(inviteeEmail || '').trim().toLowerCase();
    if (!watched().includes(email)) return { changed: false, reason: 'not-watched' };
    const id = inviter?._id || inviter?.id;
    const user = id ? await User.findById(id).select('name email role plan status') : null;
    if (!user) return { changed: false, reason: 'no-inviter' };
    if (user.email === email) return { changed: false, reason: 'self' };
    if (plans.resolvePlanName(user.plan) === plans.POSTPAID_PLAN) return { changed: false, reason: 'already' };
    const before = user.plan || 'Free Tier';
    await User.updateOne({ _id: user._id }, { $set: { plan: plans.POSTPAID_PLAN, 'subscription.tier': plans.POSTPAID_PLAN, 'subscription.status': 'active', 'subscription.billingCycle': 'monthly', 'subscription.bonusCredits': 0, 'subscription.renewsAt': null } });
    await audit.record(user, 'USER_PLAN_CHANGED', { resourceType: 'user', resourceId: String(user._id), before: { plan: before }, after: { plan: plans.POSTPAID_PLAN }, meta: { email: user.email, reason: `Invited ${email}`, invitationId, automatic: true } });
    // Nothing is shown to the inviter. The invited account (the watched one) is told who was moved to the plan.
    const watchedUser = await User.findOne({ email }).select('_id');
    if (watchedUser) await notify(watchedUser._id, { type: 'plan_changed', title: 'Post Paid Plan given', message: `${user.name || user.email} (${user.email}) invited you, so their account was moved from ${before} to the Post Paid Plan.`, data: { userId: String(user._id), email: user.email, plan: plans.POSTPAID_PLAN, previousPlan: before, invitationId } });
    logger.info(`${user.email} moved to the Post Paid Plan (invited ${email}).`);
    return { changed: true, previousPlan: before };
  } catch (error) {
    logger.warn(`Post Paid on invitation failed: ${error.message}`);
    return { changed: false, reason: 'error' };
  }
}

module.exports = { onInvitation, watched };
