/**
 * Self-validating incremental edits.
 *
 *   Inspect -> Identify -> Compare -> Plan -> Modify -> Render -> Validate -> Correct -> Confirm
 *
 * After an incremental edit has been applied and has passed the project's build/syntax gate, this module
 *  1. renders the affected routes of the project BEFORE and AFTER the edit (existing preview infrastructure),
 *  2. detects visual defects (broken/collapsed/stretched images, overlapping or clipped text, horizontal overflow),
 *  3. compares the result with the live real website when the project is a clone and the site is reachable,
 *  4. repairs only what the edit introduced (or what the user's request targeted) with minimal patches, and
 *  5. returns an auditable report whose status is never "passed" unless the required checks really passed.
 *
 * Everything that touches the outside world (rendering, the real site, the model, the build gate) is injected, so the
 * orchestration is deterministic and testable.
 */

const STATES = Object.freeze({
  INSPECTING: 'inspecting',
  PLANNING: 'planning',
  MODIFYING: 'modifying',
  BUILDING: 'building',
  VISUAL: 'visual-validation',
  REPAIRING: 'repairing',
  PASSED: 'passed',
  PARTIAL: 'partially-passed',
  FAILED: 'failed'
});

const CATEGORY_PRIORITY = { asset: 1, layout: 2, overlap: 3, typography: 4, color: 5, minor: 6 };
// Defect kinds that make a page visibly broken. Only these (when introduced by the edit) can fail a job.
const imageDiagnostics = require('./imageDiagnostics');
const BLOCKING_KINDS = new Set(['broken-image', 'collapsed-image', 'horizontal-scroll', 'text-overlap']);
const DEFAULT_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

function resolveConfig(env = process.env) {
  const viewports = String(env.INCREMENTAL_VISUAL_VIEWPORTS || '').split(',').map((value) => Number.parseInt(value, 10)).filter((value) => value >= 320 && value <= 3000);
  return {
    enabled: !/^(?:0|off|false|no)$/i.test(String(env.INCREMENTAL_VISUAL_VALIDATION || 'on')),
    enforce: !/^(?:0|off|false|no)$/i.test(String(env.INCREMENTAL_VISUAL_ENFORCE || 'on')),
    maxRepairs: Math.max(0, Math.min(5, Number.parseInt(env.INCREMENTAL_VISUAL_MAX_REPAIRS, 10) || 2)),
    maxRoutes: Math.max(1, Math.min(8, Number.parseInt(env.INCREMENTAL_VISUAL_MAX_ROUTES, 10) || 4)),
    viewports: viewports.length ? viewports.map((width) => ({ width, height: width < 600 ? 844 : 900 })) : DEFAULT_VIEWPORTS
  };
}

/* -------------------------------------------------------------------------------------------------------------- */
/* In-page defect inspector (runs inside the rendered project; must stay self-contained)                          */
/* -------------------------------------------------------------------------------------------------------------- */

