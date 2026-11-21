/**
 * Image discovery for a new website: plan -> search -> choose -> verify -> download -> store -> map.
 *
 * Nothing here trusts a search hit or a model-written link. A candidate becomes an asset only after its bytes were downloaded
 * by the server, decoded as a photograph, checked for size / shape / duplicates, converted to WebP and given a project path
 * (public/assets/images/<slot>.webp). The generator is then handed those local paths, so the site never depends on a remote link.
 */
const { imageConfig } = require('./imageConfig');
const { buildRequirements, detectIndustry, slug, INDUSTRY_AVOID } = require('./imageRequirements');
const { searchTopic } = require('./imageSources');
const { verifyAndPrepare, relevanceOf, rejectCandidate, hamming } = require('./imageVerification');
const { evaluateCandidate, avoidHit, clearEvaluationCache } = require('./imageEvaluator');
const remoteImageLocalizer = require('../remoteImageLocalizer');

const STAGES = ['image_requirements', 'image_discovery', 'image_selection', 'image_verification', 'image_download', 'asset_mapping'];
const IMAGE_DIR = 'public/assets/images';
const MANIFEST_PATH = 'src/assets/image-manifest.json';

// Verified downloads and search answers are kept briefly so a retry, a repair round or a second job asking for the same thing
// does not hit the network again.
const downloadCache = new Map();
const searchCache = new Map();
const inflight = new Map();
const DOWNLOAD_TTL = 30 * 60 * 1000;
const SEARCH_TTL = 10 * 60 * 1000;
function remember(map, key, value, limit) {
  if (map.size >= limit) map.delete(map.keys().next().value);
  map.set(key, { at: Date.now(), value });
}
const recall = (map, key, ttl) => { const hit = map.get(key); return hit && Date.now() - hit.at <= ttl ? hit.value : null; };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sentence = (text) => { const value = String(text || '').trim(); return value ? `${value[0].toUpperCase()}${value.slice(1)}` : ''; };

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next; next += 1; results[index] = await worker(items[index], index); }
  }));
  return results;
}

/** Downloads one candidate with transient-error retries. Throws an Error with .code. */
async function fetchCandidate(url, { download, signal, cfg }) {
  const cached = recall(downloadCache, url, DOWNLOAD_TTL);
  if (cached) return cached;
  let lastError;
  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    try {
      const body = await download(url, { signal });
      remember(downloadCache, url, body, 60);
      return body;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      // A missing file or a refusal will not change on a retry; a timeout or a server error might.
      if (/HTTP 4\d\d|larger than|private|not allowed|blocked/i.test(String(error.message))) break;
      await sleep(250 * (attempt + 1));
    }
  }
  const failure = new Error(String(lastError?.message || lastError || 'download failed').slice(0, 160));
  failure.code = /timed? ?out|aborted/i.test(failure.message) ? 'download_timeout' : 'download_failed';
  throw failure;
}

async function searchOnce(query, requirement, { env, signal, cfg, search }) {
  const key = `${query}|${requirement.orientation}`;
  const cached = recall(searchCache, key, SEARCH_TTL);
  if (cached) return cached;
  const result = await search(query, { requirement, env, signal, cfg });
  if (result.candidates.length) remember(searchCache, key, result, 100);
  return result;
}

function rankCandidates(candidates, query, requirement, attempted, { visual = false } = {}) {
  const seen = new Set();
  const ranked = [];
  const refused = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url) || attempted.has(candidate.url)) continue;
    seen.add(candidate.url);
    const bad = rejectCandidate(candidate, { query });
    if (bad) { refused.push({ url: candidate.url, ...bad }); continue; }
    const hit = avoidHit(candidate, requirement);
    if (hit) { refused.push({ url: candidate.url, code: 'contradicts_section', reason: `its description mentions "${hit}", which this section must not show` }); continue; }
    const relevance = relevanceOf(candidate, query);
    // With a vision model the pixels decide, so a provider's sparse caption only has to hint at the subject; without one the caption is all there is.
    const needed = visual ? 1 : relevance.needed;
    if (!relevance.trusted && relevance.matched < needed) { refused.push({ url: candidate.url, code: 'not_relevant', reason: relevance.reason || `only ${relevance.matched} of the subject words appear in its description` }); continue; }
    const pixels = (Number(candidate.width) || 0) * (Number(candidate.height) || 0);
    const fits = requirement.orientation === 'portrait' ? (candidate.height > candidate.width ? 1 : 0) : (candidate.width >= candidate.height ? 1 : 0);
    ranked.push({ candidate, relevance, score: relevance.score * 100 + fits * 10 + (candidate.curated ? 8 : 0) + Math.min(10, pixels / 1_000_000) - Number(candidate.rank || 0) * 0.3 });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ranked: ranked.map((item) => item.candidate), refused };
}

