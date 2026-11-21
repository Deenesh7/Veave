/** Small model-call adapters handed to workers, so a worker depends on "ask a model" and not on a particular provider module. */
const openrouterService = require('../openrouterService');

const canAskModel = () => Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key');
const quiet = { response_format: false, reasoning: { effort: 'minimal', exclude: true } };

/** async (system, user) => text, or null when no provider is configured. With a `signal`, cancelling the job stops the call in flight. */
function makeAsk({ model, maxTokens, temperature = 0, signal = null, service = openrouterService } = {}) {
  if (!canAskModel()) return null;
  return async (system, user) => {
    const completion = await service.generateCompletion([{ role: 'system', content: system }, { role: 'user', content: user }], { model, temperature, max_tokens: maxTokens, ...quiet, ...(signal ? { signal } : {}) });
    return completion?.content || '';
  };
}

/** async ({ system, user, image }) => text for a vision-capable model, or null. */
function makeVision({ model, maxTokens = 500, signal = null, service = openrouterService } = {}) {
  if (!canAskModel()) return null;
  return async ({ system, user, image }) => {
    const completion = await service.generateCompletion([{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] }], { model, temperature: 0, max_tokens: maxTokens, ...quiet, ...(signal ? { signal } : {}) });
    return completion?.content || '';
  };
}

module.exports = { canAskModel, makeAsk, makeVision };
