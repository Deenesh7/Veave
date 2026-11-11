/**
 * Rendered visual composition review.
 *
 * Opens every route of a finished site in the headless browser at desktop, tablet and mobile widths, measures what is really on the
 * page (section extents, gaps, empty boxes, text line length, picture sizes, card heights, horizontal overflow) and also analyses a
 * full-page screenshot for large blank bands. The measurements become targeted repair instructions that name the page, the section,
 * the measured problem, its likely cause (from the computed styles) and the file to change. Nothing here edits code.
 */
const sharp = require('sharp');
const { REVIEW, VIEWPORTS } = require('./layoutCatalog');

/* Runs inside the page. Everything it returns is plain data. */
const PAGE_MEASURE = () => {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const sy = window.scrollY;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top + sy, bottom: r.bottom + sy, left: r.left, right: r.right, width: r.width, height: r.height }; };
  const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; };
  const px = (value) => { const n = parseFloat(value); return Number.isFinite(n) ? n : 0; };
  const MEDIA = /^(IMG|SVG|VIDEO|CANVAS|PICTURE|IFRAME)$/i;
  const extentOf = (container) => {
    let top = Infinity; let bottom = -Infinity; let chars = 0; let images = 0; let imageArea = 0; let controls = 0;
    const take = (r) => { if (r.width <= 0 || r.height <= 0) return; top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); };
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (!text || !node.parentElement || !shown(node.parentElement)) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect(); take({ top: r.top + sy, bottom: r.bottom + sy, width: r.width, height: r.height });
        chars += text.length;
        continue;
      }
      if (!shown(node)) continue;
      const style = getComputedStyle(node);
      if (MEDIA.test(node.tagName)) { const r = rectOf(node); take(r); if (/^(IMG|PICTURE|VIDEO)$/i.test(node.tagName)) { images += 1; imageArea += r.width * r.height; } }
      else if (style.backgroundImage !== 'none' && !/gradient/.test(style.backgroundImage) && node !== container) { const r = rectOf(node); take(r); images += 1; imageArea += r.width * r.height; }
      else if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/i.test(node.tagName)) { take(rectOf(node)); controls += 1; }
    }
    return { top: Number.isFinite(top) ? top : null, bottom: Number.isFinite(bottom) ? bottom : null, chars, images, imageArea, controls };
  };
  const label = (el) => (el.querySelector('h1, h2, h3')?.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const classOf = (el) => String(el.getAttribute('class') || '').split(/\s+/).slice(0, 14).join(' ');

  const root = document.querySelector('#root') || document.body;
  const main = root.querySelector('main');
  let holders = main ? [...main.children] : [...(root.children.length === 1 ? root.children[0].children : root.children)];
  if (holders.length === 1 && holders[0].children.length > 1) holders = [...holders[0].children];
  const chrome = [...root.querySelectorAll('header, footer')].filter((el) => !main?.contains(el) && !holders.includes(el));
  const sectionEls = [...holders, ...chrome].filter((el) => shown(el) && !/^(SCRIPT|STYLE|LINK)$/i.test(el.tagName)).sort((a, b) => rectOf(a).top - rectOf(b).top);
  const sections = sectionEls.map((el, index) => {
    const rect = rectOf(el); const style = getComputedStyle(el); const extent = extentOf(el);
    return { index, tag: el.tagName.toLowerCase(), heading: label(el), className: classOf(el), role: el.matches('header') || (el.matches('nav') && index === 0) ? 'header' : (el.matches('footer') ? 'footer' : 'section'),
      rect, content: extent, minHeight: px(style.minHeight), height: px(style.height), paddingTop: px(style.paddingTop), paddingBottom: px(style.paddingBottom), marginTop: px(style.marginTop), marginBottom: px(style.marginBottom), position: style.position };
  });

  const emptyBlocks = [];
  for (const el of root.querySelectorAll('div, section, span, li')) {
    if (emptyBlocks.length >= 8) break;
    if (!shown(el) || el.children.length > 0 || el.textContent.trim()) continue;
    const style = getComputedStyle(el);
    if (style.position === 'absolute' || style.position === 'fixed') continue;
    const r = rectOf(el);
    const painted = style.backgroundImage !== 'none' || (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') || px(style.borderTopWidth) > 0;
    if (r.height >= 140 && r.width >= 120 && !painted) emptyBlocks.push({ tag: el.tagName.toLowerCase(), className: classOf(el), top: r.top, height: r.height, width: r.width });
  }

  const paragraphs = [];
  for (const el of root.querySelectorAll('p, li, blockquote')) {
    if (!shown(el)) continue;
    const text = el.textContent.trim();
    if (text.length < 120) continue;
    const r = rectOf(el); const fs = px(getComputedStyle(el).fontSize) || 16;
    const holder = el.closest('section, main > *');
    paragraphs.push({ chars: text.length, width: r.width, fontSize: fs, lineHeight: px(getComputedStyle(el).lineHeight) / fs || 0, perLine: Math.round(r.width / (fs * 0.5)), heading: holder ? label(holder) : '', className: classOf(el), top: r.top, snippet: text.slice(0, 50) });
  }

  const images = [];
  for (const img of root.querySelectorAll('img')) {
    if (!shown(img)) continue;
    const r = rectOf(img); const style = getComputedStyle(img);
    const holder = sectionEls.find((el) => el.contains(img));
    images.push({ src: img.currentSrc || img.src, alt: img.getAttribute('alt'), width: r.width, height: r.height, top: r.top, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, fit: style.objectFit, section: holder ? sectionEls.indexOf(holder) : -1, sectionChars: holder ? extentOf(holder).chars : 0 });
  }

  const rows = [];
  for (const parent of root.querySelectorAll('div, ul, ol')) {
    const kids = [...parent.children].filter(shown);
    if (kids.length < 3 || kids.length > 12) continue;
    const rects = kids.map(rectOf);
    const row = rects.filter((r) => Math.abs(r.top - rects[0].top) <= 4 && Math.abs(r.width - rects[0].width) <= 8 && r.width > 120);
    if (row.length < 3) continue;
    const hs = row.map((r) => r.height);
    const holder = sectionEls.find((el) => el.contains(parent));
    rows.push({ heading: holder ? label(holder) : '', min: Math.min(...hs), max: Math.max(...hs), count: row.length, className: classOf(parent), top: rects[0].top });
  }

  const sizes = new Set();
  for (const el of root.querySelectorAll('h1,h2,h3,h4,p,li,a,button,label,blockquote,figcaption')) { if (shown(el) && el.textContent.trim()) sizes.add(Math.round(px(getComputedStyle(el).fontSize))); }

  const overflowers = [];
  for (const el of root.querySelectorAll('*')) {
    if (overflowers.length >= 6) break;
    const style = getComputedStyle(el);
    if (style.position === 'fixed' || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 2 && !el.closest('[class*="overflow-x"], [class*="overflow-hidden"]')) overflowers.push({ tag: el.tagName.toLowerCase(), className: classOf(el), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 40) });
  }

  return { viewport: { width: vw, height: vh }, docHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth, sections, emptyBlocks, paragraphs, images, rows, fontSizes: [...sizes].sort((a, b) => a - b), h1Count: root.querySelectorAll('h1').length, overflowers };
};