const DUPLICATE_BITS = 5;
const sameAsTaken = (meta, taken) => taken.sha256.has(meta.sha256) || (meta.hash && taken.hashes.some((other) => hamming(other, meta.hash) <= DUPLICATE_BITS));
const reserve = (meta, taken) => { taken.sha256.add(meta.sha256); if (meta.hash) taken.hashes.push(meta.hash); };

const newState = () => ({ attempted: new Set(), failures: [], providerNotes: [], tried: 0, searchedOk: false, allProvidersFailed: true, pool: [], usedQueries: new Set(), evalRejected: 0 });

/**
 * One search round for one slot: search, filter, download, verify the bytes, then EVALUATE each verified picture against the section.
 * Nothing is reserved here; the qualified candidates form the slot's pool and the site-wide assignment chooses between slots.
 */
async function gatherSlot(requirement, ctx, state, queries) {
  const { cfg, env, signal, taken, download, search, vision = null, site = {}, excludeHashes = new Set() } = ctx;
  const poolTarget = vision && cfg.visionEval ? cfg.poolSize : 1; // metadata evaluation is free but each extra pool entry is a download, so only collect more when it buys a better choice
  let roundTried = 0;
  state.pool = [];
  for (const query of queries) {
    if (signal?.aborted || state.pool.length >= poolTarget || state.pool.some((item) => item.evaluation.visuallyVerified && item.evaluation.score >= cfg.evalGoodScore)) break;
    state.usedQueries.add(query);
    let result;
    try { result = await searchOnce(query, requirement, { env, signal, cfg, search }); } catch (error) { if (signal?.aborted) break; state.providerNotes.push({ query, error: String(error.message).slice(0, 100) }); continue; }
    state.providerNotes.push({ query, providers: result.diagnostics });
    if (result.diagnostics.some((item) => item.status === 'ok')) { state.searchedOk = true; state.allProvidersFailed = false; }
    const { ranked, refused } = rankCandidates(result.candidates, query, requirement, state.attempted, { visual: Boolean(vision && cfg.visionEval) });
    state.failures.push(...refused.slice(0, 5));
    for (const candidate of ranked) {
      if (roundTried >= cfg.maxCandidatesPerSlot || signal?.aborted || state.pool.length >= poolTarget || state.pool.some((item) => item.evaluation.visuallyVerified && item.evaluation.score >= cfg.evalGoodScore)) break;
      state.attempted.add(candidate.url);
      roundTried += 1;
      state.tried += 1;
      let body;
      try { body = await fetchCandidate(candidate.url, { download, signal, cfg }); }
      catch (error) { if (signal?.aborted) break; state.failures.push({ url: candidate.url, code: error.code || 'download_failed', reason: error.message }); continue; }
      const verified = await verifyAndPrepare(body, requirement, { cfg, taken });
      if (!verified.ok) { state.failures.push({ url: candidate.url, code: verified.code, reason: verified.reason }); continue; }
      if (excludeHashes.has(verified.meta.sha256) || sameAsTaken(verified.meta, taken) || state.pool.some((item) => item.verified.meta.sha256 === verified.meta.sha256)) { state.failures.push({ url: candidate.url, code: 'duplicate', reason: 'the same picture is already used on this site' }); continue; }
      const evaluation = await evaluateCandidate({ buffer: verified.buffer, meta: verified.meta, candidate, requirement, query, site, vision, cfg });
      if (!evaluation.pass) { state.evalRejected += 1; state.failures.push({ url: candidate.url, code: evaluation.code || 'below_threshold', reason: evaluation.reason, score: evaluation.score }); continue; }
      state.pool.push({ candidate, query, verified, evaluation });
      if (evaluation.visuallyVerified && evaluation.score >= cfg.evalGoodScore) break; // good enough: stop paying for more evaluations of this slot
    }
  }
}

