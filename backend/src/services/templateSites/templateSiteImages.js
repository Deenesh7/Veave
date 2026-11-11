/**
 * The pictures of a generated website: for each picture in the website plan, one real, AI-made photograph, stored in the site as
 * public/images/gen-<key>.jpg. Every picture is saved the moment it exists (so an interrupted run keeps what it paid for), billed once,
 * and never blocks the website: a picture that cannot be made (no credits, provider error) leaves its page on a neutral photo slot.
 */
const AIUsage = require('../../models/AIUsage');
const imageGen = require('./templateImageGenerator');
const billing = require('../billing/usageService');
const logger = require('../../utils/logger');

const FATAL = ['PROVIDER_CREDITS', 'PROVIDER_AUTH', 'DISABLED'];
const pathFor = (key) => `/images/gen-${key}.jpg`;

/**
 * @param {object} p
 * @param {object} p.plan      the website plan (plan.images is the list to make; entries already `ready` are kept)
 * @param {function} p.persist async ({ file, entry }) => void   saves one finished picture into the site
 * @param {function} p.progress async (entries) => void          records the picture list on the plan after every picture
 * Returns { images, ready, failed, skipped, notes }.
 */
async function generateSiteImages({ userId, projectId, plan, deps = {}, signal, persist, progress }) {
  const images = (plan.images || []).map((entry) => ({ ...entry }));
  const notes = [];
  const enabled = imageGen.isEnabled(deps);
  const credits = imageGen.creditsPerImage();
  const charge = !deps.skipCreditCheck;
  let stop = null;
  for (const entry of images) {
    if (entry.status === 'ready') continue;
    signal?.throwIfAborted();
    if (!enabled) { entry.status = 'skipped'; entry.error = 'Picture generation is not available.'; continue; }
    if (stop) { entry.status = 'skipped'; entry.error = stop; continue; }
    if (charge) {
      try { await billing.assertCanSpendCredits(userId, credits); }
      catch (error) { stop = error.message; entry.status = 'skipped'; entry.error = stop; notes.push(`Pictures were skipped: ${stop}`); continue; }
    }
    try {
      const made = await imageGen.generateImage({ plan, subject: entry.subject, aspect: entry.aspect, signal, deps });
      const file = { path: `public${pathFor(entry.key)}`, content: made.buffer.toString('base64'), language: 'binary', encoding: 'base64' };
      await persist({ file, entry, made });
      entry.status = 'ready'; entry.path = pathFor(entry.key); entry.error = null; entry.width = made.width; entry.height = made.height;
      if (charge) {
        try {
          await AIUsage.create({ userId, projectId, model: made.model, provider: 'openrouter', inputTokens: made.usage.promptTokens, outputTokens: made.usage.completionTokens, totalTokens: 0, cost: made.usage.cost, usageSource: 'reported' });
          await billing.chargeFixedCredits(userId, credits);
        } catch (error) { logger.error(`Could not bill picture ${entry.key}: ${error.message}`); }
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      entry.status = 'failed'; entry.error = String(error.message || error).slice(0, 200);
      logger.warn(`Picture ${entry.key} was not made (${error.code || 'error'}): ${entry.error}`);
      if (FATAL.includes(error.code)) { stop = error.message; notes.push(`Pictures stopped: ${error.message}`); }
    }
    await progress?.(images);
  }
  await progress?.(images);
  const count = (state) => images.filter((entry) => entry.status === state).length;
  return { images, ready: count('ready'), failed: count('failed'), skipped: count('skipped'), notes };
}

/**
 * After the pages are written: every picture that was made really exists as a readable image, and is really on its page. Returns the
 * problems as [{ key, route, message, broken }] (broken: the file itself is missing or unreadable). Nothing is regenerated here.
 */
async function checkPictures({ plan, files, pages }) {
  const sharp = require('sharp');
  const pageDistinctness = require('../ai/pageDistinctness');
  const byPath = new Map(files.map((file) => [file.path, file]));
  const problems = [];
  for (const entry of (plan?.images || []).filter((item) => item.status === 'ready')) {
    const file = byPath.get(`public${pathFor(entry.key)}`);
    let broken = null;
    if (!file) broken = 'The picture file is missing from the site.';
    else {
      try {
        const body = file.content ? Buffer.from(file.content, 'base64') : null;
        const meta = body ? await sharp(body).metadata() : null;
        if (meta && (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 256)) broken = 'The picture file is not a usable image.';
      } catch { broken = 'The picture file could not be read as an image.'; }
    }
    const page = entry.page ? pages.find((item) => item.route === entry.page) : null;
    if (broken) { problems.push({ key: entry.key, route: entry.page, message: `${broken} (${entry.subject.slice(0, 50)})`, broken: true }); continue; }
    if (page && !pageDistinctness.pageSource(page.componentPath, byPath, 2).includes(entry.path)) problems.push({ key: entry.key, route: entry.page, message: `The picture made for this page (${entry.subject.slice(0, 50)}) is not placed on it.`, broken: false });
  }
  return problems;
}

/** What a page may use: the pictures planned for it (and nothing planned for another page). */
const picturesForPage = (plan, route) => (plan?.images || []).filter((entry) => entry.status === 'ready' && entry.page === route);
/** Pictures for sample cards (lists of programs, services...) used by the data files. */
const cardPictures = (plan) => (plan?.images || []).filter((entry) => entry.status === 'ready' && entry.page === null);

module.exports = { checkPictures, generateSiteImages, picturesForPage, cardPictures, pathFor };
