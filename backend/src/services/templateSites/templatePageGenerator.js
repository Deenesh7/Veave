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

// Edits of a page or section (the template studio's AI bars) may use their own model (TEMPLATE_EDIT_MODEL); writing a whole website keeps TEMPLATE_OPENROUTER_MODEL.
function defaultCallModel(mode = 'edit') {
  const openrouterService = require('../ai/openrouterService');
  const jobManager = require('../ai/jobManager');
  const model = (mode === 'edit' && process.env.TEMPLATE_EDIT_MODEL) || process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
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
function applyAnswer(files, response, scope, page, { allowPatch = true } = {}) {
  const parsed = aiProtocol.parseAIResponse(response, page.componentPath);
  // After a patch left the markup broken, patches are not accepted any more: the model must return the whole file.
  if (!allowPatch && (parsed.files || []).some((op) => op.operation === 'patch')) throw new PageGenerationError('Patch edits are not accepted any more for this page: return the complete file with operation "modify".', { code: 'PATCH_NOT_ALLOWED', issues: [validation.issue('code', 'Patch edits are not accepted after the last patch broke the markup.', { path: page.componentPath, cause: 'A patch left the JSX unbalanced.', action: 'Return the complete corrected file with operation "modify" and every opening tag closed.' })] });
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
async function regeneratePage({ template, page, pages, files, instruction, attachments = [], deps = {}, signal, onState = () => {}, onTiming = () => {}, repairRounds = REPAIR_ROUNDS(), siteContext = null, history = [], onIntent = () => {}, onResearch = () => {} }) {
  const callModel = deps.callModel || defaultCallModel(siteContext?.mode === 'website' ? 'website' : 'edit');
  const localizeImages = deps.localizeImages || defaultLocalizeImages;
  const discoverImages = deps.discoverImages === undefined ? defaultDiscoverImages : deps.discoverImages;
  const buildGate = deps.buildGate === undefined ? validation.runBuildGate : deps.buildGate;
  const text = String(instruction || '').trim();
  if (!text) throw new PageGenerationError('Describe the change you want for this page.', { code: 'EMPTY_INSTRUCTION' });

  const baseline = files;
  // How long each slow part takes, reported to the job so it can be seen what is slow.
  const timed = async (label, fn) => { const started = Date.now(); try { return await fn(); } finally { try { onTiming({ label, ms: Date.now() - started }); } catch { /* timing is optional */ } } };
  let usage = null;

  /* ---- understand what the owner means (INTENT_ENGINE=on): one structured reading that every later rule works from ---- */
  const intentEngine = require('../ai/intentUnderstandingService');
  let intentResult = null;
  let policy = null;
  if (intentEngine.enabled(deps)) {
    try {
      intentResult = await timed('understand intent', () => intentEngine.understand({ instruction: text, context: intentContext({ page, pages, files, instruction: text, siteContext, history }), deps, signal }));
      usage = sumUsage(usage, intentResult.usage);
      policy = intentEngine.policyFor(intentResult.intent, { refinement: (history || []).some((item) => item.intent === 'full_rewrite') });
      logger.info(`Intent for the ${page.name} page: ${intentResult.intent.intent} / ${intentResult.intent.scope} (confidence ${intentResult.intent.confidence}, ${intentResult.source}); ${policy ? `keep ${policy.keepRatio === undefined ? 'default' : policy.keepRatio}` : 'no policy (existing rules apply)'}`);
      try { onIntent(intentEngine.summarize(intentResult, policy)); } catch { /* recording is optional */ }
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn(`Intent understanding was skipped: ${error.message}`);
    }
  }
  if (policy?.revert) throw new PageGenerationError('This asks to undo an earlier change. Restore the earlier version from the version history instead; nothing was changed.', { code: 'UNDO_USES_VERSIONS' });
  /* ---- facts from the web, when the owner asks for them ("search online for the programmes and their fees") ---- */
  const webResearch = require('./templateWebResearch');
  let research = null;
  const wantsFacts = webResearch.enabled(deps) && (Boolean(intentResult?.intent.web_research) || require('../ai/intentUnderstandingService').asksForWebResearch(text));
  if (wantsFacts) {
    onState('generating', 'Searching the web for the facts');
    research = await timed('web research', () => webResearch.research({ instruction: text, siteName: siteContext?.name || '', brand: brandOf(files), pageName: page.name, signal, deps }));
    usage = sumUsage(usage, research.usage);
    logger.info(`Web research for the ${page.name} page: ${research.found ? `${research.items.length} item(s) from ${research.sources.length} page(s)` : `nothing found${research.error ? ` (${research.error})` : ''}`}`);
    try { onResearch(webResearch.summarize(research)); } catch { /* recording is optional */ }
  }
  const siteWide = validation.wantsSiteWide(text, files) || Boolean(policy?.siteWide);
  const originals = (() => { try { return new Map(require('../templates/templateService').instantiateFiles(template).map((file) => [file.path, file.content])); } catch { return null; } })();
  const scope = validation.pageScope({ files, page, pages, template, siteWide, includeSharedContent: Boolean(policy?.rewrite), sectionNames: validation.namedSections(text) });
  const get = (path) => files.find((file) => file.path === path);
  if (!get(page.componentPath)) throw new PageGenerationError(`The page file ${page.componentPath} is missing from the site.`, { code: 'PAGE_FILE_MISSING' });
  const ownedFiles = scope.ownedList.map(get).filter(Boolean);
  const sharedFiles = scope.sharedList.map(get).filter(Boolean);
  const otherPages = pages.filter((item) => String(item._id) !== String(page._id)).map((item) => ({ name: item.name, route: item.route, description: item.description }));

  let entity = null;
  try { entity = await discoverImages?.(validation.ownerWords(text), { signal }); } catch (error) { if (signal?.aborted) throw error; logger.warn(`Image search for the page instruction was skipped: ${error.message}`); }

  const promptFor = (repair, current = files) => buildPageMessages({
    template, page, otherPages, instruction: text, ownedFiles: scope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles, siteWide,
    entityBlock: entity?.block || '', researchBlock: research?.block || '', attachments, repair, siteContext, intent: intentResult?.intent || null, policy
  });

  /* ---- generate, check, repair (static stages) ---- */
  let candidate = null;
  let changedPaths = [];
  let repair = null;
  let problems = [];
  let dropped = [];
  let reviewNotes = [];
  let attempts = 0;
  let allowPatch = true;
  // An independent reviewer compares the changed lines with the owner's words (not in tests that supply their own model, nor when a whole website is written).
  const reviewOn = Boolean(deps.reviewIntent || deps.askIntentModel) || (!deps.callModel && siteContext?.mode !== 'website');
  const keptShare = ({ baseline: before, candidate: after }) => validation.keptShareOwned(before, after, scope);
  const review = (args) => (deps.reviewIntent || require('./templateIntentReview').reviewIntent)({ instruction: text, focus: (text.match(/ticked only the section\(s\) "([^"]+)"/) || [])[1] || '', deps, signal, intent: policy ? intentResult.intent : null, research: research ? { found: research.found, organisation: research.organisation || '', sources: research.sources.map((entry) => entry.url), items: research.items.length } : null, wording: policy?.rewrite ? validation.wordingOf(args.candidate, (scope.pageFiles || []).filter((path) => scope.owned.has(path))) : '', site: policy?.rewrite ? [siteContext?.name, siteContext?.brief].filter(Boolean).join(': ').slice(0, 300) : '', refinement: Boolean(policy?.refinement), keptShare: policy && !policy.refinement ? keptShare(args) : null, ...args });
  let verdict = { met: null };
  const BROKEN_MARKUP = /syntax error|closing tag|unexpected token|unterminated/i;
  for (let round = 0; round <= repairRounds; round += 1) {
    signal?.throwIfAborted();
    onState(round === 0 ? 'generating' : 'repairing', round === 0 ? 'Writing the page' : `Fixing ${problems.length} problem(s), attempt ${round}`);
    attempts += 1;
    let applied;
    try {
      const response = await timed(round === 0 ? 'write page' : `repair ${round}`, () => callModel(promptFor(repair, candidate || files), { signal }));
      usage = sumUsage(usage, response.usage);
      applied = applyAnswer(candidate || files, response, scope, page, { allowPatch });
    } catch (error) {
      if (signal?.aborted || error?.permanent || error?.name === 'OpenRouterAuthError' || /OPENROUTER_(AUTH|INSUFFICIENT|RATE)/.test(error?.code || '') || error instanceof PageGenerationError && error.code === 'EMPTY_INSTRUCTION') throw error;
      problems = error instanceof PageGenerationError ? error.issues : [validation.issue('code', `The answer could not be applied: ${error.message}`, { cause: 'The response was malformed or cut off.', action: 'Return complete, valid file operations.' })];
      if (!problems.length) problems = [validation.issue('code', error.message, { action: 'Return valid file operations.' })];
      repair = { diagnostics: describe(problems), candidate: candidate ? scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean) : null };
      if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) allowPatch = false;
      // A patch that leaves the markup unbalanced is not fixed by another patch: ask for the whole file instead.
      if (problems.some((item) => /syntax error|closing tag|unexpected token|unterminated/i.test(String(item.message)))) repair.diagnostics.push('[code] The last answer used patch edits that left the JSX broken. Do NOT use patches this time: return the complete corrected file with operation "modify", with every opening tag closed.');
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
    problems = validation.checkCandidate({ baseline, candidate, scope, page, pages, template, changedPaths, attachments, instruction: text, siteWide, rewrite: siteContext?.mode === 'website', policy, originalFiles: originals })
      .concat(validation.imageProblems(failed, (entity?.assets || []).filter((asset) => !working.some((file) => textOfFile(file).includes(asset.url)))));
    // The owner asked for what was found online: the list on the page must be that list, not a summary of it.
    if (research?.found && research.items.length >= 3 && !problems.length) {
      // What the page shows: its own files and the files the AI created for it (a new data file holding the list is the usual way).
      const known = new Set(baseline.map((file) => file.path));
      const paths = new Set([...(scope.pageFiles || scope.ownedList).filter((path) => scope.owned.has(path)), ...candidate.filter((file) => !known.has(file.path) && /^src\//.test(file.path)).map((file) => file.path)]);
      const onPage = [...paths].map((path) => validation.visibleWording((candidate.find((file) => file.path === path) || {}).content)).join('\n');
      const seen = webResearch.coverage(research.items, onPage);
      if (seen.share < 0.7) problems.push(validation.issue('research', `The page shows ${seen.covered} of the ${seen.total} items found online. Missing: ${seen.missing.slice(0, 14).join('; ')}${seen.missing.length > 14 ? '; ...' : ''}.`, { path: page.componentPath, route: page.route, cause: 'Items found online were left out or merged into general ones.', action: `Add one entry for EACH missing item (${seen.missing.length}), with its facts exactly as in WEB RESEARCH. Do not group or summarise items. Keep the entries that are already there.` }));
    }
    // Right content for THIS website: only once the page is otherwise sound (it is the costly check), and only when the site has a plan.
    // A section the owner ticked or opened is changed in place: the relevance review of the whole page is skipped (it only matters when the page's subject changes).
    if (siteContext?.plan && !problems.length && !/ticked only the section/.test(text)) {
      const reviewed = await timed('content review', () => semantic.semanticProblems({ plan: siteContext.plan, page, files: candidate, scope, brief: siteContext.brief, deps, signal }));
      usage = sumUsage(usage, reviewed.usage);
      problems = problems.concat(reviewed.problems);
    }
    if (reviewOn && !problems.length && changedPaths.some((path) => scope.owned.has(path))) {
      onState('validating', 'Checking the change against your request');
      const judged = await timed('intent review', () => review({ baseline, candidate, changedPaths }));
      usage = sumUsage(usage, judged.usage);
      verdict = judged;
      if (judged.met === false) problems.push(validation.issue('intent', `The change does not do what was asked: ${judged.unmet.join(' ') || 'the requested result is not in the code.'}`, { path: page.componentPath, route: page.route, cause: 'The code was changed, but not in the way the owner described.', action: 'Do exactly what the instruction says, with the exact values it names, in the section it names. Do not substitute something similar.' }));
    }
    if (!changedPaths.some((path) => scope.owned.has(path))) problems.push(validation.issue('website', 'The instruction produced no change to the page.', { path: page.componentPath, route: page.route, cause: 'The model returned the page unchanged.', action: 'Apply the user instruction to the page for real.' }));
    if (!problems.length) break;
    // Remarks from the relevance reviewer are advice, not a reason to throw the page away: one correction is tried, then the page is kept and flagged for review.
    if (problems.every((item) => item.stage === 'semantic-review') && (round >= 1 || round === repairRounds)) { reviewNotes = problems; break; }
    repair = { diagnostics: describe(problems), candidate: scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean) };
    if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) allowPatch = false;
    if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) repair.diagnostics.push('[code] The last answer left the JSX broken. Do NOT use patches this time: return the complete corrected file with operation "modify", with every opening tag closed.');
    if (round === repairRounds) throw new PageGenerationError(problems.every((item) => item.stage === 'intent') ? `The AI could not do what you asked. ${problems.map((item) => item.message.replace(/^The change does not do what was asked: /, '')).join(' ')} Your page is exactly as it was.` : `The new version of the ${page.name} page did not pass validation after ${attempts} attempt(s): ${problems.slice(0, 3).map((item) => item.message).join(' | ')}`, { code: problems.every((item) => item.stage === 'intent') ? 'INTENT_NOT_MET' : 'PAGE_VALIDATION_FAILED', issues: problems });
  }

  /* ---- production build + every route in the browser, with page-scoped repairs ---- */
  let report = { status: 'passed', validationMode: 'static-only', checks: [] };
  let finalFiles = candidate;
  let behavior = { status: 'unavailable', tests: [], reason: 'Behaviour tests were not run.' };
  if (buildGate) {
    const styleOnly = false; // look-only changes are tested too: the exact colour, size or text asked for is asserted
    const canPlan = (Boolean(deps.planBehaviorTests) || (!deps.callModel && siteContext?.mode !== 'website'));
    if (canPlan) onState('validating', 'Writing browser tests for what you asked');
    const planned = !canPlan ? (styleOnly ? { status: 'not-applicable', tests: [], reason: 'A look-only change (colour, size, wording) has nothing to operate.' } : { status: 'unavailable', tests: [], reason: 'Behaviour tests were not written for this kind of job.' }) : await timed('write browser tests', () => (deps.planBehaviorTests || require('./templateBehaviorTests').planBehaviorTests)({ instruction: text, page, files: candidate, changedPaths, deps, signal }));
    usage = sumUsage(usage, planned.usage);
    behavior = planned;
    onState('validating', 'Building the site and testing every page');
    const routes = [...new Set(['/', ...pages.map((item) => item.route)])];
    const gateRepair = async (current, diagnostics) => {
      // A test that fails on its own selector (it matches several elements) is not fixed by rewriting the page.
      if (validation.strictModeProblem(diagnostics) && validation.behaviourFailureOnly(diagnostics)) return [];
      onState('repairing', 'Fixing a build or browser error');
      const gateScope = validation.pageScope({ files: current, page, pages, template, siteWide, includeSharedContent: Boolean(policy?.rewrite), sectionNames: validation.namedSections(text) });
      const gateRepairPrompt = buildPageMessages({
        template, page, otherPages, instruction: text, ownedFiles: gateScope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles, siteWide,
        entityBlock: '', attachments, repair: { diagnostics: [generationPipeline.formatDiagnostics(diagnostics)], candidate: null }, siteContext, intent: intentResult?.intent || null, policy, researchBlock: research?.block || ''
      });
      const response = await callModel(gateRepairPrompt, { signal });
      usage = sumUsage(usage, response.usage);
      const result = applyAnswer(current, response, gateScope, page);
      const changed = result.changedPaths.map((path) => result.files.find((file) => file.path === path)).filter(Boolean);
      return changed;
    };
    let gated;
    // A problem of the build machine (permissions, disk, Docker busy) is not a problem of the page: the build is tried again after a
    // short wait. If the machine still cannot build, the page is accepted on the strength of the static checks it already passed, so the
    // owner is never shown a server error. A real error in the page code still goes to the repair loop and, if it cannot be fixed, fails.
    const environmental = (error) => error?.report?.failureKind === 'infrastructure' || error?.report?.failureKind === 'timeout';
    const pause = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
    let environmentError = null;
    let gateError = null;
    for (let tryNumber = 1; tryNumber <= 3 && !gated; tryNumber += 1) {
      try { gated = await timed('build + browser tests', () => buildGate(candidate, { routes, extraTests: behavior.tests, signal, repair: gateRepair, onProgress: (state) => onState('validating', state?.stage || 'validating') })); }
      catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        if (!environmental(error)) { environmentError = null; gateError = error; break; }
        environmentError = error;
        logger.warn(`The build machine could not validate the ${page.name} page (try ${tryNumber} of 3): ${error?.report?.reason || error.message}`);
        if (tryNumber < 3) { onState('validating', 'Retrying the build check'); await pause(tryNumber * (Number(deps.gateRetryMs) >= 0 ? Number(deps.gateRetryMs) : 4000)); }
      }
    }
    if (!gated && environmentError && !gateError) {
      onState('validating', 'Build check unavailable; using the static checks');
      gated = { files: candidate, report: { status: 'passed', validationMode: 'static-only', stage: 'static', checks: [], infrastructure: String(environmentError?.report?.reason || environmentError.message).slice(0, 300), verifiedAt: new Date().toISOString() } };
    }
    // Only the AI-written behaviour test failed (the page built and every route opened): the test may be the faulty part. Try it again with
    // unambiguous selectors, and if it still fails, keep the page that built and say it could not be verified, instead of failing the job.
    const diagnosticsOf = (failure) => failure?.report?.history?.at(-1)?.diagnostics || [];
    if (!gated && gateError && behavior.tests.length && validation.behaviourFailureOnly(diagnosticsOf(gateError))) {
      const attempts = [];
      if (validation.strictModeProblem(diagnosticsOf(gateError))) attempts.push({ tests: validation.relaxSelectors(behavior.tests), looser: true });
      attempts.push({ tests: [], looser: false });
      for (const attempt of attempts) {
        try {
          onState('validating', attempt.looser ? 'Retrying the browser test with clearer selectors' : 'Checking the build without the faulty browser test');
          gated = await timed('build + browser tests (recovery)', () => buildGate(candidate, { routes, extraTests: attempt.tests, signal, maxRepairs: 0, onProgress: (state) => onState('validating', state?.stage || 'validating') }));
          behavior = attempt.looser ? { ...behavior, tests: attempt.tests } : { status: 'unavailable', tests: [], reason: 'The automatic browser test for this change was unreliable (its selectors matched several elements), but the page builds and every route opens. Please try the change in the preview.' };
          logger.warn(`The ${page.name} page was accepted: only its generated browser test failed (${attempt.looser ? 'it passed with clearer selectors' : 'it was left out'}).`);
          gateError = null;
          break;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          if (!validation.behaviourFailureOnly(diagnosticsOf(error))) { gateError = error; break; }
        }
      }
    }
    if (!gated) {
      const error = gateError || environmentError;
      const lastDiagnostics = (error?.report?.history?.at(-1)?.diagnostics || []).slice(0, 4);
      const detail = lastDiagnostics.map((item) => `${item.path || ''}${item.line ? `:${item.line}` : ''} ${String(item.message || '').replace(/\s+/g, ' ').slice(0, 240)}`.trim()).filter(Boolean).join(' | ');
      if (detail) logger.warn(`Build/browser error for the ${page.name} page: ${detail}`);
      const reason = `${error?.report?.reason || error.message}${detail ? ` Last error: ${detail}` : ''}`;
      throw new PageGenerationError(`The new version of the ${page.name} page failed the build or browser test: ${reason}`, { code: 'BUILD_VALIDATION_FAILED', report: error?.report || null, issues: (error?.report?.history?.at(-1)?.diagnostics || []).slice(0, 6).map((item) => validation.issue('code', `${item.path || ''} ${String(item.message || '').slice(0, 200)}`.trim(), { path: item.path })) });
    }
    report = { ...gated.report, intent: { status: verdict.met === true ? 'met' : 'unchecked' }, functional: { status: behavior.status === 'planned' ? 'verified' : behavior.status === 'not-applicable' ? 'not-applicable' : 'unverified', tests: behavior.tests.map((test) => test.name), reason: behavior.reason || null } };
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
    const finalProblems = validation.checkCandidate({ baseline, candidate: finalFiles, scope, page, pages, template, changedPaths: finalChanged, attachments, instruction: text, siteWide, rewrite: siteContext?.mode === 'website', policy, originalFiles: originals });
    if (finalProblems.length) throw new PageGenerationError(`The validated version of the ${page.name} page failed the final checks: ${finalProblems[0].message}`, { code: 'FINAL_CHECK_FAILED', issues: finalProblems, report });
    changedPaths = finalChanged;
    // The build's own repairs can undo or alter the change: what is left must still be a change, and still what was asked.
    if (!finalChanged.some((path) => scope.owned.has(path))) throw new PageGenerationError('The AI could not make this change work: the build checks removed it again, so nothing was changed. Your page is exactly as it was.', { code: 'NO_EFFECTIVE_CHANGE', report });
    if (reviewOn) {
      onState('validating', 'Checking the final result against your request');
      const finalVerdict = await timed('final intent review', () => review({ baseline, candidate: finalFiles, changedPaths: finalChanged }));
      usage = sumUsage(usage, finalVerdict.usage);
      verdict = finalVerdict;
      if (finalVerdict.met === false) throw new PageGenerationError(`The AI could not do what you asked. ${finalVerdict.unmet.join(' ') || 'The requested result is not in the final page.'} Your page is exactly as it was.`, { code: 'INTENT_NOT_MET', report });
    }
  }

  const diff = store.diffFiles(baseline, finalFiles);
  return { intent: intentEngine.summarize(intentResult, policy), research: require('./templateWebResearch').summarize(research), files: finalFiles, changed: diff.changed, previous: diff.previous, changedPaths: diff.changed.map((item) => item.path), report, usage, attempts, dropped, reviewNotes, entity: entity ? { found: [...new Set(entity.assets.map((asset) => asset.entity))], missing: entity.missing.map((item) => item.name) } : null };
}

/** The name the website itself shows as its brand (src/data/site.js), which tells an abbreviation like "SMC" which organisation it stands for. */
function brandOf(files) {
  const source = ((files || []).find((file) => file.path === 'src/data/site.js') || {}).content || '';
  const match = /\bname\s*:\s*(['"`])([^'"`\n]{2,80})\1/.exec(source);
  return match ? match[2].trim() : '';
}

/** What the intent reading is given: the page, its sections, the selection, the website and the last instructions on this page (never the whole source). */
function intentContext({ page, pages, files, instruction, siteContext, history }) {
  let blocks = [];
  try { blocks = require('./templatePageService').sectionBlocks((files.find((file) => file.path === page.componentPath) || {}).content || ''); } catch { /* sections are optional context */ }
  const sections = blocks.flatMap((block) => block.numbers.map(() => block.name));
  const numbers = validation.selectedSectionNumbers(instruction);
  const ticked = (instruction.match(/ticked only the section\(s\) "([^"]+)"/) || [])[1];
  const selectedSections = numbers.length ? numbers.map((n) => sections[n - 1]).filter(Boolean) : ticked ? ticked.split(/",\s*"|,\s*/).map((name) => name.trim()).filter(Boolean) : [];
  return { page: { name: page.name, route: page.route }, sections, selectedSections, category: siteContext?.plan?.identity?.category || null, otherPages: pages.filter((item) => String(item._id) !== String(page._id)).map((item) => item.name), history };
}

const textOfFile = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');

module.exports = { regeneratePage, PageGenerationError, applyAnswer, defaultCallModel, sumUsage, intentContext };
