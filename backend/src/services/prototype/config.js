'use strict';

// Every limit of the prototype engine is configurable through the environment; these are the defaults.
const int = (name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
const float = (name, fallback) => {
  const value = Number.parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

function resolveConfig(overrides = {}) {
  return {
    // Turn the engine off to fall back to the single-pass prototype flow.
    enabled: process.env.PROTOTYPE_ENGINE !== 'false',
    // Crawl
    maxPages: int('PROTOTYPE_MAX_PAGES', 24, { min: 1, max: 200 }),          // routes captured
    maxDepth: int('PROTOTYPE_MAX_DEPTH', 3, { min: 0, max: 8 }),             // link depth from the home page
    maxBuildPages: int('PROTOTYPE_MAX_BUILD_PAGES', 12, { min: 1, max: 60 }), // pages generated (the rest are listed, not built)
    crawlConcurrency: int('PROTOTYPE_CRAWL_CONCURRENCY', 2, { min: 1, max: 6 }),
    crawlDeadlineMs: int('PROTOTYPE_CRAWL_DEADLINE_MS', 4 * 60 * 1000, { min: 10000 }),
    pageTimeoutMs: int('PROTOTYPE_PAGE_TIMEOUT_MS', 45000, { min: 5000 }),
    crawlRetries: int('PROTOTYPE_CRAWL_RETRIES', 2, { min: 0, max: 5 }),
    respectRobots: process.env.PROTOTYPE_RESPECT_ROBOTS !== 'false',
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844 }
    },
    // Generation / validation
    pageRepairAttempts: int('PROTOTYPE_PAGE_REPAIR_ATTEMPTS', 2, { min: 0, max: 5 }),
    pageGenerationAttempts: int('PROTOTYPE_PAGE_GENERATION_ATTEMPTS', 2, { min: 1, max: 4 }),
    regressionRepairAttempts: int('PROTOTYPE_REGRESSION_REPAIR_ATTEMPTS', 1, { min: 0, max: 3 }),
    // A page passes when it has at least this share of the reference's sections and no blocking issue.
    minSectionRatio: float('PROTOTYPE_MIN_SECTION_RATIO', 0.6),
    // "reference-based" needs at least this share of the discovered routes captured and built.
    referenceCoverage: float('PROTOTYPE_REFERENCE_COVERAGE', 0.7),
    tolerances: {
      fontSizeRatio: float('PROTOTYPE_TOL_FONT', 0.2),      // |generated - reference| / reference
      containerRatio: float('PROTOTYPE_TOL_CONTAINER', 0.15),
      aspectRatio: float('PROTOTYPE_TOL_ASPECT', 0.25),
      colorDistance: float('PROTOTYPE_TOL_COLOR', 60)       // RGB euclidean distance
    },
    ...overrides
  };
}

module.exports = { resolveConfig };
