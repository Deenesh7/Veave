class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(resource) {
    super(`${resource} not found`, 404);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

class AuthError extends AppError {
  constructor(message) {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    super(message, 403);
    this.code = code;
  }
}

class ConflictError extends AppError {
  constructor(message, code = 'CONFLICT', details = null) {
    super(message, 409);
    this.code = code;
    if (details) this.details = details;
  }
}

class AIError extends AppError {
  constructor(message, statusCode = 502, code = 'AI_ERROR') {
    super(message, statusCode);
    this.code = code;
  }
}

class OpenRouterError extends AIError {
  constructor(message, statusCode = 502, code = 'OPENROUTER_ERROR') {
    super(message, statusCode, code);
  }
}

class OpenRouterAuthError extends OpenRouterError {
  constructor(message = 'AI service authentication failed: invalid API key') {
    super(message, 401, 'OPENROUTER_AUTH_ERROR');
  }
}

class OpenRouterRateLimitError extends OpenRouterError {
  constructor(message = 'AI service rate limit exceeded or insufficient credits') {
    super(message, 429, 'OPENROUTER_RATE_LIMIT');
  }
}

// Out of credits (HTTP 402): permanent until the account is topped up, so it is never retried. It extends the rate-limit error
// so existing `instanceof OpenRouterRateLimitError` handling (which stops the job) keeps working.
class OpenRouterCreditError extends OpenRouterRateLimitError {
  constructor(message = 'The AI service is out of credits. Please try again later.') {
    super(message);
    this.statusCode = 402;
    this.code = 'OPENROUTER_INSUFFICIENT_CREDITS';
    this.permanent = true;
  }
}

class OpenRouterModelError extends OpenRouterError {
  constructor(message = 'Selected AI model is unavailable or not found') {
    super(message, 503, 'OPENROUTER_MODEL_UNAVAILABLE');
  }
}

class OpenRouterTimeoutError extends OpenRouterError {
  constructor(message = 'AI request timed out') {
    super(message, 504, 'OPENROUTER_TIMEOUT');
  }
}

class OpenRouterNetworkError extends OpenRouterError {
  constructor(message = 'Network error connecting to AI service') {
    super(message, 502, 'OPENROUTER_NETWORK_ERROR');
  }
}

class OpenRouterAPIError extends OpenRouterError {
  constructor(message = 'AI service API returned an error', statusCode = 502) {
    super(message, statusCode, 'OPENROUTER_API_ERROR');
  }
}

class AIResponseMalformedError extends AppError {
  constructor(message = 'AI response was malformed and could not be parsed into file operations') {
    super(message, 422);
    this.code = 'AI_RESPONSE_MALFORMED';
  }
}

class AIResponseValidationError extends AppError {
  constructor(message = 'AI response failed file safety or schema validation', diagnostics = []) {
    super(message, 422);
    this.code = 'AI_RESPONSE_VALIDATION_ERROR';
    this.diagnostics = diagnostics;
  }
}

class FileApplicationError extends AppError {
  constructor(message = 'Failed to apply file operations to project') {
    super(message, 422);
    this.code = 'FILE_APPLICATION_ERROR';
  }
}

class BuildValidationError extends AppError {
  constructor(message = 'Project validation or build failed', diagnostics = []) {
    super(message, 422);
    this.code = 'BUILD_VALIDATION_ERROR';
    this.diagnostics = diagnostics;
  }
}

class RepairExhaustedError extends AppError {
  constructor(message = 'AI repair attempts exhausted without resolving errors') {
    super(message, 422);
    this.code = 'REPAIR_EXHAUSTED';
  }
}

/** Errors that retrying cannot fix (bad key, no credits, unknown model) and that must never be hidden behind a fallback site. */
function isPermanentProviderError(error) {
  return Boolean(error && (error.permanent === true || error instanceof OpenRouterAuthError || error instanceof OpenRouterCreditError || error instanceof OpenRouterModelError));
}

module.exports = {
  isPermanentProviderError,
  OpenRouterCreditError,
  AppError,
  NotFoundError,
  ValidationError,
  AuthError,
  ForbiddenError,
  ConflictError,
  AIError,
  OpenRouterError,
  OpenRouterAuthError,
  OpenRouterRateLimitError,
  OpenRouterModelError,
  OpenRouterTimeoutError,
  OpenRouterNetworkError,
  OpenRouterAPIError,
  AIResponseMalformedError,
  AIResponseValidationError,
  FileApplicationError,
  BuildValidationError,
  RepairExhaustedError
};
