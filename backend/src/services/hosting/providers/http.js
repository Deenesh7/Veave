// One small HTTP helper for DNS provider APIs: hard timeouts, a few retries for rate limits and server errors, and errors that
// never contain the credential. Providers use it so every call behaves the same way.
const axios = require('axios');

class ProviderError extends Error {
  constructor(message, { status = null, transient = false, code = 'PROVIDER_ERROR' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.transient = transient;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request({ method = 'GET', url, headers = {}, params, data, timeout = 15000, retries = 2, client = axios, wait = sleep }) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await client.request({ method, url, headers, params, data, timeout, validateStatus: () => true });
      if (response.status === 429 || response.status >= 500) {
        last = new ProviderError(`The DNS provider answered ${response.status}.`, { status: response.status, transient: true });
        const retryAfter = Number(response.headers?.['retry-after']);
        if (attempt < retries) { await wait(Math.min(5000, (retryAfter > 0 ? retryAfter * 1000 : 600 * 2 ** attempt))); continue; }
        throw last;
      }
      return { status: response.status, data: response.data };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      last = new ProviderError(`The DNS provider could not be reached (${error.code || 'network error'}).`, { transient: true, code: error.code || 'NETWORK' });
      if (attempt < retries) { await wait(600 * 2 ** attempt); continue; }
      throw last;
    }
  }
  throw last;
}

module.exports = { request, ProviderError };
