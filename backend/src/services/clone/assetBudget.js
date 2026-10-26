// Keeps a clone's assets inside what the project, the build and the validator can carry. A real site can reference
// hundreds of megabytes (a university site: 917 files, 233 MB, mostly PDFs and camera-sized photos). Shipping all of it made
// the production build exceed its artifact limit, and the repair step then "fixed" that by editing the build configuration,
// which removed every image and left the clone blank. Instead the assets are chosen and shrunk BEFORE generation:
//   * most important first (the order the capture already ranked them: fonts, then what is visible, by size on screen);
//   * photos are resized to what a screen can show and re-encoded; one font format per family; no legacy formats;
//   * a byte budget for the whole set; what does not fit is reported as unavailable, never silently forgotten.
const sharp = require('sharp');

const MB = 1024 * 1024;
const FONT_RANK = { 'font/woff2': 0, 'application/font-woff2': 0, 'font/woff': 1, 'application/font-woff': 1, 'font/ttf': 2, 'application/x-font-ttf': 2, 'font/otf': 2 };

function limits(overrides = {}) {
  const number = (name, fallback) => { const value = Number.parseInt(process.env[name], 10); return Number.isFinite(value) && value > 0 ? value : fallback; };
  return {
    totalBytes: overrides.totalBytes ?? number('CLONE_ASSET_BUDGET_BYTES', 36 * MB),   // images + fonts that ship in the project
    maxImageEdge: overrides.maxImageEdge ?? number('CLONE_IMAGE_MAX_EDGE', 1920),
    smallImageBytes: overrides.smallImageBytes ?? number('CLONE_IMAGE_KEEP_BELOW_BYTES', 80 * 1024), // already small: left untouched
    maxSingleBytes: overrides.maxSingleBytes ?? number('CLONE_ASSET_MAX_SINGLE_BYTES', 3 * MB),     // after optimisation
    quality: overrides.quality ?? number('CLONE_IMAGE_QUALITY', 80),
    heavyImageBytes: overrides.heavyImageBytes ?? number('CLONE_HEAVY_IMAGE_BYTES', 300 * 1024),
    heavyImageEdge: overrides.heavyImageEdge ?? number('CLONE_HEAVY_IMAGE_EDGE', 1280),
    heavyImageQuality: overrides.heavyImageQuality ?? number('CLONE_HEAVY_IMAGE_QUALITY', 62)
  };
}

const bytesOf = (asset) => (asset.bodyBase64 ? Buffer.from(asset.bodyBase64, 'base64') : null);

function decode(asset) {
  const direct = bytesOf(asset);
  if (direct) return direct;
  const match = String(asset.dataUrl || '').match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/);
  return match ? Buffer.from(match[1].replace(/\s/g, ''), 'base64') : null;
}

/** Font files are listed once per format (woff2, woff, ttf, eot). A browser needs one: keep the best, drop the rest. */
function dedupeFontFormats(assets) {
  const familyKey = (asset) => {
    try { return new URL(asset.url).pathname.replace(/\.(?:woff2?|ttf|otf|eot)$/i, '').toLowerCase(); } catch { return asset.url; }
  };
  const best = new Map();
  for (const asset of assets) {
    if (!(asset.mimeType in FONT_RANK)) continue;
    const key = familyKey(asset);
    const current = best.get(key);
    if (!current || FONT_RANK[asset.mimeType] < FONT_RANK[current.mimeType]) best.set(key, asset);
  }
  return assets.filter((asset) => !(asset.mimeType in FONT_RANK) || best.get(familyKey(asset)) === asset);
}

async function optimizeRaster(asset, body, config) {
  if (!/^image\/(?:png|jpeg|webp)$/.test(asset.mimeType)) return { body, mimeType: asset.mimeType, changed: false };
  let image = sharp(body, { limitInputPixels: 80_000_000, failOn: 'none' });
  const meta = await image.metadata().catch(() => null);
  if (!meta?.width) return { body, mimeType: asset.mimeType, changed: false };
  const needsResize = Math.max(meta.width, meta.height || 0) > config.maxImageEdge;
  if (body.length <= config.smallImageBytes && !needsResize) return { body, mimeType: asset.mimeType, changed: false };
  image = sharp(body, { limitInputPixels: 80_000_000, failOn: 'none' }).rotate();
  if (needsResize) image = image.resize({ width: config.maxImageEdge, height: config.maxImageEdge, fit: 'inside', withoutEnlargement: true });
  // WebP keeps transparency (logos, cut-outs) and is far smaller than PNG/JPEG for photographs.
  let optimised = await image.webp({ quality: config.quality, effort: 4 }).toBuffer();
  // A large photo that is still heavy would use the space of dozens of small images: shrink it further. Screens show
  // it at a fraction of this size anyway.
  if (optimised.length > config.heavyImageBytes) {
    const smaller = await sharp(body, { limitInputPixels: 80_000_000, failOn: 'none' }).rotate()
      .resize({ width: config.heavyImageEdge, height: config.heavyImageEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: config.heavyImageQuality, effort: 4 }).toBuffer();
    if (smaller.length < optimised.length) optimised = smaller;
  }
  return optimised.length < body.length
    ? { body: optimised, mimeType: 'image/webp', changed: true }
    : { body, mimeType: asset.mimeType, changed: false };
}

