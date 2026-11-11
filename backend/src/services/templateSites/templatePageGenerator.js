/**
 * Regenerates ONE page of a template site from a user instruction. It never writes anything: it returns the new complete file list
 * (and what changed) once the result has passed every check, or throws a PageGenerationError with the exact problems. The caller
 * (the job) decides whether to save, so a failed regeneration can never overwrite the working page.
 *
 * Flow: scope (what this page may touch) -> model -> apply only in-scope operations -> download images -> static checks
 *       -> (problems? targeted repair, up to N rounds) -> production build + browser test of every route (scoped repair) -> final checks.
 */
const aiProtocol = require('../ai/aiProtocol');
const generationPipeline = require('../ai/generationPipeline');
const { buildPageMessages } = require('./templatePromptBuilder');
const validation = require('./templateValidationService');
const semantic = require('./templateSemanticValidator');
const store = require('./siteFileStore');
const logger = require('../../utils/logger');

class PageGenerationError extends Error {
  constructor(message, { code = 'PAGE_GENERATION_FAILED', issues = [], report = null } = {}) {
    super(message);
    this.name = 'PageGenerationError';
    this.code = code;
    this.issues = issues;
    this.report = report;
  }
}

const REPAIR_ROUNDS = () => { const n = Number.parseInt(process.env.TEMPLATE_REPAIR_ROUNDS, 10); return Number.isFinite(n) && n >= 0 ? n : 3; };

/* ------------------------------------------------ default dependencies (replaced in tests) ------------------------------------------------ */

function defaultCallModel() {
  const openrouterService = require('../ai/openrouterService');
  const jobManager = require('../ai/jobManager');
  const model = process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const options = {
      model, temperature: 0.2, max_tokens: Number.parseInt(process.env.TEMPLATE_PAGE_MAX_TOKENS, 10) || 16000,
      timeout: Number.parseInt(process.env.OPENROUTER_GENERATION_TIMEOUT_MS, 10) || 300000,
      reasoning: { effort: 'low', exclude: true }, tools: [aiProtocol.FILE_OPERATIONS_TOOL],
      tool_choice: { type: 'function', function: { name: aiProtocol.FILE_OPERATIONS_TOOL.function.name } }
    };
    const first = await jobManager.withTransientRetry(() => openrouterService.generateCompletion(messages, options), { signal, retryTimeouts: false });
    return jobManager.completeOpenRouterResponse(messages, first, { model, structured: true, continuationInstruction: 'Continue the interrupted file-operation arguments exactly where they stopped. Complete all files and close the structured response.' });
  };
}

async function defaultLocalizeImages(baseline, candidate, changedPaths, signal) {
  const localizer = require('../ai/remoteImageLocalizer');
  const result = await localizer.localizeIntroducedRemoteImages({ beforeFiles: baseline, files: candidate.map((file) => ({ ...file })), changedPaths, signal });
  return { files: result.files, failed: result.failed || [], added: result.added || [] };
}

async function defaultDiscoverImages(instruction, { signal }) {
  if (!/\b(image|photo|picture|portrait|logo|headshot|gallery|banner)s?\b/i.test(instruction)) return null;
  const entityImages = require('../ai/entityImages');
  const openrouterService = require('../ai/openrouterService');
  const canAsk = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key';
  const found = await entityImages.discoverEntityImages({
    prompt: instruction, signal,
    ask: canAsk ? async (system, user) => (await openrouterService.generateCompletion([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0, max_tokens: 600, response_format: false, reasoning: { effort: 'minimal', exclude: true } }))?.content || '' : null
  });
  return found.assets.length || found.missing.length ? { ...found, block: entityImages.buildPromptBlock(found) } : null;
}

/* ------------------------------------------------ applying a model answer inside the scope ------------------------------------------------ */

/**
 * Parses an answer and applies the operations that are inside the scope. Returns the new files, the paths that changed and the
 * operations that were dropped (with reasons). Throws when nothing usable remains.
 */
