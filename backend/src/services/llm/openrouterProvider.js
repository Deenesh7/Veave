const axios = require('axios');
const BaseLLMProvider = require('./baseProvider');
const logger = require('../../utils/logger');
const { AIError } = require('../../utils/errors');

class OpenRouterProvider extends BaseLLMProvider {
  constructor() {
    super({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash',
      name: 'openrouter'
    });
    this.baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  }

  async _call({ system, user, temperature = 0.5, maxTokens = 8000, image, jsonMode }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });

    if (image?.base64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: user || '' },
          {
            type: 'image_url',
            image_url: { url: `data:${image.mimeType || 'image/png'};base64,${image.base64}` }
          }
        ]
      });
    } else {
      messages.push({ role: 'user', content: user });
    }

    try {
      const { data } = await axios.post(`${this.baseURL}/chat/completions`, {
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'VEAVE Prompt Engine',
          'Content-Type': 'application/json'
        },
        timeout: 120000
      });

      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: {
          prompt: data.usage?.prompt_tokens || 0,
          completion: data.usage?.completion_tokens || 0,
          total: data.usage?.total_tokens || 0
        }
      };
    } catch (err) {
      logger.error(`OpenRouter provider error: ${err.message}`);
      throw new AIError('AI request failed');
    }
  }
}

module.exports = OpenRouterProvider;
