/**
 * VEAVE LLM Provider — abstract base
 *
 * All concrete providers (OpenAI, Anthropic, Gemini, OpenRouter, …)
 * must extend this class so the Prompt Engine remains provider-agnostic.
 *
 *   generateText({ system, user, temperature, maxTokens, image })
 *      → { content: string, usage: { prompt, completion, total } }
 *
 *   generateStructured({ system, user, schemaHint, ... })
 *      → { data: object, raw: string, usage }
 *
 * Concrete providers should implement `_call()` (private) plus `name`.
 */

const { AIError } = require('../../utils/errors');

class BaseLLMProvider {
  constructor({ apiKey, model, name }) {
    this.apiKey = apiKey;
    this.model = model;
    this.name = name;
  }

  isConfigured() {
    return Boolean(this.apiKey) &&
           !/^your[_-]/i.test(this.apiKey) &&
           this.apiKey !== 'undefined';
  }

  /**
   * Concrete providers override this.
   * @returns {Promise<{content:string, usage:object}>}
   */
  async _call(/* { system, user, temperature, maxTokens, image, jsonMode } */) {
    throw new AIError(`Provider "${this.name}" did not implement _call()`);
  }

  async generateText(opts = {}) {
    if (!this.isConfigured()) {
      throw new AIError(`LLM provider "${this.name}" is not configured. Set the corresponding API key.`);
    }
    return this._call({ jsonMode: false, ...opts });
  }

  /**
   * Ask the model for JSON, then robustly parse it.
   */
  async generateStructured(opts = {}) {
    const res = await this.generateText({ ...opts, jsonMode: true });
    const data = BaseLLMProvider.safeParseJson(res.content);
    return { data, raw: res.content, usage: res.usage };
  }

  /* ---------------------------- utils ---------------------------- */

  static safeParseJson(text) {
    if (!text || typeof text !== 'string') return null;
    let cleaned = text.trim()
      .replace(/^```(?:json|javascript|js)?/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Attempt to isolate the first {...} or [...] block
      const first = cleaned.indexOf('{');
      const last = cleaned.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const slice = cleaned.slice(first, last + 1);
        try { return JSON.parse(slice); } catch { /* fall-through */ }
      }
      return null;
    }
  }
}

module.exports = BaseLLMProvider;