function applyAnswer(files, response, scope, page) {
  const parsed = aiProtocol.parseAIResponse(response, page.componentPath);
  const normalized = [];
  const dropped = [];
  for (const op of parsed.files || []) {
    try { normalized.push({ ...op, path: aiProtocol.validatePath(op.path) }); }
    catch (error) { dropped.push({ path: op.path, operation: op.operation, reason: error.message }); }
  }
  const { allowed, dropped: outOfScope } = validation.filterOperations(normalized, scope);
  dropped.push(...outOfScope);
  if (!allowed.length) throw new PageGenerationError(`None of the model's changes were inside this page${dropped.length ? ` (${dropped.slice(0, 3).map((item) => `${item.path}: ${item.reason}`).join('; ')})` : ''}.`, { code: 'NO_USABLE_CHANGES', issues: dropped.map((item) => validation.issue('scope', `${item.path}: ${item.reason}`, { path: item.path, action: 'Change only this page\'s files.' })) });
  const checked = aiProtocol.validateFileOperations({ ...parsed, files: allowed }, files);
  const applied = aiProtocol.applyOperationsSafely(files, checked.files);
  return { files: applied.files, changedPaths: applied.changedFiles, dropped, usage: response.usage || null };
}

const sumUsage = (total, usage) => {
  if (!usage) return total;
  const tokens = Number(usage.total_tokens ?? usage.totalTokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))) || 0;
  return { totalTokens: (total?.totalTokens || 0) + tokens, calls: (total?.calls || 0) + 1 };
};

const describe = (problems) => problems.map((item) => `[${item.stage}] ${item.message}${item.action ? ` -> ${item.action}` : ''}`);

/* ------------------------------------------------ the regeneration ------------------------------------------------ */

/**
 * @param {object} p
 * @param {object} p.template  resolved template
 * @param {object} p.page      TemplatePage (or plain object with _id, name, route, description, componentPath)
 * @param {Array}  p.pages     all pages of the site
 * @param {Array}  p.files     the site's current files (hydrated)
 * @param {string} p.instruction
 * @param {object} [p.deps]    { callModel, localizeImages, discoverImages, buildGate }
 * @param {function} [p.onState] (state, detail) => void   states: generating, validating, repairing
 */
