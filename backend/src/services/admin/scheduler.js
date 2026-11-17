/**
 * Background checks for the admin dashboard: the monthly credit allocation, credit expiry, failed generations, low resources and
 * low balances. Everything is idempotent, so it is safe if two servers run it or the server restarts.
 */
const os = require('node:os');
const User = require('../../models/User');
const TemplateGenerationJob = require('../../models/TemplateGenerationJob');
const ledger = require('./creditLedgerService');
const settings = require('./settingsService');
const notifications = require('./notificationService');
const logger = require('../../utils/logger');

let lastFailureScan = new Date();
const hourKey = () => new Date().toISOString().slice(0, 13);
const dayKey = () => new Date().toISOString().slice(0, 10);

async function tick() {
  try { await require('./planAdminService').runRenewals(); } catch (error) { logger.warn(`Plan renewal: ${error.message}`); }
  try { await ledger.runMonthlyAllocation(); } catch (error) { logger.warn(`Monthly allocation: ${error.message}`); }
  try { await ledger.runExpiry(); } catch (error) { logger.warn(`Credit expiry: ${error.message}`); }
  try { await ledger.reconcileBalances(); } catch (error) { logger.warn(`Credit balance check: ${error.message}`); }

  try {
    const since = lastFailureScan;
    lastFailureScan = new Date();
    const failed = await TemplateGenerationJob.countDocuments({ status: 'failed', updatedAt: { $gte: since } });
    if (failed > 0) await notifications.create({ type: 'GENERATION_FAILED', severity: failed >= 5 ? 'critical' : 'warning', title: 'Website generations failed', message: `${failed} generation${failed === 1 ? '' : 's'} failed since the last check.`, data: { count: failed }, dedupeKey: `gen-failed:${hourKey()}:${lastFailureScan.getMinutes()}` });
  } catch (error) { logger.warn(`Failure scan: ${error.message}`); }

  try {
    const free = os.freemem() / os.totalmem();
    const heap = process.memoryUsage();
    if (free < 0.08 || heap.heapUsed / heap.heapTotal > 0.92) {
      await notifications.create({ type: 'RESOURCE_WARNING', severity: 'critical', title: 'Server resources are low', message: `Free memory ${(free * 100).toFixed(1)}%, heap in use ${(heap.heapUsed / 1048576).toFixed(0)} MB of ${(heap.heapTotal / 1048576).toFixed(0)} MB.`, dedupeKey: `resources:${hourKey()}` });
    }
  } catch (error) { logger.warn(`Resource check: ${error.message}`); }

  try {
    const { lowBalanceThreshold } = await settings.get('credits');
    const low = await User.countDocuments({ creditsExempt: { $ne: true }, status: { $ne: 'suspended' }, $expr: { $lte: [{ $ifNull: ['$subscription.creditsRemaining', '$credits'] }, lowBalanceThreshold] } });
    if (low > 0) await notifications.create({ type: 'LOW_CREDITS', title: 'Users with low credit balances', message: `${low} user${low === 1 ? ' has' : 's have'} ${lowBalanceThreshold} credits or fewer.`, data: { count: low }, dedupeKey: `low-credits:${dayKey()}` });
  } catch (error) { logger.warn(`Low-balance check: ${error.message}`); }
}

let timer = null;
function start({ everyMs = 10 * 60 * 1000 } = {}) {
  if (timer) return;
  setTimeout(() => tick().catch(() => {}), 15_000).unref();
  timer = setInterval(() => tick().catch(() => {}), everyMs);
  timer.unref();
}

module.exports = { start, tick };