function buildAsset(requirement, item, ctx, state) {
  const { candidate, query, verified, evaluation } = item;
  const path = `${IMAGE_DIR}/${requirement.slot}.webp`;
  const focal = evaluation.focalPoint;
  const asset = {
    id: requirement.slot, jobId: ctx.scope, page: requirement.page, route: requirement.route, section: requirement.section, sectionId: requirement.sectionId || null, layout: requirement.layout || null, generic: Boolean(requirement.generic), category: requirement.category,
    // What the photograph shows (when it was looked at) is a truer alt text than what the plan hoped to find.
    alt: sentence(evaluation.visuallyVerified && evaluation.description ? evaluation.description : requirement.altHint).slice(0, 160), aspect: requirement.aspect, hero: Boolean(requirement.hero), component: requirement.component || null,
    path, publicPath: `/${path.slice('public/'.length)}`, mime: verified.meta.mime, width: verified.meta.width, height: verified.meta.height, bytes: verified.meta.bytes, sha256: verified.meta.sha256, hash: verified.meta.hash,
    sourceUrl: candidate.url, sourcePage: candidate.pageUrl || null, provider: candidate.provider, creator: candidate.creator || '', license: candidate.license || '', licenseUrl: candidate.licenseUrl || '',
    query, attempts: state.tried, status: 'verified', storage: 'pending_commit',
    evaluation: { mode: evaluation.mode, visuallyVerified: evaluation.visuallyVerified, score: evaluation.score, threshold: evaluation.threshold, scores: evaluation.scores },
    requirementHints: { subject: requirement.subject || '', style: requirement.style || '', avoid: requirement.avoid || [], sectionSummary: requirement.sectionSummary || '', sectionHeading: requirement.sectionHeading || '', component: requirement.component || '', orientation: requirement.orientation },
    objectPosition: focal ? `${focal.x}% ${focal.y}%` : null, overlay: evaluation.overlay || null, textSafeZone: evaluation.textSafeZone || null, tone: evaluation.tone || null
  };
  return { ok: true, asset, file: { path, content: verified.buffer.toString('base64'), language: 'binary', encoding: 'base64' } };
}

function missingFor(requirement, state, signal) {
  const { failures, providerNotes, tried, searchedOk, allProvidersFailed } = state;
  const codeCount = (code) => failures.filter((item) => item.code === code).length;
  let code = 'no_relevant_image';
  if (signal?.aborted) code = 'timeout';
  else if (!searchedOk && allProvidersFailed) code = providerNotes.some((note) => note.providers?.some((p) => p.code === 'provider_rate_limited')) ? 'provider_rate_limited' : (providerNotes.some((note) => note.providers?.some((p) => p.status === 'skipped' && p.code === 'not_configured')) && !providerNotes.some((note) => note.providers?.some((p) => p.status === 'error')) ? 'no_provider_configured' : 'provider_unavailable');
  else if (tried > 0 && codeCount('download_failed') + codeCount('download_timeout') >= tried) code = 'download_failed';
  else if (state.evalRejected > 0) code = 'below_relevance_threshold';
  else if (tried > 0) code = failures.filter((item) => item.url).every((item) => ['bad_aspect', 'low_resolution', 'duplicate', 'blank_image', 'too_small', 'too_large'].includes(item.code)) ? 'unsuitable_image' : 'invalid_image';
  return { slot: requirement.slot, page: requirement.page, route: requirement.route, section: requirement.section, query: requirement.query, code, tried, failures: failures.slice(0, 8), providers: providerNotes.slice(0, 4) };
}

const SLOT_WORDS = /\b(photograph(?:y|s)?|photo|photos|image|images|stock|high[- ]quality|professional|modern|creative|business)\b/gi;

/**
 * A better query for a slot nothing qualified for. With a model the rejection reasons are used ("the results showed offices, we need
 * houses"); without one only the plan's own alternates and a stripped-down subject are tried. Queries already used are never repeated.
 */
