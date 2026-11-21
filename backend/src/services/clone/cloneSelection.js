const MAX_PLAN_ASSETS = 4000;
const SCRAPE_BATCH = Math.max(1, Math.min(50, Number.parseInt(process.env.CLONE_SCRAPE_MORE_BATCH, 10) || 10));
const NOT_SCRAPEABLE = new Set(['robots-disallowed']);

const tokensPerStep = () => Number.parseInt(process.env.CLONE_ESTIMATED_TOKENS_PER_STEP, 10) || 12000;
const refineStepsPerPage = () => Math.max(0, Number.parseInt(process.env.CLONE_ESTIMATED_REFINE_PER_PAGE, 10) || 0);
const minutesPerStep = () => Number.parseFloat(process.env.CLONE_MINUTES_PER_STEP) || 1.5;

const isCaptured = (page) => page?.captureStatus === 'captured';

function pathOf(route) {
  try {
    const url = new URL(route);
    return `${url.pathname}${url.search}`;
  } catch {
    return String(route || '');
  }
}

function titleFromPath(path) {
  const last = String(path).split('?')[0].split('/').filter(Boolean).at(-1);
  return last ? decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Home';
}

/** Pages the crawl found but did not capture (and could still scrape), keyed by path. Nothing is invented: it is the crawl report. */
const samePath = (path) => String(path).split('#')[0].replace(/\/+$/, '') || '/';

function excludedRoutes(capture) {
  // A site that redirects /about to /about/ captures the page under the redirected path: compare without the trailing slash.
  const capturedPaths = new Set((capture.pages || []).filter(isCaptured).map((page) => samePath(page.path)));
  const report = capture.coverage?.crawlReport || {};
  const found = new Map();
  for (const item of report.unexplored || []) {
    const path = pathOf(item.route);
    if (!capturedPaths.has(samePath(path)) && !found.has(path)) found.set(path, { path, route: item.route, reason: item.reason || 'page-budget' });
  }
  for (const item of report.failed || []) {
    const path = pathOf(item.route);
    if (!capturedPaths.has(samePath(path)) && !found.has(path)) found.set(path, { path, route: item.route, reason: `failed:${item.reason || 'capture-error'}` });
  }
  return [...found.values()];
}

/**
 * The plan shown to the user for approval. Every number is derived from the real capture: pages and sections from the
 * extracted source, steps from the same stage builder the build uses, tokens and credits from the per-step estimate.
 */
function buildClonePlan(capture, { buildStages, creditsForTokens, hardCap }) {
  const captured = (capture.pages || []).filter(isCaptured);
  const stages = buildStages(captured);
  const tps = tokensPerStep();
  const refine = refineStepsPerPage();
  const pages = captured.map((page) => {
    const steps = stages.filter((stage) => stage.page?.path === page.path).length;
    const tokens = (steps + refine) * tps;
    return {
      path: page.path,
      title: page.title || titleFromPath(page.path),
      pageType: page.pageType || null,
      sections: page.extraction?.htmlSections?.length || page.sections?.length || 0,
      steps,
      refineSteps: refine,
      tokens,
      credits: creditsForTokens(tokens)
    };
  });
  const indexByPath = new Map(pages.map((page, index) => [page.path, index]));
  const assets = capture.assets || [];
  const assetIndex = assets.slice(0, MAX_PLAN_ASSETS).map((asset) => [
    asset.byteLength || 0,
    ...(asset.isDocument ? [] : [...new Set((asset.pages || []).map((path) => indexByPath.get(path)).filter((index) => index !== undefined))])
  ]);
  const assetBytes = assets.reduce((sum, asset) => sum + (asset.byteLength || 0), 0);
  const indexedBytes = assetIndex.reduce((sum, entry) => sum + entry[0], 0);
  const excluded = excludedRoutes(capture).map(({ path, reason }) => ({ path, title: titleFromPath(path), reason, scrapeable: !NOT_SCRAPEABLE.has(reason) }));
  const remainingCapacity = Math.max(0, hardCap - captured.length);
  return {
    sourceUrl: capture.canonicalUrl || capture.sourceUrl,
    homePath: captured[0]?.path || '/',
    pageCount: pages.length,
    stageCount: stages.length,
    assetCount: assets.length,
    assetBytes,
    // Bytes of assets not in `assetIndex` (more than MAX_PLAN_ASSETS): always counted, never attributed to a page.
    assetBytesUnattributed: Math.max(0, assetBytes - indexedBytes),
    assetIndex,
    estimatedMinutes: Math.max(1, Math.round(stages.length * minutesPerStep())),
    estimatedCredits: pages.reduce((sum, page) => sum + page.credits, 0),
    tokensPerStep: tps,
    pages,
    excluded: excluded.slice(0, 500),
    excludedTotal: excluded.length,
    canScrapeMore: remainingCapacity > 0 && excluded.some((item) => item.scrapeable),
    scrapeBatch: Math.min(SCRAPE_BATCH, remainingCapacity),
    note: 'Each page is built in several steps (top, content parts, footer) when it is large, so the number of steps can exceed the number of pages. Final credits are calculated from actual usage after the build.'
  };
}

