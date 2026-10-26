// Last-resort site for creation requests.
//
// When the AI provider fails, or its output cannot be repaired within the repair budget, a brand-new project must
// still end up as a working website instead of an error. The fallback is the deterministic prompt-driven template
// (dynamicGeneratorService) and it goes through exactly the same validation gate as any AI candidate. It is never
// marked as a plain success: the validation report carries `degraded`, which records why the AI result was not used
// and what failed, so callers and the UI can tell the user.
const dynamicGenerator = require('./dynamicGeneratorService');
const { scaffoldReactProject } = require('../project/reactScaffolder');
const { sourceHash } = require('./validationGate');
const logger = require('../../utils/logger');

const MAX_DIAGNOSTICS = 20;

function isCancellation(error) {
  return error?.name === 'AbortError' || error?.message === 'Cancelled' || error?.message === 'Validation cancelled';
}

function isEnabled() {
  return process.env.VEAVE_DISABLE_FALLBACK_SITE !== 'true';
}

function buildFallbackFiles({ prompt, tokens, projectName }) {
  const files = dynamicGenerator.synthesizeDynamicComponents(prompt || 'Website', tokens);
  const name = projectName || dynamicGenerator.extractPromptSemantics(prompt || 'Website').title.slice(0, 45).trim() || 'Website';
  return scaffoldReactProject(files, { projectName: name, tokens });
}

// Trimmed, storable description of the AI candidate that was not used.
function describeFailure(error, files = []) {
  const report = error?.report || null;
  const last = report?.history?.at(-1);
  return {
    kind: report?.failureKind || (report ? 'validation' : 'generation'),
    status: report?.status || 'failed',
    stage: report?.stage || 'generation',
    reason: report?.reason || error?.message || 'Unknown failure',
    message: String(error?.message || '').slice(0, 2000),
    attempts: report?.history?.length || 0,
    diagnostics: (last?.diagnostics || []).slice(0, MAX_DIAGNOSTICS)
      .map(({ category, path, line, message }) => ({ category, path, line, message: String(message || '').slice(0, 500) })),
    originalSourceHash: Array.isArray(files) && files.length ? sourceHash(files) : null,
    originalPaths: Array.isArray(files) ? files.map((file) => file.path).slice(0, 200) : []
  };
}

function markDegraded(validated, failure) {
  const degraded = { ...failure, usedFallbackTemplate: true, at: new Date().toISOString() };
  validated.report.degraded = degraded;
  validated.degraded = degraded;
  return validated;
}

/**
 * Runs `validate(files)`. If it throws (other than cancellation), validates the deterministic template through the
 * same `validate` function and returns it marked as degraded. If the template cannot pass either, the ORIGINAL error
 * is thrown, with the template failure attached as `fallbackError`, so nothing unverified is ever returned.
 */
async function validateWithFallback(validate, files, { prompt, tokens, projectName, enabled = isEnabled(), fallbackValidate = validate } = {}) {
  try {
    return await validate(files);
  } catch (error) {
    if (!enabled || isCancellation(error)) throw error;
    const failure = describeFailure(error, files);
    logger.warn(`AI candidate rejected (${failure.kind}: ${failure.reason}); validating the deterministic fallback site.`);
    try {
      const fallback = await fallbackValidate(buildFallbackFiles({ prompt, tokens, projectName }));
      return markDegraded(fallback, failure);
    } catch (fallbackError) {
      if (isCancellation(fallbackError)) throw fallbackError;
      error.fallbackError = fallbackError.message;
      throw error;
    }
  }
}

// One plain-language next step per failure kind, appended to the technical message.
const NEXT_STEPS = {
  provider: 'The AI provider was unavailable. Try again in a moment or choose another model.',
  'malformed-response': 'The AI returned an answer that could not be applied. Try again or simplify the request.',
  'ineffective-repair': 'Automatic repair could not fix the error. Try rephrasing the request or asking for a simpler version.',
  infrastructure: 'The validation environment was unavailable, so nothing was changed. Try again shortly.',
  timeout: 'Validation took too long, so nothing was changed. Try a smaller request or try again.',
  policy: 'The result used something that is not allowed (for example an unsupported dependency). Adjust the request.',
  source: 'The generated code did not pass its checks after the allowed repair attempts. Try rephrasing the request.'
};

function actionableMessage(error) {
  const base = error?.message || 'Generation failed. Please try again.';
  const step = NEXT_STEPS[error?.report?.failureKind];
  return step && !base.includes(step) ? `${base}\n\n${step} Your previous version is unchanged.` : base;
}

module.exports = { actionableMessage, buildFallbackFiles, describeFailure, markDegraded, validateWithFallback, isCancellation, isEnabled };