async function rewriteQueries(requirement, state, ctx) {
  const used = state.usedQueries;
  const fresh = (list) => [...new Set(list.map((q) => String(q || '').replace(SLOT_WORDS, ' ').replace(/\s+/g, ' ').trim()).filter((q) => q.split(' ').length >= 2))].filter((q) => !used.has(q));
  let queries = [];
  if (ctx.ask) {
    try {
      const reasons = [...new Set(state.failures.map((item) => item.reason).filter(Boolean))].slice(0, 6).join('; ');
      const raw = await ctx.ask('You write stock-photo search queries. Reply with ONLY JSON: {"queries": [string, string, string]}. Each query is 3-7 words naming the concrete subject, setting and photographic style of a REAL photograph. Never use generic words like business, professional, modern or creative on their own. Never repeat a query that failed.',
        `Website industry: ${ctx.site?.industry || 'unknown'}; subject: ${ctx.site?.subject || 'n/a'}.\nSection: ${requirement.page} / ${requirement.section}. ${requirement.sectionSummary || ''}\nThe picture must show: ${requirement.subject || requirement.query}. Style: ${requirement.style || 'natural photography'}. Must not show: ${(requirement.avoid || []).join(', ') || 'n/a'}.\nQueries that found nothing usable: ${[...used].join(' | ')}.\nWhy candidates were rejected: ${reasons || 'nothing relevant came back'}.`);
      const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
      queries = json ? (JSON.parse(json).queries || []).map((q) => String(q).slice(0, 90)) : [];
    } catch { /* the deterministic rewrites below are always available */ }
  }
  return fresh([...queries, ...(requirement.alternates || []), requirement.subject, `${requirement.subject || ''} ${ctx.site?.industry || ''}`]).slice(0, ctx.cfg.alternateQueriesPerSlot);
}

/**
 * Chooses a picture for every slot at once. Hero slots choose first (they matter most), then the slots with the fewest options;
 * a picture used by one slot is never offered to another. This replaces first-come-first-served selection, so the result does not
 * depend on which download happened to finish first.
 */
function assignPools(order, requirements, states, taken) {
  const results = new Map();
  const sorted = [...order].sort((a, b) => (Number(requirements[b].hero) - Number(requirements[a].hero)) || (states[a].pool.length - states[b].pool.length) || (a - b));
  for (const index of sorted) {
    const choices = [...states[index].pool].sort((x, y) => y.evaluation.score - x.evaluation.score || y.verified.meta.width * y.verified.meta.height - x.verified.meta.width * x.verified.meta.height);
    const pick = choices.find((item) => !sameAsTaken(item.verified.meta, taken));
    if (!pick) { if (choices.length) states[index].failures.push({ code: 'duplicate', reason: 'every qualified picture was already assigned to another section' }); continue; }
    reserve(pick.verified.meta, taken);
    results.set(index, pick);
  }
  return results;
}

/**
 * Finds, downloads, verifies and EVALUATES pictures for several slots and assigns them together.
 * A slot nothing qualified for is searched again (up to cfg.requeryRounds) with a rewritten query; if it still has no qualified
 * candidate it is reported missing, never filled with the best of a poor set.
 * @returns {Array<{ ok: true, asset, file } | { ok: false, missing }>} in the order of `requirements`
 */
async function runSlots(requirements, ctx) {
  const { cfg, signal } = ctx;
  const states = requirements.map(() => newState());
  const results = new Array(requirements.length);
  let pending = requirements.map((_, index) => index);
  for (let round = 0; round <= cfg.requeryRounds && pending.length && !signal?.aborted; round += 1) {
    if (round > 0) {
      const rewritten = await Promise.all(pending.map((index) => rewriteQueries(requirements[index], states[index], ctx)));
      pending.forEach((index, at) => { states[index].next = rewritten[at]; });
    }
    await mapPool(pending, cfg.concurrency, async (index) => {
      const requirement = requirements[index];
      const state = states[index];
      const base = [requirement.query, ...(requirement.alternates || [])].filter(Boolean).slice(0, 1 + cfg.alternateQueriesPerSlot);
      // Round 0 uses the plan's queries; a later round uses the rewritten ones, plus the plan's own when a rival simply took the best picture.
      const queries = round === 0 ? base : [...(state.next || []), ...(state.lostToRival ? base : [])];
      if (!queries.length) { state.pool = []; return; }
      await gatherSlot(requirement, ctx, state, queries);
    });
    const assigned = assignPools(pending, requirements, states, ctx.taken);
    for (const [index, item] of assigned) results[index] = buildAsset(requirements[index], item, ctx, states[index]);
    pending.forEach((index) => { states[index].lostToRival = !assigned.has(index) && states[index].pool.length > 0; });
    pending = pending.filter((index) => !assigned.has(index));
    states.forEach((state) => { if (state.pool.length) state.pool = []; });
  }
  return requirements.map((requirement, index) => results[index] || { ok: false, missing: missingFor(requirement, states[index], signal) });
}