/** Validates a client selection against the stored plan and returns the cost computed from the SERVER's numbers. */
function priceSelection(plan, selectedPaths) {
  const wanted = Array.isArray(selectedPaths) ? [...new Set(selectedPaths.map(String))] : null;
  if (!wanted || !wanted.length) return { error: 'Select at least one page to clone.' };
  const byPath = new Map((plan?.pages || []).map((page) => [page.path, page]));
  const unknown = wanted.filter((path) => !byPath.has(path));
  if (unknown.length) return { error: `These pages are not part of the plan: ${unknown.slice(0, 5).join(', ')}` };
  if (!byPath.has(plan.homePath) || !wanted.includes(plan.homePath)) return { error: 'The home page is required: every other page is built on top of it.' };
  return { paths: wanted, credits: wanted.reduce((sum, path) => sum + byPath.get(path).credits, 0) };
}

/** Removes the pages the user did not select, and the assets/placements only those pages used. */
function applySelection(capture, selectedPaths, { buildSiteMap }) {
  const keep = new Set(selectedPaths);
  const pages = (capture.pages || []).filter((page) => !isCaptured(page) || keep.has(page.path));
  if (pages.length === (capture.pages || []).length) return capture;
  const remaining = new Set(pages.map((page) => page.path));
  const capturedKept = new Set(pages.filter(isCaptured).map((page) => page.path));
  const assets = (capture.assets || []).filter((asset) => asset.isDocument || !(asset.pages || []).length || asset.pages.some((path) => capturedKept.has(path)));
  const assetQueue = (capture.assetQueue || []).filter((item) => !item.page || remaining.has(item.page)).map((item, index) => ({ ...item, order: index }));
  const pagesWithQueue = pages.map((page) => (isCaptured(page) ? { ...page, assetQueue: assetQueue.filter((item) => item.page === page.path) } : page));
  const keptUrls = new Set(pages.filter(isCaptured).map((page) => page.url));
  return {
    ...capture,
    pages: pagesWithQueue,
    assets,
    assetQueue,
    siteMap: buildSiteMap(pagesWithQueue),
    urlRegistry: { ...(capture.urlRegistry || {}), clonedURLs: (capture.urlRegistry?.clonedURLs || []).filter((url) => keptUrls.has(url)) },
    coverage: { ...(capture.coverage || {}), capturedPages: capturedKept.size, attemptedPages: pages.length }
  };
}

/** The routes to scrape for a "scrape more pages" request: the ones asked for, or the next batch when none were chosen. */
function pickMoreRoutes(capture, requestedPaths, { hardCap }) {
  const capacity = hardCap - (capture.pages || []).filter(isCaptured).length;
  if (capacity <= 0) return { error: `The page limit of ${hardCap} pages is reached.` };
  const scrapeable = excludedRoutes(capture).filter((item) => !NOT_SCRAPEABLE.has(item.reason));
  const byPath = new Map(scrapeable.map((item) => [item.path, item]));
  let chosen;
  if (Array.isArray(requestedPaths) && requestedPaths.length) {
    const unknown = requestedPaths.filter((path) => !byPath.has(String(path)));
    if (unknown.length) return { error: `These pages cannot be scraped: ${unknown.slice(0, 5).join(', ')}` };
    chosen = [...new Set(requestedPaths.map(String))].map((path) => byPath.get(path));
  } else {
    chosen = scrapeable.slice(0, SCRAPE_BATCH);
  }
  if (!chosen.length) return { error: 'There are no more pages to scrape.' };
  chosen = chosen.slice(0, Math.min(capacity, 50));
  return { routes: chosen.map((item) => item.route), paths: chosen.map((item) => item.path) };
}