/* ------------------------------------------------------------------ evaluation (pure) ------------------------------------------------------------------ */

const median = (values) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const round = (n) => Math.round(n);

/** Why a gap is as large as it is, read from the two sections' computed styles. */
function gapCause(a, b, gap) {
  const causes = [];
  if (a.minHeight >= 200 && a.rect.height - (a.content.bottom - a.content.top) > 120) causes.push(`"${a.heading || a.tag}" has a min-height of ${round(a.minHeight)}px (${a.className.match(/\b(?:min-h-\S+|h-screen)\b/)?.[0] || 'class or style'}) that is taller than its content`);
  if (b.minHeight >= 200 && b.rect.height - (b.content.bottom - b.content.top) > 120) causes.push(`"${b.heading || b.tag}" has a min-height of ${round(b.minHeight)}px taller than its content`);
  const pad = a.paddingBottom + b.paddingTop;
  if (pad >= 160) causes.push(`padding of ${round(a.paddingBottom)}px below and ${round(b.paddingTop)}px above adds up to ${round(pad)}px`);
  const margin = a.marginBottom + b.marginTop;
  if (margin >= 96) causes.push(`margins of ${round(a.marginBottom)}px + ${round(b.marginTop)}px`);
  if (!causes.length) causes.push('an empty or fixed-height element, spacer, or an image that did not load reserves the space');
  return causes.join('; ');
}

