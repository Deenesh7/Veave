/**
 * Image discovery for a new website: plan -> search -> choose -> verify -> download -> store -> map.
 *
 * Nothing here trusts a search hit or a model-written link. A candidate becomes an asset only after its bytes were downloaded
 * by the server, decoded as a photograph, checked for size / shape / duplicates, converted to WebP and given a project path
 * (public/assets/images/<slot>.webp). The generator is then handed those local paths, so the site never depends on a remote link.
 */
const { imageConfig } = require('./imageConfig');
const { buildRequirements, detectIndustry, slug } = require('./imageRequirements');
const { searchTopic } = require('./imageSources');
const { verifyAndPrepare, relevanceOf, rejectCandidate, hamming } = require('./imageVerification');
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

function rankCandidates(candidates, query, requirement, attempted) {
  const seen = new Set();
  const ranked = [];
  const refused = [];
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url) || attempted.has(candidate.url)) continue;
    seen.add(candidate.url);
    const bad = rejectCandidate(candidate, { query });
    if (bad) { refused.push({ url: candidate.url, ...bad }); continue; }
    const relevance = relevanceOf(candidate, query);
    if (!relevance.trusted && relevance.matched < relevance.needed) { refused.push({ url: candidate.url, code: 'not_relevant', reason: relevance.reason || `only ${relevance.matched} of the subject words appear in its description` }); continue; }
    const pixels = (Number(candidate.width) || 0) * (Number(candidate.height) || 0);
    const fits = requirement.orientation === 'portrait' ? (candidate.height > candidate.width ? 1 : 0) : (candidate.width >= candidate.height ? 1 : 0);
    ranked.push({ candidate, relevance, score: relevance.score * 100 + fits * 10 + (candidate.curated ? 8 : 0) + Math.min(10, pixels / 1_000_000) - Number(candidate.rank || 0) * 0.3 });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ranked: ranked.map((item) => item.candidate), refused };
}

/**
 * Finds, downloads and verifies ONE picture for one slot.
 * @returns {{ ok: true, asset, file } | { ok: false, missing }}
 */
async function fulfilSlot(requirement, ctx) {
  const { cfg, env, signal, taken, download, search, excludeHashes = new Set() } = ctx;
  const attempted = new Set(); // per slot: a picture another slot rejected (wrong shape, say) may still suit this one; `taken` stops real duplicates
  const queries = [requirement.query, ...(requirement.alternates || [])].filter(Boolean).slice(0, 1 + cfg.alternateQueriesPerSlot);
  const failures = [];
  const providerNotes = [];
  let tried = 0;
  let searchedOk = false;
  let allProvidersFailed = true;
  for (const query of queries) {
    if (signal?.aborted) break;
    let result;
    try { result = await searchOnce(query, requirement, { env, signal, cfg, search }); } catch (error) { if (signal?.aborted) break; providerNotes.push({ query, error: String(error.message).slice(0, 100) }); continue; }
    providerNotes.push({ query, providers: result.diagnostics });
    if (result.diagnostics.some((item) => item.status === 'ok')) { searchedOk = true; allProvidersFailed = false; }
    const { ranked, refused } = rankCandidates(result.candidates, query, requirement, attempted);
    failures.push(...refused.slice(0, 5));
    for (const candidate of ranked) {
      if (tried >= cfg.maxCandidatesPerSlot || signal?.aborted) break;
      attempted.add(candidate.url);
      tried += 1;
      let body;
      try { body = await fetchCandidate(candidate.url, { download, signal, cfg }); }
      catch (error) { if (signal?.aborted) break; failures.push({ url: candidate.url, code: error.code || 'download_failed', reason: error.message }); continue; }
      const verified = await verifyAndPrepare(body, requirement, { cfg, taken });
      if (!verified.ok) { failures.push({ url: candidate.url, code: verified.code, reason: verified.reason }); continue; }
      // Re-check right before taking it: another slot may have taken the same picture while this one was being decoded.
      if (taken.sha256.has(verified.meta.sha256) || taken.hashes.some((other) => hamming(other, verified.meta.hash) <= 5) || excludeHashes.has(verified.meta.sha256)) { failures.push({ url: candidate.url, code: 'duplicate', reason: 'the same picture is already used on this site' }); continue; }
      taken.sha256.add(verified.meta.sha256);
      if (verified.meta.hash) taken.hashes.push(verified.meta.hash);
      const path = `${IMAGE_DIR}/${requirement.slot}.webp`;
      const asset = {
        id: requirement.slot, jobId: ctx.scope, page: requirement.page, route: requirement.route, section: requirement.section, sectionId: requirement.sectionId || null, layout: requirement.layout || null, generic: Boolean(requirement.generic), category: requirement.category,
        alt: sentence(requirement.altHint).slice(0, 160), aspect: requirement.aspect, hero: Boolean(requirement.hero),
        path, publicPath: `/${path.slice('public/'.length)}`, mime: verified.meta.mime, width: verified.meta.width, height: verified.meta.height, bytes: verified.meta.bytes, sha256: verified.meta.sha256, hash: verified.meta.hash,
        sourceUrl: candidate.url, sourcePage: candidate.pageUrl || null, provider: candidate.provider, creator: candidate.creator || '', license: candidate.license || '', licenseUrl: candidate.licenseUrl || '',
        query, attempts: tried, status: 'verified', storage: 'pending_commit'
      };
      return { ok: true, asset, file: { path, content: verified.buffer.toString('base64'), language: 'binary', encoding: 'base64' } };
    }
  }
  const codeCount = (code) => failures.filter((item) => item.code === code).length;
  let code = 'no_relevant_image';
  if (signal?.aborted) code = 'timeout';
  else if (!searchedOk && allProvidersFailed) code = providerNotes.some((note) => note.providers?.some((p) => p.code === 'provider_rate_limited')) ? 'provider_rate_limited' : (providerNotes.some((note) => note.providers?.some((p) => p.status === 'skipped' && p.code === 'not_configured')) && !providerNotes.some((note) => note.providers?.some((p) => p.status === 'error')) ? 'no_provider_configured' : 'provider_unavailable');
  else if (tried > 0 && codeCount('download_failed') + codeCount('download_timeout') >= tried) code = 'download_failed';
  else if (tried > 0) code = failures.filter((item) => item.url).every((item) => ['bad_aspect', 'low_resolution', 'duplicate', 'blank_image', 'too_small', 'too_large'].includes(item.code)) ? 'unsuitable_image' : 'invalid_image';
  return { ok: false, missing: { slot: requirement.slot, page: requirement.page, route: requirement.route, section: requirement.section, query: requirement.query, code, tried, failures: failures.slice(0, 8), providers: providerNotes.slice(0, 4) } };
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
async function discoverImages({ prompt, spec = null, ask = null, signal, env = process.env, cfg = imageConfig(env), scope = 'job', requirements = null, taken = null,
  onStage = null, download = remoteImageLocalizer.downloadPublicImage, search = (query, options) => searchTopic(query, { ...options, env: options.env || env }), existingPaths = new Set() } = {}) {
  const stage = (name, info = {}) => { if (onStage) { try { onStage(name, info); } catch { /* progress reporting must never break discovery */ } } };
  stage('image_requirements');
  const plan = requirements ? { requirements, industry: null, subject: null, source: 'given' } : await buildRequirements({ prompt, spec, ask, cfg });
  stage('image_requirements', { count: plan.requirements.length, source: plan.source });

  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(cfg.totalTimeoutMs)]);
  const shared = taken || { sha256: new Set(), hashes: [] };
  const assets = [];
  const files = [];
  const missing = [];

  stage('image_discovery', { slots: plan.requirements.length });
  const results = await mapPool(plan.requirements, cfg.concurrency, async (requirement) => {
    const key = `${scope}:${requirement.slot}`;
    if (inflight.has(key)) return inflight.get(key); // the same slot of the same job is never processed twice at once
    const work = fulfilSlot(requirement, { cfg, env, signal: deadline, taken: shared, download, search, scope })
      .finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  });
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
  return { plan, assets, files, missing, taken: shared, diagnostics: summarizeDiagnostics(missing) };
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
  download_failed: 'the candidate images could not be downloaded',
  download_timeout: 'the candidate images timed out',
  invalid_image: 'the candidate images were not usable photographs',
  unsuitable_image: 'the candidates were the wrong size or shape, or already used elsewhere',
  timeout: 'image discovery ran out of time'
};
const reasonFor = (code) => REASONS[code] || code;