/** One slot: the same evaluate-then-assign path as a whole site, so a replacement is held to the same standard. */
async function fulfilSlot(requirement, ctx) {
  return (await runSlots([requirement], ctx))[0];
}

const withoutBuffers = (assets) => assets.map(({ hash, ...rest }) => rest);

function manifestFile(assets, plan) {
  const body = {
    generatedAt: new Date().toISOString(), industry: plan?.industry || null, subject: plan?.subject || null,
    assets: withoutBuffers(assets).map((asset) => ({ ...asset, jobId: undefined }))
  };
  return { path: MANIFEST_PATH, content: `${JSON.stringify(body, null, 2)}\n`, language: 'json', encoding: 'utf8' };
}

/**
 * Plans the site's images and obtains a verified file for each one.
 * @param ask    optional async (system, user) => string used for a better plan; the deterministic plan is the fallback
 * @param onStage optional (stage, info) => void
 * @returns {{ plan, assets, files, missing, diagnostics }}
 */
async function discoverImages({ prompt, spec = null, ask = null, vision = null, siteContext = null, signal, env = process.env, cfg = imageConfig(env), scope = 'job', requirements = null, taken = null,
  onStage = null, download = remoteImageLocalizer.downloadPublicImage, search = (query, options) => searchTopic(query, { ...options, env: options.env || env }), existingPaths = new Set() } = {}) {
  const stage = (name, info = {}) => { if (onStage) { try { onStage(name, info); } catch { /* progress reporting must never break discovery */ } } };
  stage('image_requirements');
  const plan = requirements ? { requirements, industry: null, subject: null, source: 'given' } : await buildRequirements({ prompt, spec, ask, cfg });
  stage('image_requirements', { count: plan.requirements.length, source: plan.source });

  const budgetMs = vision && cfg.visionEval ? Math.min(cfg.totalTimeoutMaxMs || cfg.totalTimeoutMs, cfg.totalTimeoutMs + plan.requirements.length * (cfg.visionMsPerSlot || 0)) : cfg.totalTimeoutMs;
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(budgetMs)]);
  const shared = taken || { sha256: new Set(), hashes: [] };
  const assets = [];
  const files = [];
  const missing = [];

  stage('image_discovery', { slots: plan.requirements.length });
  const site = { name: '', industry: plan.industry, subject: plan.subject, visualDirection: plan.visualDirection || '', ...(siteContext || {}) };
  const key = `${scope}:${plan.requirements.map((requirement) => requirement.slot).join(',')}`;
  let work = inflight.get(key); // the same slots of the same job are never processed twice at once
  if (!work) {
    work = runSlots(plan.requirements, { cfg, env, signal: deadline, taken: shared, download, search, scope, ask, vision, site }).finally(() => inflight.delete(key));
    inflight.set(key, work);
  }
  const results = await work;
  stage('image_selection', { selected: results.filter((item) => item.ok).length, rejectedByEvaluation: results.filter((item) => !item.ok && item.missing.code === 'below_relevance_threshold').length });
  stage('image_verification', { verified: results.filter((item) => item.ok).length });

  for (const result of results) {
    if (result.ok) {
      let { asset, file } = result;
      if (existingPaths.has(file.path)) { // a different picture already owns that name: never overwrite it
        const path = `${IMAGE_DIR}/${asset.id}-${asset.sha256.slice(0, 6)}.webp`;
        asset = { ...asset, path, publicPath: `/${path.slice('public/'.length)}` };
        file = { ...file, path };
      }
      assets.push(asset);
      files.push(file);
    } else missing.push(result.missing);
  }
  stage('image_download', { downloaded: assets.length });
  if (assets.length) files.push(manifestFile(assets, plan));
  stage('asset_mapping', { mapped: assets.length, missing: missing.length });
  return { plan, assets, files, missing, taken: shared, site, diagnostics: summarizeDiagnostics(missing), floor: floorFor(missing, cfg), vision, ask };
}

