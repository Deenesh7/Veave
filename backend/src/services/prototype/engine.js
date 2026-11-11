'use strict';

const { resolveConfig } = require('./config');
const { normalizeReferenceUrl } = require('./urlNormalizer');
const crawler = require('./crawler');
const { buildDesignSystem, renderThemeFiles, pickTypography, pickLayout, pickColors, pickEffects } = require('./designSystem');
const assetSlots = require('./assetSlots');
const { buildInventory } = require('./inventory');
const validator = require('./validator');
const templates = require('./templates');
const generator = require('./generator');
const { buildReport, toQueue, PAGE_DONE } = require('./report');
const { scaffoldReactProject } = require('../project/reactScaffolder');

/**
 * The prototype engine. It runs the 13 stages below as independently tracked, retryable operations. All side effects
 * (model calls, browser, storage) come in through `deps`, so every stage can be tested with fakes.
 *
 *   1 normalize   2 crawl   3 dom   4 styles   5 assets   6 inventory   7 design   8 shared   9 pages
 *   10 validate   11 repair   12 regression   13 save
 *
 * State is plain JSON (stage records, reference data, per-page status) and is saved after every change, so a restarted
 * job continues from its last valid checkpoint instead of starting over.
 */

const STAGE_ORDER = ['normalize', 'crawl', 'dom', 'styles', 'assets', 'inventory', 'design', 'shared', 'pages', 'validate', 'repair', 'regression', 'save'];
const isAbort = (error) => error?.name === 'AbortError';

function newState({ runId, url }) {
  return { version: 1, runId, url, normalizedUrl: null, mode: null, startedAt: new Date().toISOString(), stages: {}, data: {}, pageStates: {}, usage: null, events: [] };
}

// ---- compact reference data (kept in the job document; the heavy parts live in the browser cache) --------------------
function trimMetrics(m, { keepNav = false, keepAssets = true } = {}) {
  if (!m) return null;
  const { links, assets, nav, ...rest } = m;
  return {
    ...rest,
    headings: (m.headings || []).slice(0, 14),
    sections: (m.sections || []).slice(0, 40).map(({ index, tag, kind, selector, heading, headingLevel, headingFontSize, textLength, words, images, buttons, items, columns, background, paddingY, align, rect, fullBleed }) => ({ index, tag, kind, selector, heading, headingLevel, headingFontSize, textLength, words, images, buttons, items, columns, background, paddingY, align, rect, fullBleed })),
    nav: keepNav ? (nav || []).slice(0, 80) : [],
    assets: keepAssets ? (assets || []).filter((a) => a.visible && a.rect.w >= 8).slice(0, 120).map(({ kind, src, tag, selector, alt, title, className, rect, zone, sectionIndex, inLink, linkHref, nearText, objectFit, borderRadius, order, naturalWidth, naturalHeight, loaded, decorative, visible }) => ({ kind, src: String(src).slice(0, 400), tag, selector, alt, title, className, rect, zone, sectionIndex, inLink, linkHref, nearText, objectFit, borderRadius, order, naturalWidth, naturalHeight, loaded, decorative, visible })) : [],
    slots: [], defects: m.defects
  };
}
function compactPage(page, { keepAssets = true } = {}) {
  const home = page.route === '/';
  return { route: page.route, url: page.url, finalUrl: page.finalUrl, status: page.status, attempts: page.attempts, depth: page.depth, discoveredFrom: page.discoveredFrom, title: page.title, httpStatus: page.httpStatus, failedRequests: (page.failedRequests || []).slice(0, 10), desktop: trimMetrics(page.desktop, { keepNav: home, keepAssets }), mobile: trimMetrics(page.mobile, { keepNav: false, keepAssets }) };
}

