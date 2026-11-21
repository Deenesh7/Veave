/**
 * Building a page of an existing clone from the real page: the fill ("add everything that is missing") and the re-clone
 * ("clone this page again") flows, with the focused patch stage they use for colours, fonts and images.
 *
 * Moved out of jobManager unchanged in behaviour. `generateSequentialClonePage` and the text-coverage helpers (`cloneHelpers`) are the cloner's own
 * functions, still in jobManager because the main clone flow uses them too; they are passed to `createRealPageFill`, so this module never imports jobManager.
 */
const openrouterService = require('../openrouterService');
const aiProtocol = require('../aiProtocol');
const generationPipeline = require('../generationPipeline');
const cloneRouteGuarantee = require('../cloneRouteGuarantee');
const fidelityAudit = require('../../clone/fidelityAudit');
const assetManifestLib = require('../../clone/assetManifest');
const { measureCloneFidelity } = require('../../clone/cloneFidelity');
const { inspectRenderedPreview } = require('../targetRenderVerifier');
const { replaceAssetReferences, localizeInternalRouteLinks, validateLocalizedAssetReferences } = require('../../clone/assetLocalizationService');
const { withTransientRetry } = require('../jobSupport/retry');
const { mergeOpenRouterUsage } = require('../jobSupport/usage');
const { completeOpenRouterResponse } = require('../jobSupport/completion');
const { AIResponseValidationError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

// The project file whose source contains this text (used to tell the model WHERE a visible mismatch lives).
function findOwningFile(files, text, cache = new Map()) {
  const key = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 60);
  if (key.length < 6) return null;
  for (const file of files) {
    if (file.encoding === 'base64' || !/\.(?:jsx?|tsx?|html)$/i.test(file.path || '')) continue;
    if (!cache.has(file.path)) cache.set(file.path, String(file.content || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
    if (cache.get(file.path).includes(key)) return file.path;
  }
  return null;
}

/**
 * One focused editing call: the model receives an instruction, the files it may change and measured facts, and answers with
 * patch operations that are validated and applied safely. Returns the new files and the token usage.
 */
async function runPatchStage({ files, instruction, facts, targetPaths, model, signal }) {
  signal?.throwIfAborted();
  const budget = Number.parseInt(process.env.SOURCE_FILL_PATCH_CONTEXT_CHARS, 10) || 220000;
  let used = 0;
  const shown = [];
  for (const filePath of targetPaths) {
    const file = files.find((candidate) => candidate.path === filePath && candidate.encoding !== 'base64');
    if (!file || used + String(file.content || '').length > budget) continue;
    used += String(file.content || '').length;
    shown.push(file);
  }
  const others = files.filter((file) => file.encoding !== 'base64' && !shown.includes(file)).map((file) => file.path);
  const messages = [{
    role: 'system',
    content: `You are a precise front-end engineer correcting an existing React project so it matches a real website. Change ONLY what the instruction asks, with the smallest set of PATCH operations; keep all text, structure, routes, behaviour and unrelated styles exactly as they are. Never use remote URLs; images must use the exact local paths you are given. Copy every SEARCH block verbatim from the supplied files.\n${aiProtocol.DELIMITER_INSTRUCTIONS}`
  }, {
    role: 'user',
    content: `${instruction}\n\nMEASURED FACTS (from the real website and from the rendered project; authoritative):\n${facts}\n\nFILES YOU MAY CHANGE:\n${shown.map((file) => `--- FILE: ${file.path} ---\n${file.content}`).join('\n\n')}\n\nOTHER PROJECT FILES (not shown; do not rewrite): ${others.join(', ')}`
  }];
  let completion = await withTransientRetry(() => openrouterService.generateCompletion(messages, { model, temperature: 0.1, max_tokens: Number.parseInt(process.env.CLONE_PAGE_MAX_TOKENS, 10) || 16000, response_format: false, reasoning: { effort: 'medium', exclude: true } }), { signal });
  completion = await completeOpenRouterResponse(messages, completion, { model, structured: false, maxContinuations: 2, continuationInstruction: 'Continue exactly where the interrupted PATCH operations stopped and close every open tag.' });
  const parsed = aiProtocol.parseAIResponse(completion, null);
  const operations = aiProtocol.validateFileOperations(parsed, files);
  const applied = aiProtocol.applyOperationsSafely(files, operations.files);
  if (!applied.changedFiles.length) throw new AIResponseValidationError('The response contained no changes.');
  return { files: applied.files, changedFiles: applied.changedFiles, usage: completion.usage || null };
}


// True only when a route for this path is really defined in the code (not merely linked to from a menu).
function hasRouteDefinition(files, pagePath) {
  if (pagePath === '/') return true;
  const escaped = pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const definition = new RegExp(`\\bpath\\s*[=:]\\s*\\{?\\s*['"\`]${escaped}/?['"\`]`);
  return files.some((file) => file.encoding !== 'base64' && /\.(?:jsx?|tsx?)$/i.test(file.path) && definition.test(String(file.content || '')));
}

function pageExistsInFiles(files, pagePath, provenance = {}) {
  if (pagePath === '/') return true;
  if ((provenance.routes || []).some((route) => route.path === pagePath)) return true;
  const quoted = new RegExp(`['"\`]${pagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?['"\`]`);
  return files.some((file) => file.encoding !== 'base64' && /\.(?:jsx?|tsx?|json)$/i.test(file.path) && quoted.test(String(file.content || '')));
}

function createRealPageFill({ generateSequentialClonePage, cloneHelpers }) {
  const { measureCloneTextCoverage, classifyCloneAssetSection, simplifyCloneHtml, cloneContentHtml, buildCloneImplementationStages, cloneTextCorpus, measureHtmlCoverage, buildCloneCoverageDiagnostics } = cloneHelpers;
  async function fillMissingFromRealPage({ files, source, provenance, model, signal, onStep = async () => {}, passes, render = null, treatAsNew = false }) {
    const { page, capture } = source;
    const chunkChars = Number.parseInt(process.env.SOURCE_FILL_CHUNK_CHARS, 10) || 60000;
    const maxStages = Number.parseInt(process.env.SOURCE_FILL_MAX_STAGES, 10) || 20;
    const maxRepairPasses = passes || Number.parseInt(process.env.SOURCE_FILL_PASSES, 10) || 6;
    const targetRatio = Number.parseFloat(process.env.SOURCE_FILL_TARGET_COVERAGE) || 0.97;
    const stageMs = Number.parseInt(process.env.SOURCE_FILL_PASS_MS, 10) || 240000;
    const assets = capture.assets || [];
    const routeManifest = [
      ...(provenance.routes || []).map(({ path: routePath, title }) => ({ path: routePath, title, description: '', pageType: 'page' })),
      ...((provenance.routes || []).some((route) => route.path === page.path) ? [] : [{ path: page.path, title: page.title, description: page.description, pageType: page.pageType }])
    ];
    // The generator references assets by their local public path, so their files must exist while it works.
    const assetFiles = assets
      .filter((asset) => asset.localPath && asset.content)
      .map((asset) => ({ path: asset.localPath, content: asset.content, language: 'binary', encoding: 'base64' }));
    const present = new Set(files.map((file) => file.path));
    let working = [...files, ...assetFiles.filter((file) => !present.has(file.path))];
    const routeShot = capture.screenshots?.routes?.find((reference) => reference.path === page.path)?.dataUrl || capture.screenshots?.desktop || null;
    const mobileShot = page.path === '/' ? (capture.screenshots?.mobile || null) : null;

    const exists = treatAsNew ? false : pageExistsInFiles(working, page.path, provenance);
    const before = measureCloneTextCoverage(page, working);
    let coverage = before;
    let usage = null;
    const report = { pagePath: page.path, createdPage: !exists, before: { total: before.total, missing: before.missing.length }, stages: [], passes: [] };

    const sectionsOf = (kinds) => (page.extraction?.htmlSections || []).filter((section) => kinds.includes(classifyCloneAssetSection(section, page)));
    // The captured section list is truncated and nested; the full page markup is the complete, ordered source.
    const contentSource = simplifyCloneHtml(page.extraction?.html || cloneContentHtml(page), { keepClass: true });
    const parts = Math.min(24, Math.max(1, Math.ceil(contentSource.length / chunkChars)));
    const boundary = (target) => { const at = contentSource.indexOf('<', target); return at < 0 ? contentSource.length : at; };
    const partHtml = (index) => {
      const size = Math.ceil(contentSource.length / parts);
      return contentSource.slice(index === 0 ? 0 : boundary(size * index), index === parts - 1 ? contentSource.length : boundary(size * (index + 1)));
    };

    // Plan the stages. New page: top, every content part, footer. Existing page: only the parts with missing text.
    let plan;
    if (!exists) {
      plan = buildCloneImplementationStages([page]).map((stage) => ({ phase: stage.phase, contentChunk: stage.contentChunk, html: stage.contentChunk ? partHtml(stage.contentChunk.index) : null }));
    } else {
      const corpus = cloneTextCorpus(working);
      const topMissing = measureHtmlCoverage(sectionsOf(['header', 'hero']).map((section) => section.html).join('\n'), working, corpus).missing;
      const footerMissing = measureHtmlCoverage(sectionsOf(['footer']).map((section) => section.html).join('\n'), working, corpus).missing;
      plan = [];
      if (parts === 1) {
        // A short page is handled whole, from its complete markup, in a single stage.
        if (before.missing.length) plan.push({ phase: 'page', missing: before.missing });
      } else {
      if (topMissing.length) plan.push({ phase: 'top', missing: topMissing });
      for (let index = 0; index < parts; index += 1) {
        const html = partHtml(index);
        const missing = measureHtmlCoverage(html, working, corpus).missing;
        if (missing.length) plan.push({ phase: 'content', contentChunk: { index, total: parts }, html, missing });
      }
      if (footerMissing.length) plan.push({ phase: 'footer', missing: footerMissing });
      }
    }
    if (plan.length > maxStages) {
      report.skippedStages = plan.length - maxStages;
      plan = plan.slice(0, maxStages);
    }

    // Runs one model stage and keeps its result only when it is valid and does not make the page's coverage worse.
    const attempt = async (stage, label, extra = {}) => {
      signal?.throwIfAborted();
      await onStep(label);
      const note = stage.missing?.length
        ? `Implement ONLY the elements below that are missing from the project (and the images that belong to them), in the same order as the real markup, using the real classes and measured styles. Do not duplicate content that already exists. Missing text blocks of this part:\n${stage.missing.slice(0, 60).map((block) => `- ${block.text.slice(0, 220)}`).join('\n')}${extra.failure ? `\nThe previous attempt was rejected: ${extra.failure}` : ''}`
        : (extra.failure ? `The previous attempt was rejected: ${extra.failure}` : '');
      const generated = await generateSequentialClonePage({
        files: working,
        page: { ...page, fillMode: true, fillNote: note, ...(stage.contentChunk && parts > 1 ? { contentChunk: stage.contentChunk } : {}), ...extra.pageOverrides },
        phase: stage.phase,
        routeManifest,
        siteMap: capture.siteMap || provenance.siteMap || [],
        assets,
        routeScreenshot: stage.phase === 'top' || stage.phase === 'page' || (stage.contentChunk?.index === 0) ? routeShot : null,
        mobileScreenshot: stage.phase === 'top' ? mobileShot : null,
        model,
        signal,
        deadlineAt: Date.now() + stageMs
      });
      usage = mergeOpenRouterUsage(usage, generated.usage, model);
      const candidate = localizeInternalRouteLinks(generated.files, { pages: capture.pages || [] });
      const staticDiagnostics = generationPipeline.validateGeneratedFiles(candidate);
      if (staticDiagnostics.length) return { ok: false, reason: generationPipeline.formatDiagnostics(staticDiagnostics).slice(0, 1500) };
      const assetCheck = validateLocalizedAssetReferences(candidate);
      if (assetCheck.remote.length) return { ok: false, reason: `Remote visual assets are not allowed: ${JSON.stringify(assetCheck.remote.slice(0, 10))}` };
      const improved = measureCloneTextCoverage(page, candidate);
      return { ok: true, files: candidate, coverage: improved };
    };

    const label = (stage, number, total) => {
      const where = stage.phase === 'content' ? `part ${stage.contentChunk.index + 1} of ${stage.contentChunk.total}` : stage.phase;
      return `${exists ? 'Adding missing content to' : 'Creating'} ${page.path} from the real website (${where}, step ${number} of ${total}): ${coverage.missing.length} of ${coverage.total} text blocks still missing`;
    };

    for (let index = 0; index < plan.length; index += 1) {
      const stage = plan[index];
      let failure = '';
      let accepted = false;
      for (let tryNumber = 1; tryNumber <= 2 && !accepted; tryNumber += 1) {
        try {
          const outcome = await attempt(stage, label(stage, index + 1, plan.length), { failure });
          if (!outcome.ok) { failure = outcome.reason; continue; }
          // A part of an existing page must reduce what is missing; the parts of a brand-new page build it up from nothing.
          if (exists && outcome.coverage.missing.length >= coverage.missing.length) { failure = 'The response did not add the missing content of this part.'; continue; }
          working = outcome.files;
          coverage = outcome.coverage;
          accepted = true;
        } catch (error) {
          if (signal?.aborted) throw error;
          failure = String(error?.message || error).slice(0, 500);
          logger.warn(`Source fill stage ${stage.phase}${stage.contentChunk ? ` ${stage.contentChunk.index + 1}/${stage.contentChunk.total}` : ''} for ${page.path} failed: ${failure}`);
        }
      }
      report.stages.push({ phase: stage.phase, part: stage.contentChunk ? stage.contentChunk.index + 1 : null, of: stage.contentChunk ? stage.contentChunk.total : null, accepted, ...(accepted ? { missingAfter: coverage.missing.length } : { reason: failure }) });
    }

    // Completeness loop over whatever is still missing, anywhere on the page.
    let stalled = 0;
    let failure = '';
    for (let pass = 1; pass <= maxRepairPasses && coverage.missing.length > 0 && coverage.ratio < targetRatio && stalled < 2; pass += 1) {
      signal?.throwIfAborted();
      try {
        const outcome = await attempt(
          { phase: 'content', missing: coverage.missing },
          `Completing ${page.path}: ${coverage.missing.length} of ${coverage.total} text blocks still missing (check ${pass} of ${maxRepairPasses})`,
          { failure, pageOverrides: { coverageMissing: coverage.missing, repairDiagnostics: buildCloneCoverageDiagnostics(coverage, page, failure), contentChunk: undefined } }
        );
        if (!outcome.ok) { failure = outcome.reason; stalled += 1; report.passes.push({ pass, accepted: false, reason: failure }); continue; }
        if (outcome.coverage.missing.length >= coverage.missing.length) { failure = 'The response did not add the missing content.'; stalled += 1; report.passes.push({ pass, accepted: false, reason: failure }); continue; }
        working = outcome.files;
        coverage = outcome.coverage;
        failure = '';
        stalled = 0;
        report.passes.push({ pass, accepted: true, missing: coverage.missing.length });
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = String(error?.message || error).slice(0, 500);
        stalled += 1;
        report.passes.push({ pass, accepted: false, reason: failure });
      }
    }

    // ---- Measured fidelity audit: colours, backgrounds, fonts and image placement versus the real page ----
    const realFidelity = page.fidelity;
    const renderProject = render || ((list) => inspectRenderedPreview(list, { signal, routePath: page.path, inspect: fidelityAudit.pageSnapshot, argument: { maxTexts: 2500, maxImages: 1500 } }));
    const identityManifest = assetManifestLib.buildAssetManifest({ assets });
    const measure = async (list) => {
      const snapshot = await renderProject(list);
      return {
        identity: fidelityAudit.assetIdentityState({ manifest: identityManifest, route: page.path, realImages: realFidelity.images || [], projectImages: snapshot.images || [] }),
        style: fidelityAudit.compareStyles(realFidelity, snapshot),
        assetState: fidelityAudit.assetPlacementState({
          assets, realImages: realFidelity.images || [], projectImages: snapshot.images || [],
          sourceText: list.filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json').map((file) => String(file.content || '')).join('\n')
        }),
        docHeight: snapshot.docHeight,
        root: snapshot.root
      };
    };
    const summarize = (audit) => ({
      textsMatched: audit.style.matched, textsNotFound: audit.style.notFound, styleMismatches: audit.style.mismatches.length, unreadableOrHiddenText: audit.style.problems.length,
      assetsNeeded: audit.assetState.needed, assetsPlaced: audit.assetState.placed, pageHeight: audit.docHeight, realPageHeight: realFidelity.docHeight
    });
    let audit = null;
    if (realFidelity?.texts?.length) {
      try {
        await onStep(`Comparing the rendered project with the real ${page.path} (colours, backgrounds, fonts, images)...`);
        audit = await measure(working);
        report.audit = { before: summarize(audit), styleStages: [], assetStages: [] };
      } catch (error) {
        if (signal?.aborted) throw error;
        report.audit = { unavailable: String(error?.message || error).slice(0, 300) };
        logger.warn(`Fidelity audit for ${page.path} unavailable: ${report.audit.unavailable}`);
      }
    }
    const staticOk = (list) => !generationPipeline.validateGeneratedFiles(list).length;
    // Page-wide styling lives in global CSS, the HTML shell (e.g. classes on <body>), the entry module and the Tailwind config.
    const cssPaths = () => working.filter((file) => file.encoding !== 'base64' && String(file.content || '').length < 60000 && (/\.css$/i.test(file.path) || /^(?:public\/)?index\.html$/i.test(file.path) || /^(?:src\/)?(?:main|index)\.(?:jsx?|tsx?)$/i.test(file.path) || /tailwind\.config\.[cm]?[jt]s$/i.test(file.path))).map((file) => file.path);
    const fontAssets = assets.filter((asset) => /^font\//i.test(asset.mimeType || '') || /font/i.test(asset.mimeType || '')).map(({ publicPath, mimeType }) => ({ publicPath, mimeType }));

    // Colours, backgrounds and fonts: fix the root cause (page/global styles, wrappers) rather than element by element.
    const stylePasses = Number.parseInt(process.env.SOURCE_FILL_STYLE_PASSES, 10) || 2;
    const styleScore = (state) => state.style.mismatches.length + state.style.problems.length * 3;
    for (let pass = 1; audit && pass <= stylePasses && styleScore(audit) > 0; pass += 1) {
      signal?.throwIfAborted();
      await onStep(`Aligning colours, backgrounds and fonts with the real page: ${audit.style.mismatches.length} elements differ, ${audit.style.problems.length} unreadable or hidden (pass ${pass} of ${stylePasses})`);
      const groups = new Map();
      const ownerCache = new Map();
      for (const item of audit.style.mismatches) {
        for (const diff of item.diffs) {
          const key = `${diff.property}|${diff.real}|${diff.project}`;
          const group = groups.get(key) || { property: diff.property, real: diff.real, project: diff.project, count: 0, examples: [] };
          group.count += 1;
          if (group.examples.length < 3) group.examples.push({ text: item.text.slice(0, 60), tag: item.tag, file: findOwningFile(working, item.text, ownerCache), projectAncestors: item.projectChain, layerPaintingTheRealBackground: item.realLayer, layerPaintingTheProjectBackground: item.projectLayer });
          groups.set(key, group);
        }
      }
      const ranked = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 24);
      const owners = [...new Set(ranked.flatMap((group) => group.examples.map((example) => example.file)).filter(Boolean))];
      const design = page.design || {};
      const facts = JSON.stringify({
        realPageDefaults: { background: design.background, textColor: design.color, fontFamily: design.fontFamily, palette: design.palette, cssVariables: Object.fromEntries(Object.entries(design.cssVariables || {}).slice(0, 40)) },
        projectPageDefaults: audit.root || null,
        fontFilesAvailable: fontAssets.slice(0, 20),
        differences: ranked,
        unreadableOrHiddenText: (() => { const seen = new Set(); return audit.style.problems.filter((problem) => { const key = `${problem.kind}|${problem.color}|${problem.background}|${problem.documentY}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 25).map((problem) => ({ ...problem, sourceFile: findOwningFile(working, problem.text, ownerCache) })); })()
      }, null, 1);
      let failureNote = '';
      let accepted = false;
      for (let attempt = 1; attempt <= 2 && !accepted; attempt += 1) {
        try {
          const patched = await runPatchStage({
            files: working, model, signal, facts: failureNote ? `${facts}\n\nTHE PREVIOUS ATTEMPT WAS REJECTED: ${failureNote}` : facts, targetPaths: [...new Set([...owners, ...cssPaths()])],
            instruction: `Make the rendered project use the same colours, backgrounds and fonts as the real website. "differences" lists, for the elements (paired by their text) where the project differs: the property, the value on the REAL page, the value in the PROJECT, how many elements are affected and example elements with the source file that contains them. Fix the root cause first: compare realPageDefaults with projectPageDefaults (page/body background and text colour, which may come from classes on <body> in index.html, global CSS, CSS variables or the Tailwind theme, and may be overridden by a wrapper component) and correct the place that really wins; then individual sections and components only if needed (each section of the real page has its own background layer, described per example by layerPaintingTheRealBackground (its element, position and size on the real page) next to projectAncestors (the elements that hold the text in the project): give the project element that corresponds to that layer, or the wrapper of that section, the real background, so a dark section gets a dark background with light text and a light section a light one). If a needed font file is listed under fontFilesAvailable, declare it with @font-face using that exact local path; otherwise use the closest generic fallback. Also fix every entry of unreadableOrHiddenText: kind "unreadable" means the text colour has too little contrast with the background behind it (give the section the real background or the text the real colour); kind "covered" means another layer sits on top of the text (typically a fixed header or an absolutely positioned element that must not overlap: add the missing top padding/offset or correct the positioning). Never trade one problem for another: the change must not make any text unreadable. Do not change text, structure or images.`
          });
          usage = mergeOpenRouterUsage(usage, patched.usage, model);
          if (!staticOk(patched.files)) { failureNote = generationPipeline.formatDiagnostics(generationPipeline.validateGeneratedFiles(patched.files)).slice(0, 800); continue; }
          const next = await measure(patched.files);
          // Fewer differences overall, and never more unreadable/hidden text than before.
          if (styleScore(next) < styleScore(audit) && next.style.problems.length <= audit.style.problems.length && next.style.notFound <= audit.style.notFound + 2) {
            working = patched.files;
            report.audit.styleStages.push({ pass, attempt, accepted: true, mismatchesBefore: audit.style.mismatches.length, mismatchesAfter: next.style.mismatches.length, problemsBefore: audit.style.problems.length, problemsAfter: next.style.problems.length });
            audit = next;
            accepted = true;
          } else {
            failureNote = `the result had ${next.style.mismatches.length} differing elements and ${next.style.problems.length} unreadable/hidden texts (before: ${audit.style.mismatches.length} and ${audit.style.problems.length}); ${next.style.problems.length > audit.style.problems.length ? 'it made text unreadable: ' + JSON.stringify(next.style.problems.slice(0, 5)) : 'it did not reduce the differences enough'}.`;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          failureNote = String(error?.message || error).slice(0, 400);
        }
      }
      if (!accepted) report.audit.styleStages.push({ pass, accepted: false, reason: failureNote.slice(0, 300) });
    }

    // Images: place every downloaded image that belongs on the real page but is not used yet, where it sits on the real page.
    const assetBatch = Number.parseInt(process.env.SOURCE_FILL_ASSET_BATCH, 10) || 25;
    // As many batches as the unplaced images need (bounded), so a page with hundreds of images is not left half done.
    const assetPasses = Math.min(Number.parseInt(process.env.SOURCE_FILL_ASSET_PASSES, 10) || 12, audit ? Math.ceil(audit.assetState.unplaced.length / assetBatch) + 1 : 0);
    let skipped = 0;
    for (let pass = 1; audit && pass <= assetPasses && audit.assetState.unplaced.length > skipped; pass += 1) {
      signal?.throwIfAborted();
      const batch = audit.assetState.unplaced.slice(skipped, skipped + assetBatch);
      await onStep(`Placing images from the real page: ${audit.assetState.unplaced.length} of ${audit.assetState.needed} are not used yet (pass ${pass} of ${assetPasses})`);
      const ownerCache = new Map();
      const placements = batch.map(({ asset, spots }) => {
        const spot = spots[0];
        return { image: asset.publicPath, alt: asset.alt || spot.alt || '', realSize: `${spot.width}x${spot.height}`, kind: spot.kind === 'background' ? 'css background-image' : 'img element', positionFromTop: spot.documentY, nearbyText: spot.near || '', sourceFile: findOwningFile(working, spot.near, ownerCache), timesOnRealPage: spots.length };
      });
      const owners = [...new Set(placements.map((placement) => placement.sourceFile).filter(Boolean))].slice(0, 8);
      const fallback = owners.length ? [] : working.filter((file) => file.encoding !== 'base64' && /\.(?:jsx|tsx)$/i.test(file.path) && String(file.content || '').length < 30000).map((file) => file.path).slice(0, 10);
      let failureNote = '';
      let accepted = false;
      for (let attempt = 1; attempt <= 2 && !accepted; attempt += 1) {
        try {
          const patched = await runPatchStage({
            files: working, model, signal, facts: `${JSON.stringify(placements, null, 1)}${failureNote ? `\n\nTHE PREVIOUS ATTEMPT WAS REJECTED: ${failureNote}` : ''}`, targetPaths: [...owners, ...fallback, ...cssPaths()],
            instruction: 'Each listed image is downloaded in the project but not used. Place every one of them in the existing component whose content is next to it on the real page ("nearbyText", "sourceFile"), as an <img> (or a CSS background-image when kind says so) with its alt text and the same rendered size and crop (object-fit) as on the real page. Use the exact local "image" path. Keep all existing content and layout; only add or complete the images. Every edit must leave valid JSX (balanced tags, one root, no leftover fragments). If an image truly has no place in the existing markup, skip it.'
          });
          usage = mergeOpenRouterUsage(usage, patched.usage, model);
          if (!staticOk(patched.files)) { failureNote = generationPipeline.formatDiagnostics(generationPipeline.validateGeneratedFiles(patched.files)).slice(0, 800); continue; }
          const next = await measure(patched.files);
          if (next.assetState.unplaced.length < audit.assetState.unplaced.length && next.style.problems.length <= audit.style.problems.length) {
            working = patched.files;
            report.audit.assetStages.push({ pass, attempt, accepted: true, placed: audit.assetState.unplaced.length - next.assetState.unplaced.length, stillUnplaced: next.assetState.unplaced.length });
            audit = next;
            skipped = 0;
            accepted = true;
          } else {
            failureNote = next.style.problems.length > audit.style.problems.length ? 'the new images made existing text unreadable or hidden; place them without covering text or changing section backgrounds.' : 'no image was placed.';
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          failureNote = String(error?.message || error).slice(0, 500);
        }
      }
      if (!accepted) { report.audit.assetStages.push({ pass, accepted: false, reason: failureNote.slice(0, 300) }); skipped += assetBatch; }
    }
    // Identity: an image that loads can still be the WRONG one. Whatever the real page ties to a specific element is restored
    // deterministically (no model, no guessing); anything ambiguous or unavailable is reported, never substituted.
    if (audit && report.audit) {
      const identityReport = { before: audit.identity.defects.length, repaired: [], unresolved: [] };
      for (let pass = 1; pass <= 2; pass += 1) {
        const repairable = audit.identity.defects.filter((defect) => ['asset-mismatch', 'unrelated-substitute'].includes(defect.type));
        if (!repairable.length) break;
        const fixed = assetManifestLib.repairAssetReferences(working, repairable, identityManifest);
        if (!fixed.repaired.length) { identityReport.unresolved = fixed.unresolved.map(({ defect, reason }) => ({ type: defect.type, alt: defect.alt, src: defect.src, reason })); break; }
        if (!staticOk(fixed.files)) break;
        const next = await measure(fixed.files);
        if (next.identity.defects.length < audit.identity.defects.length && next.style.problems.length <= audit.style.problems.length) {
          working = fixed.files;
          audit = next;
          identityReport.repaired.push(...fixed.repaired);
        } else {
          identityReport.unresolved = fixed.unresolved.map(({ defect, reason }) => ({ type: defect.type, alt: defect.alt, src: defect.src, reason }));
          break;
        }
      }
      identityReport.after = audit.identity.defects.length;
      identityReport.remaining = audit.identity.defects.slice(0, 30).map(({ type, src, alt, expectedPublicPath, belongsTo }) => ({ type, src, alt, expectedPublicPath, belongsTo }));
      report.audit.assetIdentity = identityReport;
    }
    if (audit && report.audit) {
      report.audit.after = summarize(audit);
      report.audit.imagesNotPlaced = audit.assetState.unplaced.slice(0, 50).map(({ asset, spots }) => ({ image: asset.publicPath, positionFromTop: spots[0].documentY }));
    }

    report.after = { total: coverage.total, missing: coverage.missing.length, ratio: Math.round(coverage.ratio * 100) / 100 };
    // Only images the final source really uses stay in the project.
    const sourceText = working.filter((file) => file.encoding !== 'base64').map((file) => String(file.content || '')).join('\n');
    const unusedAssets = new Set(assets.filter((asset) => asset.localPath && !sourceText.includes(asset.publicPath) && !files.some((file) => file.path === asset.localPath)).map((asset) => asset.localPath));
    working = working.filter((file) => !unusedAssets.has(file.path));
    const changed = working.filter((file) => {
      const original = files.find((candidate) => candidate.path === file.path);
      return !original || original.content !== file.content;
    });
    return { files: working, changed, usage, report, coverage };
  }


  /**
   * Brings EVERYTHING missing on one real page into an existing project, the way the website cloner builds a page: the real
   * markup (with its classes, measured styles, screenshot and per-section images) is processed in ordered parts, and a part is
   * only sent to the model when text of that part is missing from the project. A page the project has no route for is built
   * whole. After the parts, a coverage loop repeats until the real page's text is covered or no progress is possible.
   * Returns the new files plus a per-stage report. Never touches the project when nothing improves.
   */
  /**
   * "Clone this page again": rebuilds ONE page of an existing clone from a fresh read of the real page.
   * The page is rebuilt deterministically from the captured source (real markup, the site's own CSS, localized images) and
   * kept only if it matches the real page at least as well as the page it replaces, measured on a real render. If that is not
   * possible, the cloner's AI page builder is tried. The caller then runs the same real-site comparison and repair loop as a new clone.
   */
  async function recloneRoute({ files, source, provenance, model, signal, onStep = async () => {} }) {
    const routePath = source.routePath;
    const page = { ...source.page, path: routePath, captureStatus: 'captured' };
    const capture = { ...source.capture, pages: [page, ...(source.capture.pages || []).filter((item) => item !== source.page && item.path !== routePath)] };
    const target = Math.min(1, Math.max(0, Number.parseFloat(process.env.CLONE_MIN_FIDELITY) || 0.9));
    const score = (entry) => (!entry || entry.error ? null : Math.min(entry.expectedWords ? entry.text : 1, entry.expectedImages >= 3 ? entry.images : 1, entry.expectedColors >= 3 ? entry.colors : 1));
    const measure = async (candidate) => score((await measureCloneFidelity(candidate, capture, { signal, routes: [routePath] })).perPage[0]);
    const report = { route: routePath, steps: [] };
    let usage = null;
    await onStep(`Measuring ${routePath} against the real page...`);
    const before = await measure(files);
    report.before = before;
    let best = { files, score: before ?? -1, via: null };

    // 1) Rebuild from the captured source: exact content and images, the site's own styling.
    await onStep(`Re-cloning ${routePath} from the real website...`);
    try {
      // Pictures only: documents (PDFs...) stay links to the real site, so re-cloning one page does not bloat the project past the build size limit.
      const imageAssets = (capture.assets || []).filter((asset) => !asset.isDocument && /^image\//i.test(asset.mimeType || ''));
      const siteCss = cloneRouteGuarantee.buildSiteCss(capture.stylesheets || [], { assets: imageAssets, localizeCss: (css) => replaceAssetReferences(css, imageAssets) });
      const localize = (html) => localizeInternalRouteLinks([{ path: 'x.html', content: replaceAssetReferences(html, imageAssets) }], capture)[0].content;
      const assetFiles = imageAssets.filter((asset) => asset.localPath && asset.content).map((asset) => ({ path: asset.localPath, content: asset.content, language: 'binary', encoding: 'base64' }));
      const present = new Set(files.map((file) => file.path));
      const withAssets = [...files, ...assetFiles.filter((file) => !present.has(file.path))];
      const built = cloneRouteGuarantee.rebuildRoutes(withAssets, [page], [routePath], { localize, assets: imageAssets, siteCss });
      // Keep only the new pictures the rebuilt page (or the site CSS) really uses.
      const textNow = built.files.filter((file) => file.encoding !== 'base64' && typeof file.content === 'string' && (!present.has(file.path) || file.content !== files.find((old) => old.path === file.path)?.content)).map((file) => file.content).join('\n');
      const rebuilt = { ...built, files: built.files.filter((file) => file.encoding !== 'base64' || present.has(file.path) || textNow.includes(file.path.replace(/^public/, ''))) };
      const applied = rebuilt.report.some((item) => item.applied);
      if (!applied) report.steps.push({ step: 'rebuild-from-capture', applied: false, reason: rebuilt.report[0]?.failure || 'not possible' });
      else {
        const after = await measure(rebuilt.files);
        report.steps.push({ step: 'rebuild-from-capture', applied: true, score: after });
        if (after !== null && after >= best.score) best = { files: rebuilt.files, score: after, via: 'rebuild-from-capture' };
      }
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      report.steps.push({ step: 'rebuild-from-capture', applied: false, reason: String(error.message).slice(0, 200) });
    }

    // 2) Still below the target (or no rebuild possible): the cloner's own AI page builder recreates the page.
    if (best.score < target) {
      try {
        const filled = await fillMissingFromRealPage({ files: best.files, source: { page, capture }, provenance, model, signal, treatAsNew: true, onStep });
        if (filled.usage) usage = filled.usage;
        const after = await measure(filled.files);
        report.steps.push({ step: 'ai-recreate', applied: filled.changed.length > 0, score: after });
        if (after !== null && filled.changed.length && after > best.score) best = { files: filled.files, score: after, via: 'ai-recreate' };
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError' || /^Cancelled$/.test(error?.message)) throw error;
        report.steps.push({ step: 'ai-recreate', applied: false, reason: String(error.message).slice(0, 200) });
      }
    }
    report.after = best.score < 0 ? null : best.score;
    report.via = best.via;
    const original = new Map(files.map((file) => [file.path, file.content]));
    const changed = best.files.filter((file) => original.get(file.path) !== file.content);
    return { files: best.files, changed, report, usage };
  }

  return { recloneRoute, fillMissingFromRealPage };
}

module.exports = { createRealPageFill, hasRouteDefinition, pageExistsInFiles, findOwningFile, runPatchStage };