/**
 * The picture floor after slots that were left empty on purpose. A slot counts only when pictures WERE found and judged unsuitable
 * (or none were relevant): an outage, a timeout or a failed download is a failure to fix, not a reason to lower the bar.
 */
const DELIBERATE = new Set(['below_relevance_threshold', 'no_relevant_image', 'unsuitable_image', 'invalid_image']);
function floorFor(missing, cfg) {
  const waived = missing.filter((item) => DELIBERATE.has(item.code));
  const site = Math.max(0, cfg.minSite - waived.length);
  // The home page can never be required to show more pictures than the whole site is (found live: every empty slot was on other pages, so the home
  // floor stayed at 3 while the site floor fell to 2, and a site with 2 relevant pictures on its home page was rejected).
  const home = Math.min(Math.max(0, cfg.minHome - waived.filter((item) => item.route === '/').length), site);
  return { home, site, waived: waived.map((item) => item.slot) };
}

function summarizeDiagnostics(missing) {
  const byCode = {};
  for (const item of missing) byCode[item.code] = (byCode[item.code] || 0) + 1;
  return byCode;
}

const REASONS = {
  no_provider_configured: 'no image search provider is available',
  provider_unavailable: 'the image providers could not be reached',
  provider_rate_limited: 'the image providers are rate limited right now',
  no_relevant_image: 'no relevant photograph was found',
  below_relevance_threshold: 'no photograph was relevant enough to this section',
  download_failed: 'the candidate images could not be downloaded',
  download_timeout: 'the candidate images timed out',
  invalid_image: 'the candidate images were not usable photographs',
  unsuitable_image: 'the candidates were the wrong size or shape, or already used elsewhere',
  timeout: 'image discovery ran out of time'
};
const reasonFor = (code) => REASONS[code] || code;

const FRAME = { hero: 'aspect-[16/9] w-full object-cover', feature: 'aspect-[4/3] w-full object-cover', service: 'aspect-[4/3] w-full object-cover', about: 'aspect-[4/3] w-full object-cover', team: 'aspect-[4/5] w-full object-cover object-top', gallery: 'aspect-square w-full object-cover', news: 'aspect-[16/9] w-full object-cover', product: 'aspect-square w-full object-cover', section: 'aspect-[4/3] w-full object-cover' };

/** What the evaluation found about text over THIS photograph, so the overlay is chosen from the picture and not applied by habit. */
function heroAdvice(asset) {
  const zone = asset.textSafeZone && asset.textSafeZone !== 'none' ? `; the calmest area for text is the ${asset.textSafeZone} side, so place the headline there` : '';
  const overlay = { none: 'no overlay is needed', light: 'at most a light scrim (about bg-black/10 to bg-black/25)', medium: 'a medium scrim (about bg-black/35 to bg-black/45)', strong: 'a strong scrim (about bg-black/55 to bg-black/65)' }[asset.overlay] || 'a light scrim only if the text is not readable';
  return `\n    hero text over this photograph: the photograph is ${asset.tone || 'mid'}-toned; ${overlay}${zone}. Do not add a darker overlay than this and do not hide the subject behind the text.`;
}