async function runPrototype(ctx) {
  const config = ctx.config || resolveConfig();
  const deps = ctx.deps;
  const request = ctx.prompt;
  const siteName = ctx.siteName || 'My Website';
  const state = ctx.state && ctx.state.version === 1 ? ctx.state : newState({ runId: ctx.runId || `proto_${Date.now().toString(36)}`, url: ctx.url });
  state.url = ctx.url;
  const signal = deps.signal;
  const usageSink = (completion) => { if (completion?.usage && deps.mergeUsage) state.usage = deps.mergeUsage(state.usage, completion.usage); };

  const checkAbort = () => { if (signal?.aborted) { const e = new Error('Cancelled'); e.name = 'AbortError'; throw e; } };
  const persist = async () => {
    try { await deps.saveState?.(state); } catch (error) { deps.log?.warn?.(`prototype state save failed: ${error.message}`); }
    try { deps.onState?.(state); } catch { /* progress display only */ }
  };
  const note = (type, detail) => { state.events.push({ at: new Date().toISOString(), type, ...detail }); if (state.events.length > 80) state.events.splice(0, state.events.length - 80); };

  // ---- stage runner -------------------------------------------------------------------------------------------------
  async function stage(name, fn, { retries = 0, fatal = true } = {}) {
    const record = state.stages[name] || (state.stages[name] = { status: 'pending', attempts: 0 });
    if (record.status === 'done' || record.status === 'skipped') return record.output;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      checkAbort();
      record.status = 'running'; record.attempts += 1; record.startedAt = new Date().toISOString(); record.error = null;
      await persist();
      try {
        const output = await fn(record);
        record.status = 'done'; record.finishedAt = new Date().toISOString();
        await persist();
        return output;
      } catch (error) {
        if (isAbort(error)) throw error;
        record.error = String(error.message).slice(0, 400);
        note('stage-error', { stage: name, attempt: record.attempts, message: record.error });
        if (attempt < retries) { await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 1500)); continue; }
        record.status = 'failed'; record.finishedAt = new Date().toISOString();
        await persist();
        if (fatal) throw error;
        return null;
      }
    }
    return null;
  }
  const skip = (name, reason) => { state.stages[name] = { status: 'skipped', attempts: 0, detail: reason }; };

  const finish = async (mode, files = null) => {
    state.mode = mode;
    const report = buildReport(state, config);
    state.mode = report.mode;
    state.report = report;
    await persist();
    return { state, report, mode: report.mode, files, usage: state.usage };
  };

  // =============================== 1. normalize ====================================================================
  let normalized;
  try {
    normalized = await stage('normalize', async (record) => {
      const result = normalizeReferenceUrl(state.url);
      if (!result.ok) throw new Error(result.message);
      await (deps.validateUrl || (async () => {}))(result.url);
      state.normalizedUrl = result.url; record.detail = result.changed ? `normalized to ${result.url}` : null;
      return result;
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    state.data.fatal = { stage: 'normalize', message: error.message };
    return finish('prompt-only');
  }
  const origin = normalized?.origin || new URL(state.normalizedUrl).origin;

  // =============================== 2. crawl ========================================================================
  try {
    await stage('crawl', async (record) => {
      const result = await (deps.crawl || crawler.crawlReference)({ url: state.normalizedUrl, config, signal, validateUrl: deps.validateUrl, onProgress: (e) => { note('crawl', e); } });
      const captured = result.pages.filter((p) => p.status === 'captured');
      if (!captured.length) { const first = result.failures[0]; throw new Error(first ? `${first.route}: ${first.message}` : 'no page could be captured'); }
      if (!captured.some((p) => p.route === '/')) {
        // an entry URL that is not the home page still counts as the first page
        captured[0].route = captured[0].route || '/';
      }
      state.data.crawl = { origin, failures: result.failures, discovered: result.discovered, truncated: result.truncated, truncatedReason: result.truncatedReason, queued: (result.queued || []).slice(0, 80), robots: result.robots, sitemapRoutes: result.sitemapRoutes, durationMs: result.durationMs };
      state.data.pages = captured.map((p) => compactPage(p));
      for (const [route, image] of result.images || []) crawler.writeCachedImage(state.runId, route, image);
      record.detail = `${captured.length} page(s) captured, ${result.failures.length} failed${result.truncated ? `, stopped at ${result.truncatedReason}` : ''}`;
    }, { retries: 1 });
  } catch (error) {
    if (isAbort(error)) throw error;
    state.data.fatal = { stage: 'crawl', message: error.message };
    return finish('prompt-only');
  }
  const pages = () => state.data.pages;

  // =============================== 3. dom ==========================================================================
  await stage('dom', async (record) => {
    state.data.dom = pages().map((p) => ({ route: p.route, title: p.title, sections: (p.desktop.sections || []).length, headings: (p.desktop.headings || []).length, words: p.desktop.wordCount, navLinks: p.route === '/' ? (p.desktop.nav || []).length : undefined, hasMobile: Boolean(p.mobile) }));
    record.detail = `${state.data.dom.length} page structure(s) read`;
  }, { fatal: false });

  // =============================== 4. styles =======================================================================
  await stage('styles', async (record) => {
    const withDesktop = pages().filter((p) => p.desktop);
    const typography = pickTypography(withDesktop);
    state.data.styles = { roles: Object.keys(typography), colors: pickColors(withDesktop), layout: pickLayout(withDesktop), effects: pickEffects(withDesktop), mobileMeasured: withDesktop.filter((p) => p.mobile).length };
    record.detail = `${state.data.styles.roles.length} text role(s) measured on ${withDesktop.length} page(s), mobile on ${state.data.styles.mobileMeasured}`;
  }, { fatal: false });

  // =============================== 5. assets =======================================================================
  await stage('assets', async (record) => {
    const manifest = assetSlots.buildAssetManifest(pages(), { origin });
    if (deps.downloadAssets !== false) {
      await (deps.downloadAssets || ((m, o) => assetSlots.downloadReferenceAssets(m, o)))(manifest, { cacheDir: crawler.cacheDirFor(`${state.runId}-assets`), validateUrl: deps.validateUrl, signal });
    }
    state.data.manifest = manifest;
    // the page snapshots no longer need their raw asset lists
    pages().forEach((p) => { if (p.desktop) p.desktop.assets = []; if (p.mobile) p.mobile.assets = []; });
    record.detail = `${manifest.stats.assets} asset(s), ${manifest.stats.slots} slot(s)${manifest.unavailable?.length ? `, ${manifest.unavailable.length} unavailable` : ''}`;
  }, { fatal: false });
  const manifest = state.data.manifest || { assets: [], slots: [], skipped: [], stats: { assets: 0, slots: 0 } };

  // =============================== 6. inventory ====================================================================
  try {
  await stage('inventory', async (record) => {
    const buildable = pages().filter((p) => !p.route.includes('?'));
    const inventory = buildInventory(buildable, { origin, assets: manifest, maxBuildPages: config.maxBuildPages });
    pages().filter((p) => p.route.includes('?')).forEach((p) => inventory.notBuilt.push({ route: p.route, reason: 'query-string variant of another page' }));
    state.data.inventory = inventory;
    record.detail = `${inventory.counts.toBuild} page(s) to build, ${inventory.shared.length} shared component(s)`;
  });

  // =============================== 7. design =======================================================================
  await stage('design', async (record) => {
    state.data.designSystem = await buildDesignSystem(pages(), { source: { url: state.normalizedUrl }, getCatalogue: deps.getFontCatalogue });
    if (!state.data.designSystem.ok) throw new Error(state.data.designSystem.message);
    record.detail = `fonts ${state.data.designSystem.fonts.heading?.original || '?'} / ${state.data.designSystem.fonts.body?.original || '?'}, ${state.data.designSystem.colors.palette.length} colours`;
  });
  } catch (error) {
    if (isAbort(error)) throw error;
    state.data.fatal = { stage: state.stages.design?.status === 'failed' ? 'design' : 'inventory', message: error.message };
    return finish('prompt-only');
  }
  const inventory = state.data.inventory;
  const ds = state.data.designSystem;

  // ---- project files: scaffold + theme + data + stubs + slots (deterministic; reused when a checkpoint exists) ---------
  let files = (await deps.loadProjectFiles?.()) || null;
  const routePaths = inventory.pages.map((p) => ({ route: p.route, label: p.title }));
  const slotRoutes = inventory.pages.map((p) => p.route);
  const palette = { surface2: ds.colors.surface2, muted: ds.colors.muted };
  const userImages = (ctx.uploadedImages || []).slice(0, 12);
  let mapping;
  const fillSlots = () => {
    const { files: slotFiles, mapping: m } = assetSlots.renderSlotFiles(manifest, { routes: slotRoutes, palette, userImages });
    mapping = m;
    state.data.mapping = Object.fromEntries(m);
    return slotFiles;
  };
  if (!files || !files.length || !files.some((f) => f.path === 'src/data/site.js')) {
    let base = scaffoldReactProject([], { projectName: siteName });
    base = renderThemeFiles(ds, base);
    const merged = new Map(base.map((f) => [f.path, f]));
    [templates.siteDataFile({ siteName, navigation: inventory.navigation, routes: routePaths }), templates.gsapHookFile(), templates.fallbackNavbar(), templates.fallbackFooter(), ...inventory.pages.map(templates.stubPageFile), templates.appFile(inventory.pages), ...fillSlots()].forEach((f) => merged.set(f.path, f));
    files = [...merged.values()];
  } else {
    // resumed: keep the saved files, rebuild only the slot mapping
    const { mapping: m } = assetSlots.renderSlotFiles(manifest, { routes: slotRoutes, palette, userImages });
    mapping = m; state.data.mapping = Object.fromEntries(m);
  }
  if (!mapping) mapping = new Map(Object.entries(state.data.mapping || {}));
  const ensureMapping = () => { if (!mapping || !mapping.size) mapping = new Map(Object.entries(state.data.mapping || {})); return mapping; };

  const render = deps.render;
  const referenceFor = (page) => { const p = pages().find((x) => x.route === page.route); return { desktop: p?.desktop || null, mobile: p?.mobile || null }; };
  const slotsFor = (route) => manifest.slots.filter((s) => s.route === route && s.kind !== 'svg' && !s.decorative);
  const saveProject = async (meta) => { try { await deps.persistProject?.(files, meta); } catch (error) { if (isAbort(error)) throw error; note('save-error', { ...meta, message: error.message }); throw error; } };

  // =============================== 8. shared components ============================================================
  await stage('shared', async (record) => {
    const logo = manifest.slots.find((s) => s.role === 'logo' && s.zone === 'header' && s.route === '/');
    const assetsForShared = logo ? { logoSlot: { slotId: logo.slotId, publicPath: ensureMapping().get(logo.slotId)?.publicPath, width: logo.width, height: logo.height } } : null;
    try {
      const result = await generator.generateShared({ generate: deps.generate, files, request, siteName, ds, inventory, assetsForShared, usageSink, attempts: config.pageGenerationAttempts });
      // the shell must render before it is accepted
      const probe = await render(result.files, inventory.pages[0].route, 'desktop');
      if (!probe.ok) throw new Error(`The shared components do not render: ${probe.error}`);
      if (!(probe.metrics.sections || []).some((s) => s.kind === 'header')) throw new Error('The shared components render no header.');
      files = result.files; record.detail = 'navigation and footer generated';
    } catch (error) {
      if (isAbort(error)) throw error;
      // keep the working fallback shell and say so
      record.detail = `degraded: using the plain navigation and footer (${String(error.message).slice(0, 160)})`;
      state.data.sharedDegraded = String(error.message).slice(0, 300);
      note('shared-degraded', { message: state.data.sharedDegraded });
    }
    await saveProject({ stage: 'shared' });
  });

  // =============================== 9-11. pages: generate, validate, repair =========================================
  const stateOfPage = (page) => state.pageStates[page.route] || (state.pageStates[page.route] = { status: 'queued', label: page.title || page.route, file: page.file, attempts: 0, repairAttempts: 0, issues: [] });
  inventory.pages.forEach(stateOfPage);
  await persist();
  const pagesRecord = state.stages.pages || (state.stages.pages = { status: 'pending', attempts: 0 });
  state.stages.validate = state.stages.validate || { status: 'pending', attempts: 0 };
  state.stages.repair = state.stages.repair || { status: 'pending', attempts: 0 };

  const pageHasCode = (page) => { const f = files.find((x) => x.path === page.file); return Boolean(f && !String(f.content).includes('data-prototype-stub')); };

  async function processPage(page) {
    const ps = stateOfPage(page);
    if (PAGE_DONE.has(ps.status) && pageHasCode(page)) return; // checkpoint: already built and saved
    const refs = referenceFor(page);
    const slots = slotsFor(page.route);
    const baseline = files;
    let bestFiles = null; let result = null;
    ps.error = null;

    // ---- 9. generate (bounded attempts happen inside the generator)
    ps.status = 'generating'; ps.attempts += 1; await persist();
    let image = null;
    try { image = await deps.getReferenceImage?.(page, state); } catch { image = null; }
    try {
      const generated = await generator.generatePage({ generate: deps.generate, files, request, siteName, ds, page, slots, mapping: ensureMapping(), inventory, image, usageSink, attempts: config.pageGenerationAttempts });
      files = generated.files; bestFiles = files;
    } catch (error) {
      if (isAbort(error)) throw error;
      // The model's last candidate may still be renderable; try it once instead of giving up on the page.
      if (error.candidate && error.touched) { files = error.candidate; bestFiles = files; ps.error = String(error.message).slice(0, 300); }
      else { files = baseline; ps.status = 'failed'; ps.error = String(error.message).slice(0, 300); note('page-failed', { route: page.route, message: ps.error }); await persist(); return; }
    }

    // ---- 10. validate (rendered, against the reference)
    const validateNow = async (only = null) => {
      ps.status = 'validating'; state.stages.validate.status = 'running'; await persist();
      return validator.validatePage({ files, page, referenceMetrics: refs, designSystem: ds, config, manifest, mapping: ensureMapping(), render, only });
    };
    result = await validateNow();
    ps.lastValidation = { passed: result.passed, counts: result.counts, issues: result.issues.slice(0, 40) };

    // ---- 11. repair: targeted patches, bounded, re-validating each time
    while (!result.passed && ps.repairAttempts < config.pageRepairAttempts) {
      checkAbort();
      ps.status = 'repairing'; ps.repairAttempts += 1; state.stages.repair.status = 'running'; await persist();
      const before = files;
      try {
        const fixed = await generator.repairPage({ generate: deps.generate, files, request, page, result, instructions: validator.repairInstructions(result), slots, mapping: ensureMapping(), usageSink });
        files = fixed.files;
      } catch (error) {
        if (isAbort(error)) throw error;
        files = before; note('repair-failed', { route: page.route, message: String(error.message).slice(0, 200) });
        continue;
      }
      const failedViewports = [...new Set(result.issues.filter((i) => ['blocking', 'major'].includes(i.severity)).map((i) => i.viewport))];
      const next = await validateNow(failedViewports.length === 2 ? null : failedViewports);
      // A repair that makes things worse is thrown away.
      const score = (r) => (r.counts.blocking * 100) + (r.counts.major * 10) + r.counts.minor;
      const previousScore = score(result);
      if (failedViewports.length === 2 || !next.viewports.length) {
        if (score(next) <= previousScore) { result = next; bestFiles = files; } else { files = before; }
      } else {
        // only some viewports were re-checked: merge with the viewports that were not
        const kept = result.issues.filter((i) => !failedViewports.includes(i.viewport));
        const merged = validator.summarizeResult([{ viewport: 'desktop', issues: [...kept.filter((i) => i.viewport === 'desktop'), ...next.issues.filter((i) => i.viewport === 'desktop')], checks: [] }, { viewport: 'mobile', issues: [...kept.filter((i) => i.viewport === 'mobile'), ...next.issues.filter((i) => i.viewport === 'mobile')], checks: [] }]);
        merged.checks = next.checks;
        if (score(merged) <= previousScore) { result = merged; bestFiles = files; } else { files = before; }
      }
      ps.lastValidation = { passed: result.passed, counts: result.counts, issues: result.issues.slice(0, 40) };
    }

    // never keep a page that does not render at all
    const renders = !result.issues.some((i) => i.kind === 'render-failed');
    if (!renders) {
      files = baseline; ps.status = 'failed'; ps.error = result.issues.find((i) => i.kind === 'render-failed')?.message?.slice(0, 300) || 'The page does not render.';
      note('page-failed', { route: page.route, message: ps.error });
      await persist();
      return;
    }
    ps.status = result.passed ? 'validated' : 'built-with-issues';
    ps.lastValidation = { passed: result.passed, counts: result.counts, issues: result.issues.slice(0, 40) };
    ps.savedAt = new Date().toISOString();
    await persist();
    // ---- save this page on its own: a later failure cannot undo it
    try { await saveProject({ stage: 'page', route: page.route, status: ps.status }); } catch (error) { ps.error = `saved in memory only: ${String(error.message).slice(0, 160)}`; await persist(); }
  }

  pagesRecord.status = 'running'; pagesRecord.attempts += 1; await persist();
  for (const page of inventory.pages) {
    checkAbort();
    try { await processPage(page); }
    catch (error) {
      if (isAbort(error)) throw error;
      const ps = stateOfPage(page); ps.status = 'failed'; ps.error = String(error.message).slice(0, 300); note('page-failed', { route: page.route, message: ps.error }); await persist();
    }
  }
  const finishedPages = Object.values(state.pageStates);
  pagesRecord.status = 'done'; pagesRecord.detail = `${finishedPages.filter((p) => p.status === 'validated').length} validated, ${finishedPages.filter((p) => p.status === 'built-with-issues').length} with issues, ${finishedPages.filter((p) => p.status === 'failed').length} failed`;
  state.stages.validate.status = 'done'; state.stages.validate.detail = `${finishedPages.length} page(s) checked`;
  state.stages.repair.status = 'done'; state.stages.repair.detail = `${finishedPages.reduce((n, p) => n + (p.repairAttempts || 0), 0)} repair attempt(s)`;
  await persist();

  // =============================== 12. regression ==================================================================
  async function regression(reason) {
    const targets = inventory.pages.filter((p) => PAGE_DONE.has(stateOfPage(p).status) || stateOfPage(p).status === 'regressed');
    const regressed = []; const repaired = []; const checked = [];
    for (const page of targets) {
      checkAbort();
      const ps = stateOfPage(page);
      const before = ps.lastValidation?.counts || { blocking: 0, major: 0 };
      const result = await validator.validatePage({ files, page, referenceMetrics: referenceFor(page), designSystem: ds, config, manifest, mapping: ensureMapping(), render });
      checked.push({ route: page.route, passed: result.passed, counts: result.counts });
      const worse = result.counts.blocking > before.blocking || result.counts.major > before.major;
      if (!worse) { ps.lastValidation = { passed: result.passed, counts: result.counts, issues: result.issues.slice(0, 40) }; ps.status = result.passed ? 'validated' : 'built-with-issues'; continue; }
      // the page was fine before the shared change: try a bounded targeted repair
      let current = result; let ok = false;
      for (let i = 0; i < config.regressionRepairAttempts && !current.passed; i += 1) {
        try {
          const fixed = await generator.repairPage({ generate: deps.generate, files, request, page, result: current, instructions: validator.repairInstructions(current), slots: slotsFor(page.route), mapping: ensureMapping(), usageSink });
          const candidate = fixed.files;
          const saved = files; files = candidate;
          const next = await validator.validatePage({ files, page, referenceMetrics: referenceFor(page), designSystem: ds, config, manifest, mapping: ensureMapping(), render });
          if (next.counts.blocking + next.counts.major <= current.counts.blocking + current.counts.major) { current = next; ok = next.counts.blocking <= before.blocking && next.counts.major <= before.major; } else { files = saved; }
        } catch (error) { if (isAbort(error)) throw error; }
      }
      ps.lastValidation = { passed: current.passed, counts: current.counts, issues: current.issues.slice(0, 40) };
      if (ok || current.passed) { ps.status = current.passed ? 'validated' : 'built-with-issues'; repaired.push(page.route); }
      else { ps.status = 'regressed'; regressed.push({ route: page.route, before, after: current.counts, issues: current.issues.filter((x) => x.severity !== 'minor').slice(0, 6).map((x) => x.message) }); }
    }
    state.data.regression = { reason, checkedAt: new Date().toISOString(), checked, regressed, repaired };
    return state.data.regression;
  }
  await stage('regression', async (record) => {
    if (!inventory.pages.some((p) => PAGE_DONE.has(stateOfPage(p).status))) { record.detail = 'no built page to check'; state.data.regression = { reason: 'final', checked: [], regressed: [], repaired: [] }; return; }
    const r = await regression('final');
    record.detail = `${r.checked.length} page(s) re-checked, ${r.regressed.length} regressed, ${r.repaired.length} repaired`;
  }, { fatal: false });

  // =============================== 13. save ========================================================================
  await stage('save', async (record) => {
    await saveProject({ stage: 'final' });
    record.detail = 'project saved';
  }, { retries: 1, fatal: false });
  crawler.clearCache(state.runId); crawler.clearCache(`${state.runId}-assets`);
  return finish(null, files);
}

/**
 * Applies a change to shared components (e.g. a new Navbar) and re-checks every built page, repairing regressions.
 * Exposed so a shared-component retry always triggers the full-site check.
 */
async function applySharedChange({ state, files, sharedFiles, config, deps, request = '' }) {
  const merged = new Map(files.map((f) => [f.path, f]));
  sharedFiles.forEach((f) => merged.set(f.path, f));
  const next = [...merged.values()];
  const ds = state.data.designSystem; const manifest = state.data.manifest;
  const mapping = new Map(Object.entries(state.data.mapping || {}));
  const checked = []; const regressed = [];
  for (const page of state.data.inventory.pages) {
    const ps = state.pageStates[page.route];
    if (!ps || !PAGE_DONE.has(ps.status)) continue;
    const refs = (() => { const p = state.data.pages.find((x) => x.route === page.route); return { desktop: p?.desktop || null, mobile: p?.mobile || null }; })();
    const result = await validator.validatePage({ files: next, page, referenceMetrics: refs, designSystem: ds, config, manifest, mapping, render: deps.render });
    const before = ps.lastValidation?.counts || { blocking: 0, major: 0 };
    const worse = result.counts.blocking > before.blocking || result.counts.major > before.major;
    checked.push({ route: page.route, passed: result.passed });
    if (worse) regressed.push({ route: page.route, before, after: result.counts, issues: result.issues.filter((i) => i.severity !== 'minor').slice(0, 5).map((i) => i.message) });
  }
  return { files: next, checked, regressed, accepted: regressed.length === 0 };
}

module.exports = { runPrototype, applySharedChange, newState, compactPage, trimMetrics, STAGE_ORDER, toQueue };
