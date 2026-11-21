/**
 * VisualQualityValidator: the checks a successful build does not make, run on what the browser really rendered.
 *
 *   layout-unbalanced      a section whose content hugs one side and leaves the other side of the width empty (a timeline on the right half
 *                          only, a lone column beside nothing)
 *   layout-empty-cell      a card or grid cell with no text and no picture
 *   layout-grid-columns    a grid whose template has more columns than it has items (the right side stays empty)
 *   layout-grid-orphan     a grid whose last row holds a single item beside empty tracks
 *   layout-image-broken    a picture that did not load
 *   layout-image-duplicate the same picture file shown in two different sections (of one page, or across the pages of the site)
 *   layout-image-mismatch  a picture whose description has nothing to do with the section it sits in
 * Every issue names the page, the section heading (which the review maps to the component file), the measured numbers and the exact
 * correction, so only that section is rewritten. Thresholds live in layoutCatalog.REVIEW and can be overridden by environment variables.
 * Pure functions over the browser measurement.
 */
const { REVIEW } = require('./layoutCatalog');
const { overlap } = require('../deep/deepPlanner');
const { normalizeUrl } = require('../images/imageDuplicateDetector');

const num = (name, fallback) => { const value = Number.parseFloat(process.env[name]); return Number.isFinite(value) ? value : fallback; };
const thresholds = () => ({
  offset: num('LAYOUT_UNBALANCED_OFFSET', REVIEW.unbalancedOffset), blocking: num('LAYOUT_UNBALANCED_BLOCKING', REVIEW.unbalancedBlocking),
  chars: num('LAYOUT_UNBALANCED_MIN_CHARS', REVIEW.minUnbalancedChars), height: num('LAYOUT_UNBALANCED_MIN_HEIGHT', REVIEW.minUnbalancedHeight), picture: num('LAYOUT_MIN_PICTURE_WIDTH', REVIEW.minPictureWidth)
});
const round = Math.round;

/**
 * @returns {Array<{ kind, severity, viewport, route, heading, message }>}
 */
