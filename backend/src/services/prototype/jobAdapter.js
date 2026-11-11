'use strict';

// Connects the prototype engine to a generation job: progress/step text, the queue shown in the UI, and the final
// analysis record. It writes to the job through `update(patch)` (a single MongoDB $set), never by saving a stale document.

const { toQueue } = require('./report');

const STAGE_TEXT = {
  normalize: 'Checking the website address...', crawl: 'Crawling the website and reading each page...', dom: 'Reading the page structure...', styles: 'Measuring fonts, colours and spacing...',
  assets: 'Mapping the images...', inventory: 'Listing the pages and shared parts...', design: 'Building the design system...', shared: 'Building the navigation and footer...',
  regression: 'Checking the whole site...', save: 'Saving the project...'
};

/** One honest line about what is happening right now, from the real state. */
function describeActivity(state) {
  const pageEntries = Object.entries(state.pageStates || {});
  const active = pageEntries.find(([, p]) => ['generating', 'validating', 'repairing'].includes(p.status));
  if (active) {
    const index = pageEntries.findIndex(([route]) => route === active[0]) + 1;
    const verb = active[1].status === 'generating' ? 'Building' : active[1].status === 'validating' ? 'Checking in a browser' : 'Fixing differences on';
    return `${verb} page ${index} of ${pageEntries.length}: ${active[0]}`;
  }
  const running = Object.entries(state.stages || {}).find(([, s]) => s.status === 'running');
  if (running) return STAGE_TEXT[running[0]] || `Working on ${running[0]}...`;
  return 'Preparing the prototype...';
}

// Engine progress fills the job's 20..66 band (the rest of the job pipeline owns the remainder). Early stages are 35% of
// the engine's work, the pages 50%, and the whole-site check plus save 15%.
function jobProgress(state) {
  const done = (id) => ['done', 'skipped'].includes(state.stages?.[id]?.status);
  const early = ['normalize', 'crawl', 'dom', 'styles', 'assets', 'inventory', 'design', 'shared'];
  const late = ['regression', 'save'];
  const pages = Object.values(state.pageStates || {});
  const pagePart = pages.length ? pages.filter((p) => ['validated', 'built-with-issues', 'failed'].includes(p.status)).length / pages.length : 0;
  const fraction = (early.filter(done).length / early.length) * 0.35 + pagePart * 0.5 + (late.filter(done).length / late.length) * 0.15;
  return Math.max(20, Math.min(66, Math.round(20 + fraction * 46)));
}

function createJobSync({ update, url, throttleMs = 700, now = Date.now }) {
  let last = 0; let pending = null; let timer = null;
  const write = async (state) => {
    pending = null; last = now();
    const queue = toQueue(state);
    try {
      await update({ progress: jobProgress(state), stepName: describeActivity(state), 'analysis.prototype': { url, used: true, engine: true, mode: state.mode || null, queue } });
    } catch { /* progress display only */ }
  };
  return {
    onState(state) {
      pending = state;
      const wait = throttleMs - (now() - last);
      if (wait <= 0) { void write(state); return; }
      if (!timer) timer = setTimeout(() => { timer = null; if (pending) void write(pending); }, wait);
    },
    async flush(state) { if (timer) { clearTimeout(timer); timer = null; } await write(state); }
  };
}

/** The record kept on the job once the engine finished. Small: the full report lives on the project. */
function finalAnalysis(url, result) {
  const r = result.report;
  return {
    url, used: result.mode !== 'prompt-only', engine: true, mode: result.mode, queue: toQueue(result.state),
    report: { mode: r.mode, label: r.label, headline: r.headline, crawl: { captured: r.crawl.captured, failed: r.crawl.failed, discovered: r.crawl.discovered, truncated: r.crawl.truncated, truncatedReason: r.crawl.truncatedReason }, counts: r.counts, assets: { slots: r.assets.slots, filledBy: r.assets.filledBy, unresolved: r.assets.unresolved.length }, unresolved: r.unresolved.slice(0, 30), missingEvidence: r.missingEvidence.slice(0, 40) }
  };
}

module.exports = { describeActivity, jobProgress, createJobSync, finalAnalysis };
