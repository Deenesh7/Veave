/**
 * What happens when an account is created (email sign-up or Google/Apple): the admin-configured starting credits are applied
 * (with a ledger row) and the admin team is notified. Never throws: a problem here must not stop someone from signing up.
 */
const User = require('../../models/User');
const settings = require('./settingsService');
const ledger = require('./creditLedgerService');
const notifications = require('./notificationService');
const logger = require('../../utils/logger');

async function onUserCreated(user) {
  try {
    const { newUserCredits } = await settings.get('credits');
    const current = ledger.balanceOf(user);
    let balance = current;
    if (Number.isInteger(newUserCredits) && newUserCredits !== current && !user.creditsExempt) {
      await User.updateOne({ _id: user._id }, { $set: { credits: newUserCredits, 'subscription.creditsRemaining': newUserCredits, 'subscription.creditsAllocated': newUserCredits } });
      balance = newUserCredits;
    }
    await ledger.recordApplied({ userId: user._id, previousBalance: 0, newBalance: balance, type: 'CREDIT_ALLOCATION', reason: 'Welcome credits for a new account', idempotencyKey: `welcome:${user._id}` });
    await notifications.create({ type: 'NEW_USER', title: 'New user registered', message: `${user.name} (${user.email}) just signed up.`, data: { userId: String(user._id) }, dedupeKey: `new-user:${user._id}` });
  } catch (error) { logger.warn(`New-user setup skipped: ${error.message}`); }
}

module.exports = { onUserCreated };
