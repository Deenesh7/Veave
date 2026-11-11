'use strict';

const { resolveConfig } = require('./config');
const { runPrototype, applySharedChange, newState } = require('./engine');
const { createRenderer } = require('./validator');
const { createMongoStore, createMemoryStore } = require('./store');
const { toQueue, buildReport } = require('./report');
const crawler = require('./crawler');
const { detectPrototypeUrl } = require('../clone/prototypeService');

const isEnabled = () => resolveConfig().enabled;

/** The reference page screenshot used as visual guidance for one page: from the crawl cache, or captured again. */
function referenceImageProvider(config, runId, validateUrl) {
  return async (page, state) => {
    let buffer = crawler.readCachedImage(runId, page.route);
    if (!buffer) {
      try {
        const target = state.data.pages.find((p) => p.route === page.route)?.url || page.url;
        const fresh = await crawler.recapturePage(target, config, { validateUrl });
        buffer = fresh.image;
        if (buffer) crawler.writeCachedImage(runId, page.route, buffer);
      } catch { buffer = null; }
    }
    return buffer ? `data:image/jpeg;base64,${buffer.toString('base64')}` : null;
  };
}

/**
 * Runs the prototype engine for one generation job (resuming from its checkpoint when one exists).
 * `generate(messages, options)` is the model call; `mergeUsage(previous, usage)` keeps the job's usage accounting.
 */
async function runForJob({ job, prompt, url, userId, siteName, signal, generate, mergeUsage, onState, store, models, blob, uploadedImages = [], inspectRenderedPreview, overrides = {}, log }) {
  const config = resolveConfig(overrides);
  const runId = String(job.jobId || job.runId);
  const theStore = store || createMongoStore({ runId, userId, url, siteName, prompt, settings: { model: 'Veave AI' }, models, blob });
  const checkpoint = await theStore.loadState();
  const deps = {
    signal, log, retryDelayMs: 1500,
    generate, mergeUsage, onState,
    render: createRenderer({ inspectRenderedPreview: inspectRenderedPreview || require('../ai/targetRenderVerifier').inspectRenderedPreview, config, signal }),
    saveState: (state) => theStore.saveState(state),
    persistProject: (files, meta) => theStore.persistProject(files, meta),
    loadProjectFiles: () => theStore.loadProjectFiles(),
    getReferenceImage: referenceImageProvider(config, runId),
    ...(overrides.deps || {})
  };
  const result = await runPrototype({ url, prompt, siteName, runId, config, deps, state: checkpoint, uploadedImages });
  await theStore.finalizeProvenance(result.report).catch(() => {});
  return { ...result, projectId: theStore.projectId || null, queue: toQueue(result.state), config };
}

module.exports = { isEnabled, runForJob, detectPrototypeUrl, resolveConfig, createMemoryStore, createMongoStore, applySharedChange, newState, toQueue, buildReport };
