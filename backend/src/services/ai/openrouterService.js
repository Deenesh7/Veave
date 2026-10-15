const axios = require('axios');
const logger = require('../../utils/logger');
const {
  AIError,
  OpenRouterAuthError,
  OpenRouterRateLimitError,
  OpenRouterModelError,
  OpenRouterTimeoutError,
  OpenRouterNetworkError,
  OpenRouterAPIError
} = require('../../utils/errors');
const { FILE_OPERATIONS_TOOL } = require('./aiProtocol');

// OpenRouter rejects requests whose total text input exceeds 8 MB. Stay safely under it.
const MAX_INPUT_BYTES = Number.parseInt(process.env.OPENROUTER_MAX_INPUT_BYTES, 10) || 7_000_000;

function collectTextBlocks(messages) {
  const blocks = [];
  messages.forEach((message, mi) => {
    if (typeof message.content === 'string') blocks.push({ mi, pi: null, text: message.content });
    else if (Array.isArray(message.content)) {
      message.content.forEach((part, pi) => {
        if (part?.type === 'text' && typeof part.text === 'string') blocks.push({ mi, pi, text: part.text });
      });
    }
  });
  return blocks;
}

/**
 * Return messages whose combined text is at most maxBytes. The largest text blocks are
 * trimmed first (keeping their head and tail) so instructions at either end survive.
 * Images are not counted. Input is never mutated.
 */
function fitMessagesToLimit(messages, maxBytes = MAX_INPUT_BYTES) {
  if (!Array.isArray(messages)) return messages;
  const blocks = collectTextBlocks(messages);
  const sizes = blocks.map((b) => Buffer.byteLength(b.text));
  let total = sizes.reduce((a, b) => a + b, 0);
  if (total <= maxBytes) return messages;

  const marker = '\n\n[...content truncated to fit the 8 MB input limit...]\n\n';
  const out = messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((p) => ({ ...p })) : m.content }));
  let guard = 0;
  while (total > maxBytes && guard++ < 50) {
    let idx = 0;
    sizes.forEach((s, i) => { if (s > sizes[idx]) idx = i; });
    const excess = total - maxBytes;
    const keepChars = Math.max(2000, blocks[idx].text.length - excess - marker.length - 1024);
    if (keepChars >= blocks[idx].text.length) break;
    const head = Math.ceil(keepChars * 0.6);
    const tail = keepChars - head;
    const trimmed = blocks[idx].text.slice(0, head) + marker + blocks[idx].text.slice(blocks[idx].text.length - tail);
    blocks[idx].text = trimmed;
    const newSize = Buffer.byteLength(trimmed);
    total -= sizes[idx] - newSize;
    sizes[idx] = newSize;
    const { mi, pi } = blocks[idx];
    if (pi === null) out[mi].content = trimmed; else out[mi].content[pi].text = trimmed;
  }
  logger.warn(`OpenRouter input trimmed to ${total} bytes (limit ${maxBytes})`);
  return out;
}

