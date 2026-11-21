// One place for every image-pipeline setting, so thresholds are changed here (or in the environment) and nowhere else.
const int = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n >= 0 ? n : fallback; };
const num = (value, fallback) => { const n = Number.parseFloat(value); return Number.isFinite(n) ? n : fallback; };
const flag = (value, fallback) => (value === undefined || value === '' ? fallback : !/^(0|false|no|off)$/i.test(String(value)));

const DEFAULT_WEIGHTS = { subject: 0.30, section: 0.25, industry: 0.15, quality: 0.10, composition: 0.10, brand: 0.10 };
function evalWeights(raw) {
  let given = {};
  try { given = raw ? JSON.parse(raw) : {}; } catch { given = {}; }
  const merged = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS)) if (Number.isFinite(Number(given[key])) && Number(given[key]) >= 0) merged[key] = Number(given[key]);
  const total = Object.values(merged).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, value / total]));
}

/**
 * The picture floor, lowered by the number of slots that were deliberately left empty because no candidate was relevant.
 * Placing an unrelated photograph just to reach a count is worse than a section without one.
 */
function applyFloor(cfg, imageContext) {
  const floor = imageContext?.floor;
  return floor ? { ...cfg, minHome: Math.min(cfg.minHome, floor.home), minSite: Math.min(cfg.minSite, floor.site) } : cfg;
}

/**
 * Without a licensed photo API key (Pexels, Unsplash or Pixabay) only Openverse and Wikimedia answer, and they rarely have a good
 * match, so a slot that finds nothing would otherwise spend its whole budget on searches that cannot succeed (measured: about
 * 100 s of discovery plus about 110 s of recovery for a small site that then failed the image check). Those defaults are therefore
 * smaller. Anything set explicitly in the environment still wins.
 */
const hasCuratedProvider = (env) => Boolean(env.PEXELS_API_KEY || env.UNSPLASH_ACCESS_KEY || env.PIXABAY_API_KEY);

function imageConfig(env = process.env) {
  const lean = !hasCuratedProvider(env);
  return {
    enabled: flag(env.IMAGE_DISCOVERY, true),
    // The validation floor (never lowered by the pipeline): unique working images on the home page and across the site.
    minHome: int(env.IMAGE_MIN_HOME, 3),
    minSite: int(env.IMAGE_MIN_SITE, 6),
    // How many images the plan may ask for in total, and how many search results one slot may try before it is reported missing.
    maxAssets: Math.max(6, int(env.IMAGE_DISCOVERY_MAX, 14)),
    // Self-healing: how many times a failed image check may search for new pictures before the job gives up (placing pictures that already exist is free and not counted).
    recoveryAttempts: int(env.IMAGE_RECOVERY_ATTEMPTS, lean ? 1 : 3),
    maxCandidatesPerSlot: Math.max(3, int(env.IMAGE_CANDIDATES_PER_SLOT, lean ? 4 : 6)),
    alternateQueriesPerSlot: Math.max(1, int(env.IMAGE_ALTERNATE_QUERIES, lean ? 2 : 3)),
    minShortSide: int(env.IMAGE_MIN_SHORT_SIDE, 400),
    minHeroLongSide: int(env.IMAGE_MIN_HERO_LONG_SIDE, 1000),
    maxOutputWidth: int(env.IMAGE_MAX_WIDTH, 1920),
    maxBytes: int(env.IMAGE_MAX_BYTES, 8 * 1024 * 1024),
    concurrency: Math.max(1, int(env.IMAGE_DISCOVERY_CONCURRENCY, 4)),
    requestTimeoutMs: int(env.IMAGE_REQUEST_TIMEOUT_MS, 12000),
    totalTimeoutMs: int(env.IMAGE_DISCOVERY_TIMEOUT_MS, 150000),
    retries: int(env.IMAGE_PROVIDER_RETRIES, 2),
    // Open web image search has no licence information; it is only used when explicitly allowed.
    allowUnlicensedWeb: flag(env.IMAGE_ALLOW_UNLICENSED_WEB, false),
    renderCheck: flag(env.IMAGE_RENDER_CHECK, true),
    // Image evaluation: every candidate is scored against the section it is for before it can be placed. The weights are
    // configurable (IMAGE_EVAL_WEIGHTS='{"subject":0.3,...}'); they are a starting point, not a guarantee of quality.
    evalWeights: evalWeights(env.IMAGE_EVAL_WEIGHTS),
    evalMinScore: num(env.IMAGE_EVAL_MIN_SCORE, 0.62),
    evalHeroMinScore: num(env.IMAGE_EVAL_HERO_MIN_SCORE, 0.7),
    // A photograph whose subject does not fit can never pass on quality alone.
    evalMinSubject: num(env.IMAGE_EVAL_MIN_SUBJECT, 0.5),
    // Without visual analysis only metadata is available, so the bar is separate and the result is never reported as visually verified.
    evalMetadataMinScore: num(env.IMAGE_EVAL_METADATA_MIN_SCORE, 0.45),
    visionEval: flag(env.IMAGE_VISION_EVAL, true),
    visionModel: env.IMAGE_VISION_MODEL || 'google/gemini-2.5-flash',
    visionMaxSide: int(env.IMAGE_VISION_MAX_SIDE, 768),
    // How many qualified candidates one slot collects before the site-wide assignment, and how often an unfilled slot is searched again with a better query.
    // A candidate this good ends the search for its slot: more vision calls would only cost time. The deadline grows with the number of slots when pictures are judged by a vision model (found live: 9 slots did not fit in 150s).
    evalGoodScore: num(env.IMAGE_EVAL_GOOD_SCORE, 0.82),
    visionMsPerSlot: int(env.IMAGE_VISION_MS_PER_SLOT, 25000),
    totalTimeoutMaxMs: int(env.IMAGE_DISCOVERY_TIMEOUT_MAX_MS, lean ? 180000 : 420000),
    poolSize: Math.max(1, int(env.IMAGE_POOL_SIZE, lean ? 2 : 3)),
    requeryRounds: int(env.IMAGE_REQUERY_ROUNDS, lean ? 0 : 1)
  };
}

module.exports = { imageConfig, applyFloor, DEFAULT_WEIGHTS };