/**
 * @param measure   PAGE_MEASURE result
 * @param viewport  'desktop' | 'tablet' | 'mobile'
 * @returns {{ issues: Array, density: Array }}  issues carry kind, severity, message (an instruction), section heading
 */
function evaluateLayout(measure, viewport = 'desktop', { pageName = '', route = '/' } = {}) {
  const issues = [];
  const where = `${pageName ? `${pageName} page (${route})` : route} at ${viewport} width`;
  const add = (kind, message, extra = {}) => issues.push({ kind, severity: REVIEW.blocking.includes(kind) ? 'blocking' : 'advisory', viewport, route, message, ...extra });
  const body = measure.sections.filter((section) => section.role === 'section' && section.rect.height > 0);
  const maxGap = viewport === 'mobile' ? REVIEW.maxGapMobile : (viewport === 'tablet' ? REVIEW.maxGapTablet : REVIEW.maxGapDesktop);

  // Horizontal overflow: never acceptable.
  if (measure.scrollWidth > measure.viewport.width + 2 || measure.overflowers.length) {
    const who = measure.overflowers.slice(0, 3).map((item) => `<${item.tag}${item.className ? ` class="${item.className.slice(0, 50)}"` : ''}>${item.text ? ` "${item.text}"` : ''}`).join(', ');
    add('layout-overflow-x', `On the ${where} the page scrolls sideways (content is ${round(measure.scrollWidth)}px wide in a ${measure.viewport.width}px window${who ? `; offenders: ${who}` : ''}). Make those elements fit: max-w-full, flex-wrap, break-words, responsive grid columns, and no fixed widths wider than the screen.`, { heading: measure.overflowers[0]?.text || '' });
  }

  // Gaps between the content of neighbouring sections, overlaps, empty sections.
  const gaps = [];
  for (let i = 0; i < body.length - 1; i += 1) {
    const a = body[i]; const b = body[i + 1];
    if (a.content.bottom === null || b.content.top === null) continue;
    gaps.push({ a, b, gap: b.content.top - a.content.bottom });
  }
  const typical = median(gaps.map((item) => item.gap).filter((gap) => gap > 0));
  for (const { a, b, gap } of gaps) {
    if (gap > maxGap || (gaps.length >= 3 && gap >= REVIEW.minBlockingGap && gap >= typical * REVIEW.gapOutlierFactor)) {
      add('layout-gap', `On the ${where} there is ${round(gap)}px of empty space between "${a.heading || a.tag}" and "${b.heading || b.tag}" (the rest of the page uses about ${round(typical)}px). Cause: ${gapCause(a, b, gap)}. Remove the fixed or minimum height and the extra padding or margin, use the section spacing from the plan (${REVIEW.maxGapDesktop > 0 ? 'py-10 md:py-14 for a major section, py-8 md:py-10 for related ones' : ''}), and keep related content together.`, { heading: a.heading, next: b.heading, size: round(gap) });
    }
  }
  for (let i = 0; i < body.length - 1; i += 1) {
    const a = body[i]; const b = body[i + 1];
    if (a.position === 'sticky' || a.position === 'fixed' || b.position === 'fixed') continue;
    if (b.rect.top < a.rect.bottom - 24 && b.rect.top > a.rect.top) add('layout-overlap', `On the ${where} "${b.heading || b.tag}" overlaps the section above it ("${a.heading || a.tag}") by ${round(a.rect.bottom - b.rect.top)}px. Remove the negative margins or absolute positioning that pull it up.`, { heading: b.heading });
  }
  for (const section of body) {
    const empty = section.content.top === null;
    if (empty && section.rect.height >= REVIEW.emptyContainerMinHeight) add('layout-empty', `On the ${where} a section${section.heading ? ` ("${section.heading}")` : ` (<${section.tag} class="${section.className.slice(0, 50)}">)`} is ${round(section.rect.height)}px tall but shows nothing. Remove it, or put its content in it (a picture that did not load must not leave an empty frame).`, { heading: section.heading });
  }
  for (const block of measure.emptyBlocks) add('layout-empty', `On the ${where} an empty <${block.tag}${block.className ? ` class="${block.className.slice(0, 50)}"` : ''}> reserves ${round(block.width)}x${round(block.height)}px of blank space. Remove it or give it its content; do not use empty boxes as spacers.`, { heading: '' });

  // Forced section heights taller than their content.
  for (const section of body) {
    const used = section.content.top === null ? 0 : section.content.bottom - section.content.top;
    if (section.minHeight >= Math.max(360, measure.viewport.height * 0.7) && section.rect.height - used > 220 && section.index > 0) {
      add('layout-forced-height', `On the ${where} "${section.heading || section.tag}" is forced to at least ${round(section.minHeight)}px tall but its content is ${round(used)}px. Remove min-h-screen / min-h-[..] / h-screen so its height follows its content.`, { heading: section.heading });
    }
  }

  // Text composition: line length and paragraph width.
  const wide = measure.paragraphs.filter((p) => p.perLine > REVIEW.maxCharsPerLine && p.width > 520).sort((a, b) => b.perLine - a.perLine);
  if (wide.length) {
    const worst = wide[0];
    add('layout-text-width', `On the ${where} paragraphs run about ${worst.perLine} characters per line${worst.heading ? ` (in "${worst.heading}")` : ''}; readable text is 55-75. Constrain the text with max-w-[68ch] (or max-w-prose) and place a picture or a second column beside it${wide.length > 1 ? `. ${wide.length} paragraphs are affected` : ''}.`, { heading: worst.heading });
  }
  if (measure.fontSizes.length > REVIEW.maxFontSizes) add('layout-type-scale', `On the ${where} ${measure.fontSizes.length} different text sizes are used (${measure.fontSizes.join(', ')}px). Use the type scale from the plan (eyebrow, H1, H2, H3, body, caption) and nothing else.`, {});
  if (measure.h1Count !== 1) add('layout-heading-hierarchy', `On the ${where} the page has ${measure.h1Count} <h1> elements; it needs exactly one, with H2 for sections and H3 inside cards.`, {});

  // Pictures: proportion and distortion.
  for (const image of measure.images) {
    const share = image.height / measure.viewport.height;
    const section = measure.sections[image.section];
    const wideShare = image.width / measure.viewport.width;
    if (viewport !== 'mobile' && share > REVIEW.imageDominates && wideShare > 0.5 && image.sectionChars < 700) {
      add('layout-image-dominates', `On the ${where} a picture${image.alt ? ` ("${String(image.alt).slice(0, 40)}")` : ''} is ${round(image.width)}x${round(image.height)}px beside only ${image.sectionChars} characters of text${section?.heading ? ` in "${section.heading}"` : ''}. Make it proportionate: place it in a two-column editorial layout (grid lg:grid-cols-2 items-center) in an aspect-[4/3] frame, not full width.`, { heading: section?.heading || '' });
      break;
    }
    if (image.naturalWidth && image.naturalHeight && image.fit === 'fill' && Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) > 0.25) {
      add('layout-image-distorted', `On the ${where} a picture${image.alt ? ` ("${String(image.alt).slice(0, 40)}")` : ''} is stretched (shown at ${round(image.width)}x${round(image.height)}px, natural ${image.naturalWidth}x${image.naturalHeight}). Put it in an aspect-ratio frame with object-cover.`, { heading: section?.heading || '' });
      break;
    }
  }

  // Cards in one row with very different heights.
  for (const row of measure.rows) {
    if (row.max / Math.max(1, row.min) > REVIEW.cardHeightSpread && row.max - row.min > 90) {
      add('layout-card-heights', `On the ${where} ${row.count} cards in one row${row.heading ? ` in "${row.heading}"` : ''} have uneven heights (${round(row.min)}-${round(row.max)}px). Use grid with items-stretch, equal image frames (aspect ratio) and h-full cards so the row lines up.`, { heading: row.heading });
      break;
    }
  }

  // Density per section: too empty, text-heavy, image-heavy.
  const density = body.map((section) => {
    const used = section.content.top === null ? 0 : section.content.bottom - section.content.top;
    const imageShare = section.rect.width * section.rect.height ? section.content.imageArea / (section.rect.width * section.rect.height) : 0;
    let state = 'balanced';
    if (section.content.chars < 220 && used < 120 && section.rect.height > 420 && !section.content.images) state = 'too-empty';
    else if (section.content.chars > 1700 && section.content.images === 0) state = 'text-heavy';
    else if (imageShare > 0.6 && section.content.chars < 160) state = 'image-heavy';
    else if (section.content.chars > 900 && section.rect.height < 360) state = 'crowded';
    return { heading: section.heading, state, chars: section.content.chars, images: section.content.images, height: round(section.rect.height) };
  });
  for (const item of density) {
    if (item.state === 'too-empty') add('layout-density', `On the ${where} "${item.heading || 'a section'}" has little content (${item.chars} characters) in a ${item.height}px tall section. Make it compact (py-8 md:py-10, content-sized) or combine it with the related section next to it.`, { heading: item.heading });
    if (item.state === 'text-heavy') add('layout-density', `On the ${where} "${item.heading || 'a section'}" is a wall of text (${item.chars} characters, no picture). Break it into sub-headed paragraphs, a list or two columns, and add a relevant verified picture or a timeline.`, { heading: item.heading });
  }
  return { issues, density };
}

