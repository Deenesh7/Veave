/**
 * A short description of an uploaded picture, written once by a vision model, so the page generator knows what a photograph shows
 * (for example "exterior of a concrete house with large windows") and can put it in the right section. It is only a hint: the upload
 * never waits for it and never fails because of it, and generation works without it.
 */
const TemplateAsset = require('../../models/TemplateAsset');
const logger = require('../../utils/logger');

const MAX_SIDE = 768;

function provider() {
  try { return require('../llm').getProvider(); } catch { return null; }
}

const enabled = () => process.env.TEMPLATE_IMAGE_CAPTIONS !== 'off' && Boolean(provider());

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Describes one picture. Returns { caption, alt, tags } or throws. */
async function describe(buffer) {
  const llm = provider();
  if (!llm) throw new Error('No vision model is configured.');
  const small = await require('sharp')(buffer).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  const { data } = await llm.generateStructured({
    system: 'You describe photographs for a website builder. Answer with JSON only: {"caption": string, "alt": string, "tags": string[]}. caption: one factual sentence (max 160 characters) saying what the picture shows. alt: concise alt text (max 120 characters). tags: 3 to 6 lowercase subject words such as architecture, interior, portrait, product, landscape, food. Never guess names of people or places.',
    user: 'Describe this picture.',
    image: { base64: small.toString('base64'), mimeType: 'image/jpeg' },
    temperature: 0.2,
    maxTokens: 300
  });
  if (!data || typeof data !== 'object') throw new Error('The vision model gave no usable description.');
  const tags = (Array.isArray(data.tags) ? data.tags : []).map((tag) => clean(tag, 24).toLowerCase()).filter(Boolean).slice(0, 6);
  return { caption: clean(data.caption, 400), alt: clean(data.alt, 200), tags };
}

/** Runs after the upload response was sent. Records the outcome on the asset either way. */
function captionInBackground(assetId, buffer) {
  setImmediate(async () => {
    try {
      const result = await describe(buffer);
      if (!result.caption) throw new Error('empty description');
      // Only fill what the owner has not written themselves.
      const asset = await TemplateAsset.findById(assetId).lean();
      if (!asset) return;
      await TemplateAsset.updateOne({ _id: assetId }, { $set: { caption: result.caption, tags: result.tags, captionStatus: 'ready', ...(asset.alt ? {} : { alt: result.alt }) } });
    } catch (error) {
      logger.warn(`Could not describe uploaded picture ${assetId}: ${error.message}`);
      await TemplateAsset.updateOne({ _id: assetId }, { $set: { captionStatus: 'failed' } }).catch(() => {});
    }
  });
}

module.exports = { enabled, describe, captionInBackground };
