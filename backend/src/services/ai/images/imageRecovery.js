/**
 * Self-healing image recovery for a candidate website. It runs inside the generation job whenever image validation finds a
 * shortfall, and it keeps going until the requirement is met or the configured attempts are used up:
 *
 *   1. analyse         what is downloaded, what the code references, what is missing or broken (reconciliation report)
 *   2. place           verified pictures that are saved but unused go into the page and section they were assigned to
 *   3. discover        if the site is still short, new pictures are searched for the pages that lack them, verified and stored
 *   4. place again     the new pictures go into their pages
 *   5. (the caller)    rebuilds, re-counts, and checks that the pictures really render in the browser
 *
 * Placement is deterministic JSX editing (imagePlacement.js), not another model call, so it cannot re-introduce invented links and it
 * costs nothing. Nothing here creates a job or charges the user: recovery is part of the job that is already running.
 */
const { imageConfig } = require('./imageConfig');
const imageValidation = require('./imageValidation');
const imageDiscovery = require('./imageDiscoveryService');
const { placeAssets } = require('./imagePlacement');

const deficitOf = (counts, cfg) => ({ home: Math.max(0, cfg.minHome - counts.home.count), site: Math.max(0, cfg.minSite - counts.site.count) });

/** The page file that renders a route, from the router. */
function pageResolver(files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const routes = require('../pageDistinctness').extractRoutes(files);
  const completeness = require('../siteCompleteness');
  const app = byPath.get('src/App.jsx') || byPath.get('src/App.tsx') || byPath.get('src/App.js');
  return (route) => {
    const found = routes.find((item) => item.path === route && item.target && byPath.has(item.target));
    if (found) return found.target;
    if (route === '/' && app) return completeness.findHomeFile(files, byPath, app, [])?.path || null;
    return null;
  };
}

/** The human-readable diagnostic: required / found / missing, what was recovered, and the result. */
function formatDiagnostic({ before, after, cfg, log, rendered = null }) {
  const line = (label, required, found) => `${label}:\n  Required: ${required}\n  ${rendered ? 'Rendered' : 'Found'}: ${found}\n  Missing: ${Math.max(0, required - found)}`;
  const placed = log.flatMap((entry) => entry.placed || []);
  const discovered = log.reduce((sum, entry) => sum + (entry.discovered || 0), 0);
  const files = [...new Set(placed.map((item) => item.file))];
  const ok = after.home >= cfg.minHome && after.site >= cfg.minSite;
  return [
    `Image Validation: ${ok ? 'PASSED' : 'FAILED'}`,
    line('Home page', cfg.minHome, after.home),
    line('Total website', cfg.minSite, after.site),
    before ? `Before recovery: home ${before.home}, website ${before.site}` : null,
    `Recovery attempts used: ${log.length}`,
    `Unused verified assets placed: ${placed.length}`,
    `New pictures discovered and verified: ${discovered}`,
    `Components updated: ${files.length ? files.join(', ') : 'none'}`,
    log.some((entry) => (entry.failed || []).length) ? `Could not place: ${log.flatMap((entry) => entry.failed || []).map((item) => `${item.id} (${item.reason})`).join('; ')}` : null,
    `Result: ${ok ? 'PASSED' : 'NOT YET - see the remaining issues'}`
  ].filter(Boolean).join('\n');
}

/**
 * @param files         the candidate project files
 * @param imageContext  { jobId, assets, files, missing, plan, taken, attempts }  (mutated: it carries the manifest of the job)
 * @param placeOnly     true = only place what already exists (no searching), used for the final pass
 * @returns {{ files, changed, satisfied, log, report, diagnostic }}
 */