/** The block appended to the generation prompt: verified local files only, grouped by page, with exact placement rules. */
function buildPromptBlock({ assets = [], missing = [] } = {}) {
  if (!assets.length && !missing.length) return '';
  const lines = ['VERIFIED PROJECT IMAGES (real photographs the server already found, downloaded, decoded and checked; they are saved in the project):'];
  const byPage = new Map();
  for (const asset of assets) byPage.set(asset.page, [...(byPage.get(asset.page) || []), asset]);
  for (const [page, list] of byPage) {
    lines.push(`\n${page} page (${list[0].route}):`);
    for (const asset of list) {
      const frame = FRAME[asset.category] || FRAME.section;
      const position = asset.objectPosition ? ` object-position: ${asset.objectPosition} (focal point of the photograph; keep it inside the frame, for example style={{ objectPosition: '${asset.objectPosition}' }})` : '';
      const checked = asset.evaluation?.visuallyVerified ? 'visually checked' : 'matched by metadata only';
      lines.push(`- ${asset.publicPath}  [${asset.section}${asset.component ? `, ${asset.component}` : ''}; ${asset.width}x${asset.height}; ${checked}] alt="${asset.alt}" frame: ${frame}${position}${asset.hero ? ' (hero: eager, fetchPriority="high")' : ''}${asset.hero ? heroAdvice(asset) : ''}`);
    }
  }
  if (missing.length) {
    lines.push(`\nNo verified picture could be found for: ${missing.map((item) => `${item.page} / ${item.section} (${reasonFor(item.code)})`).join('; ')}. Lay those sections out without a picture slot (text, icons or cards); never invent an image link for them and never draw an empty box or a gradient where a photograph should be.`);
  }
  const homeCount = Math.max(3, assets.filter((asset) => asset.route === '/').length);
  lines.push(`
RULES FOR THESE IMAGES:
- Use ONLY the paths above, written exactly as shown (for example <img src="${assets[0]?.publicPath || '/assets/images/home-hero.webp'}" ...>). Do not invent, shorten, change or add image links of your own for these sections.
- Put each image on the page and in the section named above, and nowhere else. Use every image at most once: never repeat one picture to fill another slot.
- Every <img> sits in a fixed-aspect frame using the frame classes above (aspect-ratio + w-full + object-cover), carries the alt text above (you may refine it to be more specific, never empty), and has width and height attributes or an aspect-ratio frame so the layout does not jump.
- Choose text contrast per photograph, not by habit: use the hero text advice given under each hero image (a light overlay or none for a photograph that already has calm areas; never a blanket dark overlay on every hero), and keep the main subject of every photograph clear of the text.
- A section listed without a picture stays without one; never fill it with another section's photograph.
- The hero image is not lazy: <img src="..." alt="..." className="aspect-[16/9] w-full object-cover" fetchPriority="high" />. Every other image below the first screen uses loading="lazy" decoding="async".
- The Home page must show at least ${homeCount} of these images (hero plus feature cards), and every other page shows the images listed for it.
- Add a small "Photo credits" line in the footer: one line listing the creators and sources found in src/assets/image-manifest.json (creator name and provider).`);
  return lines.join('\n');
}

/** Verified assets the project does not reference yet (offered to the repair step instead of asking the model for new links). */
function spareAssets(files = [], assets = []) {
  const sources = files.filter((file) => file && file.encoding !== 'base64' && typeof file.content === 'string' && /\.(?:jsx?|tsx?|css|html)$/i.test(file.path || '')).map((file) => file.content).join('\n');
  return assets.filter((asset) => !sources.includes(asset.publicPath) && !sources.includes(asset.path.split('/').pop()));
}

/** Adds the discovered files that the project does not have yet. */
function mergeAssetFiles(files, assetFiles = []) {
  const have = new Set(files.map((file) => file.path));
  return [...files, ...assetFiles.filter((file) => !have.has(file.path))];
}

/** Removes discovered pictures that no page ended up using (and refreshes the manifest), so the project carries no dead weight. */
function pruneUnused(files, assets = []) {
  if (!assets.length) return { files, removed: [] };
  const sources = files.filter((file) => file && file.encoding !== 'base64' && typeof file.content === 'string' && file.path !== MANIFEST_PATH && /\.(?:jsx?|tsx?|css|html|json)$/i.test(file.path || '')).map((file) => file.content).join('\n');
  const unused = assets.filter((asset) => !sources.includes(asset.publicPath) && !sources.includes(asset.path.split('/').pop()));
  if (!unused.length) return { files, removed: [] };
  const drop = new Set(unused.map((asset) => asset.path));
  const kept = assets.filter((asset) => !drop.has(asset.path));
  const next = files.filter((file) => !drop.has(file.path)).map((file) => (file.path === MANIFEST_PATH ? manifestFile(kept, null) : file));
  return { files: next, removed: unused.map((asset) => asset.path) };
}