function evaluateQuality(measure, viewport = 'desktop', { pageName = '', route = '/' } = {}) {
  const limit = thresholds();
  const issues = [];
  const where = `${pageName ? `${pageName} page (${route})` : route} at ${viewport} width`;
  const add = (kind, severity, heading, message) => issues.push({ kind, severity, viewport, route, heading: heading || '', message });

  // 1. Content hugging one side of its section. The width is split into 12 bins weighted by how much text and picture area falls in each;
  // a section whose empty bins are mostly on one side (a centred column has empty edges on BOTH sides, which is fine) is unbalanced.
  if (viewport !== 'mobile') {
    for (const item of measure.balance || []) {
      const width = item.containerRight - item.containerLeft;
      if (width < 600 || item.height < limit.height || (item.chars < limit.chars && !item.images) || !Array.isArray(item.bins)) continue;
      const bins = item.bins; const n = bins.length;
      const empty = (value) => value < 0.025;
      let left = 0; while (left < n && empty(bins[left])) left += 1;
      let right = 0; while (right < n && empty(bins[n - 1 - right])) right += 1;
      if (left >= n) continue;
      const diff = Math.abs(left - right) / n;
      const side = Math.max(left, right) / n;
      if (diff < limit.offset || side < limit.offset) continue;
      const emptySide = left > right ? 'left' : 'right';
      add('layout-unbalanced', diff >= limit.blocking && item.height >= 420 ? 'blocking' : 'advisory', item.heading,
        `On the ${where} the content of "${item.heading || 'a section'}" sits to the ${emptySide === 'left' ? 'right' : 'left'} and leaves the ${emptySide} ${round(side * width)}px of its ${round(width)}px width empty. Fix the structure, not the spacing: a timeline or list with few entries is ONE centred column (max-w-3xl mx-auto); a two-column section must put content in both columns (the picture or a second block in the empty one) with items-start; remove any column, grid track or image frame that has nothing in it.`);
    }
  }

  // 2. Grids: empty cells, template columns without items, a lone item in the last row.
  for (const cell of measure.cells || []) {
    const holder = cell.heading ? `"${cell.heading}"` : 'a section';
    if (cell.empty > 0) add('layout-empty-cell', 'blocking', cell.heading, `On the ${where} ${cell.empty} of the ${cell.count} cards in ${holder} are empty boxes (no text, no picture; class "${String(cell.className).slice(0, 50)}"). Render exactly one card per real item and nothing else: no placeholder card, no reserved image frame.`);
    if (cell.grid && cell.tracks >= 3 && cell.count < cell.tracks && cell.count >= 2) add('layout-grid-columns', 'advisory', cell.heading, `On the ${where} the grid in ${holder} defines ${cell.tracks} columns for only ${cell.count} items, so the right side stays empty. Size the columns to the item count: 2 items -> sm:grid-cols-2, 3 -> md:grid-cols-3, 4 -> lg:grid-cols-4 (or a 2x2), never more columns than items.`);
    else if (cell.grid && cell.tracks >= 3 && cell.rows >= 2 && cell.count % cell.tracks === 1 && cell.lastRow === 1) add('layout-grid-orphan', 'advisory', cell.heading, `On the ${where} the last row of the grid in ${holder} holds a single item beside ${cell.tracks - 1} empty columns (${cell.count} items in ${cell.tracks} columns). Use rows that fill: ${cell.count % 3 === 1 ? 'a centred wrapped row (flex flex-wrap justify-center with fixed item widths)' : 'a column count that divides the number of items'}.`);
  }

  // 3. Pictures: broken, duplicated within the page, unrelated to their section.
  const sectionOf = (image) => measure.sections[image.section];
  const seen = new Map();
  for (const image of measure.images || []) {
    const section = sectionOf(image);
    const heading = section?.heading || '';
    if (image.complete === false) { add('layout-image-broken', 'blocking', heading, `On the ${where} a picture${image.alt ? ` ("${String(image.alt).slice(0, 50)}")` : ''}${heading ? ` in "${heading}"` : ''} did not load (${String(image.src).slice(-60)}). Use a picture file that exists in the project, or remove the picture and its frame.`); continue; }
    if (image.width < limit.picture || !section || section.role !== 'section') continue;
    const key = normalizeUrl(image.src);
    const first = seen.get(key);
    if (first && first.index !== image.section) add('layout-image-duplicate', 'blocking', heading, `On the ${where} the same picture (${String(image.src).split('/').pop()}) is shown in "${first.heading || 'another section'}" and again in "${heading || 'this section'}". A picture is used once: give this section a different verified picture that fits its subject, or no picture (a text-led layout without an empty frame).`);
    else if (!first) seen.set(key, { index: image.section, heading });
    if (image.alt && image.context && String(image.alt).trim().split(/\s+/).length >= 3 && image.context.length >= 120 && overlap(image.alt, `${heading} ${image.context}`) === 0) {
      add('layout-image-mismatch', 'advisory', heading, `On the ${where} the picture described as "${String(image.alt).slice(0, 80)}" has nothing to do with "${heading || 'its section'}". Remove it or replace it with a picture of that section's subject; never keep a picture only to fill space.`);
    }
  }
  return issues;
}

/** The same picture used in different sections of different pages (one issue, at the later use). */
function crossPageImageIssues(perRoute) {
  const uses = new Map();
  const issues = [];
  for (const { route, pageName, measure } of perRoute) {
    for (const image of measure.images || []) {
      const section = measure.sections[image.section];
      if (!section || section.role !== 'section' || image.width < thresholds().picture || image.complete === false) continue;
      const key = normalizeUrl(image.src);
      const first = uses.get(key);
      const here = { route, pageName, heading: section.heading };
      if (!first) { uses.set(key, here); continue; }
      if (first.route !== route && first.heading !== here.heading) {
        issues.push({ kind: 'layout-image-duplicate', severity: 'blocking', viewport: 'desktop', route, heading: here.heading, message: `The same picture (${String(image.src).split('/').pop()}) is shown in "${first.heading}" on ${first.pageName || first.route} and in "${here.heading}" on ${pageName || route}. Different sections need different pictures: give "${here.heading}" a verified picture of its own subject, or lay it out text-led.` });
        uses.set(key, here);
      }
    }
  }
  return issues;
}

module.exports = { evaluateQuality, crossPageImageIssues, thresholds };
