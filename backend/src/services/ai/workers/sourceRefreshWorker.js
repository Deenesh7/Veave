/**
 * "You missed some pages, crawl the real website again": find the pages the project lacks and build each one from its real page.
 *
 * Moved out of jobManager. It does not touch the job document: progress goes through `onStep` (which also throws when the job was
 * cancelled) and the caller saves the result. Collaborators are passed in `deps` so this module has no import cycle with jobManager.
 *
 * Failure rules (unchanged):
 *   nothing missing            throws "... The project was not changed."
 *   a page fails               recorded in `failures`, the other pages still build; a cancellation always propagates
 *   no page could be built     throws "... The project was not changed."
 */
const sourceRefreshService = require('../../clone/sourceRefreshService');

/**
 * @param deps { captureWebsite, hasRouteDefinition, pageExistsInFiles, fillMissingFromRealPage, localizeInternalRouteLinks, sumUsageRecords, logger }
 * Usage: `fillMissingFromRealPage` already returns normalized usage records (promptTokens, ...), so they are added with `sumUsageRecords`.
 *  (`mergeOpenRouterUsage` reads the provider's snake_case fields and would count these as zero tokens.)
 * @returns {Promise<{ working, recrawlResult, usage }>} usage is the summed usage of every page built, on top of `usage` passed in
 */
async function recrawlMissingPages({ jobId, project, files, model, signal, onStep, usage = null, deps }) {
  const { captureWebsite, hasRouteDefinition, pageExistsInFiles, fillMissingFromRealPage, localizeInternalRouteLinks, sumUsageRecords, logger } = deps;
  await onStep('Crawling the real website again to find the pages that were missed...');
  const found = await sourceRefreshService.findMissingPages({
    project, signal, capture: captureWebsite,
    exists: (pagePath) => hasRouteDefinition(files, pagePath)
  });
  const maxNewPages = Number.parseInt(process.env.SOURCE_RECRAWL_MAX_PAGES, 10) || 8;
  const batch = found.missing.slice(0, maxNewPages);
  if (!batch.length) {
    const failedNote = found.failed.length ? ` ${found.failed.length} page(s) could not be opened (${found.failed.slice(0, 5).map((item) => item.path).join(', ')}).` : '';
    throw new Error(`Crawled the real website again: ${found.totalCaptured} page(s) found, and the project already has all of them.${failedNote} The project was not changed.`);
  }
  let routes = [...(project.provenance.routes || [])];
  const created = [];
  const failures = [];
  let working = files;
  let totalUsage = usage;
  for (let index = 0; index < batch.length; index += 1) {
    const page = batch[index];
    try {
      const filled = await fillMissingFromRealPage({
        files: working, source: { page, capture: found.capture }, provenance: { ...project.provenance, routes },
        model, signal, treatAsNew: true,
        onStep: (message) => onStep(`Page ${index + 1} of ${batch.length} (${page.path}): ${message}`)
      });
      if (!filled.changed.length || !pageExistsInFiles(filled.files, page.path, { routes })) throw new Error('the page could not be added to the project routes');
      working = filled.files;
      if (filled.usage) totalUsage = sumUsageRecords(totalUsage, filled.usage);
      routes = [...routes, { path: page.path, title: page.title, description: page.description, headings: (page.headings || []).slice(0, 12), sections: (page.sections || []).slice(0, 20).map(({ tag, id, text }) => ({ tag, id, text })) }];
      created.push({ path: page.path, textMissingAfter: filled.report.after.missing, textTotal: filled.report.after.total });
    } catch (error) {
      if (signal?.aborted || /^Cancelled$/.test(error?.message)) throw error;
      failures.push({ path: page.path, reason: String(error?.message || error).slice(0, 300) });
      logger.warn(`Job ${jobId} re-crawl could not add ${page.path}: ${failures[failures.length - 1].reason}`);
    }
  }
  if (!created.length) throw new Error(`Found ${found.missing.length} missing page(s) but could not build any: ${failures.map((item) => `${item.path} (${item.reason})`).join('; ')}. The project was not changed.`);
  // Menus and links elsewhere that still point at the real site now go to the new local pages.
  working = localizeInternalRouteLinks(working, { pages: batch.filter((page) => created.some((item) => item.path === page.path)) });
  return {
    working,
    usage: totalUsage,
    recrawlResult: {
      routes, siteMap: found.capture.siteMap, created, failures,
      remaining: found.missing.slice(maxNewPages).map((page) => page.path),
      unreachable: found.failed.slice(0, 20), totalCaptured: found.totalCaptured
    }
  };
}

/**
 * After "clone this page again": the rebuilt page is a copy of the real one WITHOUT the real site's scripts. Make its content visible,
 * then let the model fix what still differs from the real page, so validation judges the repaired page, not the raw copy.
 *
 * Failure rules (unchanged): a cancellation propagates; any other failure is logged and the repair is skipped. The returned
 * `files` are then whatever state was reached (visibility guard applied or not), and `failed` is true so the caller keeps its
 * own change list.
 *
 * @param deps { capturedVisibility, cloneVisualRepair, incrementalValidation, fidelityAudit, inspectRenderedPreview, snapshotLivePage, logger }
 * @param ask  async (messages) => completion; the caller bills it
 * @returns {Promise<{ files, repair, failed }>} repair is { initial, final, passes, remaining } or null
 */
async function repairRecloned({ jobId, files, source, signal, onState, ask, deps }) {
  const { capturedVisibility, cloneVisualRepair, incrementalValidation, fidelityAudit, inspectRenderedPreview, snapshotLivePage, logger } = deps;
  let current = files;
  try {
    const guarded = await capturedVisibility.ensureCapturedContentVisible(current, { signal, routes: [source.routePath] });
    current = guarded.files;
    let repair = null;
    const repairPasses = Number.parseInt(process.env.CLONE_VISUAL_REPAIR_PASSES ?? '2', 10);
    if (repairPasses > 0 && process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key') {
      const repaired = await cloneVisualRepair.runCloneVisualRepair({
        files: current, routes: [source.routePath], maxPasses: repairPasses, signal,
        validation: incrementalValidation, fidelity: fidelityAudit,
        render: (renderFiles, options) => inspectRenderedPreview(renderFiles, { signal, ...options }),
        reference: async () => ({ url: source.url, snapshot: source.page.fidelity || await snapshotLivePage(source.url, { signal }) }),
        ask, onState
      });
      if (repaired.passes?.length) {
        current = repaired.files;
        repair = { initial: repaired.initial, final: repaired.final, passes: repaired.passes, remaining: repaired.remaining };
        logger.info(`Job ${jobId} re-cloned ${source.routePath}: ${repaired.initial.issues} -> ${repaired.final.issues} difference(s) from the real page after repair.`);
      }
    }
    return { files: current, repair, failed: false };
  } catch (repairError) {
    if (signal?.aborted || repairError?.name === 'AbortError') throw repairError;
    logger.warn(`Job ${jobId} re-clone visual repair skipped: ${repairError.message}`);
    return { files: current, repair: null, failed: true };
  }
}

module.exports = { recrawlMissingPages, repairRecloned };