/**
 * @param {Array} ranked assets in priority order (most important first); each may list the `pages` that use it
 * @param {{ pageOrder?: string[] }} overrides  pageOrder gives every page a fair share of the budget, in this order
 * @returns {{ assets: Array, dropped: Array<{url, reason, bytes}>, stats: object }}
 */
async function budgetAssets(ranked, overrides = {}) {
  const config = limits(overrides);
  const dropped = [];
  const candidates = dedupeFontFormats(ranked.filter((asset) => {
    if (/\.eot(?:[?#]|$)/i.test(asset.url || '')) { dropped.push({ url: asset.url, reason: 'legacy-format', bytes: asset.byteLength || 0 }); return false; }
    return true;
  }));
  for (const asset of ranked) if (!candidates.includes(asset) && !dropped.some((item) => item.url === asset.url)) dropped.push({ url: asset.url, reason: 'duplicate-font-format', bytes: asset.byteLength || 0 });

  // Without this, the first page's hundreds of photos use the whole budget and the later pages get none ("no images used").
  const order = overrides.pageOrder || [];
  const primaryPage = (asset) => (asset.pages || []).slice().sort((a, b) => (order.indexOf(a) < 0 ? 1e9 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 1e9 : order.indexOf(b)))[0] || null;
  const fairShare = order.length ? Math.floor((config.totalBytes * 0.7) / order.length) : 0;
  const sequence = [];
  if (fairShare) for (const page of order) sequence.push(...candidates.filter((asset) => primaryPage(asset) === page).map((asset) => ({ asset, quota: page })));
  // What is left after every page had its share goes smallest first: it keeps the most images (and so the most of each
  // page) instead of letting a few big ones take the remaining space.
  sequence.push(...candidates.slice().sort((a, b) => (a.byteLength || 0) - (b.byteLength || 0)).map((asset) => ({ asset, quota: null })));

  const kept = [];
  const decided = new Set();
  const usedByPage = new Map();
  let used = 0;
  let originalBytes = 0;
  let optimisedCount = 0;
  const rankOf = new Map(ranked.map((asset, index) => [asset, index]));
  const cache = new Map();
  const prepare = async (asset) => {
    if (cache.has(asset)) return cache.get(asset);
    const body = decode(asset);
    if (!body?.length) { cache.set(asset, null); return null; }
    originalBytes += body.length;
    let result;
    try { result = await optimizeRaster(asset, body, config); } catch { result = { body, mimeType: asset.mimeType, changed: false }; }
    cache.set(asset, result);
    return result;
  };
  for (const { asset, quota } of sequence) {
    if (decided.has(asset)) continue;
    // Cheap pre-check: something many times larger than the space left cannot be shrunk into it.
    if (quota === null && asset.byteLength > (config.totalBytes - used) * 12) { decided.add(asset); dropped.push({ url: asset.url, reason: 'over-budget', bytes: asset.byteLength || 0 }); continue; }
    const result = await prepare(asset);
    if (!result) { decided.add(asset); dropped.push({ url: asset.url, reason: 'unreadable', bytes: 0 }); continue; }
    const size = result.body.length;
    if (size > config.maxSingleBytes) { decided.add(asset); dropped.push({ url: asset.url, reason: 'too-large', bytes: size }); continue; }
    if (quota !== null) {
      // First round: each page may take its fair share; whatever does not fit its share waits for the second round.
      if ((usedByPage.get(quota) || 0) + size > fairShare || used + size > config.totalBytes) continue;
      usedByPage.set(quota, (usedByPage.get(quota) || 0) + size);
    } else if (used + size > config.totalBytes) { decided.add(asset); dropped.push({ url: asset.url, reason: 'over-budget', bytes: size }); continue; }
    decided.add(asset);
    used += size;
    if (result.changed) optimisedCount += 1;
    const { dataUrl, ...rest } = asset;
    kept.push({ ...rest, mimeType: result.mimeType, bodyBase64: result.body.toString('base64'), byteLength: size, optimised: result.changed, __rank: rankOf.get(asset) });
  }
  // keep the caller's priority order
  kept.sort((a, b) => a.__rank - b.__rank);
  for (const asset of kept) delete asset.__rank;
  return { assets: kept, dropped, stats: { candidates: ranked.length, kept: kept.length, optimised: optimisedCount, droppedCount: dropped.length, originalBytes, finalBytes: used, budgetBytes: config.totalBytes, pages: Object.fromEntries(usedByPage) } };
}

module.exports = { budgetAssets, dedupeFontFormats, optimizeRaster, limits };
