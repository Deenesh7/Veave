/**
 * One way to ask OpenRouter for a picture, whichever kind of model is configured.
 *
 * Some image models answer on /chat/completions (with modalities ["image", "text"]); dedicated image-generation models
 * (openai/gpt-image-*, for example) are only served by POST /images and reject a chat request with
 * "... is an image generation model and cannot be used with the chat/completions endpoint". IMAGE_GENERATE_API chooses:
 *   auto (default) - chat first; a model that rejects chat is remembered and sent to /images from then on
 *   images         - always /images
 *   chat           - always /chat/completions
 * Both answers are read by templateImageEnhancer.pictureFrom (chat: choices[0].message.images, /images: data[].b64_json or url).
 */
const axios = require('axios');

const baseUrl = () => process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const mode = () => { const value = String(process.env.IMAGE_GENERATE_API || 'auto').trim().toLowerCase(); return ['auto', 'images', 'chat'].includes(value) ? value : 'auto'; };
const headers = () => ({ Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'VEAVE Template Studio', 'Content-Type': 'application/json' });
const ASPECTS = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);

// Models that said they only work on /images (kept for the life of the process).
const imagesOnly = new Set();

/** Did the provider refuse a chat request because the model only generates images through /images? */
function wantsImagesEndpoint(error) {
  const status = error?.response?.status;
  const detail = String(error?.response?.data?.error?.message || error?.message || '');
  return (status === 400 || status === 404 || status === 405) && /image generation model|cannot be used with the chat\/completions|\/images\b|images endpoint/i.test(detail);
}

async function post(path, body, { signal, timeout }) {
  const { data } = await axios.post(`${baseUrl()}${path}`, body, { headers: headers(), timeout, signal, maxBodyLength: Infinity, maxContentLength: 80 * 1024 * 1024 });
  return data;
}

/** POST /images: a text prompt (and optional reference pictures as data URLs) -> { data: [{ b64_json | url }], usage }. */
function generateWithImagesApi({ model, prompt, aspect, references = [], signal, timeout }) {
  return post('/images', {
    model, prompt, n: 1,
    ...(ASPECTS.has(aspect) ? { aspect_ratio: aspect } : {}),
    ...(references.length ? { input_references: references } : {})
  }, { signal, timeout });
}

/**
 * Asks for one picture. `chatBody` is the /chat/completions request; `prompt`, `aspect` and `references` describe the same request
 * for /images. Throws the provider's error (axios error) when both ways fail.
 */
async function requestPicture({ model, chatBody, prompt, aspect, references = [], signal, timeout }) {
  if (mode() === 'images' || imagesOnly.has(model)) return generateWithImagesApi({ model, prompt, aspect, references, signal, timeout });
  try {
    return await post('/chat/completions', chatBody, { signal, timeout });
  } catch (error) {
    if (mode() === 'chat' || !wantsImagesEndpoint(error)) throw error;
    imagesOnly.add(model);
    return generateWithImagesApi({ model, prompt, aspect, references, signal, timeout });
  }
}

module.exports = { requestPicture, generateWithImagesApi, wantsImagesEndpoint, imagesOnly };
