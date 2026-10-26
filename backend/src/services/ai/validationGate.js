const { createHash } = require('node:crypto');
const { validateGeneratedFiles, validateFilePaths, formatDiagnostics } = require('./generationPipeline');
const { executeProject } = require('./executionRunner');
const { autoFix } = require('./autoFix');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

function sourceHash(files) {
  return createHash('sha256').update(JSON.stringify(files.map(({ path, content }) => ({ path, content: String(content || '') }))
    .sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
}

// --- Structured validation results ------------------------------------------------------------------------------
// Every stage ends in exactly one of these. Consumers never need to parse messages to tell them apart.
const STAGE_STATUS = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  TIMED_OUT: 'timed_out',
  SKIPPED: 'skipped',
  INFRASTRUCTURE_UNAVAILABLE: 'infrastructure_unavailable'
});

// Why validation stopped. Only 'source' means the generated code itself is wrong; everything else is the
// environment, the AI provider or the response format and must not be "fixed" by rewriting source files.
const FAILURE_KIND = Object.freeze({
  SOURCE: 'source',
  INFRASTRUCTURE: 'infrastructure',
  TIMEOUT: 'timeout',
  POLICY: 'policy',
  PROVIDER: 'provider',
  MALFORMED_RESPONSE: 'malformed-response',
  INEFFECTIVE_REPAIR: 'ineffective-repair',
  CANCELLED: 'cancelled'
});

const INFRASTRUCTURE_CATEGORIES = new Set(['infrastructure']);
const POLICY_CATEGORIES = new Set(['path', 'dependency-policy', 'external-blocked']);

function normalizeStatus(status) {
  switch (status) {
    case 'passed': return STAGE_STATUS.PASSED;
    case 'failed': return STAGE_STATUS.FAILED;
    case 'timed_out': case 'timed-out': case 'timeout': return STAGE_STATUS.TIMED_OUT;
    case 'infrastructure_unavailable': return STAGE_STATUS.INFRASTRUCTURE_UNAVAILABLE;
    case 'skipped': case 'not-applicable': case 'not_applicable': return STAGE_STATUS.SKIPPED;
    default: return status || STAGE_STATUS.FAILED;
  }
}

function classifyDiagnostics(diagnostics = [], outcome = {}) {
  if (diagnostics.some((item) => item.timedOut || item.category === 'timeout')) return FAILURE_KIND.TIMEOUT;
  if (diagnostics.some((item) => INFRASTRUCTURE_CATEGORIES.has(item.category))) return FAILURE_KIND.INFRASTRUCTURE;
  if (diagnostics.some((item) => POLICY_CATEGORIES.has(item.category))) return FAILURE_KIND.POLICY;
  if (outcome.blocked) return FAILURE_KIND.INFRASTRUCTURE;
  return FAILURE_KIND.SOURCE;
}