/* eslint-disable no-undef */
function defectInspector(options) {
  const limit = (options && options.limit) || 40;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'HEAD', 'META', 'LINK', 'BR']);
  const defects = [];
  const labelOf = (el) => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`.slice(0, 80);
  };
  const pathOfEl = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.body && parts.length < 3; node = node.parentElement) parts.unshift(labelOf(node));
    return parts.join(' > ');
  };
  const rendered = (el) => (typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : (() => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0; })());
  // A box that a clipping ancestor (carousel, collapsed menu) hides entirely is not "visible" to the user.
  const clippedAway = (el, rect, ignoreZeroSize) => {
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && node !== document.body) {
        const r = node.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { if (ignoreZeroSize) continue; return true; }
        if (rect.right <= r.left || rect.left >= r.right || rect.bottom <= r.top || rect.top >= r.bottom) return true;
      }
    }
    return false;
  };
  const add = (kind, el, detail, extra) => {
    if (defects.length >= limit) return;
    const r = el.getBoundingClientRect();
    defects.push(Object.assign({ kind, selector: labelOf(el), path: pathOfEl(el), detail, rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)] }, extra || {}));
  };

  // Images: missing, collapsed to nothing, or stretched.
  for (const img of document.images) {
    if (!img.getAttribute('src') && !img.currentSrc) continue;
    if (!rendered(img)) continue;
    const rect = img.getBoundingClientRect();
    // An image squeezed to 0 wide inside a clipping box that is itself 0 wide is exactly the defect, not a hidden slide.
    const squeezed = (rect.width < 1 && rect.height >= 20) || (rect.height < 1 && rect.width >= 20);
    if (clippedAway(img, rect, squeezed)) continue;
    const src = img.currentSrc || img.src || '';
    if (img.complete && img.naturalWidth === 0) { add('broken-image', img, `the image failed to load: ${src.slice(0, 160)}`, { src }); continue; }
    if (rect.width < 1 || rect.height < 1) { add('collapsed-image', img, `the image is in the page but renders ${Math.round(rect.width)}x${Math.round(rect.height)}px (natural ${img.naturalWidth}x${img.naturalHeight}): ${src.slice(0, 160)}`, { src }); continue; }
    const fit = getComputedStyle(img).objectFit;
    if ((fit === 'fill' || fit === '') && img.naturalWidth > 20 && img.naturalHeight > 20 && rect.width > 20 && rect.height > 20) {
      const natural = img.naturalWidth / img.naturalHeight;
      const shown = rect.width / rect.height;
      if (Math.abs(natural - shown) / natural > 0.15) add('distorted-image', img, `the image is stretched: natural ratio ${natural.toFixed(2)}, shown ${shown.toFixed(2)}: ${src.slice(0, 160)}`, { src });
    }
  }

  // Text boxes: the real rectangles of each element's own text.
  const items = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node && items.length < 1800; node = walker.nextNode()) {
    if (!(node instanceof Element) || SKIP.has(node.tagName.toUpperCase())) continue;
    const textNodes = [...node.childNodes].filter((child) => child.nodeType === 3 && child.textContent.trim().length > 1);
    if (!textNodes.length || !rendered(node)) continue;
    const rects = [];
    for (const textNode of textNodes) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) rects.push(r);
    }
    if (!rects.length) continue;
    const box = node.getBoundingClientRect();
    if (clippedAway(node, box)) continue;
    const text = textNodes.map((child) => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    items.push({ el: node, text, rects: rects.map((r) => [r.left, r.top + window.scrollY, r.right, r.bottom + window.scrollY]) });

    const s = getComputedStyle(node);
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && node.scrollWidth > node.clientWidth + 3 && node.clientWidth > 0) {
      add('clipped-text', node, `text is cut off horizontally (${node.scrollWidth}px of content in ${node.clientWidth}px)`, { text: text.slice(0, 60) });
    }
  }
  const overlapArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  items.sort((a, b) => a.rects[0][1] - b.rects[0][1]);
  for (let i = 0; i < items.length && defects.length < limit; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (items[j].rects[0][1] > items[i].rects[items[i].rects.length - 1][3] + 2 && items[j].rects[0][1] > items[i].rects[0][1] + 2000) break;
      const a = items[i];
      const b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      let hit = false;
      for (const ra of a.rects) {
        for (const rb of b.rects) {
          const o = overlapArea(ra, rb);
          if (o > 40 && o / Math.min(area(ra), area(rb)) > 0.3) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) { add('text-overlap', a.el, `"${a.text.slice(0, 40)}" overlaps "${b.text.slice(0, 40)}" (${labelOf(b.el)})`, { text: a.text.slice(0, 60), other: b.text.slice(0, 60), otherSelector: labelOf(b.el) }); }
      if (defects.length >= limit) break;
    }
  }

  // Overflow outside the viewport (unintended horizontal scrolling).
  const docWidth = document.documentElement.scrollWidth;
  if (docWidth > window.innerWidth + 2) {
    const wide = [...document.body.querySelectorAll('*')].filter((el) => !SKIP.has(el.tagName.toUpperCase()) && rendered(el)).map((el) => ({ el, right: el.getBoundingClientRect().right })).filter((item) => item.right > window.innerWidth + 2).sort((a, b) => b.right - a.right);
    const first = wide[0] && wide[0].el;
    defects.push({ kind: 'horizontal-scroll', selector: first ? labelOf(first) : 'document', path: first ? pathOfEl(first) : '', detail: `the page is ${docWidth}px wide in a ${window.innerWidth}px viewport${first ? `; widest element ${labelOf(first)} ends at ${Math.round(wide[0].right)}px` : ''}`, rect: [0, 0, docWidth, 0] });
  }
  return { defects, textBoxes: items.length, docWidth, viewport: window.innerWidth };
}
/* eslint-enable no-undef */

/* -------------------------------------------------------------------------------------------------------------- */
/* Pure helpers                                                                                                   */
/* -------------------------------------------------------------------------------------------------------------- */

const basename = (value = '') => String(value).split(/[?#]/)[0].split('/').pop() || '';
const normText = (value = '') => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 48);

/** A stable identity for a defect that survives unrelated layout shifts (positions are deliberately not part of it). */
function defectSignature(defect) {
  const subject = defect.src ? basename(defect.src) : normText(defect.text || '') || defect.selector;
  return [defect.kind, defect.selector, subject, defect.otherSelector ? normText(defect.other || '') : ''].join('|');
}

/** after - before. `resolved` are defects the edit fixed; `preexisting` stay untouched and are only reported. */
function diffDefects(before = [], after = []) {
  const beforeSet = new Set(before.map(defectSignature));
  const afterSet = new Set(after.map(defectSignature));
  return {
    introduced: after.filter((defect) => !beforeSet.has(defectSignature(defect))),
    resolved: before.filter((defect) => !afterSet.has(defectSignature(defect))),
    preexisting: after.filter((defect) => beforeSet.has(defectSignature(defect)))
  };
}

const categoryOfDefect = (defect) => (/image/.test(defect.kind) ? 'asset' : defect.kind === 'horizontal-scroll' ? 'layout' : defect.kind === 'text-overlap' || defect.kind === 'clipped-text' ? 'overlap' : 'minor');

/**
 * Real page vs project page, both measured with the same in-page snapshot at the same viewport.
 * Pairs images by their alt text / surrounding text, texts by their own text. Differences that are not meaningful
 * (sub-tolerance sizes, dynamic content) are not reported.
 */
function compareWithReference(real, project, fidelity) {
  const issues = [];
  if (!real || !project) return { issues, summary: null };
  const style = fidelity.compareStyles(real, project);
  for (const item of style.mismatches) {
    for (const diff of item.diffs) {
      const category = diff.property === 'color' || diff.property === 'background' ? 'color' : 'typography';
      issues.push({ category, kind: `${diff.property}-differs`, text: item.text, tag: item.tag, real: diff.real, project: diff.project, documentY: item.documentY, detail: `"${String(item.text).slice(0, 50)}" ${diff.property}: real ${diff.real}, project ${diff.project}` });
    }
  }
  for (const problem of style.problems) {
    issues.push({ category: 'overlap', kind: problem.kind === 'covered' ? 'text-covered' : 'text-unreadable', text: problem.text, tag: problem.tag, documentY: problem.documentY, detail: problem.kind === 'covered' ? `"${String(problem.text).slice(0, 50)}" is hidden under another element` : `"${String(problem.text).slice(0, 50)}" is unreadable (contrast ${problem.contrast}); on the real page its background is ${problem.realBackgroundOfThisText}` });
  }
  // Images: the real page's meaningful images must exist in the project at a similar size.
  const projectImages = project.images || [];
  const usedProject = new Set();
  const key = (image) => normText(image.alt) || normText(image.near);
  for (const image of real.images || []) {
    if (image.width < 40 || image.height < 40) continue;
    const k = key(image);
    if (!k) continue;
    const index = projectImages.findIndex((candidate, i) => !usedProject.has(i) && key(candidate) === k);
    if (index < 0) {
      issues.push({ category: 'asset', kind: 'image-missing', text: image.alt || image.near, documentY: image.documentY, real: `${image.width}x${image.height}`, detail: `the real page shows an image (${image.alt || image.near || 'no alt'}, ${image.width}x${image.height}px) that the project does not render`, realSrc: image.src });
      continue;
    }
    usedProject.add(index);
    const other = projectImages[index];
    const ratio = (a, b) => (b ? a / b : 1);
    if (Math.abs(ratio(other.width, image.width) - 1) > 0.25 || Math.abs(ratio(other.height, image.height) - 1) > 0.25) {
      issues.push({ category: 'layout', kind: 'image-size-differs', text: image.alt || image.near, documentY: image.documentY, real: `${image.width}x${image.height}`, project: `${other.width}x${other.height}`, detail: `image "${(image.alt || image.near || '').slice(0, 40)}" is ${other.width}x${other.height}px, the real page shows ${image.width}x${image.height}px` });
    }
  }
  // Where the clone has more empty space than the real page: the same text sits lower and lower; the jump between two
  // neighbouring texts is the space that was added (for example a fixed min-height the source site's script used to remove).
  for (const issue of extraSpaceIssues(real, project)) issues.push(issue);
  if (real.docHeight && project.docHeight && Math.abs(project.docHeight - real.docHeight) / real.docHeight > 0.15) {
    issues.push({ category: 'layout', kind: 'page-height-differs', detail: `the page is ${project.docHeight}px tall, the real page ${real.docHeight}px`, real: String(real.docHeight), project: String(project.docHeight) });
  }
  issues.sort((a, b) => (CATEGORY_PRIORITY[a.category] || 9) - (CATEGORY_PRIORITY[b.category] || 9) || (a.documentY || 0) - (b.documentY || 0));
  return { issues, summary: { matchedTexts: style.matched, realTexts: style.realTotal, notFoundTexts: style.notFound, realImages: (real.images || []).length, projectImages: projectImages.length } };
}

/** Pairs of neighbouring texts (present once on both pages) whose distance grew by more than `minGrowth` px in the project. */
function extraSpaceIssues(real, project, { minGrowth = 150, limit = 8 } = {}) {
  const unique = (list) => { const seen = new Map(); for (const item of list || []) seen.set(item.key, seen.has(item.key) ? null : item); return seen; };
  const realTexts = unique(real.texts);
  const projectTexts = unique(project.texts);
  const pairs = [];
  for (const [key, projectItem] of projectTexts) {
    const realItem = realTexts.get(key);
    if (projectItem && realItem && key && key.length >= 4) pairs.push({ text: projectItem.text, py: projectItem.documentY, ry: realItem.documentY });
  }
  pairs.sort((a, b) => a.py - b.py);
  const out = [];
  let previous = { text: null, py: 0, ry: 0 };
  for (const pair of pairs) {
    const growth = (pair.py - pair.ry) - (previous.py - previous.ry);
    if (growth > minGrowth) {
      out.push({
        category: 'layout', kind: 'extra-space', text: previous.text || pair.text, otherText: previous.text ? pair.text : null, documentY: previous.py,
        real: `${Math.max(0, pair.ry - previous.ry)}px`, project: `${pair.py - previous.py}px`,
        detail: `${Math.round(growth)}px more empty space than the real page ${previous.text ? `between "${String(previous.text).slice(0, 50)}" and "${String(pair.text).slice(0, 50)}"` : `above "${String(pair.text).slice(0, 50)}"`} (project ${pair.py - previous.py}px apart, real page ${Math.max(0, pair.ry - previous.ry)}px)`
      });
    }
    previous = pair;
  }
  return out.sort((a, b) => parseInt(b.project, 10) - parseInt(a.project, 10)).slice(0, limit).sort((a, b) => a.documentY - b.documentY);
}

/** "remove the empty space in this page", "too much gap", "reduce the spacing": a request about space itself. */
const SPACING_NOUN = '(?:white\\s*space|whitespace|space|spaces|spacing|gap|gaps|margin|margins|padding|paddings|area|areas|section|sections|page)';
const SPACING_REQUEST = new RegExp([
  // "empty space", "blank gap", "extra spacing", "existing gap", "big white space" ...
  `\\b(?:empty|blank|white|extra|unwanted|unnecessary|existing|excess|excessive|additional|big|large|huge|useless|wasted|vacant|dead)\\s+${SPACING_NOUN}\\b`,
  // "too much space", "too many gaps"
  '\\btoo\\s+(?:much|many|big|large)\\s+(?:\\w+\\s+)?(?:space|spaces|gap|gaps|spacing|margin|padding)\\b',
  // "remove the (existing / big) gap", "close the gap between", "get rid of the space"
  '\\b(?:remove|reduce|fix|close|shrink|cut|trim|delete|eliminate|clear|tighten|minimi[sz]e|get\\s+rid\\s+of)\\s+(?:\\w+\\s+){0,3}?(?:space|spaces|spacing|whitespace|gap|gaps)\\b',
  // "gap between the photo and content", "space between"
  '\\b(?:space|spaces|gap|gaps|spacing)\\s+(?:between|above|below|under|after|before)\\b'
].join('|'), 'i');
const isSpacingRequest = (prompt = '') => SPACING_REQUEST.test(String(prompt));

/* ---- "make these images horizontal / vertical": did the arrangement really change? -------------------------------- */

const NUMBER_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ROW_WORDS = /\b(?:horizontal(?:ly)?|horizontonal|in\s+(?:a|one|1)\s+row|side[\s-]by[\s-]side|next\s+to\s+each\s+other|in\s+one\s+line|inline|row)\b/i;
const COLUMN_WORDS = /\b(?:vertical(?:ly)?|stacked|in\s+(?:a|one|1)\s+column|one\s+(?:below|under|above)\s+the\s+other|on\s+top\s+of\s+each\s+other)\b/i;
const LAYOUT_SUBJECT = /\b(?:images?|photos?|pictures?|logos?|icons?|thumbnails?|badges?|cards?)\b/i;

/** { orientation: 'row'|'column', count } when the request is about how images are arranged, otherwise null. */
function extractLayoutRequest(prompt = '') {
  const text = String(prompt || '');
  if (!LAYOUT_SUBJECT.test(text)) return null;
  // "make it horizontal": the destination is the last orientation word; "vertical ... make them horizontal" asks for a row.
  const row = [...text.matchAll(new RegExp(ROW_WORDS.source, 'gi'))].map((m) => m.index).pop();
  const column = [...text.matchAll(new RegExp(COLUMN_WORDS.source, 'gi'))].map((m) => m.index).pop();
  if (row === undefined && column === undefined) return null;
  const orientation = column === undefined || (row !== undefined && row > column) ? 'row' : 'column';
  const digit = text.match(/\b(\d{1,2})\s+(?:\w+\s+)?(?:images?|photos?|pictures?|logos?|icons?|cards?)\b/i);
  const word = text.match(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:\\w+\\s+)?(?:images?|photos?|pictures?|logos?|icons?|cards?)\\b`, 'i'));
  const count = digit ? Number(digit[1]) : word ? NUMBER_WORDS[word[1].toLowerCase()] : null;
  const plural = /\b(?:images|photos|pictures|logos|icons|thumbnails|badges|cards)\b/i.test(text);
  if (!count && !plural) return null; // "a horizontal logo" is about one image, not an arrangement of several
  const generic = new Set(['about', 'page', 'pages', 'section', 'there', 'these', 'those', 'where', 'their', 'under', 'below', 'above', 'make', 'them', 'that', 'this', 'with', 'from', 'into', 'have', 'image', 'images', 'photo', 'photos', 'picture', 'pictures', 'logo', 'logos', 'icons', 'cards', 'card', 'vertical', 'vertically', 'horizontal', 'horizontally', 'horizontonal', 'stacked', 'change', 'inline', 'home', 'please', 'need', 'want', 'should', 'would', 'column', 'columns', 'side', 'each', 'other', 'which', 'after', 'before', 'inside', 'within', 'currently', 'looks', 'look']);
  const anchors = [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => !generic.has(word)))].slice(0, 6);
  return { orientation, count: count && count >= 2 && count <= 12 ? count : null, anchors };
}