async function regeneratePage({ template, page, pages, files, instruction, attachments = [], deps = {}, signal, onState = () => {}, repairRounds = REPAIR_ROUNDS(), siteContext = null }) {
  const callModel = deps.callModel || defaultCallModel();
  const localizeImages = deps.localizeImages || defaultLocalizeImages;
  const discoverImages = deps.discoverImages === undefined ? defaultDiscoverImages : deps.discoverImages;
  const buildGate = deps.buildGate === undefined ? validation.runBuildGate : deps.buildGate;
  const text = String(instruction || '').trim();
  if (!text) throw new PageGenerationError('Describe the change you want for this page.', { code: 'EMPTY_INSTRUCTION' });

  const baseline = files;
  const scope = validation.pageScope({ files, page, pages, template });
  const get = (path) => files.find((file) => file.path === path);
  if (!get(page.componentPath)) throw new PageGenerationError(`The page file ${page.componentPath} is missing from the site.`, { code: 'PAGE_FILE_MISSING' });
  const ownedFiles = scope.ownedList.map(get).filter(Boolean);
  const sharedFiles = scope.sharedList.map(get).filter(Boolean);
  const otherPages = pages.filter((item) => String(item._id) !== String(page._id)).map((item) => ({ name: item.name, route: item.route, description: item.description }));

  let usage = null;
  let entity = null;
  try { entity = await discoverImages?.(text, { signal }); } catch (error) { if (signal?.aborted) throw error; logger.warn(`Image search for the page instruction was skipped: ${error.message}`); }

  const promptFor = (repair, current = files) => buildPageMessages({
    template, page, otherPages, instruction: text, ownedFiles: scope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles,
    entityBlock: entity?.block || '', attachments, repair, siteContext
  });

  /* ---- generate, check, repair (static stages) ---- */
  let candidate = null;
  let changedPaths = [];
  let repair = null;
  let problems = [];
  let dropped = [];
  let reviewNotes = [];
  let attempts = 0;
  for (let round = 0; round <= repairRounds; round += 1) {
    signal?.throwIfAborted();
    onState(round === 0 ? 'generating' : 'repairing', round === 0 ? 'Writing the page' : `Fixing ${problems.length} problem(s), attempt ${round}`);
    attempts += 1;
    let applied;
    try {
      const response = await callModel(promptFor(repair, candidate || files), { signal });
      usage = sumUsage(usage, response.usage);
      applied = applyAnswer(candidate || files, response, scope, page);
    } catch (error) {
      if (signal?.aborted || error?.permanent || error?.name === 'OpenRouterAuthError' || /OPENROUTER_(AUTH|INSUFFICIENT|RATE)/.test(error?.code || '') || error instanceof PageGenerationError && error.code === 'EMPTY_INSTRUCTION') throw error;
      problems = error instanceof PageGenerationError ? error.issues : [validation.issue('code', `The answer could not be applied: ${error.message}`, { cause: 'The response was malformed or cut off.', action: 'Return complete, valid file operations.' })];
      if (!problems.length) problems = [validation.issue('code', error.message, { action: 'Return valid file operations.' })];
      repair = { diagnostics: describe(problems), candidate: candidate ? scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean) : null };
      if (round === repairRounds) throw new PageGenerationError(`The page could not be generated: ${error.message}`, { code: error instanceof PageGenerationError ? error.code : 'MODEL_ANSWER_UNUSABLE', issues: problems });
      continue;
    }
    dropped = dropped.concat(applied.dropped);
    // Pictures the page now links to are downloaded into the site; a dead link is recovered from the verified spares or reported.
    let working = applied.files;
    let localized = await localizeImages(baseline, working, applied.changedPaths, signal);
    working = localized.files;
    let failed = localized.failed;
    if (failed.length && entity?.assets?.length) {
      const spare = entity.assets.filter((asset) => !working.some((file) => textOfFile(file).includes(asset.url)));
      let recovered = working;
      failed.forEach((item, index) => {
        const replacement = spare[index];
        if (!replacement) return;
        recovered = recovered.map((file) => (textOfFile(file).includes(item.url) ? { ...file, content: file.content.split(item.url).join(replacement.url) } : file));
      });
      if (recovered !== working) {
        localized = await localizeImages(baseline, recovered, applied.changedPaths, signal);
        working = localized.files;
        failed = localized.failed;
      }
    }
    // What really changed (a file the model returned unchanged is not a change).
    changedPaths = store.diffFiles(baseline, working).changed.map((item) => item.path);
    candidate = working;
    problems = validation.checkCandidate({ baseline, candidate, scope, page, pages, template, changedPaths, attachments })
      .concat(validation.imageProblems(failed, (entity?.assets || []).filter((asset) => !working.some((file) => textOfFile(file).includes(asset.url)))));
    // Right content for THIS website: only once the page is otherwise sound (it is the costly check), and only when the site has a plan.
    if (siteContext?.plan && !problems.length) {
      const reviewed = await semantic.semanticProblems({ plan: siteContext.plan, page, files: candidate, scope, brief: siteContext.brief, deps, signal });
      usage = sumUsage(usage, reviewed.usage);
      problems = problems.concat(reviewed.problems);
    }
    if (!changedPaths.some((path) => scope.owned.has(path))) problems.push(validation.issue('website', 'The instruction produced no change to the page.', { path: page.componentPath, route: page.route, cause: 'The model returned the page unchanged.', action: 'Apply the user instruction to the page for real.' }));
    if (!problems.length) break;
    // Remarks from the relevance reviewer are advice, not a reason to throw the page away: one correction is tried, then the page is kept and flagged for review.
    if (problems.every((item) => item.stage === 'semantic-review') && (round >= 1 || round === repairRounds)) { reviewNotes = problems; break; }
    repair = { diagnostics: describe(problems), candidate: scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean) };
    if (round === repairRounds) throw new PageGenerationError(`The new version of the ${page.name} page did not pass validation after ${attempts} attempt(s): ${problems.slice(0, 3).map((item) => item.message).join(' | ')}`, { code: 'PAGE_VALIDATION_FAILED', issues: problems });
  }

  /* ---- production build + every route in the browser, with page-scoped repairs ---- */
  let report = { status: 'passed', validationMode: 'static-only', checks: [] };
  let finalFiles = candidate;
  if (buildGate) {
    onState('validating', 'Building the site and testing every page');
    const routes = [...new Set(['/', ...pages.map((item) => item.route)])];
    const gateRepair = async (current, diagnostics) => {
      onState('repairing', 'Fixing a build or browser error');
      const gateScope = validation.pageScope({ files: current, page, pages, template });
      const gateRepairPrompt = buildPageMessages({
        template, page, otherPages, instruction: text, ownedFiles: gateScope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles,
        entityBlock: '', attachments, repair: { diagnostics: [generationPipeline.formatDiagnostics(diagnostics)], candidate: null }, siteContext
      });
      const response = await callModel(gateRepairPrompt, { signal });
      usage = sumUsage(usage, response.usage);
      const result = applyAnswer(current, response, gateScope, page);
      const changed = result.changedPaths.map((path) => result.files.find((file) => file.path === path)).filter(Boolean);
      return changed;
    };
    let gated;
    try { gated = await buildGate(candidate, { routes, signal, repair: gateRepair, onProgress: (state) => onState('validating', state?.stage || 'validating') }); }
    catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      const reason = error?.report?.reason || error.message;
      throw new PageGenerationError(`The new version of the ${page.name} page failed the build or browser test: ${reason}`, { code: 'BUILD_VALIDATION_FAILED', report: error?.report || null, issues: (error?.report?.history?.at(-1)?.diagnostics || []).slice(0, 6).map((item) => validation.issue('code', `${item.path || ''} ${String(item.message || '').slice(0, 200)}`.trim(), { path: item.path })) });
    }
    report = gated.report;
    // The gate's own deterministic fixes may only add what the page needs; anything else outside the page is put back.
    // The lockfile is a build artifact regenerated by the gate; it is never part of a page change.
    const baselineLock = baseline.find((file) => file.path === 'package-lock.json');
    finalFiles = gated.files.filter((file) => file.path !== 'package-lock.json' || baselineLock).map((file) => {
      if (file.path === 'package-lock.json') return baselineLock;
      const original = candidate.find((item) => item.path === file.path);
      if (!original || original.content === file.content || scope.owned.has(file.path) || file.path === 'package.json') return file;
      return original;
    });
    for (const original of candidate) if (!finalFiles.some((file) => file.path === original.path)) finalFiles = [...finalFiles, original];
    const finalChanged = store.diffFiles(baseline, finalFiles).changed.map((item) => item.path);
    const finalProblems = validation.checkCandidate({ baseline, candidate: finalFiles, scope, page, pages, template, changedPaths: finalChanged });
    if (finalProblems.length) throw new PageGenerationError(`The validated version of the ${page.name} page failed the final checks: ${finalProblems[0].message}`, { code: 'FINAL_CHECK_FAILED', issues: finalProblems, report });
    changedPaths = finalChanged;
  }

  const diff = store.diffFiles(baseline, finalFiles);
  return { files: finalFiles, changed: diff.changed, previous: diff.previous, changedPaths: diff.changed.map((item) => item.path), report, usage, attempts, dropped, reviewNotes, entity: entity ? { found: [...new Set(entity.assets.map((asset) => asset.entity))], missing: entity.missing.map((item) => item.name) } : null };
}

const textOfFile = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');

module.exports = { regeneratePage, PageGenerationError, applyAnswer, defaultCallModel, sumUsage };
