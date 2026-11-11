/**
 * AI photo enhancement: sends the owner's ORIGINAL photo, together with the enhancement system prompt, to a real image-to-image
 * model (IMAGE_ENHANCE_MODEL, reached through OpenRouter with the same OPENROUTER_API_KEY) and returns the enhanced picture.
 *
 * This is image EDITING: the photo travels with the request as the reference image. A text-only model is never used, and nothing
 * is accepted unless the model really returned a picture that passes the checks below.
 */
const axios = require('axios');
const crypto = require('node:crypto');
const sharp = require('sharp');
const remoteImageLocalizer = require('../ai/remoteImageLocalizer');
const logger = require('../../utils/logger');
const { IMAGE_ENHANCE_SYSTEM_PROMPT, IMAGE_ENHANCE_USER_PROMPT } = require('./prompts/imageEnhancePrompt');

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ASPECT_TOLERANCE = 0.08;     // the model may differ from the original's shape by this much; it is trimmed to match
const MIN_SIMILARITY = 0.55;       // structure correlation with the original: an unrelated picture fails
const MAX_SIDE = 2560;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

/** A failure with a code the app can act on (and a message a person can read). */
class EnhanceError extends Error {
  constructor(code, message, { retryable = true } = {}) { super(message); this.name = 'EnhanceError'; this.code = code; this.retryable = retryable; }
}

const model = () => String(process.env.IMAGE_ENHANCE_MODEL || '').trim();
const baseUrl = () => process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const timeoutMs = () => Number.parseInt(process.env.IMAGE_ENHANCE_TIMEOUT_MS, 10) || 180000;

function isEnabled() {
  if (String(process.env.IMAGE_ENHANCE_ENABLED || 'true').toLowerCase() === 'false') return false;
  const key = process.env.OPENROUTER_API_KEY;
  return Boolean(model() && key && !/^your[_-]/i.test(key) && key !== 'undefined');
}

const autoEnabled = () => isEnabled() && String(process.env.IMAGE_ENHANCE_AUTO ?? 'false').toLowerCase() === 'true';

/** Maps an HTTP / network failure to a code the owner can act on. */
function providerError(error) {
  if (error instanceof EnhanceError) return error;
  const status = error?.response?.status;
  const detail = error?.response?.data?.error?.message || '';
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return new EnhanceError('TIMEOUT', 'The AI took too long to enhance this photo. Try again.');
  if (status === 429) return new EnhanceError('RATE_LIMIT', 'The AI service is busy right now. Try again in a minute.');
  if (status === 402) return new EnhanceError('PROVIDER_CREDITS', 'The AI service has run out of credit. Please contact support.', { retryable: false });
  if (status === 401 || status === 403) return new EnhanceError('PROVIDER_AUTH', 'The AI service is not set up correctly. Please contact support.', { retryable: false });
  if (status === 400 || status === 404) return new EnhanceError('PROVIDER_REJECTED', `The AI could not process this photo${detail ? `: ${String(detail).slice(0, 120)}` : '.'}`);
  if (status >= 500) return new EnhanceError('PROVIDER_ERROR', 'The AI service had a problem. Try again.');
  if (!error?.response) return new EnhanceError('NETWORK', 'The connection to the AI service was interrupted. Try again.');
  return new EnhanceError('PROVIDER_ERROR', 'The AI enhancement failed. Try again.');
}

/** One request to the image model. Resolves to { response } (the raw provider answer). Retries once on a busy / network failure. */
async function requestModel({ buffer, mime, signal }) {
  const body = {
    model: model(),
    modalities: ['image', 'text'],
    messages: [
      { role: 'system', content: IMAGE_ENHANCE_SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: IMAGE_ENHANCE_USER_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } }
      ] }
    ]
  };
  const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'VEAVE Template Studio', 'Content-Type': 'application/json' };
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data } = await axios.post(`${baseUrl()}/chat/completions`, body, { headers, timeout: timeoutMs(), signal, maxBodyLength: Infinity, maxContentLength: 80 * 1024 * 1024 });
      return data;
    } catch (error) {
      last = providerError(error);
      if (signal?.aborted || !['RATE_LIMIT', 'NETWORK', 'PROVIDER_ERROR'].includes(last.code) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw last;
}

/** Finds the picture in a provider answer: base64 data URL (the usual case), a plain https URL, or raw base64. */
async function pictureFrom(data) {
  const message = data?.choices?.[0]?.message || {};
  const candidates = [];
  for (const item of message.images || []) candidates.push(item?.image_url?.url || item?.url || item?.b64_json || item);
  if (Array.isArray(message.content)) for (const part of message.content) if (part?.type === 'image_url' || part?.type === 'output_image' || part?.type === 'image') candidates.push(part.image_url?.url || part.url || part.b64_json);
  if (typeof message.content === 'string') { const found = message.content.match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/); if (found) candidates.push(found[0]); }
  for (const candidate of candidates.filter((value) => typeof value === 'string' && value)) {
    if (candidate.startsWith('data:')) { const encoded = candidate.slice(candidate.indexOf(',') + 1); return Buffer.from(encoded, 'base64'); }
    if (/^https:\/\//i.test(candidate)) return remoteImageLocalizer.downloadPublicImage(candidate);
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(candidate)) return Buffer.from(candidate, 'base64');
  }
  throw new EnhanceError('NO_IMAGE', 'The AI answered without returning a picture. Try again.');
}

/** A 24x24 greyscale fingerprint used to tell "the same scene, better" from "something else". */
async function fingerprint(buffer) {
  return sharp(buffer).rotate().resize(24, 24, { fit: 'fill' }).greyscale().raw().toBuffer();
}