const FRAME = { hero: 'aspect-[16/9] w-full object-cover', feature: 'aspect-[4/3] w-full object-cover', service: 'aspect-[4/3] w-full object-cover', about: 'aspect-[4/3] w-full object-cover', team: 'aspect-[4/5] w-full object-cover object-top', gallery: 'aspect-square w-full object-cover', news: 'aspect-[16/9] w-full object-cover', product: 'aspect-square w-full object-cover', section: 'aspect-[4/3] w-full object-cover' };

/** The block appended to the generation prompt: verified local files only, grouped by page, with exact placement rules. */
function buildPromptBlock({ assets = [], missing = [] } = {}) {
  if (!assets.length && !missing.length) return '';
  const lines = ['VERIFIED PROJECT IMAGES (real photographs the server already found, downloaded, decoded and checked; they are saved in the project):'];
  const byPage = new Map();
  for (const asset of assets) byPage.set(asset.page, [...(byPage.get(asset.page) || []), asset]);
  for (const [page, list] of byPage) {
    lines.push(`\n${page} page (${list[0].route}):`);
    for (const asset of list) {
      lines.push(`- ${asset.publicPath}  [${asset.section}; ${asset.width}x${asset.height}] alt="${asset.alt}" frame: ${FRAME[asset.category] || FRAME.section}${asset.hero ? ' (hero: eager, fetchPriority="high")' : ''}`);
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
  const req = requirement || { slot: asset.id, page: asset.page, route: asset.route, section: asset.section, category: asset.category, query: asset.query, alternates: [], aspect: asset.aspect, hero: asset.hero, orientation: asset.category === 'team' ? 'portrait' : 'landscape', altHint: asset.alt };
  const taken = options.taken || { sha256: new Set(), hashes: [] };
  const result = await fulfilSlot(req, { cfg, env: options.env || process.env, signal: options.signal, taken, download: options.download || remoteImageLocalizer.downloadPublicImage,
    search: options.search || ((query, opts) => searchTopic(query, { ...opts, env: opts.env || options.env || process.env })), scope: asset.jobId, excludeHashes: new Set(exclude) });
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
    out.push({ slot: nextId(page), page: page.name, route: page.route, section: 'Gallery', category: 'gallery', query: pool[i], alternates: [], aspect: '4/3', hero: false, orientation: 'landscape', altHint: pool[i] });
  }
  return out;
}

function clearCaches() { downloadCache.clear(); searchCache.clear(); inflight.clear(); }

module.exports = { discoverImages, replaceAsset, extraRequirements, buildPromptBlock, spareAssets, mergeAssetFiles, pruneUnused, manifestFile, summarizeDiagnostics, reasonFor, fulfilSlot, clearCaches, STAGES, IMAGE_DIR, MANIFEST_PATH };
