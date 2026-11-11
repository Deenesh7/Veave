// One place for every image-pipeline setting, so thresholds are changed here (or in the environment) and nowhere else.
const int = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };
const flag = (value, fallback) => (value === undefined || value === '' ? fallback : !/^(0|false|no|off)$/i.test(String(value)));

function imageConfig(env = process.env) {
  return {
    enabled: flag(env.IMAGE_DISCOVERY, true),
    // The validation floor (never lowered by the pipeline): unique working images on the home page and across the site.
    minHome: int(env.IMAGE_MIN_HOME, 3),
    minSite: int(env.IMAGE_MIN_SITE, 6),
    // How many images the plan may ask for in total, and how many search results one slot may try before it is reported missing.
    maxAssets: Math.max(6, int(env.IMAGE_DISCOVERY_MAX, 14)),
    maxCandidatesPerSlot: Math.max(3, int(env.IMAGE_CANDIDATES_PER_SLOT, 6)),
    alternateQueriesPerSlot: Math.max(1, int(env.IMAGE_ALTERNATE_QUERIES, 3)),
    minShortSide: int(env.IMAGE_MIN_SHORT_SIDE, 400),
    minHeroLongSide: int(env.IMAGE_MIN_HERO_LONG_SIDE, 1100),
    maxOutputWidth: int(env.IMAGE_MAX_WIDTH, 1920),
    maxBytes: int(env.IMAGE_MAX_BYTES, 8 * 1024 * 1024),
    concurrency: Math.max(1, int(env.IMAGE_DISCOVERY_CONCURRENCY, 4)),
    requestTimeoutMs: int(env.IMAGE_REQUEST_TIMEOUT_MS, 12000),
    totalTimeoutMs: int(env.IMAGE_DISCOVERY_TIMEOUT_MS, 150000),
    retries: int(env.IMAGE_PROVIDER_RETRIES, 2),
    // Open web image search has no licence information; it is only used when explicitly allowed.
    allowUnlicensedWeb: flag(env.IMAGE_ALLOW_UNLICENSED_WEB, false),
    renderCheck: flag(env.IMAGE_RENDER_CHECK, true)
  };
}

module.exports = { imageConfig };
