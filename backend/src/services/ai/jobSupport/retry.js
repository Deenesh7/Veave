/** Retry policy for model calls: what is transient, how to back off, and which provider failures must end a job. */
const openrouterService = require('../openrouterService');
const logger = require('../../../utils/logger');
const { OpenRouterRateLimitError, OpenRouterTimeoutError, isPermanentProviderError } = require('../../../utils/errors');

function isTransientError(error, { retryTimeouts = true } = {}) {
  // A bad key, exhausted credits or an unknown model do not fix themselves: never retry them.
  if (isPermanentProviderError(error)) return false;
  if (!retryTimeouts && (error instanceof OpenRouterTimeoutError || /timed? ?out|ECONNABORTED/i.test(`${error?.code || ''} ${error?.message || ''}`))) return false;
  const status = Number(error?.status || error?.response?.status || error?.statusCode);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const text = `${error?.code || ''} ${error?.name || ''} ${error?.message || ''}`;
  return /ETIMEDOUT|ECONNRESET|EPIPE|ECONNABORTED|EAI_AGAIN|ENOTFOUND|socket hang up|timeout|timed out|rate limit|overloaded|busy/i.test(text);
}

async function withTransientRetry(operation, { signal, deadlineAt, attempts = 3, retryTimeouts = true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isTransientError(error, { retryTimeouts }) || attempt === attempts) throw error;
      logger.warn(`Transient AI error (${error?.code || error?.name}: ${String(error?.message).slice(0, 120)}); retry ${attempt}/${attempts - 1} in ${Math.min(15000, 1500 * 2 ** (attempt - 1))}ms`);
      const delay = Math.min(15000, 1500 * 2 ** (attempt - 1));
      if (deadlineAt && Date.now() + delay >= deadlineAt) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}


// The model call used by new-site generation: a 429, 5xx or dropped connection is retried with backoff; a timeout is not (a
// 5-minute call is not repeated blindly) and permanent errors (key, credits, model) are never retried.
// Provider failures that must end the job (not be answered with a template site): a bad key, no credits, an unknown model, or a
// rate limit that survived the retries.
const isProviderStop = (error) => isPermanentProviderError(error) || error instanceof OpenRouterRateLimitError;

function generateWithRetry(messages, options, { signal } = {}) {
  return withTransientRetry(() => openrouterService.generateCompletion(messages, signal ? { ...options, signal } : options), { signal, attempts: Number.parseInt(process.env.OPENROUTER_RETRY_ATTEMPTS, 10) || 3, retryTimeouts: false });
}

module.exports = { isTransientError, withTransientRetry, generateWithRetry, isProviderStop };
