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
const { buildPageMessages, OWNED_FILE_LIMIT } = require('./templatePromptBuilder');
const validation = require('./templateValidationService');
const semantic = require('./templateSemanticValidator');
const store = require('./siteFileStore');
const logger = require('../../utils/logger');

class PageGenerationError extends Error {
  constructor(message, { code = 'PAGE_GENERATION_FAILED', issues = [], report = null, repeated = false } = {}) {
    super(message);
    this.name = 'PageGenerationError';
    this.code = code;
    this.issues = issues;
    this.report = report;
    this.repeated = repeated;
  }
}

/**
 * The incremental editor's free, deterministic fixes (validationGate runs them before every check): import path case and extensions,
 * missing exports, stray text in code. Here they run on the model's answer before the page checks, so a small slip costs no paid repair
 * round. Only fixes inside what this page may change (its files and the files the change created) are kept; nothing else is touched.
 */
function freeFixes(files, baseline, scope, page) {
  try {
    const fixed = require('../ai/autoFix').autoFix(files, { stubMissing: false });
    if (!fixed.fixes.length) return files;
    const known = new Set(baseline.map((file) => file.path));
    const mayChange = (path) => scope.owned.has(path) || (!known.has(path) && /^src\/(?:components|data)\//.test(path));
    const byPath = new Map(fixed.files.map((file) => [file.path, file]));
    let kept = 0;
    const out = files.map((file) => {
      const next = byPath.get(file.path);
      if (!next || next.content === file.content || !mayChange(file.path)) return file;
      kept += 1;
      return { ...file, content: next.content };
    });
    if (kept) logger.info(`The ${page.name} page: ${kept} file(s) corrected without the model (${fixed.fixes.filter((item) => mayChange(String(item).split(':')[0])).slice(0, 4).join(' | ')})`);
    return out;
  } catch (error) {
    logger.warn(`Free fixes were skipped for the ${page.name} page: ${error.message}`);
    return files;
  }
}

const signatureOf = (item) => require('../ai/validationGate').diagnosticSignature([item]);
const summarize = (diagnostics = []) => diagnostics.slice(0, 2).map((item) => `${item.path || ''}${item.line ? `:${item.line}` : ''} ${String(item.message || '').replace(/\s+/g, ' ').slice(0, 140)}`.trim()).join(' | ') || 'unknown error';

// The build errors of a site as it was before a change, by source hash (the same site is not built again for every try of a job).
// Kept per build checker (the real gate, or a test's), then by source hash and routes.
const baselineCaches = new WeakMap();
const BASELINE_CACHE_MS = 30 * 60 * 1000;
async function baselineFailures(baseline, { buildGate, routes, signal }) {
  if (!baselineCaches.has(buildGate)) baselineCaches.set(buildGate, new Map());
  const baselineCache = baselineCaches.get(buildGate);
  const key = `${require('../ai/validationGate').sourceHash(baseline)}|${routes.join(',')}`;
  const cached = baselineCache.get(key);
  if (cached && Date.now() - cached.at < BASELINE_CACHE_MS) return cached.diagnostics;
  let diagnostics = [];
  try { await buildGate(baseline, { routes, extraTests: [], signal, maxRepairs: 0 }); }
  catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    if (error?.report?.failureKind === 'infrastructure' || error?.report?.failureKind === 'timeout') throw error;
    diagnostics = error?.report?.history?.at(-1)?.diagnostics || [];
  }
  baselineCache.set(key, { at: Date.now(), diagnostics });
  for (const [entry, value] of baselineCache) if (Date.now() - value.at >= BASELINE_CACHE_MS) baselineCache.delete(entry);
  return diagnostics;
}

// Answers a build repair may take before the repair gives up (the first may patch, the next must return complete files).
const GATE_REPAIR_TRIES = 3;
// Repairs in a row that may end in exactly the same problem before the repairs stop (the 3rd identical answer ends the loop).
const MAX_SAME_PROBLEM = 2;
// Problems judged by a model (relevance review, intent review) are worded differently every time: only deterministic ones are compared.
const JUDGED_STAGES = new Set(['semantic-review', 'intent']);
/** The identity of a set of deterministic problems (stage, file and message), '' when there are none. */
function problemSignature(problems = []) {
  return (problems || []).filter((item) => item && !JUDGED_STAGES.has(item.stage)).map((item) => `${item.stage}|${item.path || ''}|${String(item.message || '').replace(/\s+/g, ' ').trim()}`).sort().join('\n');
}

const reasoningEffort = () => { const value = String(process.env.TEMPLATE_REASONING_EFFORT || 'medium').trim().toLowerCase(); return ['minimal', 'low', 'medium', 'high'].includes(value) ? value : 'medium'; };
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
      // The page writer thinks before it answers (TEMPLATE_REASONING_EFFORT: minimal, low, medium or high; medium by default).
      reasoning: { effort: reasoningEffort(), exclude: true }, tools: [aiProtocol.FILE_OPERATIONS_TOOL],
      tool_choice: { type: 'function', function: { name: aiProtocol.FILE_OPERATIONS_TOOL.function.name } },
      // Cancelling the job (or its time limit) stops the call in flight instead of paying for a page nobody will see.
      ...(signal ? { signal } : {})
    };
    const first = await jobManager.withTransientRetry(() => openrouterService.generateCompletion(messages, options), { signal, retryTimeouts: false });
    return jobManager.completeOpenRouterResponse(messages, first, { model, structured: true, signal, continuationInstruction: 'Continue the interrupted file-operation arguments exactly where they stopped. Complete all files and close the structured response.' });
  };
}

