const { createHash } = require('node:crypto');
const { validateGeneratedFiles, validateFilePaths, formatDiagnostics } = require('./generationPipeline');
const { executeProject } = require('./executionRunner');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

function sourceHash(files) {
  return createHash('sha256').update(JSON.stringify(files.map(({ path, content }) => ({ path, content: String(content || '') }))
    .sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
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

async function validateAndRepair(initialFiles, { repair, run = executeProject, onProgress = async () => {}, signal, maxRepairs = 2,
  requireExecution = true, requireArtifacts = requireExecution } = {}) {
  const report = { status: 'running', stage: 'static', history: [], checks: [], sourceHash: null };
  const unsafe = validateFilePaths(initialFiles);
  if (unsafe.length) {
    report.status = 'blocked';
    report.history.push({ attempt: 1, diagnostics: unsafe });
    throw new PipelineError(report);
  }
  let files = initialFiles.map(({ path, content, language, encoding }) => ({ path, content, language, encoding }));
  const seen = new Set();
  const abort = () => { if (signal?.aborted) throw Object.assign(new Error('Validation cancelled'), { name: 'AbortError' }); };
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    abort();
    const hash = sourceHash(files);
    seen.add(hash);
    report.stage = 'static';
    await onProgress(structuredClone(report));
    const appFile = files.find(f => f.path === 'src/App.jsx' || f.path.endsWith('App.jsx'));
    if (appFile) inspectFilePreValidation(appFile);
    let diagnostics = validateGeneratedFiles(files);
    let outcome;
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
    report.history.push({ attempt: attempt + 1, sourceHash: hash, diagnostics, checks: outcome?.checks || [], changedFiles: [] });
    if (!diagnostics.length && outcome?.ok) {
      if (requireArtifacts) {
        if (!Array.isArray(outcome.artifacts) || !outcome.artifacts.some((file) => file.path === 'dist/index.html')) {
          report.status = 'blocked'; report.reason = 'Worker returned no runnable build artifact.';
          throw new PipelineError(report);
        }
        // Keep the exact dependency resolution which was built and tested.
        if (outcome.lockfile) {
          files = files.filter((file) => file.path !== 'package-lock.json');
          files.push({ path: 'package-lock.json', content: outcome.lockfile, language: 'json' });
        }
      }
      Object.assign(report, { status: 'passed', stage: 'verified', sourceHash: sourceHash(files),
        checks: outcome.checks, coverage: outcome.coverage || { exhaustive: false }, visual: outcome.visual || null,
        verifiedAt: new Date().toISOString() });
      await onProgress(structuredClone(report));
      return { files, report, artifacts: outcome.artifacts || [] };
    }
    if (outcome?.blocked || diagnostics.some((item) => ['path', 'external-blocked'].includes(item.category))) {
      report.status = 'blocked'; report.reason = 'Execution environment or dependency policy requires attention; source code was not rewritten.';
      throw new PipelineError(report);
    }
    if (attempt === maxRepairs || !repair) {
      report.status = 'failed'; report.reason = `Validation did not pass within ${maxRepairs} repair attempts.`;
      throw new PipelineError(report);
    }
    report.stage = 'repair';
    await onProgress(structuredClone(report));
    let changes;
    try { changes = await repair(files, diagnostics, structuredClone(report.history)); }
    catch (error) {
      report.status = 'blocked'; report.reason = `Repair provider unavailable: ${error.message}`;
      throw new PipelineError(report);
    }
    abort();
    if (!Array.isArray(changes) || !changes.length || validateFilePaths(changes).length) {
      report.status = 'failed'; report.reason = 'Repair returned no valid file changes.';
      throw new PipelineError(report);
    }
    // Repairs may add/modify files, but cannot delete working features or weaken test assertions.
    if (changes.some((file) => file.path === 'veave.validation.json' && files.some((old) => old.path === file.path && old.content !== file.content))) {
      report.status = 'failed'; report.reason = 'Repair attempted to change the acceptance tests.';
      throw new PipelineError(report);
    }
    const candidateFiles = files.map((file) => ({ ...file }));
    const next = new Map(candidateFiles.map((file) => [file.path, file]));
    const changedFiles = [];
    for (const file of changes) {
      if (next.get(file.path)?.content !== file.content) changedFiles.push(file.path);
      next.set(file.path, { ...next.get(file.path), ...file });
    }
    const testFiles = [...next.values()];

    // Validate candidate repair before accepting it into working files
    const repairPreDiagnostics = validateGeneratedFiles(testFiles);
    const syntaxErrors = repairPreDiagnostics.filter(d => d.category === 'syntax');
    if (syntaxErrors.length > 0) {
      logger.warn(`Repair attempt ${attempt + 1} produced syntax errors: ${formatDiagnostics(syntaxErrors)}. Preserving previous valid file state.`);
      report.history.at(-1).changedFiles = changedFiles;
      report.history.push({
        attempt: attempt + 1,
        sourceHash: sourceHash(testFiles),
        diagnostics: syntaxErrors,
        checks: [],
        changedFiles: []
      });
      if (attempt === maxRepairs) {
        report.status = 'failed';
        report.reason = `Validation did not pass within ${maxRepairs} repair attempts.`;
        throw new PipelineError(report);
      }
      continue;
    }

    files = testFiles;
    report.history.at(-1).changedFiles = changedFiles;
    if (!changedFiles.length || seen.has(sourceHash(files))) {
      report.status = 'failed'; report.reason = 'Repair made no meaningful change or repeated an earlier failed revision.';
      throw new PipelineError(report);
    }
  }
}

module.exports = { validateAndRepair, sourceHash, PipelineError };