// Turns whatever the worker or the local verifier produced into uniform stage records:
// { name, status, category?, exitCode?, timedOut?, timeoutMs?, files?, reason? }
function structureChecks(checks = [], diagnostics = [], outcome = {}) {
  const list = (Array.isArray(checks) ? checks : []).map((check) => ({ ...check, status: normalizeStatus(check.status) }));
  // Affected files come from the diagnostic paths and, for tool output without a path, from file names in the message.
  const filesOf = (items) => [...new Set(items.flatMap((item) => {
    const own = typeof item.path === 'string' && item.path && !/^https?:/.test(item.path) ? [item.path] : [];
    const text = String(item.message || '');
    const mentioned = [...text.matchAll(/(?:^|[\s"'(])(?:\/workspace\/)?((?:src|public)\/[\w./@-]+\.\w+|package\.json|tsconfig\.json|vite\.config\.\w+|index\.html)/g)].map((match) => match[1]);
    return item.category === 'install' || item.category === 'dependencies' ? [...own, 'package.json'] : [...own, ...mentioned];
  }))].slice(0, 20);
  const timeout = diagnostics.find((item) => item.timedOut || item.category === 'timeout');
  const infrastructure = diagnostics.find((item) => INFRASTRUCTURE_CATEGORIES.has(item.category));
  const failedChecks = list.filter((check) => check.status === STAGE_STATUS.FAILED);

  for (const check of failedChecks) {
    const related = diagnostics.filter((item) => item.stage === check.name || item.category === check.name);
    const source = related.length ? related : (failedChecks.length === 1 ? diagnostics : []);
    if (source.length) {
      check.category = check.category || source[0].category;
      check.files = filesOf(source);
    }
    if (Number.isInteger(outcome.exitCode)) check.exitCode = outcome.exitCode;
  }
  if (timeout) {
    const stage = timeout.stage || 'execution';
    const existing = list.find((check) => check.name === stage);
    const record = { name: stage, status: STAGE_STATUS.TIMED_OUT, category: 'timeout', timedOut: true, timeoutMs: timeout.timeoutMs ?? null, reason: timeout.message };
    if (existing) Object.assign(existing, record); else list.push(record);
  } else if (infrastructure) {
    list.push({ name: 'execution', status: STAGE_STATUS.INFRASTRUCTURE_UNAVAILABLE, category: infrastructure.category, reason: infrastructure.message });
  } else if (!list.length && diagnostics.length) {
    list.push({ name: 'static', status: STAGE_STATUS.FAILED, category: diagnostics[0].category, files: filesOf(diagnostics) });
  }
  return list;
}

// Stable identity of a failure, used to detect a repair loop that keeps producing the same error.
function diagnosticSignature(diagnostics = []) {
  return diagnostics
    .map((item) => `${item.category || ''}|${item.path || ''}|${String(item.message || '').split('\n')[0].replace(/\d+/g, '#').slice(0, 160)}`)
    .sort().join('\n');
}

function repairFailureKind(error) {
  const text = `${error?.name || ''} ${error?.code || ''}`;
  if (/Auth|RateLimit|Timeout|Network|OPENROUTER|API/i.test(text) || error?.statusCode === 401 || error?.statusCode === 429) return FAILURE_KIND.PROVIDER;
  return FAILURE_KIND.MALFORMED_RESPONSE;
}

function inspectFilePreValidation(file) {
  if (!file || typeof file.content !== 'string') return null;
  const content = file.content;
  const hash = createHash('sha256').update(content).digest('hex');
  const lineCount = content.split('\n').length;
  const size = Buffer.byteLength(content, 'utf8');
  const first200 = content.slice(0, 200);
  const last200 = content.slice(-200);

  const anomalies = [];
  if (/^\uFEFF/.test(content)) anomalies.push('BOM artifact');
  if (/^```/m.test(content) || /```$/m.test(content)) anomalies.push('Markdown fence');
  if (/<FILE[\s>]/i.test(content) || /<\/FILE>/i.test(content)) anomalies.push('<FILE> tag wrapper');
  if (/<PATCH[\s>]/i.test(content) || /<\/PATCH>/i.test(content)) anomalies.push('<PATCH> tag wrapper');
  if (/^(?:Here is|Below is|I have updated|Sure,|Certainly)/i.test(content.trim())) anomalies.push('Conversational AI explanation');
  if (/^<!DOCTYPE/i.test(content.trim()) || /^<html/i.test(content.trim())) {
    if (!file.path.endsWith('.html')) anomalies.push('Unexpected HTML doctype');
  }
  if (/^\{[\s\S]*"files"\s*:/i.test(content.trim()) || /^\{[\s\S]*"operations"\s*:/i.test(content.trim())) {
    anomalies.push('JSON wrapper');
  }

  logger.info(`[ValidationGate Pre-Static Inspection] File: ${file.path}, Size: ${size}B, Lines: ${lineCount}, Hash: ${hash.slice(0, 16)}, Status: ${anomalies.length ? 'ANOMALIES (' + anomalies.join(', ') + ')' : 'CLEAN'}, First200: ${JSON.stringify(first200)}, Last200: ${JSON.stringify(last200)}`);

  return { path: file.path, size, lineCount, hash, anomalies };
}

class PipelineError extends AppError {
  constructor(report) {
    const last = report.history.at(-1);
    super(`Generation ${report.status} at ${report.stage}. ${report.reason || ''}\n${formatDiagnostics(last?.diagnostics || [])}`, report.status === 'blocked' ? 503 : 422);
    this.report = report;
  }
}

async function validateAndRepair(initialFiles, { repair, run = executeProject, onProgress = async () => {}, signal, maxRepairs = 3,
  requireExecution = true, requireArtifacts = requireExecution } = {}) {
  const report = { status: 'running', stage: 'static', history: [], checks: [], sourceHash: null, failureKind: null };
  const stop = (status, reason, kind) => {
    Object.assign(report, { status, reason, failureKind: kind });
    return new PipelineError(report);
  };
  const unsafe = validateFilePaths(initialFiles);
  if (unsafe.length) {
    report.history.push({ attempt: 1, diagnostics: unsafe });
    throw stop('blocked', report.reason, FAILURE_KIND.POLICY);
  }
  let files = initialFiles.map(({ path, content, language, encoding }) => ({ path, content, language, encoding }));
  const seen = new Set();
  const abort = () => { if (signal?.aborted) throw Object.assign(new Error('Validation cancelled'), { name: 'AbortError' }); };
  // A repair that is rejected before it is applied leaves the files untouched, so the previous diagnostics are still
  // the truth; re-running the (slow) execution stage on identical source would only repeat them.
  let pending = null;
  let lastSignature = null;
  let identicalStreak = 0;
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    abort();
    let diagnostics;
    let outcome;
    let hash;
    if (pending) {
      ({ diagnostics, outcome } = pending);
      hash = sourceHash(files);
      pending = null;
    } else {
      // Free, deterministic fixes (case/extension import mistakes, missing default exports, stub pages, missing
      // dependencies) run before validation so the paid AI repair is only needed for real problems.
      try {
        const fixed = autoFix(files);
        if (fixed.fixes.length) {
          files = fixed.files;
          report.autoFixes = [...(report.autoFixes || []), ...fixed.fixes];
          logger.info(`[AutoFix] ${fixed.fixes.length} deterministic fix(es): ${fixed.fixes.join(' | ')}`);
        }
      } catch (error) {
        logger.warn(`[AutoFix] skipped: ${error.message}`);
      }
      hash = sourceHash(files);
      seen.add(hash);
      report.stage = 'static';
      await onProgress(structuredClone(report));
      const appFile = files.find(f => f.path === 'src/App.jsx' || f.path.endsWith('App.jsx'));
      if (appFile) inspectFilePreValidation(appFile);
      diagnostics = validateGeneratedFiles(files);
      if (!diagnostics.length) {
        if (requireExecution && typeof run === 'function') {
          report.stage = 'execution';
          await onProgress(structuredClone(report));
          outcome = await run(files, { signal, onEvent: (event) => {
            report.stage = event.stage;
            // Notifications are serialized by the caller; they never decide success.
            Promise.resolve(onProgress(structuredClone(report))).catch(() => {});
          } });
          diagnostics = outcome?.diagnostics || [];
          if (!outcome?.ok && !diagnostics.length) diagnostics = [{ category: 'execution', path: null, message: 'Worker did not pass validation.' }];
        } else {
          outcome = {
            ok: true,
            diagnostics: [],
            checks: [
              { name: 'syntax', status: 'passed' },
              { name: 'dependencies', status: 'passed' },
              { name: 'static', status: 'passed' }
            ],
            coverage: { exhaustive: false },
            artifacts: []
          };
        }
      }
      abort();
      report.history.push({ attempt: attempt + 1, sourceHash: hash, diagnostics,
        checks: structureChecks(outcome?.checks || [], diagnostics, outcome || {}),
        failureKind: diagnostics.length ? classifyDiagnostics(diagnostics, outcome || {}) : null, changedFiles: [] });
    }
    if (!diagnostics.length && outcome?.ok) {
      if (outcome.degradedExecution) {
        // The isolated build runner was unavailable and the local browser verifier ran instead. Recorded, never hidden.
        report.validationMode = 'local-browser-fallback';
        report.infrastructure = outcome.infrastructure || null;
      } else if (requireArtifacts) {
        if (!Array.isArray(outcome.artifacts) || !outcome.artifacts.some((file) => file.path === 'dist/index.html')) {
          throw stop('blocked', 'Worker returned no runnable build artifact.', FAILURE_KIND.INFRASTRUCTURE);
        }
        // Keep the exact dependency resolution which was built and tested.
        if (outcome.lockfile) {
          files = files.filter((file) => file.path !== 'package-lock.json');
          files.push({ path: 'package-lock.json', content: outcome.lockfile, language: 'json' });
        }
      }
      Object.assign(report, { status: 'passed', stage: 'verified', failureKind: null, sourceHash: sourceHash(files),
        checks: structureChecks(outcome.checks, [], outcome), coverage: outcome.coverage || { exhaustive: false }, visual: outcome.visual || null,
        verifiedAt: new Date().toISOString() });
      await onProgress(structuredClone(report));
      return { files, report, artifacts: outcome.artifacts || [] };
    }
    const kind = classifyDiagnostics(diagnostics, outcome || {});
    if (outcome?.blocked || diagnostics.some((item) => ['path', 'external-blocked'].includes(item.category))) {
      throw stop('blocked', kind === FAILURE_KIND.TIMEOUT
        ? 'Validation timed out; the environment needs attention and the source code was not rewritten.'
        : 'Execution environment or dependency policy requires attention; source code was not rewritten.', kind);
    }
    const signature = diagnosticSignature(diagnostics);
    identicalStreak = signature === lastSignature ? identicalStreak + 1 : 0;
    lastSignature = signature;
    if (attempt === maxRepairs || !repair) {
      throw stop('failed', `Validation did not pass within ${maxRepairs} repair attempts.`, kind);
    }
    if (identicalStreak >= 2) {
      throw stop('failed', `The same error persisted after ${identicalStreak} repair attempts; further retries were stopped.`, FAILURE_KIND.INEFFECTIVE_REPAIR);
    }
    report.stage = 'repair';
    await onProgress(structuredClone(report));
    let changes;
    try { changes = await repair(files, diagnostics, structuredClone(report.history)); }
    catch (error) {
      abort();
      const repairKind = repairFailureKind(error);
      throw stop(repairKind === FAILURE_KIND.PROVIDER ? 'blocked' : 'failed',
        repairKind === FAILURE_KIND.PROVIDER
          ? `Repair provider unavailable: ${error.message}`
          : `Repair response could not be used: ${error.message}`, repairKind);
    }
    abort();
    // A repair may not "fix" an artifact-size, asset or visual failure by rewriting the build configuration (it once dropped
    // the public folder to get under the size limit, which removed every image and blanked the site). Build configuration
    // is changed only when a diagnostic actually points at it.
    if (Array.isArray(changes)) {
      const citesConfig = diagnostics.some((item) => /vite\.config/.test(`${item.path || ''} ${item.message || ''}`));
      const ignored = citesConfig ? [] : changes.filter((file) => /^vite\.config\.[cm]?[jt]s$/.test(file.path) && files.some((old) => old.path === file.path && old.content !== file.content));
      if (ignored.length) {
        report.history.at(-1).ignoredChanges = ignored.map((file) => file.path);
        logger.warn(`Repair tried to change ${ignored.map((file) => file.path).join(', ')} without a diagnostic pointing at it; those changes were discarded.`);
        const kept = changes.filter((file) => !ignored.includes(file));
        if (changes.deletedPaths) kept.deletedPaths = changes.deletedPaths;
        changes = kept;
      }
    }
    if (!Array.isArray(changes) || !changes.length || validateFilePaths(changes).length) {
      throw stop('failed', 'Repair returned no valid file changes.', FAILURE_KIND.MALFORMED_RESPONSE);
    }
    // Repairs may add/modify files, but cannot delete working features or weaken test assertions.
    if (changes.some((file) => file.path === 'veave.validation.json' && files.some((old) => old.path === file.path && old.content !== file.content))) {
      throw stop('failed', 'Repair attempted to change the acceptance tests.', FAILURE_KIND.POLICY);
    }
    const candidateFiles = files.map((file) => ({ ...file }));
    const next = new Map(candidateFiles.map((file) => [file.path, file]));
    const changedFiles = [];
    for (const file of changes) {
      if (next.get(file.path)?.content !== file.content) changedFiles.push(file.path);
      next.set(file.path, { ...next.get(file.path), ...file });
    }
    const testFiles = [...next.values()];

    // Validate the candidate repair before accepting it into the working files; `files` keeps the last good state.
    const repairPreDiagnostics = validateGeneratedFiles(testFiles);
    const syntaxErrors = repairPreDiagnostics.filter(d => d.category === 'syntax');
    if (syntaxErrors.length > 0) {
      logger.warn(`Repair attempt ${attempt + 1} produced syntax errors: ${formatDiagnostics(syntaxErrors)}. Preserving previous valid file state.`);
      report.history.at(-1).changedFiles = changedFiles;
      report.history.push({
        attempt: attempt + 1,
        sourceHash: sourceHash(testFiles),
        diagnostics: syntaxErrors,
        checks: structureChecks([], syntaxErrors, {}),
        failureKind: FAILURE_KIND.SOURCE,
        rejectedRepair: true,
        changedFiles: []
      });
      if (attempt === maxRepairs) {
        throw stop('failed', `Validation did not pass within ${maxRepairs} repair attempts.`, FAILURE_KIND.SOURCE);
      }
      pending = { diagnostics, outcome };
      continue;
    }

    files = testFiles;
    report.history.at(-1).changedFiles = changedFiles;
    if (!changedFiles.length || seen.has(sourceHash(files))) {
      throw stop('failed', 'Repair made no meaningful change or repeated an earlier failed revision.', FAILURE_KIND.INEFFECTIVE_REPAIR);
    }
  }
}

module.exports = { validateAndRepair, sourceHash, PipelineError, STAGE_STATUS, FAILURE_KIND, structureChecks, classifyDiagnostics, diagnosticSignature };