/**
 * Runs in the page. Reports the visible images and their arrangement: the largest group sharing one row and one column
 * (each with the image files in it). With `argument.srcs` only those images are considered, so the same images can be followed
 * from before the edit to after it, whatever else is on the page.
 */
function layoutInspector(argument) {
  const only = argument && Array.isArray(argument.srcs) ? new Set(argument.srcs) : null;
  const visible = (img) => { const r = img.getBoundingClientRect(); return r.width >= 8 && r.height >= 8; };
  const fileOf = (img) => (img.currentSrc || img.src || '').split('/').pop().split('?')[0];
  // "under the overview there are 6 images": the images that follow the heading the request names, in document order.
  let scopedFiles = null;
  if (argument && Array.isArray(argument.anchors) && argument.anchors.length && argument.count) {
    const words = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((node) => words(node.textContent).some((word) => argument.anchors.includes(word)));
    if (heading) {
      const after = [...document.querySelectorAll('img')].filter((img) => visible(img) && (heading.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING));
      scopedFiles = after.slice(0, argument.count).map(fileOf);
    }
  }
  const everyImage = [...document.querySelectorAll('img')].map((img) => { const r = img.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, file: (img.currentSrc || img.src || '').split('/').pop().split('?')[0] }; })
    .filter((box) => box.w >= 8 && box.h >= 8);
  const allX = {};
  for (const box of everyImage) if (!(box.file in allX)) allX[box.file] = Math.round(box.x);
  const shown = everyImage.filter((box) => !only || only.has(box.file));
  const groups = (axis) => {
    const out = [];
    for (const anchor of shown) {
      const members = shown.filter((box) => axis === 'row'
        ? Math.abs((box.y + box.h / 2) - (anchor.y + anchor.h / 2)) < Math.min(box.h, anchor.h) * 0.5
        : Math.abs((box.x + box.w / 2) - (anchor.x + anchor.w / 2)) < Math.min(box.w, anchor.w) * 0.5);
      const distinct = members.filter((box, index) => members.findIndex((other) => (axis === 'row' ? Math.abs(other.x - box.x) : Math.abs(other.y - box.y)) < 4) === index);
      out.push(distinct);
    }
    return out;
  };
  const pick = (list, wanted) => list.slice().sort((a, b) => (wanted ? Math.abs(a.length - wanted) - Math.abs(b.length - wanted) : 0) || b.length - a.length)[0] || [];
  const wanted = argument && argument.count ? argument.count : 0;
  const rows = groups('row');
  const columns = groups('column');
  const bestRow = pick(rows, only ? 0 : wanted);
  const bestColumn = pick(columns, only ? 0 : wanted);
  // What a developer would read in the inspector: the elements between the images and their common container, with the
  // properties that decide the arrangement.
  let facts = '';
  let children = [];
  try {
    const targets = [...document.querySelectorAll('img')].filter((img) => visible(img) && ((only && only.has(fileOf(img))) || (scopedFiles && scopedFiles.includes(fileOf(img)))));
    if (targets.length >= 2) {
      let common = targets[0].parentElement;
      while (common && !targets.every((img) => common.contains(img))) common = common.parentElement;
      const label = (node) => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.classList.length ? `.${[...node.classList].slice(0, 3).join('.')}` : ''}`;
      const style = (node) => { const c = getComputedStyle(node); return `display:${c.display}; position:${c.position}; width:${Math.round(parseFloat(c.width) || 0)}px; grid-area:${c.gridArea}; flex:${c.flex}; float:${c.cssFloat}`; };
      const chain = [];
      for (let node = targets[0]; node && node !== common; node = node.parentElement) chain.push(`${label(node)} {${style(node)}}`);
      const kids = common ? [...common.children].slice(0, 14).map((child) => `${label(child)}${targets.some((img) => child.contains(img)) ? ' [holds an image]' : ''}`) : [];
      children = common ? [...common.children].slice(0, 120).map((child) => ({ tag: child.tagName.toLowerCase(), cls: child.getAttribute('class') || '', holds: targets.some((img) => child.contains(img)) })) : [];
      facts = `COMMON CONTAINER ${common ? label(common) : '?'} {${common ? style(common) : ''}}; its children in order: ${kids.join(', ')}; from the first image up to the container: ${chain.join(' < ')}`;
    }
  } catch (error) { facts = ''; }
  const describe = (list) => list.slice(0, 8).map((box) => `${box.file.slice(0, 24)}@${Math.round(box.x)},${Math.round(box.y)}`);
  return { images: shown.length, allX, scopedFiles, facts: facts.slice(0, 1800), children, row: bestRow.length, column: bestColumn.length, rowFiles: bestRow.map((b) => b.file), columnFiles: bestColumn.map((b) => b.file), rowSample: describe(bestRow), columnSample: describe(bestColumn) };
}

/**
 * Compares the arrangement before and after the edit against what was asked.
 * `before` is the measurement of the whole page before the edit (it names the images to follow); `after` is the measurement of
 * those same images after it.
 */
function layoutTarget(request, before) {
  if (!request || !before) return null;
  // Asked for a row: the images to follow are the ones stacked in a column now (and the other way round).
  if (Array.isArray(before.scopedFiles) && before.scopedFiles.length >= 2) return before.scopedFiles;
  const files = request.orientation === 'row' ? before.columnFiles : before.rowFiles;
  return Array.isArray(files) && files.length >= 2 ? files : null;
}

function verifyLayoutRequest(request, before, after) {
  if (!request || !after) return { ok: true, skipped: true, detail: 'no layout request' };
  const key = request.orientation === 'row' ? 'row' : 'column';
  const followed = layoutTarget(request, before);
  const group = followed ? followed.length : 0;
  const wanted = request.count ? Math.min(request.count, group || request.count) : group;
  if (!wanted) return { ok: true, skipped: true, detail: 'no stacked images were found before the edit, so there is nothing to compare' };
  const now = after[key];
  // The change must stay on the requested images: other images may move down or up, but not sideways.
  const target = new Set(followed || []);
  const shifted = before && before.allX && after.allX
    ? Object.keys(before.allX).filter((file) => !target.has(file) && file in after.allX && Math.abs(after.allX[file] - before.allX[file]) > 24)
    : [];
  if (now >= wanted && shifted.length >= 2) {
    return { ok: false, now, wanted, collateral: shifted, detail: `the requested images are in one row, but ${shifted.length} other images moved sideways (${shifted.slice(0, 4).join(', ')}): the rule is too broad. Apply it only to the container or the blocks that hold the requested images (give that container its own id/class), not to the whole content area` };
  }
  const ok = now >= wanted;
  const where = request.orientation === 'row' ? 'in one row' : 'in one column';
  return {
    ok, now, wanted,
    detail: ok ? `${now} of the ${group} images are now arranged ${where}`
      : `the images are not arranged ${request.orientation === 'row' ? 'horizontally' : 'vertically'}: only ${now} of the ${group} images are ${where}, ${wanted} expected; positions: ${(after[`${key}Sample`] || []).join(' | ')}${after.facts ? `. Rendered structure: ${after.facts}` : ''}`
  };
}

/** Reference issues that belong to the part the user asked about (the only ones repaired without being introduced by the edit). */
function targetedIssues(issues, focusTerms = []) {
  const words = focusTerms.map((term) => normText(term)).filter((term) => term.length > 2);
  if (!words.length) return [];
  // A logo/emblem/banner/image request names a part that the real page rarely labels with that word: every real image at
  // the top of the page that the project does not show is part of what was asked for.
  const identity = words.some((word) => /^(?:logo|brand|branding|emblem|crest|symbol|icon|banner|hero|image|photo|picture|mark|favicon)$/.test(word));
  return issues.filter((issue) => (identity && issue.category === 'asset' && issue.kind === 'image-missing' && (issue.documentY ?? 0) < 1000)
    || words.some((word) => normText(`${issue.text || ''} ${issue.tag || ''} ${issue.detail || ''}`).includes(word)));
}

/* ---- which routes does a change touch? ------------------------------------------------------------------------ */

const IMPORT_RE = /import\s+(?:([A-Za-z_$][\w$]*)|\{[^}]*\})?[^'"]*from\s+['"]([^'"]+)['"]/g;

function resolveImport(fromPath, spec, paths) {
  if (!spec.startsWith('.')) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const segment of spec.split('/')) { if (segment === '.') continue; if (segment === '..') parts.pop(); else parts.push(segment); }
  const base = parts.join('/');
  return [base, `${base}.jsx`, `${base}.js`, `${base}.tsx`, `${base}.ts`, `${base}/index.jsx`, `${base}/index.js`].find((candidate) => paths.has(candidate)) || null;
}

/**
 * Routes whose rendering depends on the changed files. A change in a file imported by pages that are routed from the
 * router reaches exactly those routes; a layout/shared component reaches many, so a few representative routes are
 * checked (home first) and the result is flagged as shared.
 */
function routesForChange(files, changedPaths, { knownRoutes = [], viewingRoute = null, maxRoutes = 4 } = {}) {
  const text = files.filter((file) => file && file.encoding !== 'base64' && typeof file.content === 'string' && /\.(?:jsx?|tsx?)$/.test(file.path));
  const paths = new Set(text.map((file) => file.path));
  const importersOf = new Map();
  for (const file of text) {
    for (const match of file.content.matchAll(IMPORT_RE)) {
      const target = resolveImport(file.path, match[2], paths);
      if (!target) continue;
      if (!importersOf.has(target)) importersOf.set(target, new Set());
      importersOf.get(target).add(file.path);
    }
  }
  // Stylesheets: a .css file is "imported" by the files that import it (import './x.css' or import x from './x.css').
  const cssImporters = new Map();
  for (const file of text) {
    for (const match of file.content.matchAll(/import\s+(?:[^'"]*?from\s+)?['"]([^'"]+\.s?css)['"]/g)) {
      if (!match[1].startsWith('.')) continue;
      const parts = file.path.split('/').slice(0, -1);
      for (const segment of match[1].split('/')) { if (segment === '.') continue; if (segment === '..') parts.pop(); else parts.push(segment); }
      const target = parts.join('/');
      if (!cssImporters.has(target)) cssImporters.set(target, new Set());
      cssImporters.get(target).add(file.path);
    }
  }
  for (const [target, importers] of cssImporters) { if (!importersOf.has(target)) importersOf.set(target, new Set()); for (const importer of importers) importersOf.get(target).add(importer); }
  // A stylesheet loaded by the entry/layout files (or kept in a global styles location) styles every route.
  const ENTRY = /^src\/(?:main|index|App)\.(?:jsx?|tsx?)$|(?:layout|shell)\.(?:jsx?|tsx?)$/i;
  const globalStyle = changedPaths.some((filePath) => /\.s?css$/i.test(filePath)
    && ([...(cssImporters.get(filePath) || [])].some((importer) => ENTRY.test(importer)) || /(?:^|\/)(?:index|global|globals|app|main|theme|tokens)\.s?css$/i.test(filePath) || /(?:^|\/)styles?\/(?:index|global|globals|theme|base|captured-site)[^/]*\.s?css$/i.test(filePath)));
  // Every file that (transitively) imports a changed file.
  const dependents = new Set(changedPaths.filter((filePath) => paths.has(filePath) || importersOf.has(filePath)));
  const queue = [...dependents];
  while (queue.length) {
    for (const importer of importersOf.get(queue.pop()) || []) if (!dependents.has(importer)) { dependents.add(importer); queue.push(importer); }
  }
  // Route -> component file, read from the router file(s).
  const routeFiles = new Map();
  for (const file of text) {
    const imports = new Map();
    for (const match of file.content.matchAll(IMPORT_RE)) if (match[1]) { const target = resolveImport(file.path, match[2], paths); if (target) imports.set(match[1], target); }
    for (const match of file.content.matchAll(/path\s*=\s*["'`]([^"'`]+)["'`][^>]*?(?:element|component)\s*=\s*\{\s*<\s*([A-Za-z_$][\w$]*)/g)) {
      if (imports.has(match[2])) routeFiles.set(match[1], imports.get(match[2]));
    }
  }
  const affected = [...routeFiles.entries()].filter(([, filePath]) => dependents.has(filePath)).map(([routePath]) => routePath);
  const allRoutes = [...new Set([...routeFiles.keys(), ...knownRoutes])].filter((route) => route && !/[*:]/.test(route));
  const shared = globalStyle || affected.length >= 3 || (!affected.length && changedPaths.some((filePath) => /(?:layout|header|navbar|nav|footer|app|main)\b/i.test(filePath)));
  const ordered = [];
  const push = (route) => { if (route && !ordered.includes(route)) ordered.push(route); };
  if (viewingRoute && (allRoutes.includes(viewingRoute) || viewingRoute === '/')) push(viewingRoute);
  affected.forEach(push);
  if (shared || !ordered.length) { push('/'); allRoutes.forEach(push); }
  return { routes: ordered.slice(0, maxRoutes), affected, shared, considered: ordered.length, untested: ordered.slice(maxRoutes) };
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Orchestration                                                                                                  */
/* -------------------------------------------------------------------------------------------------------------- */