function correlation(a, b) {
  const n = a.length;
  let meanA = 0; let meanB = 0;
  for (let i = 0; i < n; i += 1) { meanA += a[i]; meanB += b[i]; }
  meanA /= n; meanB /= n;
  let num = 0; let varA = 0; let varB = 0;
  for (let i = 0; i < n; i += 1) { const x = a[i] - meanA; const y = b[i] - meanB; num += x * y; varA += x * x; varB += y * y; }
  if (!varA || !varB) return 0;
  return num / Math.sqrt(varA * varB);
}

/**
 * Checks what the model returned and turns it into the picture that will be stored: a real image of an allowed type, not flat or
 * identical to the original, the same shape and the same scene as the original, at a sensible size.
 */
async function validateAndNormalize(output, original) {
  if (!Buffer.isBuffer(output) || !output.length) throw new EnhanceError('INVALID_OUTPUT', 'The AI returned an empty picture. Try again.');
  if (output.length > MAX_OUTPUT_BYTES) throw new EnhanceError('INVALID_OUTPUT', 'The AI returned a picture that is too large. Try again.');
  const sniffed = remoteImageLocalizer.sniffImage(output);
  if (!sniffed || !ALLOWED.has(sniffed.mime)) throw new EnhanceError('INVALID_OUTPUT', 'The AI returned a file that is not a usable picture. Try again.');
  let meta;
  try { meta = await sharp(output).metadata(); } catch { throw new EnhanceError('INVALID_OUTPUT', 'The AI returned a damaged picture. Try again.'); }
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new EnhanceError('INVALID_OUTPUT', 'The AI returned a picture that is too small. Try again.');
  if (crypto.createHash('sha256').update(output).digest('hex') === original.sha256) throw new EnhanceError('UNCHANGED', 'The AI returned the photo unchanged. Try again.');

  const stats = await sharp(output).stats();
  if (stats.channels.every((channel) => channel.stdev < 2)) throw new EnhanceError('INVALID_OUTPUT', 'The AI returned a blank picture. Try again.');

  const originalAspect = original.width / original.height;
  const outputAspect = meta.width / meta.height;
  if (Math.abs(outputAspect - originalAspect) / originalAspect > ASPECT_TOLERANCE) throw new EnhanceError('SHAPE_CHANGED', 'The AI changed the shape of the photo, so the result was rejected. Try again.');

  // The same scene, not a replacement: coarse structure must still match the original.
  const similarity = correlation(await fingerprint(original.buffer), await fingerprint(output));
  if (similarity < MIN_SIMILARITY) throw new EnhanceError('SUBJECT_CHANGED', 'The AI changed the photo too much, so the result was rejected. Your original is untouched. Try again.');

  // Trim the (small) difference in shape so the enhanced photo fits exactly where the original did.
  let pipeline = sharp(output).rotate();
  let width = meta.width; let height = meta.height;
  if (Math.abs(outputAspect - originalAspect) / originalAspect > 0.004) {
    if (outputAspect > originalAspect) width = Math.round(height * originalAspect); else height = Math.round(width / originalAspect);
    pipeline = pipeline.extract({ left: Math.floor((meta.width - width) / 2), top: Math.floor((meta.height - height) / 2), width, height });
  }
  const long = Math.max(width, height);
  if (long > MAX_SIDE) pipeline = pipeline.resize({ width: width >= height ? MAX_SIDE : undefined, height: height > width ? MAX_SIDE : undefined, fit: 'inside' });

  // Keep the original's family of format: photos stay compact JPEG/WebP; PNG (and anything else) stays lossless PNG.
  let target = { mime: 'image/png', extension: 'png', encode: (image) => image.png({ compressionLevel: 9 }) };
  if (original.mime === 'image/jpeg') target = { mime: 'image/jpeg', extension: 'jpg', encode: (image) => image.jpeg({ quality: 92, mozjpeg: true }) };
  else if (original.mime === 'image/webp') target = { mime: 'image/webp', extension: 'webp', encode: (image) => image.webp({ quality: 92 }) };
  const finalBuffer = await target.encode(pipeline).toBuffer();
  const final = await sharp(finalBuffer).metadata();
  return { buffer: finalBuffer, mime: target.mime, extension: target.extension, width: final.width, height: final.height, similarity: Number(similarity.toFixed(3)) };
}

/**
 * Enhances one photo. `original` is { buffer, mime, sha256, width, height }.
 * Returns { buffer, mime, extension, width, height, similarity, model, usage: { promptTokens, completionTokens, totalTokens, cost } }.
 * `deps.requestModel` exists so tests can stand in for the network call; production always uses the real model.
 */
async function enhance(original, { signal, deps = {} } = {}) {
  if (!isEnabled()) throw new EnhanceError('DISABLED', 'AI photo enhancement is not available right now.', { retryable: false });
  const call = deps.requestModel || requestModel;
  const answer = await call({ buffer: original.buffer, mime: original.mime, signal, systemPrompt: IMAGE_ENHANCE_SYSTEM_PROMPT });
  const output = await pictureFrom(answer);
  const checked = await validateAndNormalize(output, original);
  const usage = answer?.usage || {};
  logger.info(`Enhanced a photo with ${model()}: ${original.width}x${original.height} -> ${checked.width}x${checked.height}, similarity ${checked.similarity}`);
  return { ...checked, model: model(), usage: { promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0, totalTokens: usage.total_tokens || 0, cost: Number(usage.cost) || 0 } };
}

module.exports = { enhance, isEnabled, autoEnabled, EnhanceError, providerError, validateAndNormalize, pictureFrom, requestModel, MIN_SIMILARITY, ASPECT_TOLERANCE };