/**
 * One "scrape more pages" request against the capture held by a running job: pick the routes, capture exactly those, merge them
 * in and return the new capture. The input capture is never changed, so a failed scrape leaves the plan exactly as it was.
 */
async function scrapeMore(capture, request, { sourceUrl, signal, captureWebsite, hardCap, merge, session = null }) {
  const picked = pickMoreRoutes(capture, request.paths, { hardCap });
  if (picked.error) throw new Error(picked.error);
  const before = capture.pages.filter(isCaptured).length;
  const extra = await captureWebsite(sourceUrl, { signal, onlyRoutes: picked.routes, session });
  const next = merge(capture, extra);
  const added = next.pages.filter(isCaptured).length - before;
  if (added <= 0) throw new Error('None of those pages could be captured.');
  return { capture: next, added, message: `Added ${added} page${added === 1 ? '' : 's'}.` };
}

const TOKEN = /^__VEAVE_CLONE_ASSET_(\d+)__$/;

/** Adds the pages of a targeted scrape to the capture, merging byte-identical assets and keeping asset tokens unique. */
function mergeCapture(base, extra, { normalizeRoute, dedupePlacements, buildSiteMap, guard }) {
  const origin = new URL(base.canonicalUrl || base.sourceUrl).origin;
  const offset = (base.assets || []).length;
  const stamp = `m${Date.now().toString(36)}`;
  const tokenMap = new Map();
  const assets = (extra.assets || []).map((asset, index) => {
    const match = TOKEN.exec(asset.token || '');
    const next = `__VEAVE_CLONE_ASSET_${offset + (match ? Number(match[1]) : index)}__`;
    tokenMap.set(asset.token, next);
    return { ...asset, token: next };
  });
  const queue = (extra.assetQueue || []).map((item) => ({ ...item, id: `${stamp}:${item.id}`, token: item.token ? (tokenMap.get(item.token) || item.token) : item.token }));
  const sheets = new Map();
  for (const sheet of [...(base.stylesheets || []), ...(extra.stylesheets || [])]) if (!sheets.has(sheet.key)) sheets.set(sheet.key, sheet);

  const combined = {
    ...base,
    pages: [...(base.pages || []), ...(extra.pages || [])],
    assets: [...(base.assets || []), ...assets],
    assetQueue: [...(base.assetQueue || []), ...queue],
    stylesheets: [...sheets.values()],
    screenshots: { ...(base.screenshots || {}), routes: [...(base.screenshots?.routes || []), ...(extra.screenshots?.routes || [])] }
  };
  const { capture: cleaned } = guard.enforceUniqueCapture(combined, { normalizeRoute, dedupePlacements, origin });
  guard.assertNoCaptureDuplicates(cleaned, { normalizeRoute, dedupePlacements, origin });

  const captured = cleaned.pages.filter(isCaptured);
  const capturedUrls = new Set(captured.map((page) => normalizeRoute(page.url, origin) || page.url));
  const report = cleaned.coverage?.crawlReport || {};
  const stillUnexplored = (report.unexplored || []).filter((item) => !capturedUrls.has(normalizeRoute(item.route, origin) || item.route));
  const stillFailed = (report.failed || []).filter((item) => !capturedUrls.has(normalizeRoute(item.route, origin) || item.route));
  return {
    ...cleaned,
    siteMap: buildSiteMap(cleaned.pages),
    urlRegistry: {
      ...(base.urlRegistry || {}),
      visitedURLs: [...new Set([...(base.urlRegistry?.visitedURLs || []), ...(extra.urlRegistry?.visitedURLs || [])])],
      clonedURLs: captured.map((page) => page.url)
    },
    assetDiscovery: {
      ...(base.assetDiscovery || {}),
      localizedAssets: cleaned.assets.length,
      discoveredReferences: (base.assetDiscovery?.discoveredReferences || 0) + (extra.assetDiscovery?.discoveredReferences || 0)
    },
    coverage: {
      ...(base.coverage || {}),
      attemptedPages: cleaned.pages.length,
      capturedPages: captured.length,
      unavailablePages: cleaned.pages.length - captured.length,
      crawlReport: { ...report, capturedRoutes: captured.length, unexplored: stillUnexplored, unexploredCount: stillUnexplored.length, failed: stillFailed, failedCount: stillFailed.length }
    }
  };
}

module.exports = { scrapeMore, buildClonePlan, priceSelection, applySelection, pickMoreRoutes, mergeCapture, excludedRoutes, pathOf, SCRAPE_BATCH };
