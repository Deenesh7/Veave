/**
 * The deterministic edit engines: they measure the rendered page and edit it themselves, so the model is not asked when they can
 * verify a fix.
 *
 *   duplicate()      "there are 2 footers, remove one": checked against the render first; fixed and verified, or an error saying what the page shows
 *   style(files)     "make the footer black": restyles exactly the region on the viewed page
 *   autoSpacing()    "remove the empty space": layout engine, verified in the browser
 *   measureSpacing() where the page has more space than the real page (a hint for the model, no edit)
 *   arrange()        "make these images horizontal": wraps the run of blocks and verifies the arrangement, else measures it for the model
 *
 * Moved out of jobManager unchanged in behaviour. Each step returns the new edit state (`editEngineResult` shape) or null; the
 * orchestrator decides what to do with it. State shared with later steps (files already verified by an engine, whether the spacing
 * engine ran or fixed something) is read through `engines.state`.
 */
const GenerationJob = require('../../../models/GenerationJob');
const openrouterService = require('../openrouterService');
const incrementalValidation = require('../incrementalValidation');
const incrementalEditor = require('../incrementalEditor');
const layoutEngine = require('../layoutEngine');
const editEngineResult = require('./editEngineResult');
const sourceRefreshService = require('../../clone/sourceRefreshService');
const fidelityAudit = require('../../clone/fidelityAudit');
const { snapshotLivePage } = require('../../clone/websiteCaptureService');
const { inspectRenderedPreview } = require('../targetRenderVerifier');
const { runBlankSpaceEngine, makeLlmChooser } = require('../../layout/blankSpaceEngine');
const { runElementStyleEngine } = require('../../layout/elementStyleEngine');
const { interpretStyleRequest } = require('../../layout/styleIntent');
const { runDuplicateRegionEngine, parseDuplicateRequest } = require('../../layout/duplicateRegionEngine');
const { AIResponseValidationError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

const hasModelKey = () => Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key');

/**
 * @param ctx { jobId, prompt, model, signal, project, editTarget, editViewingRoute, previousAppCode, onUsage(completion, messages) }
 *            onUsage bills every model call an engine makes (the caller adds it to the job's usage)
 */
function createEditEngines(ctx) {
  const { jobId, prompt, model, signal, project, editTarget, editViewingRoute, previousAppCode, onUsage } = ctx;
  let spacingEngineRan = false;
  let spacingEngineFixed = false; // the engine verified a fix in the browser
  const engineChangedPaths = new Set(); // files the engine edited: already verified, so the scope guard must not revert them
  const currentFiles = () => project.files.map(incrementalEditor.normalizeFile).filter(Boolean);

  const runSpacingEngine = async (files) => {
    spacingEngineRan = true;
    const spacingRoute = editTarget.route;
    const canAsk = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key';
    const engineReport = await runBlankSpaceEngine({
      files, route: spacingRoute, request: prompt, signal: signal,
      maxAttempts: Number.parseInt(process.env.BLANK_SPACE_MAX_ATTEMPTS, 10) || 4,
      chooseCandidate: canAsk ? makeLlmChooser(async (messages) => {
        const completion = await openrouterService.generateCompletion(messages, { model, temperature: 0, max_tokens: 400, reasoning: { effort: 'low', exclude: true }, response_format: false });
        onUsage(completion, messages);
        return completion;
      }) : null,
      onState: (state, detail) => { GenerationJob.updateOne({ jobId, status: 'processing' }, { $set: { stepName: `Blank space: ${state.toLowerCase().replace(/_/g, ' ')}${detail ? ` - ${String(detail).slice(0, 80)}` : ''}` } }).catch(() => {}); }
    });
    if (engineReport.changes.length) { for (const change of engineReport.changes) engineChangedPaths.add(change.file); spacingEngineFixed = ['fixed', 'partially-fixed'].includes(engineReport.status); }
    const { files: _omit, ...summary } = engineReport;
    await GenerationJob.updateOne({ jobId }, { $set: { 'analysis.blankSpaceEngine': summary } }).catch(() => {});
    logger.info(`Job ${jobId} blank-space engine on ${spacingRoute}: ${engineReport.status} (${engineReport.state}), ${engineReport.changes.length} verified change(s), ${engineReport.attempts.length} attempt(s).`);
    return engineReport;
  };
  const runStyleEngine = async (files, intent) => {
    const route = editTarget.route;
    const report = await runElementStyleEngine({
      files, route, request: prompt, intent, signal: signal,
      onState: (state, detail) => { GenerationJob.updateOne({ jobId, status: 'processing' }, { $set: { stepName: `Restyle: ${state.toLowerCase().replace(/_/g, ' ')}${detail ? ` - ${String(detail).slice(0, 80)}` : ''}` } }).catch(() => {}); }
    });
    for (const change of report.changes) engineChangedPaths.add(change.file);
    const { files: _omit, ...summary } = report;
    await GenerationJob.updateOne({ jobId }, { $set: { 'analysis.styleEngine': summary } }).catch(() => {});
    logger.info(`Job ${jobId} style engine on ${route}: ${report.status} (${report.state}), target ${report.target?.selector || 'none'}, ${report.changes.length} verified change(s), ${report.attempts.length} attempt(s).`);
    return report;
  };

  // "There are 2 footers, remove one": the claim is checked against the rendered page first. A model asked to do this blindly removes
  // the wrong footer (or the only one), so the model is not used: either the duplicate is removed and verified, or nothing changes
  // and the user is told what the page really shows. Returns null when the request is not about a duplicate.
  const duplicate = async () => {
    if (!parseDuplicateRequest(prompt)) return null;
    const report = await runDuplicateRegionEngine({
      files: currentFiles(), route: editTarget.route, request: prompt, provenance: project.provenance, signal,
      onState: (state, detail) => { GenerationJob.updateOne({ jobId, status: 'processing' }, { $set: { stepName: `Duplicate check: ${state.toLowerCase().replace(/_/g, ' ')}${detail ? ` - ${String(detail).slice(0, 80)}` : ''}` } }).catch(() => {}); }
    });
    for (const change of report.changes) engineChangedPaths.add(change.file);
    const { files: _omit, ...summary } = report;
    await GenerationJob.updateOne({ jobId }, { $set: { 'analysis.duplicateRegionEngine': summary } }).catch(() => {});
    logger.info(`Job ${jobId} duplicate-region engine on ${editTarget.route}: ${report.status}${report.reason ? ` - ${report.reason}` : ''}`);
    if (report.status === 'fixed') return editEngineResult.applyEngineFiles({ originalFiles: project.files, engineFiles: report.files, previousAppCode });
    if (report.status !== 'not-a-duplicate-request') throw new AIResponseValidationError(report.reason || 'The duplicate could not be removed safely, so the project was not changed.');
    return null;
  };

  // Colour/background change of a named region ("footer", "header", ...): done by the style engine before any model call, so the
  // edit lands on what the viewed page really renders (a captured route is not drawn by the component with the same name).
  const style = async () => {
    const styleAsk = hasModelKey() ? async (messages) => {
      const completion = await openrouterService.generateCompletion(messages, { model, temperature: 0, max_tokens: 200, reasoning: { effort: 'low', exclude: true }, response_format: false });
      onUsage(completion, messages);
      return completion;
    } : null;
    const styleIntent = !incrementalValidation.isSpacingRequest(prompt) ? await interpretStyleRequest(prompt, styleAsk).catch(() => null) : null;
    if (!styleIntent) return null;
    try {
      const styleReport = await runStyleEngine(currentFiles(), styleIntent);
      if (styleReport.status === 'fixed' && styleReport.changes.length) return editEngineResult.applyEngineFiles({ originalFiles: project.files, engineFiles: styleReport.files, previousAppCode });
    } catch (styleError) {
      if (signal.aborted || styleError?.name === 'AbortError') throw styleError;
      logger.warn(`Job ${jobId} style engine skipped: ${styleError.message}`);
    }
    return null;
  };

  // "Remove the empty space": solve it automatically, before any model call. The layout engine measures the viewed page,
  // traces each blank region to its cause, patches only that and verifies it in the browser. When it verifies a fix, the
  // model is not asked at all; otherwise the model path runs as before (and the engine runs again on its result).
  const autoSpacing = async () => {
    if (!incrementalValidation.isSpacingRequest(prompt)) return null;
    try {
      const engineReport = await runSpacingEngine(currentFiles());
      if (engineReport.changes.length && ['fixed', 'partially-fixed'].includes(engineReport.status)) {
        return editEngineResult.applyEngineFiles({ originalFiles: project.files, engineFiles: engineReport.files, previousAppCode });
      }
      spacingEngineRan = false; // nothing verified: let the model try, then run the engine on its result
    } catch (autoSpacingError) {
      if (signal.aborted || autoSpacingError?.name === 'AbortError') throw autoSpacingError;
      spacingEngineRan = false;
      logger.warn(`Job ${jobId} automatic blank-space engine skipped: ${autoSpacingError.message}`);
    }
    return null;
  };

  // "Remove the empty space": measure WHERE this page has more space than the real page and tell the model, so it patches the
  // elements that cause it instead of guessing (a blind attempt changes nothing). Returns the text to add to the prompt.
  const measureSpacing = async () => {
    let spacingContext = '';
    if (!(incrementalValidation.isSpacingRequest(prompt) && project.provenance?.type === 'website-clone' && project.provenance.sourceUrl)) return spacingContext;
    try {
      const route = editTarget.route;
      const url = sourceRefreshService.sourceUrlForRoute(project.provenance, route);
      const [real, mine] = await Promise.all([
        snapshotLivePage(url, { signal }),
        inspectRenderedPreview(currentFiles(), { signal, routePath: route, inspect: fidelityAudit.pageSnapshot, argument: { maxTexts: 2500, maxImages: 1500 } })
      ]);
      const extra = incrementalValidation.extraSpaceIssues(real, mine);
      if (extra.length || (real.docHeight && mine.docHeight > real.docHeight * 1.05)) {
        spacingContext = `\nMEASURED EMPTY SPACE (the page ${route} rendered next to the real website at the same width; the real page is ${real.docHeight}px tall, this one ${mine.docHeight}px):\n${extra.map((issue) => `- ${issue.detail}`).join('\n') || '- the page is taller than the real page'}\nFind the elements that sit between those texts (in the markup above, in page order) and remove or shrink what creates the extra space: fixed pixel min-height / height / padding / margin in style attributes or classes, empty spacer blocks. Change ONLY those values on those elements. Do not remove real content, images or text.\n`;
        logger.info(`Job ${jobId} measured ${extra.length} extra-space gap(s) on ${route} (page ${mine.docHeight}px vs real ${real.docHeight}px).`);
      }
    } catch (spacingError) {
      if (signal.aborted || spacingError?.name === 'AbortError') throw spacingError;
      logger.warn(`Job ${jobId} spacing measurement skipped: ${spacingError.message}`);
    }
    return spacingContext;
  };

  // "Make these images horizontal": measure how the images are placed today, so the model edits the real cause instead of guessing.
  // Returns { applied, context }: `applied` is the verified arrangement (the model is then not asked), `context` is a hint for the model.
  // `alreadyEdited` is true when an earlier engine already produced the edit.
  const arrange = async ({ alreadyEdited = false } = {}) => {
    const result = { applied: null, context: '' };
    const layoutAsk = incrementalValidation.extractLayoutRequest(prompt);
    if (!layoutAsk) return result;
    try {
      const route = editViewingRoute || '/';
      const measured = await inspectRenderedPreview(currentFiles(), { signal, routePath: route, inspect: incrementalValidation.layoutInspector, argument: { count: layoutAsk.count, anchors: layoutAsk.anchors } });
      const followed = incrementalValidation.layoutTarget(layoutAsk, measured);
      // A captured page: wrap only the run of blocks that holds those images, then check by rendering that they are really in
      // that arrangement and that nothing else moved. Verified -> the model is not asked.
      if (!alreadyEdited && followed && measured.children?.length) {
        const arranged = layoutEngine.arrangeCapturedBlocks(currentFiles(), measured, layoutAsk);
        if (arranged) {
          const after = await inspectRenderedPreview(arranged.files, { signal, routePath: route, inspect: incrementalValidation.layoutInspector, argument: { srcs: followed } });
          const verdict = incrementalValidation.verifyLayoutRequest(layoutAsk, measured, after);
          logger.info(`Job ${jobId} arrangement engine on ${route}: ${verdict.ok ? 'verified' : 'rejected'} (${verdict.detail.slice(0, 200)}).`);
          if (verdict.ok) {
            result.applied = editEngineResult.applyEngineFiles({ originalFiles: project.files, engineFiles: arranged.files, previousAppCode });
            for (const change of result.applied.generatedChanges) engineChangedPaths.add(change.path);
          }
        }
      }
      if (!alreadyEdited && !result.applied && followed && measured.facts) {
        result.context += `\nMEASURED LAYOUT (the page ${route} rendered at 1440px): the ${followed.length} images to arrange ${layoutAsk.orientation === 'row' ? 'in one row' : 'in one column'} are ${followed.join(', ')}; they are currently NOT arranged that way.\n${measured.facts}\nHOW TO CHANGE IT: the container also holds other content that must not move. Make the change with ONE scoped rule that targets only the blocks marked [holds an image] (and the caption blocks between them if they belong to the images), for example with a <style> element placed next to the container and selectors built from the block classes above, giving those blocks a row layout (flex or grid with ${followed.length} equal columns, width:auto, position:static, no fixed pixel width). Reset the old placement (grid-area, absolute position, fixed width) on those blocks and let each img fill its block (width:100%; height:auto). Do not change the container's own display for the whole page. Each SEARCH block must be a short unique line.\n`;
        logger.info(`Job ${jobId} measured the layout of ${followed.length} image(s) on ${route} for the arrangement request.`);
      }
    } catch (layoutError) {
      if (signal.aborted || layoutError?.name === 'AbortError') throw layoutError;
      logger.warn(`Job ${jobId} layout measurement skipped: ${layoutError.message}`);
    }
    return result;
  };

  return {
    duplicate, style, autoSpacing, measureSpacing, arrange, runSpacing: runSpacingEngine,
    state: {
      get spacingEngineRan() { return spacingEngineRan; },
      get spacingEngineFixed() { return spacingEngineFixed; },
      changedPaths: engineChangedPaths
    }
  };
}

module.exports = { createEditEngines };