/* ------------------------------------------------------------------ screenshot analysis ------------------------------------------------------------------ */

/** Blank horizontal bands in a full-page screenshot: rows with no visible variation. Independent of the DOM, so it catches what styles hide. */
async function blankBands(png, { minHeight = 320, edge = true } = {}) {
  const meta = await sharp(png).metadata();
  const scale = (meta.width || 1) / 160;
  const { data, info } = await sharp(png).resize({ width: 160 }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const bands = [];
  let start = null;
  for (let y = 0; y < info.height; y += 1) {
    const row = data.subarray(y * info.width, (y + 1) * info.width);
    let min = 255; let max = 0;
    for (const value of row) { if (value < min) min = value; if (value > max) max = value; }
    const blank = max - min <= 3;
    if (blank && start === null) start = y;
    if ((!blank || y === info.height - 1) && start !== null) {
      const end = blank ? y + 1 : y;
      const height = (end - start) * scale;
      if (height >= minHeight && (edge || (start > 0 && end < info.height))) bands.push({ top: Math.round(start * scale), height: Math.round(height) });
      start = null;
    }
  }
  return bands;
}

/* ------------------------------------------------------------------ orchestration ------------------------------------------------------------------ */

const fileFor = (files, heading) => {
  const needle = String(heading || '').trim().slice(0, 28);
  if (needle.length < 4) return null;
  return files.find((file) => file.encoding !== 'base64' && typeof file.content === 'string' && /^src\//.test(file.path) && file.content.includes(needle))?.path || null;
};
const rank = { 'layout-overflow-x': 0, 'layout-gap': 1, 'layout-empty': 2, 'layout-forced-height': 3 };

/**
 * @param render   async (files, { routePath, viewport, inspect, onPage }) => measurement   (inspectRenderedPreview in production)
 * @param routes   [{ path, name }]
 * @returns {{ issues, blocking, metrics, screenshots }}  issues in the completeness format ({ category, kind, path, message, ... })
 */
async function reviewComposition(files, { routes = [{ path: '/', name: 'Home' }], viewports = ['desktop', 'tablet', 'mobile'], render, signal, concurrency = 2, screenshots = true } = {}) {
  const jobs = [];
  for (const route of routes) for (const name of viewports) if (VIEWPORTS[name]) jobs.push({ route, viewport: VIEWPORTS[name] });
  const found = [];
  const metrics = {};
  const shots = [];
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (next < jobs.length && !failure) {
      const { route, viewport } = jobs[next]; next += 1;
      signal?.throwIfAborted();
      try {
        let bands = [];
        let shotBytes = 0;
        const measure = await render(files, { routePath: route.path, viewport: { width: viewport.width, height: viewport.height }, inspect: PAGE_MEASURE, onPage: screenshots ? async (page) => {
          try { const png = await page.screenshot({ fullPage: true, type: 'png' }); shotBytes = png.length; bands = await blankBands(png, { minHeight: viewport.name === 'mobile' ? 300 : 360, edge: false }); } catch { /* the DOM measurements still apply */ }
        } : null });
        const { issues, density } = evaluateLayout(measure, viewport.name, { pageName: route.name, route: route.path });
        // A blank band in the screenshot that no DOM gap explains.
        for (const band of bands.slice(0, 2)) {
          if (!issues.some((issue) => issue.kind === 'layout-gap')) {
            issues.push({ kind: 'layout-gap', severity: 'blocking', viewport: viewport.name, route: route.path, size: band.height, heading: '', message: `On the ${route.name ? `${route.name} page (${route.path})` : route.path} at ${viewport.name} width the rendered page has a blank band of ${band.height}px at ${band.top}px from the top. Find the section that reserves it (a fixed or minimum height, large padding or margin, an empty element or a picture that did not load) and remove the extra space.` });
          }
        }
        metrics[`${route.path}@${viewport.name}`] = { docHeight: measure.docHeight, sections: measure.sections.length, density, blankBands: bands, screenshotBytes: shotBytes };
        if (shotBytes) shots.push({ route: route.path, viewport: viewport.name, bytes: shotBytes });
        found.push(...issues);
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = error; // the preview could not render at all: the build checks report that, not this review
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  if (failure) return { issues: [], blocking: [], metrics, screenshots: shots, skipped: failure.message };
  // One issue per kind, route and section: the same defect seen at three widths is reported once, at the worst width.
  const merged = new Map();
  for (const issue of found) {
    const key = `${issue.kind}|${issue.route}|${issue.heading || ''}|${issue.next || ''}`;
    const old = merged.get(key);
    if (!old || (issue.size || 0) > (old.size || 0) || (old.viewport !== 'desktop' && issue.viewport === 'desktop' && !issue.size)) merged.set(key, issue);
  }
  const issues = [...merged.values()].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)).slice(0, 14).map((issue) => ({
    category: 'completeness', kind: issue.kind, severity: issue.severity, path: fileFor(files, issue.heading) || fileFor(files, issue.next) || 'src/App.jsx', route: issue.route, viewport: issue.viewport, message: issue.message
  }));
  return { issues, blocking: issues.filter((issue) => issue.severity === 'blocking'), metrics, screenshots: shots };
}

module.exports = { PAGE_MEASURE, evaluateLayout, blankBands, reviewComposition, median };