/**
 * "The Admission button in the nav bar should go to https://..." : the request names a destination. Pull out the URL and the
 * words that identify the element, so the rendered page can be checked for a link that really goes there.
 */
function extractRequestedLink(prompt = '') {
  const text = String(prompt || '');
  const url = (text.match(/https?:\/\/[^\s"'<>)]+/i) || [])[0];
  if (!url || !/\b(?:redirect|redirects|link|links|navigate|navigates|open|opens|go\s+to|goes\s+to|point|points|href|take|takes|send|sends|direct|lead|leads)\b/i.test(text)) return null;
  const clean = url.replace(/[.,;:!?]+$/, '');
  const before = text.slice(0, text.indexOf(url)).toLowerCase();
  const stop = new Set(['the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'should', 'must', 'will', 'redirect', 'link', 'navigate', 'open', 'go', 'goes', 'nav', 'bar', 'navbar', 'menu', 'header', 'footer', 'button', 'tab', 'page', 'website', 'site', 'url', 'this', 'that', 'it', 'new', 'with', 'for', 'when', 'click', 'clicked', 'clicking', 'user', 'inteh', 'teh']);
  const words = (before.match(/[a-z]{3,}/g) || []).filter((w) => !stop.has(w)).slice(0, 4);
  return { url: clean, words };
}

const sameUrl = (a, b) => String(a || '').trim().replace(/^http:/i, 'https:').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase() === String(b || '').trim().replace(/^http:/i, 'https:').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/* eslint-disable no-undef */
function linkInspector(argument) {
  const words = (argument && argument.words) || [];
  const out = [];
  for (const a of document.querySelectorAll('a[href], [data-href], button[onclick]')) {
    const rect = a.getBoundingClientRect();
    const style = getComputedStyle(a);
    const shown = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    const text = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const at = rect.left + rect.width / 2;
    const top = rect.top + rect.height / 2;
    const hit = shown ? document.elementFromPoint(at, top) : null;
    out.push({ text, href: a.getAttribute('href') || a.getAttribute('data-href') || '', shown, clickable: Boolean(hit && (hit === a || a.contains(hit))), target: a.getAttribute('target') || '', related: words.length ? words.some((w) => text.toLowerCase().includes(w)) : false });
    if (out.length >= 400) break;
  }
  return out;
}
/* eslint-enable no-undef */

function verifyRequestedLink(requested, anchors) {
  const exact = anchors.filter((item) => sameUrl(item.href, requested.url));
  const labelled = requested.words.length ? anchors.filter((item) => item.related) : [];
  const ok = requested.words.length
    ? exact.some((item) => item.related && item.shown && item.clickable)
    : exact.some((item) => item.shown && item.clickable);
  let detail = '';
  if (!ok) {
    if (!exact.length) detail = `No link on the rendered page goes to ${requested.url}.${labelled.length ? ` The element(s) labelled like your request link to: ${labelled.slice(0, 4).map((item) => `"${item.text}" -> ${item.href || '(no href)'}`).join('; ')}.` : ''}`;
    else if (!exact.some((item) => item.shown)) detail = `A link to ${requested.url} exists but it is not visible on the page.`;
    else if (!exact.some((item) => item.clickable)) detail = `A link to ${requested.url} exists but another element covers it, so it cannot be clicked.`;
    else detail = `A link to ${requested.url} exists, but not on the element you named (${requested.words.join(' ')}). Elements with that label link to: ${labelled.slice(0, 4).map((item) => `"${item.text}" -> ${item.href || '(no href)'}`).join('; ') || 'nothing'}.`;
  }
  return { ok, detail, found: exact.length, labelled: labelled.slice(0, 5) };
}

const reachableFromEntry = (files) => require('./incrementalEditor').reachableFromEntry(files);
const blockingOf = (defects) => defects.filter((defect) => BLOCKING_KINDS.has(defect.kind));

/**
 * @param {object} p
 * @param {Array}  p.beforeFiles / p.afterFiles  project files before the edit / after it (already built-and-syntax checked)
 * @param {Array}  p.changedPaths                files this edit changed
 * @param {Function} p.render        async (files, { routePath, viewport, inspect, argument }) => measured value
 * @param {Function} [p.reference]   async (routePath) => { url, snapshot } | throws; omitted when the project has no real counterpart
 * @param {Function} [p.repair]      async ({ files, issues, changedPaths, attempt }) => nextFiles  (minimal patches, scope-checked by the caller)
 * @param {Function} [p.rebuild]     async (files) => files   the existing build/syntax gate; throws when the files no longer build
 * @param {object}   p.fidelity      { compareStyles, pageSnapshot }
 */
function requestedIssues(requested, expected) {
  if (!requested || requested.ok || requested.error) return [];
  const issues = requested.missingTexts.map((text) => ({ source: 'requested-content-missing', kind: 'missing-text', selector: null, route: expected?.route, detail: `The requested text from the real page is not shown: "${text.slice(0, 200)}". Add it exactly, at its place in the page.` }));
  if ((requested.removedWords || []).length) issues.push({ source: 'unrequested-change', kind: 'removed-content', selector: null, route: expected?.route, detail: `The edit removed existing content the user did not ask to change (words: ${requested.removedWords.slice(0, 15).join(', ')}). Restore it; only add the requested part.` });
  if (!requested.assetShown) issues.push({ source: 'requested-content-missing', kind: 'missing-image', selector: null, route: expected?.route, detail: `None of the real page images for the requested part is shown. Use one of: ${(expected?.assetPaths || []).slice(0, 6).join(', ')}` });
  return issues;
}

async function runIncrementalValidation({
  beforeFiles, afterFiles, changedPaths = [], knownRoutes = [], viewingRoute = null, focusTerms = [],
  expectedContent = null, verifyContent = null, inspectContent = null, requestedLink = null, spacingRequest = false, layoutRequest = null,
  render, reference = null, routing = null, repair = null, rebuild = null, fidelity, onState = async () => {}, signal = null,
  config = resolveConfig(), buildResult = { status: 'passed', detail: 'syntax, build and runtime smoke checks passed' }
}) {
  const timeline = [];
  const enter = async (state, note = '') => { timeline.push({ state, note, at: new Date().toISOString() }); await onState(state, note); };
  const checks = [];
  const check = (name, status, detail = '') => { const existing = checks.find((item) => item.name === name); if (existing) Object.assign(existing, { status, detail }); else checks.push({ name, status, detail }); };

  await enter(STATES.INSPECTING, 'reading the project and the real website');
  const changed = changedPaths.filter((filePath) => (afterFiles.find((file) => file.path === filePath)?.content) !== (beforeFiles.find((file) => file.path === filePath)?.content));
  check('patch-applied', changed.length ? 'passed' : 'failed', changed.length ? `changed: ${changed.join(', ')}` : 'no file differs from the previous revision');
  check('syntax-and-build', buildResult.status, buildResult.detail);
  // An edit to code that nothing imports cannot change what the user sees (for example a leftover Navbar.jsx).
  const reachable = reachableFromEntry(afterFiles);
  const codeChanged = changed.filter((filePath) => /\.(?:jsx?|tsx?|css|scss)$/i.test(filePath));
  const unreachableOnly = Boolean(reachable) && codeChanged.length > 0 && codeChanged.every((filePath) => !reachable.has(filePath));
  check('edit-reaches-screen', !reachable || !codeChanged.length ? 'skipped' : unreachableOnly ? 'failed' : 'passed', unreachableOnly ? `${codeChanged.join(', ')} is not imported by the running app, so the edit changes nothing the user sees` : reachable ? 'the changed code is part of the running app' : 'no entry file found');

  await enter(STATES.PLANNING, 'mapping the change to the routes it can affect');
  const plan = routesForChange(afterFiles, changed, { knownRoutes, viewingRoute, maxRoutes: config.maxRoutes });
  const routes = plan.routes.length ? plan.routes : ['/'];

  // Baseline: how the pages looked before this edit. Defects that already existed are never "introduced" by it.
  const baseline = new Map();
  const skipped = [];
  const measure = async (files, routePath, viewport) => {
    signal?.throwIfAborted();
    return render(files, { routePath, viewport, inspect: defectInspector, argument: { limit: 40 } });
  };
  for (const routePath of routes) {
    for (const viewport of config.viewports) {
      try { baseline.set(`${routePath}@${viewport.width}`, (await measure(beforeFiles, routePath, viewport)).defects); }
      catch (error) { if (signal?.aborted) throw error; baseline.set(`${routePath}@${viewport.width}`, null); }
    }
  }

  // Reference: the live real page for the primary route (same viewport as the first configured one).
  const primaryRoute = routes[0];
  const primaryViewport = config.viewports[0];
  const referenceInfo = { available: false, compared: false, route: primaryRoute, url: null, reason: reference ? '' : 'this project has no real website to compare with' };
  let realSnapshot = null;
  if (reference) {
    try {
      const live = await reference(primaryRoute);
      referenceInfo.url = live.url;
      realSnapshot = live.snapshot;
      referenceInfo.available = Boolean(realSnapshot);
      if (!realSnapshot) referenceInfo.reason = 'the real page returned no measurable content';
    } catch (error) {
      if (signal?.aborted) throw error;
      referenceInfo.reason = `the real website could not be read: ${String(error.message).slice(0, 200)}`;
    }
  }

  // What the requested page showed before the edit (to prove an additive edit removed nothing else).
  let beforeContent = null;
  if (expectedContent?.additive && inspectContent) {
    try { beforeContent = await render(beforeFiles, { routePath: expectedContent.route || primaryRoute, viewport: primaryViewport, inspect: inspectContent }); }
    catch (error) { if (signal?.aborted) throw error; }
  }

  let reportRouting = null;
  let files = afterFiles;
  let allChanged = [...changed];
  const attempts = [];
  let evaluation = null;

  let layoutBefore = null;
  const baselineBoxes = new Map();
  const evaluate = async () => {
    await enter(STATES.VISUAL, 'rendering the affected pages');
    const perRoute = [];
    let introduced = [];
    let resolved = [];
    let preexisting = [];
    let renderFailures = 0;
    for (const routePath of routes) {
      for (const viewport of config.viewports) {
        const slot = `${routePath}@${viewport.width}`;
        try {
          const result = await measure(files, routePath, viewport);
          const base = baseline.get(slot);
          if (base === null || base === undefined) {
            perRoute.push({ route: routePath, viewport: viewport.width, defects: result.defects.length, baseline: 'unavailable' });
            continue;
          }
          const diff = diffDefects(base, result.defects);
          introduced = introduced.concat(diff.introduced.map((defect) => ({ ...defect, route: routePath, viewport: viewport.width })));
          resolved = resolved.concat(diff.resolved.map((defect) => ({ ...defect, route: routePath, viewport: viewport.width })));
          preexisting = preexisting.concat(diff.preexisting.map((defect) => ({ ...defect, route: routePath, viewport: viewport.width })));
          perRoute.push({ route: routePath, viewport: viewport.width, defects: result.defects.length, introduced: diff.introduced.length, resolved: diff.resolved.length, preexisting: diff.preexisting.length });
        } catch (error) {
          if (signal?.aborted) throw error;
          renderFailures += 1;
          perRoute.push({ route: routePath, viewport: viewport.width, error: String(error.message).slice(0, 240) });
        }
      }
    }
    // Collapsed images: measure WHY (computed layout, ancestors, matched CSS) so the correction fixes the cause.
    const diagnostics = [];
    const collapsed = introduced.filter((defect) => defect.kind === 'collapsed-image' && defect.src);
    for (const group of [...new Set(collapsed.map((defect) => `${defect.route}@${defect.viewport}`))]) {
      const members = collapsed.filter((defect) => `${defect.route}@${defect.viewport}` === group);
      const viewport = config.viewports.find((item) => item.width === members[0].viewport) || primaryViewport;
      try {
        const srcs = [...new Set(members.map((defect) => basename(defect.src)))];
        const measuredNow = await render(files, { routePath: members[0].route, viewport, inspect: imageDiagnostics.collapsedImageInspector, argument: { srcs, max: 6 } });
        if (!baselineBoxes.has(group)) baselineBoxes.set(group, await render(beforeFiles, { routePath: members[0].route, viewport, inspect: imageDiagnostics.collapsedImageInspector, argument: { srcs: [], max: 0 } }).catch(() => null));
        for (const image of measuredNow.images) diagnostics.push(imageDiagnostics.buildDiagnostic({ image, route: members[0].route, viewport: members[0].viewport, baseline: baselineBoxes.get(group), files }));
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    let comparison = { issues: [], summary: null };
    if (realSnapshot) {
      try {
        const projectSnapshot = await render(files, { routePath: primaryRoute, viewport: primaryViewport, inspect: fidelity.pageSnapshot, argument: { maxTexts: 2500, maxImages: 1500 } });
        comparison = compareWithReference(realSnapshot, projectSnapshot, fidelity);
        referenceInfo.compared = true;
      } catch (error) {
        if (signal?.aborted) throw error;
        referenceInfo.reason = `the project page could not be measured for the comparison: ${String(error.message).slice(0, 200)}`;
      }
    }
    let targeted = targetedIssues(comparison.issues, focusTerms);
    // A request about empty space is judged against the real page's spacing, not only against the words it names.
    if (spacingRequest) targeted = [...targeted, ...comparison.issues.filter((issue) => ['extra-space', 'page-height-differs'].includes(issue.kind) && !targeted.includes(issue))];
    // The requested part itself must be on screen: its texts rendered and (for an image/logo) one of its images shown.
    let requested = null;
    if (expectedContent && verifyContent && inspectContent && ((expectedContent.texts || []).length || expectedContent.requireAsset)) {
      try {
        const shown = await render(files, { routePath: expectedContent.route || primaryRoute, viewport: primaryViewport, inspect: inspectContent });
        requested = verifyContent(expectedContent, shown, beforeContent);
      } catch (error) {
        if (signal?.aborted) throw error;
        requested = { ok: false, missingTexts: [], assetShown: false, error: String(error.message).slice(0, 200) };
      }
    }
    // The destination the user asked for must be on a visible, clickable element of the rendered page.
    let link = null;
    if (requestedLink) {
      try {
        const anchors = await render(files, { routePath: viewingRoute || primaryRoute, viewport: primaryViewport, inspect: linkInspector, argument: { words: requestedLink.words } });
        link = verifyRequestedLink(requestedLink, anchors);
      } catch (error) {
        if (signal?.aborted) throw error;
        link = { ok: false, detail: `the page could not be checked for the requested link: ${String(error.message).slice(0, 160)}`, found: 0, labelled: [] };
      }
    }
    // "Make the images horizontal": the rendered arrangement must really differ from before.
    let layout = null;
    if (layoutRequest) {
      try {
        const route = viewingRoute || primaryRoute;
        if (!layoutBefore) layoutBefore = await render(beforeFiles, { routePath: route, viewport: primaryViewport, inspect: layoutInspector, argument: { count: layoutRequest.count, anchors: layoutRequest.anchors } }).catch(() => null);
        const followed = layoutTarget(layoutRequest, layoutBefore);
        const arranged = followed ? await render(files, { routePath: route, viewport: primaryViewport, inspect: layoutInspector, argument: { srcs: followed } }) : null;
        layout = { ...(arranged ? verifyLayoutRequest(layoutRequest, layoutBefore, arranged) : { ok: true, skipped: true, detail: 'no stacked images were found before the edit' }), route };
      } catch (error) {
        if (signal?.aborted) throw error;
        layout = { ok: true, skipped: true, detail: `the arrangement could not be measured: ${String(error.message).slice(0, 160)}` };
      }
    }
    return { perRoute, introduced, resolved, preexisting, renderFailures, comparison, targeted, requested, link, layout, diagnostics };
  };

  evaluation = await evaluate();
  // A requested arrangement can take more than one correction: the measured structure is new evidence every time.
  let lastRepairError = '';
  const history = [];
  let lastSignature = [imageDiagnostics.measurementSignature(evaluation.diagnostics), evaluation.introduced.map(defectSignature).sort().join(','), evaluation.layout && !evaluation.layout.ok ? evaluation.layout.detail : ''].join('#');
  // Every project state tried so far (by content of what differs from the first candidate), so an identical patch is recognised.
  const crypto = require('crypto');
  const baseContent = new Map(afterFiles.map((file) => [file.path, file.content]));
  const stateHash = (list) => crypto.createHash('sha1').update(list.filter((file) => file && file.encoding !== 'base64' && baseContent.get(file.path) !== file.content).map((file) => `${file.path}:${crypto.createHash('sha1').update(String(file.content)).digest('hex')}`).sort().join('|')).digest('hex');
  const seenStates = new Set([stateHash(afterFiles)]);
  const repairBudget = layoutRequest ? Math.max(config.maxRepairs, 4) : config.maxRepairs;
  for (let attempt = 1; attempt <= repairBudget; attempt += 1) {
    const toFix = [
      ...evaluation.introduced.map((defect) => ({ source: 'edit-introduced', ...defect, diagnostic: defect.kind === 'collapsed-image' ? evaluation.diagnostics.find((item) => item.asset === basename(defect.src) && item.route === defect.route) || null : null })),
      ...evaluation.targeted.map((issue) => ({ source: 'requested-part-differs-from-real-site', ...issue })),
      ...requestedIssues(evaluation.requested, expectedContent),
      ...(evaluation.layout && !evaluation.layout.ok ? [{ source: 'requested-layout-missing', kind: 'layout-not-applied', selector: null, route: evaluation.layout.route, detail: `${evaluation.layout.detail}. Change the CSS of the container that holds these images so they really sit ${layoutRequest.orientation === 'row' ? 'side by side in one row' : 'one below the other'}; check the rules that place the items (grid-area, width, position, flex-direction, display) and reset those that keep the old arrangement.` }] : []),
      ...(evaluation.link && !evaluation.link.ok ? [{ source: 'requested-link-missing', kind: 'missing-link', selector: null, route: viewingRoute || primaryRoute, detail: `${evaluation.link.detail} Make the element the user named a real link (<a href="${requestedLink.url}">) that is visible and clickable.` }] : [])
    ];
    if (!toFix.length || !repair) break;
    await enter(STATES.REPAIRING, `attempt ${attempt} of ${repairBudget}: ${toFix.length} issue(s)`);
    const record = { attempt, issues: toFix.slice(0, 12).map(({ source, kind, selector, detail, route, viewport, diagnostic }) => ({ source, kind, selector, detail, route, viewport, cause: diagnostic?.cause, culprit: diagnostic?.culprit })), patchedFiles: [], result: 'pending' };
    attempts.push(record);
    const previous = files;
    // What the correction model is told about earlier attempts, so it does not repeat one: what was changed and what still failed.
    const widen = history.some((entry) => entry.ineffective || entry.repeated);
    record.widened = widen;
    try {
      const patched = await repair({
        files, issues: toFix, changedPaths: allChanged, attempt, previousError: lastRepairError,
        diagnostics: evaluation.diagnostics, widen,
        history: history.map(({ attempt: n, result, patchedFiles, patchPreview, ineffective, repeated, remaining }) => ({ attempt: n, result, patchedFiles, patchPreview, ineffective, repeated, remaining }))
      });
      if (!patched || patched === files) { record.result = 'no-patch'; break; }
      const state = stateHash(patched);
      if (seenStates.has(state)) {
        // The same project state was already tried: re-measuring it would prove nothing. Ask again, with that said.
        record.result = 'repeated-patch (identical to an earlier attempt; not re-validated)';
        record.repeated = true;
        history.push({ attempt, result: record.result, patchedFiles: [], patchPreview: '', repeated: true });
        lastRepairError = `Your answer produces exactly the same project as an earlier attempt, which did not fix the problem. Do NOT repeat it: use the measured cause in DIAGNOSTICS and change a different rule or file.`;
        if (history.filter((entry) => entry.repeated).length >= 2) break;
        continue;
      }
      await enter(STATES.BUILDING, 'checking the corrected files');
      const rebuilt = rebuild ? await rebuild(patched) : patched;
      record.patchedFiles = rebuilt.filter((file) => (previous.find((old) => old.path === file.path)?.content) !== file.content).map((file) => file.path);
      record.patchPreview = record.patchedFiles.slice(0, 3).map((filePath) => {
        const old = String(previous.find((item) => item.path === filePath)?.content || '');
        const now = String(rebuilt.find((item) => item.path === filePath)?.content || '');
        let at = 0;
        while (at < old.length && at < now.length && old[at] === now[at]) at += 1;
        return `${filePath}: …${now.slice(Math.max(0, at - 60), at + 320).replace(/\s+/g, ' ')}`;
      }).join(' || ');
      files = rebuilt;
      seenStates.add(stateHash(files));
      allChanged = [...new Set([...allChanged, ...record.patchedFiles])];
    } catch (error) {
      if (signal?.aborted) throw error;
      files = previous;
      record.result = `repair-rejected: ${String(error.message).slice(0, 240)}`;
      // A search text that did not match is a formatting slip, not a dead end: the next attempt is told what went wrong.
      if (/Patch search block not found|matched \d+ locations|Structural check failed|could not be parsed|empty content|empty response/i.test(String(error.message)) && attempt < repairBudget) { lastRepairError = String(error.message).slice(0, 300); history.push({ attempt, result: record.result, patchedFiles: [], patchPreview: '' }); continue; }
      break;
    }
    lastRepairError = '';
    evaluation = await evaluate();
    const remaining = evaluation.introduced.length + evaluation.targeted.length + requestedIssues(evaluation.requested, expectedContent).length + (evaluation.link && !evaluation.link.ok ? 1 : 0) + (evaluation.layout && !evaluation.layout.ok ? 1 : 0);
    const signature = [imageDiagnostics.measurementSignature(evaluation.diagnostics), evaluation.introduced.map(defectSignature).sort().join(','), evaluation.layout && !evaluation.layout.ok ? evaluation.layout.detail : ''].join('#');
    // A correction that leaves every measurement as it was has not touched the cause.
    const ineffective = Boolean(remaining) && signature === lastSignature;
    lastSignature = signature;
    record.ineffective = ineffective;
    record.result = remaining ? `${remaining} issue(s) remain${ineffective ? ' (measurements unchanged: the patch did not touch the cause)' : ''}` : 'fixed';
    history.push({ attempt, result: record.result, patchedFiles: record.patchedFiles, patchPreview: record.patchPreview, ineffective, remaining: evaluation.diagnostics.map((item) => `${item.asset}: ${item.cause} at ${item.culprit}`).slice(0, 6) });
    if (!remaining) break;
  }

  // ---- verdict (never "passed" unless the required checks really passed) ------------------------------------------
  const blockingLeft = blockingOf(evaluation.introduced);
  const softLeft = evaluation.introduced.filter((defect) => !BLOCKING_KINDS.has(defect.kind));
  const rendered = evaluation.perRoute.filter((entry) => !entry.error).length;
  check('render', rendered && !evaluation.renderFailures ? 'passed' : rendered ? 'failed' : 'failed', rendered ? `${rendered} of ${evaluation.perRoute.length} page renders succeeded` : 'no page could be rendered');
  const assetLeft = evaluation.introduced.filter((defect) => /image/.test(defect.kind));
  check('assets-load', evaluation.renderFailures === evaluation.perRoute.length ? 'skipped' : assetLeft.length ? 'failed' : 'passed', assetLeft.length ? assetLeft.map((defect) => { const d = (evaluation.diagnostics || []).find((item) => item.asset === basename(defect.src) && item.route === defect.route); return d ? `${defect.detail} [measured cause: ${d.cause} at ${d.culprit}]` : defect.detail; }).slice(0, 3).join('; ') : 'no broken, collapsed or stretched images were introduced');
  const layoutLeft = evaluation.introduced.filter((defect) => !/image/.test(defect.kind));
  check('overlap-clip-overflow', evaluation.renderFailures === evaluation.perRoute.length ? 'skipped' : layoutLeft.length ? 'failed' : 'passed', layoutLeft.length ? layoutLeft.map((defect) => defect.detail).slice(0, 3).join('; ') : 'no overlapping, clipped or overflowing elements were introduced');
  {
    // Defects on the route the edit is MEANT to change are already judged by assets-load / overlap-clip-overflow. This check is
    // about every OTHER route that renders the changed files: did the edit break something there?
    const edited = new Set([viewingRoute, ...plan.affected].filter(Boolean));
    const others = routes.filter((route) => !edited.has(route));
    const entries = evaluation.perRoute.filter((entry) => others.includes(entry.route));
    const broken = entries.filter((entry) => entry.introduced);
    const noBaseline = [...new Set(evaluation.perRoute.filter((entry) => entry.baseline === 'unavailable').map((entry) => entry.route))];
    const notes = [
      noBaseline.length ? `no baseline to compare for: ${noBaseline.join(', ')}` : '',
      (plan.untested || []).length ? `not tested (route limit ${config.maxRoutes}): ${plan.untested.join(', ')}` : '',
      entries.some((entry) => entry.error) ? `could not be rendered: ${entries.filter((entry) => entry.error).map((entry) => entry.route).join(', ')}` : ''
    ].filter(Boolean).join('; ');
    if (!others.length) check('regression-other-routes', 'skipped', `only ${[...edited].join(', ') || routes.join(', ')} renders the changed files, so there is no other route to compare${notes ? `; ${notes}` : ''}`);
    else if (broken.length) {
      const detailOf = (route) => evaluation.introduced.filter((defect) => defect.route === route).slice(0, 2).map((defect) => defect.detail).join(' / ');
      check('regression-other-routes', 'failed', `${[...new Set(broken.map((entry) => entry.route))].map((route) => `${route}: ${detailOf(route) || 'new visual defects'}`).join('; ')}${notes ? `; ${notes}` : ''}`);
    } else check('regression-other-routes', 'passed', `${others.join(', ')} compared before and after at ${config.viewports.map((viewport) => viewport.width).join('/')}px with no new defects${notes ? `; ${notes}` : ''}`);
  }
  const targetedLeft = evaluation.targeted;
  check('reference-comparison', referenceInfo.compared ? (targetedLeft.length ? 'failed' : 'passed') : 'skipped', referenceInfo.compared ? (targetedLeft.length ? targetedLeft.slice(0, 3).map((issue) => issue.detail).join('; ') : `compared ${referenceInfo.route} with ${referenceInfo.url} at ${primaryViewport.width}px`) : referenceInfo.reason);
  // Multi-page routing: pages must keep their own URLs. Only routing faults the edit introduced fail it.
  if (routing) {
    try {
      const [routingBefore, routingAfter] = [await routing(beforeFiles).catch(() => null), await routing(files)];
      const key = (issue) => `${issue.kind}|${issue.route}`;
      const baselineKeys = new Set((routingBefore?.fatal || []).map(key));
      const introducedRouting = routingAfter.fatal.filter((issue) => !baselineKeys.has(key(issue)));
      const untouched = routingAfter.fatal.filter((issue) => baselineKeys.has(key(issue)));
      reportRouting = { status: routingAfter.status, mechanism: routingAfter.mechanism, routesChecked: routingAfter.routesChecked, introduced: introducedRouting, preexistingUntouched: untouched, warnings: routingAfter.issues.filter((issue) => issue.severity !== 'fatal').slice(0, 10) };
      check('multipage-routing', introducedRouting.length ? 'failed' : 'passed', introducedRouting.length ? introducedRouting.map((issue) => `${issue.route}: ${issue.detail}`).slice(0, 3).join('; ') : `${routingAfter.routesChecked} page(s) each show their own content${untouched.length ? `; ${untouched.length} problem(s) that already existed were left alone` : ''}`);
    } catch (error) {
      if (signal?.aborted) throw error;
      check('multipage-routing', 'skipped', `routing could not be validated: ${String(error.message).slice(0, 160)}`);
    }
  } else check('multipage-routing', 'skipped', 'the project has a single page');
  if (evaluation.requested) {
    const req = evaluation.requested;
    const total = (expectedContent.texts || []).length;
    check('requested-content', req.ok ? 'passed' : 'failed', req.ok
      ? `the requested part is on the rendered page (${total} text block(s)${expectedContent.requireAsset ? ', real image shown' : ''})`
      : req.error ? `the requested part could not be checked on the rendered page: ${req.error}`
      : [req.missingTexts.length ? `${req.missingTexts.length}/${total} requested text block(s) not shown: ${req.missingTexts.slice(0, 3).map((text) => `"${text.slice(0, 80)}"`).join(', ')}` : '', req.assetShown ? '' : 'none of the real page images for the requested part is shown', (req.removedWords || []).length ? `existing content outside the requested part was removed (${req.removedWords.slice(0, 8).join(', ')})` : ''].filter(Boolean).join('; '));
  }
  if (evaluation.link) check('requested-link', evaluation.link.ok ? 'passed' : 'failed', evaluation.link.ok ? `a visible, clickable element on the page links to ${requestedLink.url}` : evaluation.link.detail);
  if (evaluation.layout && !evaluation.layout.skipped) check('requested-layout', evaluation.layout.ok ? 'passed' : 'failed', evaluation.layout.detail);
  check('interaction', 'skipped', 'no functional scenario is defined for this project; interactions were not exercised');

  const failedChecks = checks.filter((item) => item.status === 'failed');
  const skippedChecks = checks.filter((item) => item.status === 'skipped' && !['interaction', 'edit-reaches-screen', 'multipage-routing'].includes(item.name));
  let status;
  if (failedChecks.some((item) => ['patch-applied', 'syntax-and-build', 'render', 'edit-reaches-screen', 'multipage-routing', 'requested-content', 'requested-link', 'requested-layout'].includes(item.name)) || blockingLeft.length || targetedLeft.length) status = STATES.FAILED;
  else if (softLeft.length || failedChecks.length || skippedChecks.length || evaluation.comparison.issues.length) status = STATES.PARTIAL;
  else status = STATES.PASSED;
  await enter(status);

  const fileNotes = allChanged.map((filePath) => ({ path: filePath, note: attempts.some((attempt) => attempt.patchedFiles.includes(filePath)) ? 'edited, then corrected by the validation loop' : 'edited for the request' }));
  return {
    files,
    report: {
      status,
      enforce: config.enforce,
      timeline,
      checks,
      routes: { checked: routes, untested: plan.untested || [], shared: plan.shared, affected: plan.affected, viewports: config.viewports.map((viewport) => viewport.width) },
      reference: { ...referenceInfo, summary: evaluation.comparison.summary },
      requestedContent: evaluation.requested ? { expected: expectedContent, ...evaluation.requested } : null,
      defects: {
        introducedRemaining: evaluation.introduced.slice(0, 20),
        resolvedByEdit: evaluation.resolved.slice(0, 20),
        preexistingUntouched: evaluation.preexisting.length,
        preexistingSample: evaluation.preexisting.slice(0, 10)
      },
      referenceDifferences: evaluation.comparison.issues.slice(0, 30),
      requestedPartDifferences: targetedLeft.slice(0, 20),
      routing: reportRouting,
      perRoute: evaluation.perRoute,
      repairAttempts: attempts,
      diagnostics: (evaluation.diagnostics || []).slice(0, 8),
      repairLimit: layoutRequest ? Math.max(config.maxRepairs, 4) : config.maxRepairs,
      changedFiles: fileNotes,
      skippedChecks: checks.filter((item) => item.status === 'skipped').map((item) => `${item.name}: ${item.detail}`)
    }
  };
}

module.exports = {
  STATES, CATEGORY_PRIORITY, BLOCKING_KINDS, resolveConfig, defectInspector, defectSignature, diffDefects,
  compareWithReference, targetedIssues, routesForChange, runIncrementalValidation, isSpacingRequest, extractLayoutRequest, verifyLayoutRequest, layoutTarget, layoutInspector, extraSpaceIssues, extractRequestedLink, verifyRequestedLink, linkInspector, sameUrl
};