// The same writer, asked for plain <FILE>/<PATCH> delimiters instead of a tool call (the incremental editor's fallback format).
function defaultCallText(mode = 'edit') {
  const openrouterService = require('../ai/openrouterService');
  const jobManager = require('../ai/jobManager');
  const model = (mode === 'edit' && process.env.TEMPLATE_EDIT_MODEL) || process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal, maxTokens = 32000 } = {}) => {
    const options = { model, temperature: 0.1, max_tokens: maxTokens, timeout: Number.parseInt(process.env.OPENROUTER_GENERATION_TIMEOUT_MS, 10) || 300000, reasoning: { effort: 'low', exclude: true }, response_format: false, ...(signal ? { signal } : {}) };
    let answer = await jobManager.withTransientRetry(() => openrouterService.generateCompletion(messages, options), { signal, retryTimeouts: false });
    // A cut-off delimiter answer is continued (twice at most), like the incremental editor does.
    for (let more = 0; more < 2 && answer?.finishReason === 'length' && !aiProtocol.hasCompleteStructuredResponse(answer); more += 1) {
      const next = await openrouterService.generateCompletion([...messages, { role: 'assistant', content: String(answer.content || '') }, { role: 'user', content: 'Continue exactly where the interrupted response stopped. Do not repeat earlier text. Output only the remaining delimiter content, close every open FILE, PATCH, SEARCH and REPLACE tag, then stop.' }], { ...options, temperature: 0, max_tokens: 16000 });
      answer = { ...next, content: aiProtocol.appendResponseContinuation(String(answer.content || ''), next?.content) };
    }
    if (answer?.reasoning && answer.content === answer.reasoning) answer = { ...answer, content: '' };
    return answer;
  };
}

