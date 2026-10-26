'use strict';

/**
 * How much of the real website a finished clone shows. Compares, per captured page, what the original page contained
 * (its words and its distinct images) with what the clone actually renders for the same route:
 *   text   = share of the original's distinct words that appear on the clone's page;
 *   images = share of the original's distinct visible images (variants of one picture count once) that the clone shows
 *            from a local file.
 * Both are measured on a real render, so an image that is referenced but missing or broken does not count.
 */

const MIN_IMAGE_EDGE = 40; // smaller things are icons, spacers and tracking pixels
const MIN_WORD_LENGTH = 3;
const COLOUR_TOLERANCE = 24; // per-channel distance below which two colours look the same

function canonicalIdentity(value) {
  const text = String(value || '');
  if (text.startsWith('data:')) return text;
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:format|width|height|w|h|quality|q|dpr|fit|crop)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hash = '';
    return url.href;
  } catch {
    return text;
  }
}

function wordsOf(text) {
  const words = String(text || '').toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) || [];
  return new Set(words.filter((word) => word.length >= MIN_WORD_LENGTH));
}

function parseColour(value) {
  const match = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+%?))?\s*\)/i);
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : (match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4]));
  if (!(alpha >= 0.5)) return null; // transparent colours say nothing about the look
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function uniqueColours(values) {
  const seen = new Map();
  for (const value of values || []) {
    const rgb = parseColour(value);
    if (rgb) seen.set(rgb.join(','), rgb);
  }
  return [...seen.values()];
}

function colourPresent(rgb, pool) {
  return pool.some((other) => Math.abs(rgb[0] - other[0]) <= COLOUR_TOLERANCE && Math.abs(rgb[1] - other[1]) <= COLOUR_TOLERANCE && Math.abs(rgb[2] - other[2]) <= COLOUR_TOLERANCE);
}

/** What the original page contained: its distinct words and the canonical identities of its visible images. */
function expectedFromPage(page) {
  const words = wordsOf(page?.data?.fullText || '');
  const images = new Set();
  for (const image of page?.images || []) {
    const rect = image?.rect;
    if (!rect || rect.width < MIN_IMAGE_EDGE || rect.height < MIN_IMAGE_EDGE) continue;
    if (!image.src || /^data:image\/(?:gif|svg)/.test(image.src)) continue;
    images.add(canonicalIdentity(image.src));
  }
  const colours = uniqueColours([...(page?.design?.palette || []), page?.design?.color, page?.design?.background]);
  return { words, images, colours };
}

/** Maps the local path of each downloaded asset back to the canonical identity(ies) of the original URL(s). */
function identitiesByLocalPath(assets = []) {
  const map = new Map();
  for (const asset of assets) {
    const publicPath = asset.publicPath || (asset.localPath ? `/${String(asset.localPath).replace(/^public\//, '')}` : null);
    if (!publicPath) continue;
    const ids = new Set([canonicalIdentity(asset.url), ...(asset.sourceUrls || []).map(canonicalIdentity)]);
    map.set(publicPath, ids);
  }
  return map;
}

/** Runs inside the rendered page: its visible text and the local files its pictures come from. */
function inspectRenderedPage() {
  const local = new Set();
  const toPath = (value) => {
    try { const url = new URL(value, location.href); return url.hostname === location.hostname ? decodeURIComponent(url.pathname) : null; } catch { return null; }
  };
  for (const img of document.images) {
    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40 || !img.complete || img.naturalWidth === 0) continue;
    const found = toPath(img.currentSrc || img.src);
    if (found) local.add(found);
  }
  for (const element of document.querySelectorAll('*')) {
    const background = getComputedStyle(element).backgroundImage;
    if (!background || background === 'none') continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) continue;
    for (const match of background.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const found = toPath(match[1]);
      if (found) local.add(found);
    }
  }
  const colours = new Set();
  let inspected = 0;
  for (const element of document.querySelectorAll('body, body *')) {
    if (inspected++ > 5000) break;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    colours.add(style.color); colours.add(style.backgroundColor); colours.add(style.borderTopColor);
  }
  // textContent (like the capture's fullText) also holds text of menus that are closed, so both sides are measured alike.
  return { text: document.body ? `${document.body.innerText}\n${document.body.textContent}` : '', images: [...local], colours: [...colours] };
}

/** Pure scoring from what was expected and what was rendered. */
function scorePage(expected, rendered, localToIdentity) {
  const renderedWords = wordsOf(rendered.text);
  let textHit = 0;
  for (const word of expected.words) if (renderedWords.has(word)) textHit += 1;
  const shownIdentities = new Set();
  for (const localPath of rendered.images || []) for (const id of localToIdentity.get(localPath) || []) shownIdentities.add(id);
  let imageHit = 0;
  for (const id of expected.images) if (shownIdentities.has(id)) imageHit += 1;
  const renderedColours = uniqueColours(rendered.colours);
  const expectedColours = expected.colours || [];
  const colourHit = expectedColours.filter((rgb) => colourPresent(rgb, renderedColours)).length;
  const ratio = (hit, total) => (total ? hit / total : 1);
  return {
    text: ratio(textHit, expected.words.size),
    images: ratio(imageHit, expected.images.size),
    colors: ratio(colourHit, expectedColours.length),
    expectedWords: expected.words.size,
    expectedImages: expected.images.size,
    expectedColors: expectedColours.length,
    matchedWords: textHit,
    matchedImages: imageHit,
    matchedColors: colourHit
  };
}

/** Whole-site figures: totals are summed over pages so a big page counts for more than an empty one. */
function summarize(perPage) {
  const sum = (key) => perPage.reduce((total, page) => total + page[key], 0);
  const ratio = (hit, total) => (total ? hit / total : 1);
  return {
    text: ratio(sum('matchedWords'), sum('expectedWords')),
    images: ratio(sum('matchedImages'), sum('expectedImages')),
    colors: ratio(sum('matchedColors'), sum('expectedColors')),
    pages: perPage.length
  };
}

/**
 * Renders every captured route of `files` and scores it against the capture.
 * @param {Array} files project files of the clone
 * @param {{ pages: Array, assets: Array }} capture the capture result
 */
async function measureCloneFidelity(files, capture, { signal, routes = null } = {}) {
  const { inspectRenderedPreview } = require('../ai/targetRenderVerifier');
  const localToIdentity = identitiesByLocalPath(capture.assets || []);
  const perPage = [];
  for (const page of (capture.pages || []).filter((item) => item.captureStatus === 'captured')) {
    if (routes && !routes.includes(page.path)) continue;
    const expected = expectedFromPage(page);
    let rendered = { text: '', images: [], colours: [] };
    let error = null;
    try {
      rendered = await inspectRenderedPreview(files, { signal, routePath: page.path, inspect: inspectRenderedPage });
    } catch (renderError) {
      if (renderError.name === 'AbortError') throw renderError;
      error = renderError.message;
    }
    perPage.push({ path: page.path, ...scorePage(expected, rendered, localToIdentity), ...(error ? { error } : {}) });
  }
  return { ...summarize(perPage), perPage };
}

module.exports = { measureCloneFidelity, expectedFromPage, scorePage, summarize, identitiesByLocalPath, inspectRenderedPage, canonicalIdentity, wordsOf };
