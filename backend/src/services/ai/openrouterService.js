const axios = require('axios');
const https = require('node:https');
const logger = require('../../utils/logger');
const {
  AIError,
  OpenRouterAuthError,
  OpenRouterRateLimitError,
  OpenRouterCreditError,
  OpenRouterModelError,
  OpenRouterTimeoutError,
  OpenRouterNetworkError,
  OpenRouterAPIError
} = require('../../utils/errors');
const { FILE_OPERATIONS_TOOL } = require('./aiProtocol');

// OpenRouter rejects requests whose total text input exceeds 8 MB. Stay safely under it.
const MAX_INPUT_BYTES = Number.parseInt(process.env.OPENROUTER_MAX_INPUT_BYTES, 10) || 7_000_000;

// Connection-level failures (no HTTP response) are safe to retry: the request never completed.
// EPIPE/ECONNRESET usually mean a stale keep-alive socket or the server closed a large upload early,
// so retries use a fresh, non-pooled connection.
const NETWORK_RETRY_PATTERN = /EPIPE|ECONNRESET|socket hang up|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i;
const freshAgent = new https.Agent({ keepAlive: false });

async function postWithNetworkRetry(url, payload, config, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await axios.post(url, payload, attempt === 1 ? config : { ...config, httpsAgent: freshAgent });
    } catch (error) {
      lastError = error;
      const text = `${error?.code || ''} ${error?.message || ''}`;
      const retryable = !error.response && !/timeout/i.test(text) && error?.code !== 'ECONNABORTED' && NETWORK_RETRY_PATTERN.test(text);
      if (!retryable || attempt === attempts) throw error;
      logger.warn?.(`OpenRouter connection error (${error.code || error.message}); retrying ${attempt}/${attempts - 1}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

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

// Veave uses a single model, GPT-6 Luna, and reaches it only through OpenRouter.
const LUNA_MODEL = 'openai/gpt-6-luna';
const LUNA_LABEL = 'Veave AI';

class OpenRouterService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.model = LUNA_MODEL;
    this.baseURL = 'https://openrouter.ai/api/v1';
  }

  /**
   * Detect model capabilities for structured outputs, tools, or delimiter fallbacks.
   */
  detectCapabilities() {
    return { supportsTools: true, supportsJsonSchema: false, preferredMode: 'tools' };
  }

  /**
   * Every request runs on GPT-6 Luna through OpenRouter. Any other requested name (old Gemini, Claude or GPT
   * selections saved in the UI or in old jobs) is ignored.
   */
  resolveModel() {
    return LUNA_MODEL;
  }

  isConfigured() {
    const key = String(process.env.OPENROUTER_API_KEY || '').trim();
    return Boolean(key) && key !== 'your_openrouter_api_key';
  }

  /**
   * Live check that the OpenRouter key works and that GPT-6 Luna is available to it.
   * Returns { ok, status, model, message }.
   */
  async checkConnection() {
    if (!this.isConfigured()) {
      return { ok: false, status: 'missing_key', model: LUNA_MODEL, message: 'OPENROUTER_API_KEY is not set.' };
    }
    try {
      const { data } = await axios.get(`${this.baseURL}/models/${LUNA_MODEL}/endpoints`, {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        timeout: 15000
      });
      const endpoints = data?.data?.endpoints || [];
      if (data?.data && endpoints.length === 0) {
        return { ok: false, status: 'model_unavailable', model: LUNA_MODEL, message: `OpenRouter has no endpoints for ${LUNA_MODEL}.` };
      }
      return { ok: true, status: 'connected', model: LUNA_MODEL, message: `Connected to OpenRouter. Model: ${LUNA_MODEL}.` };
    } catch (err) {
      const code = err.response?.status;
      if (code === 401 || code === 403) return { ok: false, status: 'auth_failed', model: LUNA_MODEL, message: 'OpenRouter rejected the API key.' };
      if (code === 404) return { ok: false, status: 'model_unavailable', model: LUNA_MODEL, message: `OpenRouter does not know the model ${LUNA_MODEL}.` };
      return { ok: false, status: 'unreachable', model: LUNA_MODEL, message: `Could not reach OpenRouter: ${err.message}` };
    }
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

      const response = await postWithNetworkRetry(`${this.baseURL}/chat/completions`, reqPayload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173',
          'X-Title': 'Veave AI',
          'Content-Type': 'application/json'
        },
        timeout: options.timeout || 120000
      });

      const choice = response.data.choices?.[0]?.message;
      if (!choice?.content && !choice?.tool_calls?.length) {
        const first = response.data.choices?.[0] || {};
        logger.warn(`OpenRouter returned no content: model=${response.data.model || targetModel} provider=${response.data.provider || 'n/a'} finish=${first.finish_reason || 'n/a'} native_finish=${first.native_finish_reason || 'n/a'} error=${JSON.stringify(first.error || response.data.error || null)} refusal=${JSON.stringify(choice?.refusal || null)} reasoningChars=${String(choice?.reasoning || '').length} usage=${JSON.stringify(response.data.usage || null)}`);
      }
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
        throw new OpenRouterTimeoutError(`The AI request timed out: ${error.message}`);
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
        logger.error(`OpenRouter HTTP ${status}: ${msg}`);
        if (status === 401) {
          { const authError = new OpenRouterAuthError('The AI service is not available right now. Please try again later.'); authError.permanent = true; throw authError; }
        }
        if (status === 402) {
          const match = typeof msg === 'string' && msg.match(/can only afford (\d+)/i);
          if (match && !options._retried402) {
            const affordable = parseInt(match[1], 10);
            if (affordable >= 200) {
              const reduced = Math.min(affordable, Number(options.max_tokens) || 16000);
              logger.warn(`OpenRouter 402 credit limit encountered; auto-retrying with affordable max_tokens: ${reduced}`);
              return await this.generateCompletion(messages, {
                ...options,
                max_tokens: reduced,
                _retried402: true
              });
            }
          }
          throw new OpenRouterCreditError('The AI service is out of credits or capacity. Please try again later.');
        }
        if (status === 429) {
          throw new OpenRouterRateLimitError('The AI service is busy. Please try again in a moment.');
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
          { const modelError = new OpenRouterModelError('The AI model is unavailable. Please try again later.'); modelError.permanent = true; throw modelError; }
        }
        throw new OpenRouterAPIError(`The AI service returned an error (${status}): ${msg}`, status);
      }
      if (error.request) {
        throw new OpenRouterNetworkError(`Could not reach the AI service: ${error.message}`);
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