async function recoverImages({ files, imageContext, prompt, spec, signal, cfg = imageConfig(), onStage = null, placeOnly = false, deps = {} } = {}) {
  const stage = (name, info = {}) => { try { onStage?.(name, info); } catch { /* progress reporting must never break recovery */ } };
  const inspect = deps.inspectProjectImages || imageValidation.inspectProjectImages;
  const discover = deps.discoverImages || imageDiscovery.discoverImages;
  const log = imageContext.recoveryLog || (imageContext.recoveryLog = []);
  const attemptsAllowed = Number.isFinite(cfg.recoveryAttempts) ? cfg.recoveryAttempts : 3;
  let current = files;
  let changed = false;
  stage('image_validation');
  let info = await inspect(current);
  let counts = imageValidation.countsByRoute(current, info);
  const first = { home: counts.home.count, site: counts.site.count };
  let missing = deficitOf(counts, cfg);

  // The manifest's own files are part of the project: restore any that vanished, replace any that no longer decode (in place).
  stage('image_failure_analysis');
  const taken = imageContext.taken || (imageContext.taken = { sha256: new Set(), hashes: [] });
  const byPath = new Map(current.map((file) => [file.path, file]));
  for (const asset of imageContext.assets || []) {
    const stored = (imageContext.files || []).find((file) => file.path === asset.path);
    if (!byPath.has(asset.path) && stored) { current = imageDiscovery.mergeAssetFiles(current, [stored]); changed = true; }
    else if (byPath.has(asset.path) && info.get(asset.path) && !info.get(asset.path).valid && !placeOnly) {
      const replacement = await (deps.replaceAsset || imageDiscovery.replaceAsset)(asset, { signal, taken, exclude: [asset.sha256] });
      if (replacement.ok) {
        current = current.map((file) => (file.path === asset.path ? replacement.file : file));
        Object.assign(asset, replacement.asset);
        const at = (imageContext.files || []).findIndex((file) => file.path === asset.path);
        if (at >= 0) imageContext.files[at] = replacement.file;
        changed = true;
      }
    }
  }
  if (changed) { info = await inspect(current); counts = imageValidation.countsByRoute(current, info); missing = deficitOf(counts, cfg); }

  const unplaceable = imageContext.unplaceable || (imageContext.unplaceable = new Set());
  const pending = () => imageDiscovery.spareAssets(current, imageContext.assets || []).filter((asset) => !unplaceable.has(asset.id));
  const satisfied = () => missing.home === 0 && missing.site === 0;
  const recount = async () => { info = await inspect(current); counts = imageValidation.countsByRoute(current, info); missing = deficitOf(counts, cfg); };
  const place = (assets, entry) => {
    if (!assets.length) return;
    stage('image_placement_repair', { count: assets.length });
    const placed = placeAssets(current, assets, { pageFor: pageResolver(current) });
    if (placed.placements.length) { current = placed.files; changed = true; stage('component_update', { files: [...new Set(placed.placements.map((item) => item.file))] }); }
    entry.placed.push(...placed.placements);
    entry.failed.push(...placed.failed);
    for (const failure of placed.failed) unplaceable.add(failure.id); // a picture that cannot be placed safely is not retried forever
  };

  const tried = imageContext.triedQueries || (imageContext.triedQueries = new Set());
  for (let round = 0; round < attemptsAllowed + 3 && !signal?.aborted; round += 1) {
    const spare = pending();
    const entry = { attempt: log.length + 1, before: { home: counts.home.count, site: counts.site.count }, placed: [], failed: [], discovered: 0 };

    // Use what is already downloaded first: it costs nothing and needs no search.
    if (spare.length) {
      stage('unused_asset_reconciliation', { unused: spare.length });
      place(spare, entry);
      stage('rebuild');
      await recount();
      entry.after = { home: counts.home.count, site: counts.site.count };
      log.push(entry);
      continue;
    }
    if (satisfied() || placeOnly || (imageContext.attempts || 0) >= attemptsAllowed) break;

    // Still short: find new pictures for the pages that lack them, verify and store them, then place them.
    imageContext.attempts = (imageContext.attempts || 0) + 1;
    stage('missing_asset_discovery', { missing });
    const targets = [];
    if (missing.home > 0) targets.push({ page: 'Home', route: '/', count: missing.home + 1 });
    const siteShort = Math.max(0, missing.site - missing.home);
    if (siteShort > 0) {
      const others = Object.entries(counts.routes).filter(([route]) => route !== '/' && !/contact/i.test(route)).sort((a, b) => a[1].count - b[1].count);
      const pageName = (route) => (imageContext.plan?.pages || []).find((page) => page.route === route)?.name || route.replace(/^\//, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Home';
      const pool = others.length ? others : [['/', { count: 0 }]];
      for (let i = 0; i < siteShort + 1; i += 1) {
        const [route] = pool[i % pool.length];
        const existing = targets.find((target) => target.route === route);
        if (existing) existing.count += 1; else targets.push({ page: pageName(route), route, count: 1 });
      }
    }
    const requirements = imageDiscovery.extraRequirements({ plan: imageContext.plan, assets: imageContext.assets || [], prompt, spec, targets, count: 0, exclude: tried });
    if (!requirements.length) { log.push({ ...entry, note: 'no further search queries are available' }); break; }
    requirements.forEach((requirement) => tried.add(requirement.query));
    let found;
    try {
      found = await discover({ prompt, spec, scope: `${imageContext.jobId}-recovery-${log.length + 1}`, signal, taken, requirements, existingPaths: new Set(current.map((file) => file.path)), onStage: (name, data) => stage(name, data) });
    } catch (error) {
      if (signal?.aborted) throw error;
      log.push({ ...entry, note: `discovery failed: ${String(error.message).slice(0, 120)}` });
      continue;
    }
    stage('alternative_image_download', { downloaded: found.assets.length });
    entry.discovered = found.assets.length;
    entry.unfound = found.missing.map((item) => ({ slot: item.slot, code: item.code }));
    imageContext.missing = [...(imageContext.missing || []), ...found.missing];
    if (found.assets.length) {
      const assetFiles = found.files.filter((file) => file.path !== imageDiscovery.MANIFEST_PATH);
      imageContext.assets = [...(imageContext.assets || []), ...found.assets];
      imageContext.files = [...(imageContext.files || []), ...assetFiles];
      current = imageDiscovery.mergeAssetFiles(current, assetFiles);
      current = [...current.filter((file) => file.path !== imageDiscovery.MANIFEST_PATH), imageDiscovery.manifestFile(imageContext.assets, imageContext.plan)];
      changed = true;
      place(found.assets, entry);
    }
    stage('rebuild');
    await recount();
    entry.after = { home: counts.home.count, site: counts.site.count };
    log.push(entry);
  }

  const report = imageValidation.reconcile(current, { assets: imageContext.assets || [], info, cfg });
  const after = { home: counts.home.count, site: counts.site.count };
  const diagnostic = formatDiagnostic({ before: first, after, cfg, log });
  imageContext.report = report;
  return { files: current, changed, satisfied: satisfied(), log, report, diagnostic, counts: after };
}

module.exports = { recoverImages, formatDiagnostic, pageResolver };
