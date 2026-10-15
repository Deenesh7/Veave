const axios = require('axios');
const BaseLLMProvider = require('./baseProvider');
const logger = require('../../utils/logger');
const { AIError } = require('../../utils/errors');

class AnthropicProvider extends BaseLLMProvider {
  constructor() {
    super({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
      name: 'anthropic'
    });
    this.baseURL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    this.version = '2023-06-01';
  }

  async _call({ system, user, temperature = 0.5, maxTokens = 8000, image, jsonMode }) {
    const userContent = [];
    if (image?.base64) {
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mimeType || 'image/png',
          data: image.base64
        }
      });
    }
    userContent.push({
      type: 'text',
      text: jsonMode
        ? `${user}\n\nReturn ONLY a single valid JSON object. Do not wrap in markdown fences.`
        : user
    });

    try {
      const { data } = await axios.post(`${this.baseURL}/messages`, {
        model: this.model,
        system: system || undefined,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: userContent }]
      }, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': this.version,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      });

      const content = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      return {
        content,
        usage: {
          prompt: data.usage?.input_tokens || 0,
          completion: data.usage?.output_tokens || 0,
          total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
        }
      };
    } catch (err) {
      logger.error(`Anthropic provider error: ${err.message}`);
      throw new AIError('Anthropic request failed');
    }
  }
}

module.exports = AnthropicProvider;