/** Is this answer readable as file operations at all (a malformed tool call, an empty or reasoning-only reply is not)? */
function readable(response, componentPath) {
  try { const parsed = aiProtocol.parseAIResponse(response, componentPath); return Boolean(parsed.files?.length); }
  catch { return false; }
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
function applyAnswer(files, response, scope, page, { allowPatch = true, shownLimit = Infinity } = {}) {
  const parsed = aiProtocol.parseAIResponse(response, page.componentPath);
  // After a patch left the markup broken, patches are not accepted any more: the model must return the whole file.
  if (!allowPatch && (parsed.files || []).some((op) => op.operation === 'patch')) throw new PageGenerationError('Patch edits are not accepted any more for this page: return the complete file with operation "modify".', { code: 'PATCH_NOT_ALLOWED', issues: [validation.issue('code', 'Patch edits are not accepted after the last patch broke the markup.', { path: page.componentPath, cause: 'A patch left the JSX unbalanced.', action: 'Return the complete corrected file with operation "modify" and every opening tag closed.' })] });
  const normalized = [];
  const dropped = [];
  for (const op of parsed.files || []) {
    // A file too large to be shown in full cannot be replaced as a whole: the model never saw its end, so "modify" would cut it off.
    const existing = files.find((file) => file.path === op.path);
    if (String(op.operation || 'modify').toLowerCase() === 'modify' && typeof existing?.content === 'string' && existing.content.length > shownLimit) {
      dropped.push({ path: op.path, operation: 'modify', reason: 'the file is too large to be replaced as a whole (only its beginning was shown); change it with exact "patch" edits' });
      continue;
    }
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
  const callText = deps.callText || (deps.callModel ? null : defaultCallText(siteContext?.mode === 'website' ? 'website' : 'edit'));
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
  // The owner ticked sections: whatever the words say, the change is made in those sections. It is never a rewrite of the whole page
  // (that would demand new wording in the sections that must stay as they are) and never a change of the whole website.
  const ticked = isTicked(text);
  if (policy && ticked) policy = { ...policy, rewrite: false, refinement: false, maxKeep: undefined, siteWide: false };
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
  // "Rewrite this page for Saveetha" on a page an earlier change already wrote for it (it was edited before and no longer reads like the
  // template): this is a refinement (keep what fits, change what still speaks about the old subject), not another full replacement of its wording.
  const editedBefore = (history || []).length > 0 || Number(page.currentRevision) > 1;
  if (policy?.rewrite && !policy.refinement && editedBefore && alreadyRewritten(originals, files, page.componentPath, template)) {
    policy = { ...policy, refinement: true, maxKeep: undefined };
    logger.info(`The ${page.name} page was already rewritten away from the template: this rewrite is treated as a refinement.`);
  }
  const sectionPhrases = ticked ? quotedPhrases(text) : [];
  const scope = validation.pageScope({ files, page, pages, template, siteWide, includeSharedContent: Boolean(policy?.rewrite), sectionNames: validation.namedSections(text), sectionPhrases });
  const get = (path) => files.find((file) => file.path === path);
  if (!get(page.componentPath)) throw new PageGenerationError(`The page file ${page.componentPath} is missing from the site.`, { code: 'PAGE_FILE_MISSING' });
  const ownedFiles = scope.ownedList.map(get).filter(Boolean);
  const sharedFiles = scope.sharedList.map(get).filter(Boolean);
  const otherPages = pages.filter((item) => String(item._id) !== String(page._id)).map((item) => ({ name: item.name, route: item.route, description: item.description }));

  let entity = null;
  // Pictures were given for this change (uploaded by the owner, or made for it): no other pictures are searched for on the web.
  try { entity = attachments.length ? null : await discoverImages?.(validation.ownerWords(text), { signal }); } catch (error) { if (signal?.aborted) throw error; logger.warn(`Image search for the page instruction was skipped: ${error.message}`); }

  // The request as an ordered work list made from this page (its sections, the files that show them, the exact texts, the pictures): the
  // writer does and checks every item, and the reviewer judges the change by the same items.
  const workList = (() => { try { return require('./templateWorkList').buildWorkList({ instruction: text, page, files, scope, policy, intent: intentResult?.intent || null, attachments, template, originals }); } catch (error) { logger.warn(`The work list for the ${page.name} page was not made: ${error.message}`); return []; } })();
  if (workList.length) logger.info(`Work list for the ${page.name} page (${workList.length} item(s)): ${workList.map((item) => item.text.slice(0, 60)).join(' | ')}`);
  // Who else reads the files this change may touch (exports, record fields), so the change keeps them working.
  const usageBlock = (() => { try { return require('./templateDataContract').usageNotes(files, scope.ownedList); } catch { return ''; } })();
  // Text edit, section edit, redesign, or a conversion of the page to another kind of website: a conversion rebuilds the page (and the
  // validator also flags old-industry components it leaves imported), the others keep the page's structure.
  const contentAudit = require('./templateContentAudit');
  const changeKind = contentAudit.changeKind({ plan: siteContext?.plan || null, intent: intentResult?.intent || null, policy, ticked, mode: siteContext?.mode });
  const conversion = changeKind === 'conversion';
  const conversionBlock = (() => { if (!conversion) return ''; try { return contentAudit.conversionBlock({ plan: siteContext.plan, page, files, scope, template }); } catch (error) { logger.warn(`The conversion brief for the ${page.name} page was not made: ${error.message}`); return ''; } })();
  if (siteContext?.plan) logger.info(`Change kind for the ${page.name} page: ${changeKind}`);
  const promptFor = (repair, current = files) => buildPageMessages({
    template, page, otherPages, instruction: text, ownedFiles: scope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles, siteWide,
    entityBlock: entity?.block || '', researchBlock: research?.block || '', sectionFiles: scope.sectionFiles || [], attachments, repair, siteContext, intent: intentResult?.intent || null, policy, usageBlock, workList, conversionBlock
  });

  // An answer that cannot be read (a cut-off or malformed tool call, an empty or reasoning-only reply) is asked for again the way the
  // incremental editor does: in the plain <FILE>/<PATCH> format, then with a compact prompt (only this page's own files) and a larger budget.
  const DELIMITER_RETRY = `${aiProtocol.DELIMITER_INSTRUCTIONS}\n\nRETRY REQUIREMENT: your previous answer could not be read as file operations. Answer ONLY with <FILE path="..."> blocks holding COMPLETE files (or <PATCH> blocks whose SEARCH text is copied exactly from the files shown). No explanations, no thinking out loud, no code fences.`;
  // The compact request: only this page's own files, no shared sources, research or usage notes (also the answer to "request too large").
  const compactMessages = (current) => buildPageMessages({ template, page, otherPages: [], instruction: text, ownedFiles: (scope.ownOnly || [page.componentPath]).map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles: [], siteWide, attachments, siteContext, intent: intentResult?.intent || null, policy, workList, conversionBlock, repair: repair ? { ...repair, candidate: null } : null });
  const askUsable = async (messages, current) => {
    let first;
    try { first = await callModel(messages, { signal }); }
    catch (error) {
      // The request was too large for the model: asked once more with the compact request instead of ending the job.
      if (!(error?.contextTooLong || error?.code === 'OPENROUTER_CONTEXT_TOO_LONG') || signal?.aborted) throw error;
      logger.warn(`The request for the ${page.name} page was too large for the model; asking with only the page's own files.`);
      const compact = compactMessages(current);
      return callText ? callText([{ role: 'system', content: `${compact[0].content}\n\n${DELIMITER_RETRY}` }, compact[1]], { signal, maxTokens: 32000 }) : callModel(compact, { signal });
    }
    if (!callText || readable(first, page.componentPath)) return first;
    usage = sumUsage(usage, first.usage);
    logger.warn(`The answer for the ${page.name} page could not be read (finish ${first?.finishReason || 'n/a'}, ${String(first?.content || '').length} chars); asking again in the plain file format.`);
    const second = await callText([{ role: 'system', content: `${messages[0].content}\n\n${DELIMITER_RETRY}` }, messages[1]], { signal });
    if (readable(second, page.componentPath)) return second;
    usage = sumUsage(usage, second.usage);
    logger.warn(`The plain-format answer for the ${page.name} page could not be read either; asking with a compact prompt.`);
    const compact = compactMessages(current);
    return callText([{ role: 'system', content: `${compact[0].content}\n\n${DELIMITER_RETRY}` }, compact[1]], { signal, maxTokens: 32000 });
  };

  /* ---- generate, check, repair (static stages) ---- */
  let candidate = null;
  let changedPaths = [];
  let repair = null;
  let problems = [];
  let dropped = [];
  let reviewNotes = [];
  let attempts = 0;
  let allowPatch = true;
  // The files the next answer is applied to: the last candidate for a repair, or the original files again when the last answer changed
  // what it had to keep (a section that was not ticked, the wording of the rest of the page): patching that answer cannot bring them back.
  let startFrom = files;
  // An independent reviewer compares the changed lines with the owner's words (not in tests that supply their own model, nor when a whole website is written).
  const reviewOn = Boolean(deps.reviewIntent || deps.askIntentModel) || (!deps.callModel && siteContext?.mode !== 'website');
  const keptShare = ({ baseline: before, candidate: after }) => validation.keptShareOwned(before, after, scope.ownOnly ? { ...scope, ownedList: scope.ownOnly } : scope);
  // The sections the owner ticked, and the ones that must stay as they are: the reviewer judges the change in the ticked ones only.
  const focusNames = validation.namedSections(text);
  const lockedNames = ticked ? untickedSectionNames(get(page.componentPath)?.content, text, focusNames) : [];
  // What the reviewer reads as "the page" for a rewrite: the page's own files and what this change touched. Shared records it displays
  // (another page's data, the departments of the site) are judged file by file against the template, not by the reviewer.
  const reviewedPaths = (changed = []) => [...new Set([...(scope.ownOnly || [page.componentPath]), ...changed.filter((path) => scope.owned.has(path))])];
  const review = (args) => (deps.reviewIntent || require('./templateIntentReview').reviewIntent)({ instruction: text, focus: focusNames.join(', '), lockedSections: lockedNames, workList, deps, signal, intent: policy ? intentResult.intent : null, research: research ? { found: research.found, organisation: research.organisation || '', sources: research.sources.map((entry) => entry.url), items: research.items.length } : null, wording: policy?.rewrite ? validation.wordingOf(args.candidate, reviewedPaths(args.changedPaths)) : '', site: policy?.rewrite ? websiteLine(siteContext) : '', refinement: Boolean(policy?.refinement), keptShare: policy && !policy.refinement ? keptShare(args) : null, ...args });
  let verdict = { met: null };
  let lastSignature = '';
  let repeats = 0;
  const autoCorrected = [];
  // What the owner should know about a page that was kept (another page's problem, a check that could not run).
  const notices = [];
  const BROKEN_MARKUP = /syntax error|closing tag|unexpected token|unterminated/i;
  for (let round = 0; round <= repairRounds; round += 1) {
    signal?.throwIfAborted();
    onState(round === 0 ? 'generating' : 'repairing', round === 0 ? 'Writing the page' : `Fixing ${problems.length} problem(s), attempt ${round}`);
    attempts += 1;
    let applied;
    try {
      const response = await timed(round === 0 ? 'write page' : `repair ${round}`, () => askUsable(promptFor(repair, startFrom), startFrom));
      usage = sumUsage(usage, response.usage);
      applied = applyAnswer(startFrom, response, scope, page, { allowPatch, shownLimit: OWNED_FILE_LIMIT });
    } catch (error) {
      if (signal?.aborted || error?.permanent || error?.name === 'OpenRouterAuthError' || /OPENROUTER_(AUTH|INSUFFICIENT|RATE)/.test(error?.code || '') || error instanceof PageGenerationError && error.code === 'EMPTY_INSTRUCTION') throw error;
      problems = error instanceof PageGenerationError ? error.issues : [validation.issue('code', `The answer could not be applied: ${error.message}`, { cause: 'The response was malformed or cut off.', action: 'Return complete, valid file operations.' })];
      if (!problems.length) problems = [validation.issue('code', error.message, { action: 'Return valid file operations.' })];
      repair = { diagnostics: describe(problems), candidate: candidate ? scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean) : null, restart: Boolean(candidate) && startFrom === files };
      if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) allowPatch = false;
      // A patch that leaves the markup unbalanced is not fixed by another patch: ask for the whole file instead.
      if (problems.some((item) => /syntax error|closing tag|unexpected token|unterminated/i.test(String(item.message)))) repair.diagnostics.push('[code] The last answer used patch edits that left the JSX broken. Do NOT use patches this time: return the complete corrected file with operation "modify", with every opening tag closed.');
      if (round === repairRounds) throw new PageGenerationError(`The page could not be generated: ${error.message}`, { code: error instanceof PageGenerationError ? error.code : 'MODEL_ANSWER_UNUSABLE', issues: problems });
      continue;
    }
    dropped = dropped.concat(applied.dropped);
    // Pictures the page now links to are downloaded into the site; a dead link is recovered from the verified spares or reported.
    let working = freeFixes(applied.files, baseline, scope, page);
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
    // A picture link that cannot be downloaded, still there after a repair: like the incremental editor (which drops unsaveable images),
    // the picture becomes the neutral photo placeholder instead of failing the page, and the owner is told which link was dead.
    if (round >= 1 && failed.length && problems.length && problems.every((item) => item.stage === 'asset' && /could not be downloaded/.test(item.message))) {
      const dead = [...new Set(failed.map((item) => item.url).filter(Boolean))];
      // The site's own neutral photo slot when it has one (every converted site does); otherwise the dead <img> is taken out.
      const slot = candidate.some((file) => file.path === 'public/images/slot-1.svg') ? '/images/slot-1.svg' : null;
      const withoutDead = (content) => dead.reduce((text, url) => (slot ? text.split(url).join(slot) : text.replace(new RegExp(`<img\\b[^>]*${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*?/?>\\s*`, 'gi'), '')), content);
      const next = candidate.map((file) => (textOfFile(file) && dead.some((url) => file.content.includes(url)) && changedPaths.includes(file.path) ? { ...file, content: withoutDead(file.content) } : file));
      const nextChanged = store.diffFiles(baseline, next).changed.map((item) => item.path);
      const again = validation.checkCandidate({ baseline, candidate: next, scope, page, pages, template, changedPaths: nextChanged, attachments, instruction: text, siteWide, rewrite: siteContext?.mode === 'website', policy, originalFiles: originals });
      if (!again.length) {
        logger.warn(`The ${page.name} page: ${dead.length} picture link(s) could not be downloaded and were replaced by the photo placeholder.`);
        notices.push(`${dead.length === 1 ? 'A picture link' : `${dead.length} picture links`} could not be downloaded (${dead.slice(0, 2).join(', ')}), ${slot ? "so a neutral photo placeholder is shown instead" : "so that picture was left out"}. Upload a photo to add it.`);
        candidate = next;
        changedPaths = nextChanged;
        problems = [];
      }
    }
    // The owner asked for what was found online: the list on the page must be that list, not a summary of it.
    if (research?.found && research.items.length >= 3 && !problems.length) {
      // What the page shows: its own files and the files the AI created for it (a new data file holding the list is the usual way).
      const known = new Set(baseline.map((file) => file.path));
      // The list must be in the data or the page: written inside a card component it would be repeated on every card.
      const paths = new Set([...(scope.pageFiles || scope.ownedList).filter((path) => scope.owned.has(path)), ...candidate.filter((file) => !known.has(file.path) && /^src\//.test(file.path)).map((file) => file.path)].filter((path) => !/^src\/components\//.test(path)));
      const onPage = [...paths].map((path) => validation.visibleWording((candidate.find((file) => file.path === path) || {}).content)).join('\n');
      const seen = webResearch.coverage(research.items, onPage);
      if (seen.share < 0.7) problems.push(validation.issue('research', `The page shows ${seen.covered} of the ${seen.total} items found online. Missing: ${seen.missing.slice(0, 14).join('; ')}${seen.missing.length > 14 ? '; ...' : ''}.`, { path: page.componentPath, route: page.route, cause: 'Items found online were left out or merged into general ones.', action: `Add one entry for EACH missing item (${seen.missing.length}), with its facts exactly as in WEB RESEARCH. Do not group or summarise items. Keep the entries that are already there.` }));
    }
    // Right content for THIS website: only once the page is otherwise sound (it is the costly check), and only when the site has a plan.
    // A section the owner ticked or opened is changed in place: the relevance review of the whole page is skipped (it only matters when the page's subject changes).
    if (siteContext?.plan && !problems.length && !/ticked only the section/.test(text)) {
      const reviewed = await timed('content review', () => semantic.semanticProblems({ plan: siteContext.plan, page, files: candidate, scope, brief: siteContext.brief, deps, signal, baseline, conversion }));
      usage = sumUsage(usage, reviewed.usage);
      problems = problems.concat(reviewed.problems);
    }
    // The model had its repair and still left short leftovers of the old website ("See listings" on a card): they are corrected with the
    // website's own vocabulary, without another model call, and EVERY check runs again on the corrected files. A correction that would
    // bring any other problem is thrown away.
    if (siteContext?.plan && round >= 1 && problems.length && problems.every((item) => item.leaks?.length)) {
      const fixed = contentAudit.rewordLeaks(candidate, problems, siteContext.plan);
      if (fixed.changes.length) {
        const fixedChanged = store.diffFiles(baseline, fixed.files).changed.map((item) => item.path);
        let again = validation.checkCandidate({ baseline, candidate: fixed.files, scope, page, pages, template, changedPaths: fixedChanged, attachments, instruction: text, siteWide, rewrite: siteContext?.mode === 'website', policy, originalFiles: originals });
        if (!again.length) {
          const reviewedAgain = await timed('content review', () => semantic.semanticProblems({ plan: siteContext.plan, page, files: fixed.files, scope, brief: siteContext.brief, deps, signal, baseline, conversion }));
          usage = sumUsage(usage, reviewedAgain.usage);
          again = reviewedAgain.problems;
        }
        if (again.every((item) => item.leaks?.length || item.stage === 'semantic-review')) {
          logger.info(`The ${page.name} page: corrected ${fixed.changes.length} leftover(s) of the old website without the model: ${fixed.changes.map((item) => `${item.path}:${item.line}`).join(', ')}`);
          autoCorrected.push(...fixed.changes);
          candidate = fixed.files;
          changedPaths = fixedChanged;
          problems = again;
        }
      }
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
    const restart = problems.some((item) => item.stage === 'preserve');
    // The same deterministic problem after a repair: the repair did not touch the code that causes it. The next repair is told so (with the
    // file and text), and after the third identical answer the loop stops instead of paying for repairs that keep failing the same way.
    const signature = problemSignature(problems);
    repeats = signature && signature === lastSignature ? repeats + 1 : 0;
    lastSignature = signature;
    repair = { diagnostics: describe(problems), candidate: scope.ownedList.map((path) => candidate.find((file) => file.path === path)).filter(Boolean), restart };
    startFrom = restart ? files : candidate;
    if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) allowPatch = false;
    if (problems.some((item) => BROKEN_MARKUP.test(String(item.message)))) repair.diagnostics.push('[code] The last answer left the JSX broken. Do NOT use patches this time: return the complete corrected file with operation "modify", with every opening tag closed.');
    if (repeats >= 1) repair.diagnostics.push(`[repeat] Your last fix did not change what causes ${problems.length === 1 ? 'this problem' : 'these problems'}: ${[...new Set(problems.map((item) => item.path).filter(Boolean))].join(', ') || page.componentPath} still ${problems.length === 1 ? 'has it' : 'have them'}. Change exactly the file, line and text named above (or stop rendering that component on this page). Do not change anything else.`);
    if (repeats >= MAX_SAME_PROBLEM && round < repairRounds) {
      logger.warn(`The ${page.name} page: the same problem came back after ${repeats} repairs; stopping the repairs. ${problems[0]?.message || ''}`);
      throw new PageGenerationError(`The new version of the ${page.name} page did not pass validation after ${attempts} attempt(s): ${problems.slice(0, 3).map((item) => item.message).join(' | ')}`, { code: 'PAGE_VALIDATION_FAILED', issues: problems, repeated: true });
    }
    if (round === repairRounds) throw new PageGenerationError(problems.every((item) => item.stage === 'intent') ? `The AI could not do what you asked. ${problems.map((item) => item.message.replace(/^The change does not do what was asked: /, '')).join(' ')} Your page is exactly as it was.` : `The new version of the ${page.name} page did not pass validation after ${attempts} attempt(s): ${problems.slice(0, 3).map((item) => item.message).join(' | ')}`, { code: problems.every((item) => item.stage === 'intent') ? 'INTENT_NOT_MET' : 'PAGE_VALIDATION_FAILED', issues: problems });
  }

  /* ---- production build + every route in the browser, with page-scoped repairs ---- */
  let report = { status: 'passed', validationMode: 'static-only', checks: [] };
  let finalFiles = candidate;
  let behavior = { status: 'unavailable', tests: [], reason: 'Behaviour tests were not run.' };
  if (buildGate) {
    const styleOnly = false; // look-only changes are tested too: the exact colour, size or text asked for is asserted
    // A detail page is tested at a record that exists in the NEW records (a sample route whose record is gone would only show "not found").
    const sampleRoute = (item) => { try { return require('./templateDataContract').sampleRoute(candidate, item) || item.route; } catch { return item.route; } };
    const canPlan = (Boolean(deps.planBehaviorTests) || (!deps.callModel && siteContext?.mode !== 'website'));
    if (canPlan) onState('validating', 'Writing browser tests for what you asked');
    const planned = !canPlan ? (styleOnly ? { status: 'not-applicable', tests: [], reason: 'A look-only change (colour, size, wording) has nothing to operate.' } : { status: 'unavailable', tests: [], reason: 'Behaviour tests were not written for this kind of job.' }) : await timed('write browser tests', () => (deps.planBehaviorTests || require('./templateBehaviorTests').planBehaviorTests)({ instruction: text, page, files: candidate, changedPaths, deps, signal, route: sampleRoute(page) }));
    usage = sumUsage(usage, planned.usage);
    behavior = planned;
    onState('validating', 'Building the site and testing every page');
    const routes = [...new Set(['/', ...pages.map(sampleRoute)])];
    const gateRepair = async (current, diagnostics) => {
      // A test that fails on its own selector (it matches several elements) is not fixed by rewriting the page.
      if (validation.strictModeProblem(diagnostics) && validation.behaviourFailureOnly(diagnostics)) return [];
      onState('repairing', 'Fixing a build or browser error');
      const gateScope = validation.pageScope({ files: current, page, pages, template, siteWide, includeSharedContent: Boolean(policy?.rewrite), sectionNames: validation.namedSections(text), sectionPhrases });
      // Like the incremental editor's code repair: an answer that cannot be applied (a patch that does not match, a malformed answer) is
      // asked for again, the second time as complete files, instead of ending the build check.
      const notes = [];
      for (let tryNumber = 1; tryNumber <= GATE_REPAIR_TRIES; tryNumber += 1) {
        const gateRepairPrompt = buildPageMessages({
          template, page, otherPages, instruction: text, ownedFiles: gateScope.ownedList.map((path) => current.find((file) => file.path === path)).filter(Boolean), sharedFiles, siteWide,
          entityBlock: '', attachments, repair: { diagnostics: [generationPipeline.formatDiagnostics(diagnostics), ...notes], candidate: null }, siteContext, intent: intentResult?.intent || null, policy, researchBlock: research?.block || '', usageBlock, workList, conversionBlock
        });
        try {
          const response = await callModel(gateRepairPrompt, { signal });
          usage = sumUsage(usage, response.usage);
          const result = applyAnswer(current, response, gateScope, page, { allowPatch: tryNumber === 1 });
          const fixed = freeFixes(result.files, baseline, gateScope, page);
          return result.changedPaths.map((path) => fixed.find((file) => file.path === path)).filter(Boolean);
        } catch (error) {
          if (signal?.aborted || error?.permanent || error?.name === 'OpenRouterAuthError' || /OPENROUTER_(AUTH|INSUFFICIENT)/.test(error?.code || '') || tryNumber === GATE_REPAIR_TRIES) throw error;
          logger.warn(`Build repair answer for the ${page.name} page could not be used (try ${tryNumber} of ${GATE_REPAIR_TRIES}): ${String(error.message).slice(0, 200)}`);
          notes.push(`[repair] Your last answer could not be applied (${String(error.message).slice(0, 200)}). Return the COMPLETE corrected file(s) with operation "modify"; do not use patches.`);
        }
      }
      return [];
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
      try { gated = await timed('build + browser tests', () => buildGate(candidate, { routes, extraTests: behavior.tests, signal, repair: gateRepair, onProgress: gateProgress(onState) })); }
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
      let machineError = null;
      let machineRetries = 0;
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        try {
          onState('validating', attempt.looser ? 'Retrying the browser test with clearer selectors' : 'Checking the build without the faulty browser test');
          gated = await timed('build + browser tests (recovery)', () => buildGate(candidate, { routes, extraTests: attempt.tests, signal, maxRepairs: 0, onProgress: gateProgress(onState) }));
          behavior = attempt.looser ? { ...behavior, tests: attempt.tests } : { status: 'unavailable', tests: [], reason: 'The automatic browser test for this change was unreliable (its selectors matched several elements), but the page builds and every route opens. Please try the change in the preview.' };
          logger.warn(`The ${page.name} page was accepted: only its generated browser test failed (${attempt.looser ? 'it passed with clearer selectors' : 'it was left out'}).`);
          gateError = null;
          break;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          // The build machine failed during the re-check (a dropped connection of the preview server): the page itself already built and
          // opened, so the machine is given one more chance and then the page is kept on the strength of that earlier run.
          if (environmental(error)) {
            machineError = error;
            if (machineRetries < 1) { machineRetries += 1; await pause(Number(deps.gateRetryMs) >= 0 ? Number(deps.gateRetryMs) : 4000); index -= 1; }
            continue;
          }
          if (!validation.behaviourFailureOnly(diagnosticsOf(error))) { gateError = error; machineError = null; break; }
        }
      }
      if (!gated && machineError && validation.behaviourFailureOnly(diagnosticsOf(gateError))) {
        logger.warn(`The ${page.name} page was accepted without its generated browser test: the build machine could not finish the re-check (${String(machineError?.report?.reason || machineError.message).slice(0, 160)}).`);
        gated = { files: candidate, report: { ...(gateError?.report || {}), status: 'passed', validationMode: 'static-only', stage: 'static', checks: [], infrastructure: String(machineError?.report?.reason || machineError.message).slice(0, 300), verifiedAt: new Date().toISOString() } };
        behavior = { status: 'unavailable', tests: [], reason: 'The page builds and every route opens, but the automatic browser test for this change could not be completed. Please try the change in the preview.' };
        gateError = null;
      }
    }
    // The build check tests EVERY route of the website, but this change may only repair its own page: an error that was already on another
    // page (a crash, a missing picture) can never be fixed here and used to fail every rewrite of this page. Like the incremental editor, a
    // change is judged by what it broke: (1) the check is run for this page (and Home) only; if that passes, the page is verified and the
    // other page's problem is reported. (2) Otherwise the site as it was before the change is checked (once, cached); when every error of
    // the change was already there, the change broke nothing and is kept. An error the change introduced still fails it.
    if (!gated && gateError && !environmental(gateError) && !deps.noPreexistingCheck) {
      const ownRoutes = [...new Set(['/', sampleRoute(page)])];
      const failing = diagnosticsOf(gateError);
      try {
        if (routes.length > ownRoutes.length) {
          onState('validating', 'Checking this page on its own');
          gated = await timed('build + browser tests (this page)', () => buildGate(candidate, { routes: ownRoutes, extraTests: behavior.tests, signal, repair: gateRepair, onProgress: gateProgress(onState) }));
          notices.push(`This page passed every check. Another page of the website has a problem that this change did not cause and could not fix: ${summarize(failing)}`);
          logger.warn(`The ${page.name} page passed on its own routes; the full check failed elsewhere: ${summarize(failing)}`);
          gateError = null;
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
      }
      if (!gated) {
        try {
          const before = await baselineFailures(baseline, { buildGate, routes, signal });
          const known = new Set(before.map(signatureOf));
          const latest = diagnosticsOf(gateError);
          // An error in a file this change wrote, or on this page's own route, is never "already there": the change must fix it.
          const ours = (item) => changedPaths.includes(item.path) || item.path === page.route || item.path === sampleRoute(page);
          if (before.length && latest.length && latest.every((item) => known.has(signatureOf(item)) && !ours(item))) {
            logger.warn(`The ${page.name} page is kept: every build error was already in the site before this change (${summarize(latest)}).`);
            notices.push(`The website already had a problem before this change, so the full build check could not pass: ${summarize(latest)}. This change did not add any new problem.`);
            gated = { files: candidate, report: { ...(gateError?.report || {}), status: 'passed', validationMode: 'static-only', stage: 'static', checks: [], preexisting: latest.slice(0, 6).map((item) => `${item.path || ''} ${String(item.message || '').slice(0, 160)}`.trim()), verifiedAt: new Date().toISOString() } };
            behavior = { status: 'unavailable', tests: [], reason: 'The site had build errors before this change, so the change could only be checked for new problems.' };
            gateError = null;
          }
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          logger.warn(`The site before the change could not be checked: ${error.message}`);
        }
      }
    }
    if (!gated) {
      const error = gateError || environmentError;
      const lastDiagnostics = (error?.report?.history?.at(-1)?.diagnostics || []).slice(0, 4);
      const detail = lastDiagnostics.map((item) => `${item.path || ''}${item.line ? `:${item.line}` : ''} ${String(item.message || '').replace(/\s+/g, ' ').slice(0, 240)}`.trim()).filter(Boolean).join(' | ');
      if (detail) logger.warn(`Build/browser error for the ${page.name} page: ${require('./templateJobLog').cleanDetail(detail, 320)}`);
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
  return { workList, intent: intentEngine.summarize(intentResult, policy), research: require('./templateWebResearch').summarize(research), files: finalFiles, changed: diff.changed, previous: diff.previous, changedPaths: diff.changed.map((item) => item.path), report, usage, attempts, dropped, reviewNotes, autoCorrected, notices, entity: entity ? { found: [...new Set(entity.assets.map((asset) => asset.entity))], missing: entity.missing.map((item) => item.name) } : null };
}

// The build machine reports many small stages, some in parallel ("manifest", "install", "syntax"...): the owner sees a few plain steps
// that only move forward within one run of the checks.
const GATE_STAGES = { static: ['Checking the code', 1], 'plan-schema': ['Checking the code', 1], syntax: ['Checking the code', 1], execution: ['Installing the website\'s packages', 2], manifest: ['Installing the website\'s packages', 2], install: ['Installing the website\'s packages', 2], dependencies: ['Installing the website\'s packages', 2], build: ['Building the website', 3], preview: ['Starting the website', 4], browser: ['Testing every page in a browser', 5], artifacts: ['Finishing the checks', 6], verified: ['Finishing the checks', 6] };
function gateProgress(onState) {
  let rank = 0;
  return (state) => {
    const stage = state?.stage;
    if (stage === 'repair') { rank = 0; return; } // the repair reports itself ("Fixing a build or browser error"); the next run starts again
    const entry = GATE_STAGES[stage];
    if (!entry || entry[1] <= rank) return;
    rank = entry[1];
    onState('validating', entry[0]);
  };
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
  const selectedSections = numbers.length ? numbers.map((n) => sections[n - 1]).filter(Boolean) : ticked ? ticked.split(/",\s*"/).map((name) => name.trim()).filter(Boolean) : [];
  return { page: { name: page.name, route: page.route }, sections, selectedSections, category: siteContext?.plan?.identity?.category || null, otherPages: pages.filter((item) => String(item._id) !== String(page._id)).map((item) => item.name), history };
}

/** What the website is, for the reviewer: from the plan when there is one (never an earlier page's instruction saved as the brief). */
function websiteLine(siteContext) {
  const identity = siteContext?.plan?.identity;
  if (identity) return [`${identity.name || siteContext.name}${identity.organizationType || identity.category ? ` (${[identity.organizationType, identity.category].filter(Boolean).join(', ')})` : ''}`, identity.purpose].filter(Boolean).join(': ').slice(0, 300);
  return [siteContext?.name, validation.ownerWords(siteContext?.brief || '')].filter(Boolean).join(': ').slice(0, 300);
}

/** Does the page's own file no longer read like the template it came from (less than 60% of the template's subject words are left)? */
function alreadyRewritten(originals, files, path, template) {
  const original = originals?.get(path);
  const current = (files.find((file) => file.path === path) || {}).content;
  if (!original || typeof current !== 'string') return false;
  const generic = validation.genericWords(template?.id);
  const before = [...validation.ownedWordSet([{ path, content: original }], { ownedList: [path] })];
  const judged = generic.size && before.filter((word) => !generic.has(word)).length >= 10 ? before.filter((word) => !generic.has(word)) : before;
  if (judged.length < 10) return false;
  const now = validation.ownedWordSet([{ path, content: current }], { ownedList: [path] });
  return judged.filter((word) => now.has(word)).length / judged.length < 0.6;
}

/** Did the owner tick (or name, through the section panel) the sections this change is about? */
const isTicked = (instruction) => validation.isTickedEdit(instruction);

/** The texts the studio quoted from the section the owner is looking at ("SECTION 01 CONTENT: - Heading: "Homes for sale""). */
const quotedPhrases = (instruction) => [...new Set((String(instruction || '').match(/"([^"\n]{10,120})"/g) || []).map((item) => item.slice(1, -1).trim()))];

/** The names of the page's sections that were not ticked (they must stay exactly as they are). */
function untickedSectionNames(source, instruction, tickedNames) {
  let blocks = [];
  try { blocks = require('./templatePageService').sectionBlocks(source || ''); } catch { return []; }
  const numbers = validation.selectedSectionNumbers(instruction);
  const squash = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const tickedSet = new Set(tickedNames.map(squash));
  return [...new Set(blocks.filter((block) => (numbers.length ? !block.numbers.some((n) => numbers.includes(n)) : !tickedSet.has(squash(block.name)))).map((block) => block.name))];
}

const textOfFile = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');

module.exports = { alreadyRewritten, regeneratePage, PageGenerationError, applyAnswer, defaultCallModel, sumUsage, intentContext, brandOf, problemSignature };