class OpenRouterService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
    this.baseURL = 'https://openrouter.ai/api/v1';
  }

  /**
   * Detect model capabilities for structured outputs, tools, or delimiter fallbacks.
   */
  detectCapabilities(modelName) {
    const resolved = this.resolveModel(modelName).toLowerCase();
    const supportsTools = (
      resolved.includes('gemini') ||
      resolved.includes('gpt-') ||
      resolved.includes('claude-') ||
      resolved.includes('mistral') ||
      resolved.includes('llama-3') ||
      resolved.includes('qwen')
    );
    const supportsJsonSchema = (
      resolved.includes('gpt-4o') ||
      resolved.includes('gemini-2') ||
      resolved.includes('gemini-3')
    );
    return {
      supportsTools,
      supportsJsonSchema,
      preferredMode: supportsTools ? 'tools' : (supportsJsonSchema ? 'json_schema' : 'delimiter')
    };
  }

  /**
   * Resolve user-selected model to corresponding OpenRouter model identifier.
   * Defaults to Gemini Flash 3.8 (google/gemini-3.8-flash).
   */
  resolveModel(modelName) {
    if (!modelName) return this.model;
    const m = String(modelName).toLowerCase().trim();
    if (
      m === 'gemini flash 3.8' ||
      m === 'gemini-flash-3.8' ||
      m === 'gemini 3.8 flash' ||
      m === 'gemini-3.8-flash' ||
      m === 'gemini flash' ||
      m === 'gemini-flash' ||
      m === 'flash' ||
      m === 'fast' ||
      m === 'auto' ||
      m === 'default'
    ) {
      return process.env.OPENROUTER_MODEL || 'google/gemini-3.8-flash';
    }
    if (m === 'gpt' || m === 'gpt-4o') {
      return 'openai/gpt-4o';
    }
    if (m === 'gpt-6 luna' || m === 'chatgpt luna 6' || m === 'gpt 6 luna' || m === 'luna 6') {
      return 'openai/gpt-6-luna';
    }
    if (m === 'claude' || m === 'claude sonnet 5.5' || m === 'claude 5.5 sonnet' || m === 'claude sonnet 4.5' || m === 'claude 4.5 sonnet' || m === 'claude 3.5 sonnet' || m === 'high quality') {
      return process.env.CLAUDE_GENERATION_MODEL || 'anthropic/claude-sonnet-5.5';
    }
    if (m === 'gemini' || m === 'gemini 1.5 pro' || m === 'balanced') {
      return 'google/gemini-pro-1.5';
    }
    return modelName;
  }

  async generateCompletion(messages, options = {}) {
    messages = fitMessagesToLimit(messages);
    try {
      const targetModel = this.resolveModel(options.model) || this.model;
      const reqPayload = {
        model: targetModel,
        messages,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
        max_tokens: options.max_tokens || 16000,
        usage: { include: true }
      };
      if (options.tools) {
        reqPayload.tools = options.tools;
        if (options.tool_choice) reqPayload.tool_choice = options.tool_choice;
      } else if (options.response_format !== false) {
        reqPayload.response_format = options.response_format || { type: 'json_object' };
      }
      if (options.plugins) reqPayload.plugins = options.plugins;
      if (options.reasoning) reqPayload.reasoning = options.reasoning;

      const response = await axios.post(`${this.baseURL}/chat/completions`, reqPayload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'Veave AI',
          'Content-Type': 'application/json'
        },
        timeout: options.timeout || 120000
      });

      const choice = response.data.choices?.[0]?.message;
      return {
        content: choice?.content || choice?.reasoning || '',
        reasoning: choice?.reasoning || null,
        tool_calls: choice?.tool_calls || null,
        finishReason: response.data.choices?.[0]?.finish_reason || null,
        usage: response.data.usage
      };
    } catch (error) {
      if (error instanceof AIError) throw error;
      logger.error(`OpenRouter API Error: ${error.message}`);
      if (error.code === 'ECONNABORTED' || (error.message && error.message.toLowerCase().includes('timeout'))) {
        throw new OpenRouterTimeoutError(`OpenRouter request timed out: ${error.message}`);
      }
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        const baseMessage = data?.error?.message || data?.message || error.message;
        const providerDetail = data?.error?.metadata?.raw || data?.error?.metadata?.message || data?.error?.metadata?.error;
        const serializedDetail = typeof providerDetail === 'string'
          ? providerDetail
          : providerDetail && typeof providerDetail === 'object'
          ? JSON.stringify(providerDetail)
          : '';
        const msg = serializedDetail && !String(baseMessage).includes(serializedDetail)
          ? `${baseMessage}: ${serializedDetail}`
          : baseMessage;
        if (status === 401) {
          throw new OpenRouterAuthError(`OpenRouter authentication failed: ${msg}`);
        }
        if (status === 402) {
          const match = typeof msg === 'string' && msg.match(/can only afford (\d+)/i);
          if (match && !options._retried402) {
            const affordable = parseInt(match[1], 10);
            if (affordable >= 200) {
              const reduced = Math.min(affordable, 4000);
              logger.warn(`OpenRouter 402 credit limit encountered; auto-retrying with affordable max_tokens: ${reduced}`);
              return await this.generateCompletion(messages, {
                ...options,
                max_tokens: reduced,
                _retried402: true
              });
            }
          }
          throw new OpenRouterRateLimitError(`OpenRouter insufficient credits (HTTP 402): ${msg}. Top up at https://openrouter.ai/settings/credits.`);
        }
        if (status === 429) {
          throw new OpenRouterRateLimitError(`OpenRouter rate limit exceeded or insufficient credits: ${msg}`);
        }
        if (status === 400 && /provider returned error/i.test(String(baseMessage)) && !options._retried400) {
          logger.warn('OpenRouter provider rejected advanced generation parameters; retrying once without forced tool choice or reasoning controls.');
          return await this.generateCompletion(messages, {
            ...options,
            reasoning: undefined,
            tool_choice: undefined,
            _retried400: true
          });
        }
        if (status === 404 || (typeof msg === 'string' && (msg.toLowerCase().includes('model') || msg.toLowerCase().includes('not found')))) {
          throw new OpenRouterModelError(`OpenRouter model unavailable: ${msg}`);
        }
        throw new OpenRouterAPIError(`OpenRouter API error (${status}): ${msg}`, status);
      }
      if (error.request) {
        throw new OpenRouterNetworkError(`OpenRouter network error: ${error.message}`);
      }
      throw new AIError(`Failed to generate completion from AI service: ${error.message}`);
    }
  }

  async streamCompletion(messages, options = {}, onChunk) {
    messages = fitMessagesToLimit(messages);
    try {
      const targetModel = this.resolveModel(options.model) || this.model;
      const reqPayload = {
        model: targetModel,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 16000,
        response_format: { type: 'json_object' },
        stream: true
      };
      if (options.plugins) reqPayload.plugins = options.plugins;
      const response = await axios.post(`${this.baseURL}/chat/completions`, reqPayload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'Veave AI',
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: 120000
      });

      return new Promise((resolve, reject) => {
        let fullText = '';
        response.data.on('data', chunk => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
          for (const line of lines) {
            if (line === 'data: [DONE]') {
              resolve(fullText);
              return;
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                  const content = data.choices[0].delta.content;
                  fullText += content;
                  if (onChunk) onChunk(content);
                }
              } catch (e) {
                // Ignore parse errors on partial chunks
              }
            }
          }
        });

        response.data.on('end', () => {
          resolve(fullText);
        });

        response.data.on('error', err => {
          reject(err);
        });
      });
    } catch (error) {
      logger.error(`OpenRouter Streaming API Error: ${error.message}`);
      throw new AIError('Failed to stream completion from AI service');
    }
  }
}

module.exports = new OpenRouterService();
module.exports.fitMessagesToLimit = fitMessagesToLimit;

