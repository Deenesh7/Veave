const axios = require('axios');
const BaseLLMProvider = require('./baseProvider');
const logger = require('../../utils/logger');
const { AIError } = require('../../utils/errors');

class OpenAIProvider extends BaseLLMProvider {
  constructor() {
    super({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      name: 'openai'
    });
    this.baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  }

  async _call({ system, user, temperature = 0.5, maxTokens = 8000, image, jsonMode }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });

    if (image?.base64) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: user || '' },
          { type: 'image_url', image_url: { url: `data:${image.mimeType || 'image/png'};base64,${image.base64}` } }
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
      logger.error(`OpenAI provider error: ${err.message}`);
      throw new AIError('OpenAI request failed');
    }
  }
}

module.exports = OpenAIProvider;