/**
 * Targeted replacement: finds another verified picture for a slot whose file failed validation and returns it at the SAME path,
 * so no component has to change. `exclude` holds hashes that must not come back.
 */
async function replaceAsset(asset, { requirement = null, exclude = [], ...options } = {}) {
  const cfg = options.cfg || imageConfig(options.env || process.env);
  const req = requirement || { slot: asset.id, page: asset.page, route: asset.route, section: asset.section, category: asset.category, query: asset.query, alternates: [], aspect: asset.aspect, hero: asset.hero, orientation: asset.category === 'team' ? 'portrait' : 'landscape', altHint: asset.alt, ...(asset.requirementHints || {}) };
  const taken = options.taken || { sha256: new Set(), hashes: [] };
  const result = await fulfilSlot(req, { cfg, env: options.env || process.env, signal: options.signal, taken, download: options.download || remoteImageLocalizer.downloadPublicImage,
    search: options.search || ((query, opts) => searchTopic(query, { ...opts, env: opts.env || options.env || process.env })), scope: asset.jobId, excludeHashes: new Set(exclude), vision: options.vision || null, ask: options.ask || null, site: options.site || {} });
  if (!result.ok) return result;
  return { ok: true, asset: { ...result.asset, path: asset.path, publicPath: asset.publicPath, replacedFrom: asset.sourceUrl }, file: { ...result.file, path: asset.path } };
}

/**
 * More slots when the site needs further pictures after the first plan. `targets` names the pages that are short
 * ([{ page, route, count }]); without it the pages with the fewest pictures are used. Slot names continue the existing numbering.
 */
function extraRequirements({ plan, assets, count, prompt, spec, targets = null, exclude = null }) {
  const industry = detectIndustry(prompt, spec);
  const used = new Set([...(plan?.requirements || []).map((r) => r.query), ...assets.map((a) => a.query)]);
  const pool = [...industry.gallery, ...industry.features, ...industry.service, `${industry.subject} detail`, `${industry.subject} customers`, `${industry.subject} workspace`, `${industry.subject} team at work`, `${industry.subject} professional photograph`, `${industry.subject} lifestyle`].filter((query) => !used.has(query) && !(exclude && exclude.has(query)));
  const pages = (plan?.pages?.length ? plan.pages : [{ name: 'Home', route: '/' }]).filter((page) => !/contact/i.test(page.name));
  const perPage = new Map(pages.map((page) => [page.name, assets.filter((a) => a.page === page.name).length]));
  const taken = new Set(assets.map((asset) => asset.id));
  const nextId = (page) => { let n = 1; const base = slug(page.name); while (taken.has(`${base}-extra-${String(n).padStart(2, '0')}`)) n += 1; const id = `${base}-extra-${String(n).padStart(2, '0')}`; taken.add(id); return id; };
  const wanted = targets && targets.length ? targets.flatMap((target) => Array.from({ length: target.count }, () => ({ name: target.page || 'Home', route: target.route || '/' }))) : null;
  const out = [];
  const total = wanted ? wanted.length : count;
  for (let i = 0; i < total && i < pool.length; i += 1) {
    const page = wanted ? wanted[i] : [...pages].sort((a, b) => (perPage.get(a.name) || 0) - (perPage.get(b.name) || 0))[0];
    if (!wanted) perPage.set(page.name, (perPage.get(page.name) || 0) + 1);
    out.push({ slot: nextId(page), page: page.name, route: page.route, section: 'Gallery', category: 'gallery', query: pool[i], alternates: [], aspect: '4/3', hero: false, orientation: 'landscape', altHint: pool[i], subject: pool[i], avoid: INDUSTRY_AVOID[industry.id] || [], derived: true });
  }
  return out;
}

function clearCaches() { downloadCache.clear(); searchCache.clear(); inflight.clear(); clearEvaluationCache(); }

module.exports = { discoverImages, runSlots, floorFor, replaceAsset, extraRequirements, buildPromptBlock, spareAssets, mergeAssetFiles, pruneUnused, manifestFile, summarizeDiagnostics, reasonFor, fulfilSlot, clearCaches, STAGES, IMAGE_DIR, MANIFEST_PATH };
