const axios = require('axios');
const BaseLLMProvider = require('./baseProvider');
const logger = require('../../utils/logger');
const { AIError } = require('../../utils/errors');

class GeminiProvider extends BaseLLMProvider {
  constructor() {
    super({
      apiKey: process.env.GEMINI_FLASH_API_KEY || process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_FLASH_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-3.8',
      name: 'gemini'
    });
    this.baseURL = process.env.GEMINI_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta';
  }

  async _call({ system, user, temperature = 0.5, maxTokens = 8000, image, jsonMode }) {
    const parts = [];
    if (image?.base64) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType || 'image/png',
          data: image.base64
        }
      });
    }
    parts.push({
      text: jsonMode
        ? `${user}\n\nReturn ONLY a valid JSON object. No markdown fences.`
        : user
    });

    try {
      const url = `${this.baseURL}/models/${this.model}:generateContent?key=${this.apiKey}`;
      const { data } = await axios.post(url, {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {})
        }
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000
      });

      const content = (data.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '')
        .join('\n');

      return {
        content,
        usage: {
          prompt: data.usageMetadata?.promptTokenCount || 0,
          completion: data.usageMetadata?.candidatesTokenCount || 0,
          total: data.usageMetadata?.totalTokenCount || 0
        }
      };
    } catch (err) {
      logger.error(`Gemini provider error: ${err.message}`);
      throw new AIError('Gemini request failed');
    }
  }
}

module.exports = GeminiProvider;
