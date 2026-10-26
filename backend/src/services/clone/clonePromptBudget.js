// A page-building request must stay a size the model can use and the account can afford. A real captured page measures
// megabytes (one measured stage prompt was 4.7 MB, about 1.2 million tokens), most of it repetition: thousands of image
// placements nobody can use, long style dumps and the same HTML in several forms. A whole clone cost 11.8 million input
// tokens for 242 thousand tokens of output. This keeps each stage to a budget and trims the least useful parts first.
const size = (value) => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');

const DEFAULT_BUDGET = 640 * 1024; // bytes of page analysis per request (about 160k tokens); styles and images are what make the clone match, so they get the room

function configuredBudget() {
  const value = Number.parseInt(process.env.CLONE_PAGE_PROMPT_BYTES, 10);
  return Number.isFinite(value) && value >= 60 * 1024 ? value : DEFAULT_BUDGET;
}

/** Image placements the model can act on: the ones with a local file, in page order, with only the fields it uses. */
function compactPlacements(queue = [], limit = 320) {
  const usable = queue.filter((item) => item && item.status !== 'unavailable' && item.publicPath);
  return {
    placements: usable.slice(0, limit).map(({ publicPath, alt, width, height, section, selector, rect, status }) => (
      { publicPath, alt: String(alt || '').slice(0, 80), width, height, section: section?.heading || section?.tag || null, selector: selector ? String(selector).slice(0, 120) : null, y: rect?.documentY ?? null, status })),
    unavailable: queue.filter((item) => item?.status === 'unavailable').length,
    omitted: Math.max(0, usable.length - limit)
  };
}

function compactImages(images = [], limit = 200) {
  return images.slice(0, limit).map((image) => ({
    src: image.localPath || image.src, alt: String(image.alt || '').slice(0, 80), width: image.width, height: image.height,
    y: image.rect?.documentY ?? image.documentY ?? null, link: image.link ? { resolvedHref: image.link.resolvedHref, kind: image.link.kind } : undefined
  }));
}

// Each step removes the least valuable remaining detail; the loop stops as soon as the analysis fits.
// Order matters: repeated or derived data goes first (duplicate markup, DOM outline, responsive dump). The style rules, image
// placements and image list are what make the clone look like the real site, so they are slimmed field by field and only
// cut as a last resort, and never below a floor that still covers a normal page.
const STEPS = [
  { name: 'responsive', apply: (a) => { if (a.responsive) a.responsive = null; } },
  { name: 'domHierarchy', apply: (a) => { if (a.extraction?.domHierarchy?.length > 40) a.extraction.domHierarchy = a.extraction.domHierarchy.slice(0, Math.max(40, Math.floor(a.extraction.domHierarchy.length / 2))); } },
  { name: 'htmlSections', apply: (a) => { if (a.extraction?.htmlSections?.length) a.extraction.htmlSections = a.extraction.htmlSections.map(({ html, ...meta }) => meta); } },
  { name: 'placementDetail', apply: (a) => { if (Array.isArray(a.assetQueue)) a.assetQueue = a.assetQueue.map(({ selector, section, ...rest }) => rest); } },
  { name: 'imageDetail', apply: (a) => { if (Array.isArray(a.images)) a.images = a.images.map(({ link, ...rest }) => rest); } },
  { name: 'visualElements', apply: (a) => { if (a.visualElements?.length > 120) a.visualElements = a.visualElements.slice(0, Math.max(120, Math.floor(a.visualElements.length / 2))); } },
  { name: 'html', apply: (a) => { if (a.extraction?.html?.length > 120000) a.extraction.html = a.extraction.html.slice(0, Math.max(120000, Math.floor(a.extraction.html.length * 0.8))); } },
  { name: 'styles', apply: (a) => { if (a.styles) a.styles = JSON.stringify(a.styles).length > 120000 ? { note: 'omitted (too large)' } : a.styles; } },
  { name: 'placements', apply: (a) => { if (a.assetQueue?.length > 150) a.assetQueue = a.assetQueue.slice(0, Math.max(150, Math.floor(a.assetQueue.length * 0.75))); } },
  { name: 'images', apply: (a) => { if (a.images?.length > 100) a.images = a.images.slice(0, Math.max(100, Math.floor(a.images.length * 0.75))); } }
];

/**
 * @returns {{ analysis: object, bytes: number, trimmed: string[], fits: boolean }}
 */
function fitAnalysis(input, maxBytes = configuredBudget()) {
  const analysis = structuredClone(input);
  const trimmed = [];
  let bytes = size(analysis);
  for (let pass = 0; pass < 12 && bytes > maxBytes; pass += 1) {
    for (const step of STEPS) {
      if (bytes <= maxBytes) break;
      const before = bytes;
      step.apply(analysis);
      bytes = size(analysis);
      if (bytes < before && !trimmed.includes(step.name)) trimmed.push(step.name);
    }
  }
  return { analysis, bytes, trimmed, fits: bytes <= maxBytes };
}

module.exports = { fitAnalysis, compactPlacements, compactImages, configuredBudget, DEFAULT_BUDGET };
