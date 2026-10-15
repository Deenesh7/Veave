/**
 * VEAVE LLM Service — provider registry & selector.
 *
 * Env vars:
 *   LLM_PROVIDER   openai | anthropic | gemini | openrouter   (default: openrouter)
 *   LLM_MODEL      overrides provider-specific default model
 *
 * The Prompt Engine never imports a concrete provider directly. It calls
 *   llmService.getProvider(preference)
 * so we can swap providers without touching pipeline code.
 */

const OpenAIProvider = require('./openaiProvider');
const AnthropicProvider = require('./anthropicProvider');
const GeminiProvider = require('./geminiProvider');
const OpenRouterProvider = require('./openrouterProvider');
const { AIError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class LLMService {
  constructor() {
    this._providers = {
      openai: new OpenAIProvider(),
      anthropic: new AnthropicProvider(),
      gemini: new GeminiProvider(),
      openrouter: new OpenRouterProvider()
    };

    // Optional shared model override (rarely needed — provider-specific vars win)
    const sharedModel = process.env.LLM_MODEL;
    if (sharedModel) {
      Object.values(this._providers).forEach(p => { p.model = sharedModel; });
    }

    this.default = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
  }

  /**
   * Resolve a user-facing model preference to a concrete provider.
   *
   *  'auto'    → configured default provider (or first configured one)
   *  'gpt'     → openai
   *  'claude'  → anthropic
   *  'gemini'  → gemini
   *  'openrouter' | provider name → that provider
   */
  resolvePreference(preference = 'auto') {
    const pref = String(preference).toLowerCase().trim();
    if (pref === 'auto' || pref === '') return this._pickDefault();
    if (pref === 'gemini-flash-3.8' || pref === 'gemini flash 3.8' || pref === 'gemini-flash' || pref === 'gemini' || pref === 'google') {
      if (this._providers.gemini.isConfigured()) return this._providers.gemini;
      return this._providers.openrouter;
    }
    if (pref === 'gpt' || pref === 'openai') return this._providers.openai;
    if (pref === 'claude' || pref === 'anthropic') return this._providers.anthropic;
    if (pref === 'openrouter') return this._providers.openrouter;
    if (this._providers[pref]) return this._providers[pref];
    return this._pickDefault();
  }

  _pickDefault() {
    const preferred = this._providers[this.default];
    if (preferred && preferred.isConfigured()) return preferred;
    // Fall back to any configured provider
    for (const p of Object.values(this._providers)) {
      if (p.isConfigured()) return p;
    }
    return preferred || this._providers.openrouter; // return something for error surfacing
  }

  getProvider(preference = 'auto') {
    const provider = this.resolvePreference(preference);
    if (!provider) {
      throw new AIError('No LLM provider available. Configure LLM_PROVIDER and its API key.');
    }
    if (!provider.isConfigured()) {
      // Fallback: pick any configured provider
      const fallback = this._pickDefault();
      if (fallback?.isConfigured()) {
        logger.warn(`Requested provider "${provider.name}" is not configured; falling back to "${fallback.name}"`);
        return fallback;
      }
      throw new AIError(`LLM provider "${provider.name}" is not configured. Set the corresponding API key.`);
    }
    return provider;
  }

  listConfigured() {
    return Object.entries(this._providers)
      .filter(([, p]) => p.isConfigured())
      .map(([k, p]) => ({ key: k, name: p.name, model: p.model }));
  }
}

module.exports = new LLMService();
