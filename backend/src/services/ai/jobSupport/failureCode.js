/** The stable machine-readable code stored on a failed job (the frontend and support tooling read it). */
const { OpenRouterAuthError, OpenRouterRateLimitError, OpenRouterTimeoutError, OpenRouterModelError, AIResponseValidationError, AIResponseMalformedError, RepairExhaustedError } = require('../../../utils/errors');

function failureCode(error, { timedOut = false } = {}) {
  if (timedOut) return 'JOB_TIMEOUT';
  if (error instanceof OpenRouterAuthError) return 'PROVIDER_AUTH';
  if (error?.code === 'OPENROUTER_INSUFFICIENT_CREDITS') return 'PROVIDER_CREDITS';
  if (error instanceof OpenRouterRateLimitError) return 'PROVIDER_RATE_LIMIT';
  if (error instanceof OpenRouterModelError) return 'PROVIDER_MODEL';
  if (error instanceof OpenRouterTimeoutError) return 'PROVIDER_TIMEOUT';
  if (error instanceof AIResponseMalformedError) return 'AI_RESPONSE_MALFORMED';
  if (error instanceof AIResponseValidationError) return /^Image check failed/.test(error.message) ? 'IMAGE_CHECK_FAILED' : /^Layout check failed/.test(error.message) ? 'LAYOUT_CHECK_FAILED' : /^Page check failed/.test(error.message) ? 'PAGE_CHECK_FAILED' : /^Coverage check failed/.test(error.message) ? 'COVERAGE_CHECK_FAILED' : 'AI_RESPONSE_INVALID';
  if (error instanceof RepairExhaustedError) return 'REPAIR_EXHAUSTED';
  if (error?.report?.failureKind) return `VALIDATION_${String(error.report.failureKind).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  return 'JOB_FAILED';
}

module.exports = { failureCode };
