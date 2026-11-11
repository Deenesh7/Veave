/**
 * VEAVE LLM Service.
 *
 * Veave uses one model, GPT-6 Luna, and reaches it only through OpenRouter.
 * Other providers (OpenAI, Anthropic, Gemini) are not supported. Any model
 * preference passed in is ignored.
 *
 * Required env var: OPENROUTER_API_KEY
 */

const OpenRouterProvider = require('./openrouterProvider');
const { AIError } = require('../../utils/errors');

class LLMService {
  constructor() {
    this._provider = new OpenRouterProvider();
    this.default = 'openrouter';
  }

  getProvider() {
    if (!this._provider.isConfigured()) {
      throw new AIError('OpenRouter is not configured. Set OPENROUTER_API_KEY.');
    }
    return this._provider;
  }

  listConfigured() {
    return this._provider.isConfigured()
      ? [{ key: 'openrouter', name: this._provider.name, model: this._provider.model }]
      : [];
  }
}

module.exports = new LLMService();
