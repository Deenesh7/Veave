/**
 * Cleanup worker: removes what a generation leaves behind when it did not finish cleanly.
 *
 *   sweepTempDirs         build and reference directories (veave-validation-*, veave-reference-*) abandoned by a crashed process
 *   sweepExpiredPreviews  validated-preview artifacts past their expiry (the TTL index normally does this; this is the backstop)
 *
 * It only deletes things that are provably stale (older than a threshold, or past their own expiry), never anything a running job may
 * still use, and it reports what it did instead of throwing.
 */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const logger = require('../../../utils/logger');

const TEMP_PREFIXES = ['veave-validation-', 'veave-reference-'];
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // longer than the whole-job limit's typical validation phase, so a live run is never touched

async function sweepTempDirs({ dir = os.tmpdir(), prefixes = TEMP_PREFIXES, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now() } = {}) {
  const removed = [];
  const failed = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return { removed, failed }; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs < maxAgeMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed.push(entry.name);
    } catch (error) { failed.push({ name: entry.name, reason: String(error.message).slice(0, 120) }); }
  }
  return { removed, failed };
}

async function sweepExpiredPreviews({ now = new Date(), model = require('../../../models/PreviewArtifact') } = {}) {
  try {
    const result = await model.deleteMany({ expiresAt: { $lte: now } });
    return { removed: result.deletedCount || 0, failed: [] };
  } catch (error) { return { removed: 0, failed: [{ reason: String(error.message).slice(0, 120) }] }; }
}

/** One cleanup pass. Never throws. */
async function sweep(options = {}) {
  const tempDirs = await sweepTempDirs(options.tempDirs);
  const previews = await sweepExpiredPreviews(options.previews);
  const summary = { tempDirs, previews };
  if (tempDirs.removed.length || previews.removed || tempDirs.failed.length || previews.failed.length) {
    logger.info(`[worker cleanup] removed ${tempDirs.removed.length} abandoned build dir(s) and ${previews.removed} expired preview(s)${tempDirs.failed.length + previews.failed.length ? `; ${tempDirs.failed.length + previews.failed.length} could not be removed` : ''}`);
  }
  return summary;
}

module.exports = { sweep, sweepTempDirs, sweepExpiredPreviews, TEMP_PREFIXES };
