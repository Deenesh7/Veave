/**
 * Real pictures for a generated website: one text-to-image request per picture, to the same image model family and OpenRouter key as
 * the photo enhancement (IMAGE_GENERATE_MODEL, falling back to IMAGE_ENHANCE_MODEL). A picture is only accepted when the model
 * really returned a picture that passes the checks; otherwise the page keeps its neutral photo slot.
 */
const axios = require('axios');
const sharp = require('sharp');
const enhancer = require('./templateImageEnhancer');
const remoteImageLocalizer = require('../ai/remoteImageLocalizer');
const logger = require('../../utils/logger');

const SIZES = { '16:9': [1600, 900], '4:3': [1400, 1050], '1:1': [1200, 1200] };
const model = () => String(process.env.IMAGE_GENERATE_MODEL || process.env.IMAGE_ENHANCE_MODEL || '').trim();
const timeoutMs = () => Number.parseInt(process.env.IMAGE_ENHANCE_TIMEOUT_MS, 10) || 180000;
const creditsPerImage = () => { const value = Number.parseInt(process.env.IMAGE_GENERATE_CREDITS, 10); return Number.isInteger(value) && value >= 0 ? value : 1; };
const maxImages = () => { const value = Number.parseInt(process.env.IMAGE_GENERATE_MAX, 10); return Number.isInteger(value) && value >= 0 ? value : 7; };

function isEnabled(deps = {}) {
  if (deps.requestImage === null) return false;
  if (deps.requestImage) return true;
  if (String(process.env.IMAGE_GENERATE_ENABLED || 'true').toLowerCase() === 'false') return false;
  const key = process.env.OPENROUTER_API_KEY;
  return Boolean(model() && key && !/^your[_-]/i.test(key) && key !== 'undefined');
}

/**
 * Image models sometimes answer a request for another shape with the photograph centred on a blurred copy of itself (bars above and
 * below). Those bars carry almost no detail, so a symmetric pair of them is found by measuring detail row by row and cut off.
 * Returns the picture unchanged when it has no such bars.
 */
async function trimBlurredBars(buffer, meta) {
  const { data, info } = await sharp(buffer).rotate().greyscale().resize({ width: 320, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width; const h = info.height;
  if (h < 60) return buffer;
  const raw = new Array(h).fill(0);
  for (let y = 0; y < h - 1; y += 1) {
    let sum = 0;
    for (let x = 0; x < w - 1; x += 1) { const i = y * w + x; sum += Math.abs(data[i] - data[i + 1]) + Math.abs(data[i] - data[i + w]); }
    raw[y] = sum / w;
  }
  const smooth = raw.map((_, y) => { let total = 0; let n = 0; for (let k = -3; k <= 3; k += 1) { if (raw[y + k] !== undefined) { total += raw[y + k]; n += 1; } } return total / n; });
  const median = [...smooth].sort((a, b) => a - b)[Math.floor(h / 2)];
  if (!median) return buffer;
  const sharp5 = (y) => [0, 1, 2, 3, 4].every((k) => (smooth[y + k] ?? 0) > 0.4 * median);
  let top = 0; while (top < h - 5 && !sharp5(top)) top += 1;
  let bottom = h - 1; while (bottom > 5 && !sharp5(bottom - 4)) bottom -= 1;
  if (top < h * 0.06 || h - 1 - bottom < h * 0.06 || bottom - top < h * 0.4) return buffer;
  const scale = meta.height / h;
  const inset = Math.round(h * 0.012);
  const y0 = Math.round((top + inset) * scale);
  const y1 = Math.round((bottom - inset) * scale);
  return sharp(buffer).rotate().extract({ left: 0, top: y0, width: meta.width, height: Math.max(64, y1 - y0) }).toBuffer();
}

/** The instruction for one picture. Real photography only: no text, logos, seals, certificates or recognisable individuals. */
function promptFor({ plan, subject, aspect }) {
  const identity = plan.identity || {};
  return `Create a realistic, professional photograph for the website of a ${identity.category || 'organisation'}${identity.organizationType ? ` (${identity.organizationType})` : ''}.
Subject: ${subject}.
Style: natural light, authentic documentary photography, clean composition with room for a headline. Wide 16:9 landscape photograph that fills the ENTIRE frame edge to edge; keep the subject near the centre so it still works when cropped to ${aspect === '1:1' ? 'a square' : aspect === '4:3' ? '4:3' : '16:9'}.
Strict rules: the picture must fill the whole frame: no borders, frames, bars, letterboxing, blurred or mirrored padding, no collage; no text, no letters or numbers, no printed material such as brochures, posters, signs or notice boards, no readable screens, no logos, no signs with writing, no watermarks, no certificates, seals or badges, no screenshots or user-interface mock-ups, no recognisable real people or celebrities; if people appear they are small, natural and not identifiable. It must look like a real photograph, not an illustration.`;
}

async function requestModel({ prompt, signal }) {
  const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'VEAVE Template Studio', 'Content-Type': 'application/json' };
  const body = { model: model(), modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] };
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data } = await axios.post(`${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`, body, { headers, timeout: timeoutMs(), signal, maxBodyLength: Infinity, maxContentLength: 80 * 1024 * 1024 });
      return data;
    } catch (error) {
      last = enhancer.providerError(error);
      if (signal?.aborted || !['RATE_LIMIT', 'NETWORK', 'PROVIDER_ERROR'].includes(last.code) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw last;
}

/** Generates one picture. Returns { buffer, mime, extension, width, height, usage } or throws an EnhanceError with a readable message. */
async function generateImage({ plan, subject, aspect = '16:9', signal, deps = {} }) {
  if (!isEnabled(deps)) throw new enhancer.EnhanceError('DISABLED', 'AI picture generation is not available.', { retryable: false });
  const [width, height] = SIZES[aspect] || SIZES['16:9'];
  const answer = await (deps.requestImage || requestModel)({ prompt: promptFor({ plan, subject, aspect }), signal, subject, aspect });
  const raw = await enhancer.pictureFrom(answer);
  const sniffed = remoteImageLocalizer.sniffImage(raw);
  if (!sniffed || !['image/png', 'image/jpeg', 'image/webp'].includes(sniffed.mime)) throw new enhancer.EnhanceError('INVALID_OUTPUT', 'The AI returned a file that is not a usable picture.');
  let meta;
  try { meta = await sharp(raw).metadata(); } catch { throw new enhancer.EnhanceError('INVALID_OUTPUT', 'The AI returned a damaged picture.'); }
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 256) throw new enhancer.EnhanceError('INVALID_OUTPUT', 'The AI returned a picture that is too small.');
  const stats = await sharp(raw).stats();
  if (stats.channels.every((channel) => channel.stdev < 3)) throw new enhancer.EnhanceError('INVALID_OUTPUT', 'The AI returned a blank picture.');
  const content = await trimBlurredBars(raw, meta);
  // Fit it exactly to the frame the page uses (a centred crop), and keep it light for a website.
  const buffer = await sharp(content).resize({ width, height, fit: 'cover', position: 'centre', withoutEnlargement: false }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  const usage = answer?.usage || {};
  logger.info(`Generated a ${aspect} picture with ${model()} (${Math.round(buffer.length / 1024)} KB)`);
  return { buffer, mime: 'image/jpeg', extension: 'jpg', width, height, model: model(), usage: { totalTokens: usage.total_tokens || 0, cost: Number(usage.cost) || 0, promptTokens: usage.prompt_tokens || 0, completionTokens: usage.completion_tokens || 0 } };
}

module.exports = { trimBlurredBars, isEnabled, generateImage, promptFor, creditsPerImage, maxImages, SIZES };
