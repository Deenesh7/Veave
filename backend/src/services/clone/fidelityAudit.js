/**
 * Fidelity audit: compares a real page with the project's rendering of it, using only measured data.
 *
 * Both sides run the SAME in-page snapshot (`pageSnapshot`): every visible text element with its real computed colour,
 * effective background and font, every image (with the text around it), and the document height. Elements are paired by
 * their own text, so nothing about the site (names, colours, classes) is assumed anywhere.
 */

/* eslint-disable no-undef */
// Runs inside a browser page (the real site while it is captured, and the project's rendered preview).
// Async: it scrolls through the page so the colour BEHIND every text can be sampled with elementsFromPoint, which also sees
// backgrounds drawn by sibling layers (not only by ancestors) and anything laid on top of the text.
async function pageSnapshot(limits) {
  const maxTexts = (limits && limits.maxTexts) || 2500;
  const maxImages = (limits && limits.maxImages) || 1500;
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (!(style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0)) return false;
    // An element inside a transparent ancestor (opacity:0 wrapper, e.g. content the source site faded in with JavaScript) is not visible either.
    return typeof element.checkVisibility === 'function' ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true;
  };
  const alpha = (color) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(color || '');
    if (!m) return 0;
    const parts = m[1].split(',').map((part) => part.trim());
    return parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  };
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const ancestorBackground = (element) => {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== 'none') return 'image';
      if (alpha(style.backgroundColor) >= 0.5) return style.backgroundColor;
    }
    return 'rgb(255, 255, 255)';
  };
  const documentTop = (element) => Math.round(element.getBoundingClientRect().y + window.scrollY);
  const label = (node) => {
    const first = String(node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${first ? `.${first}` : ''}`.slice(0, 70);
  };
  const chainOf = (element) => {
    const chain = [];
    for (let node = element.parentElement; node && node !== document.body && chain.length < 5; node = node.parentElement) chain.push(label(node));
    return chain;
  };
  const layerOf = (node) => {
    const r = node.getBoundingClientRect();
    return { element: label(node), documentY: Math.round(r.y + window.scrollY), height: Math.round(r.height), width: Math.round(r.width) };
  };
  const entries = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode; node && entries.length < maxTexts; node = walker.nextNode()) {
    if (!(node instanceof Element) || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'TEMPLATE'].includes(node.tagName.toUpperCase())) continue;
    const own = [...node.childNodes].filter((child) => child.nodeType === 3).map((child) => child.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (own.length < 3) continue;
    const key = normalize(own).slice(0, 80);
    if (key.length < 3 || !visible(node)) continue;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    entries.push({
      element: node,
      item: {
        key, text: own.slice(0, 90), tag: node.tagName.toLowerCase(), documentY: documentTop(node),
        x: Math.round(rect.x), width: Math.round(rect.width), height: Math.round(rect.height),
        color: style.color, bg: ancestorBackground(node), covered: false, chain: chainOf(node), layer: null,
        fontFamily: String(style.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase(),
        fontSize: Number.parseFloat(style.fontSize) || 0, fontWeight: Number.parseInt(style.fontWeight, 10) || 400
      }
    });
  }
  // Pass 2 (in page order): bring each text into view and read what is really painted behind and above it.
  const startY = window.scrollY;
  for (const entry of entries.sort((a, b) => a.item.documentY - b.item.documentY)) {
    const element = entry.element;
    let rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      // behavior 'instant': sites with CSS smooth scrolling would otherwise still be moving when the position is read.
      window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - window.innerHeight / 2), behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      rect = element.getBoundingClientRect();
    }
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.width <= 0) continue;
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + Math.min(6, rect.width / 2)));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    let reachedText = false;
    for (const node of document.elementsFromPoint(x, y)) {
      if (node === element || element.contains(node)) { reachedText = true; continue; }
      if (node.contains(element)) continue; // an ancestor: its background is found below like any other layer
      const style = getComputedStyle(node);
      const opaque = alpha(style.backgroundColor) >= 0.9 && style.visibility !== 'hidden';
      // Something opaque painted ABOVE the text hides it.
      if (!reachedText && opaque && Number(style.opacity) !== 0 && !node.contains(element)) { entry.item.covered = true; break; }
    }
    const behind = document.elementsFromPoint(x, y).filter((node) => node !== element && !element.contains(node));
    for (const node of behind) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== 'none') { entry.item.bg = 'image'; entry.item.layer = layerOf(node); break; }
      if (alpha(style.backgroundColor) >= 0.5) { entry.item.bg = style.backgroundColor; entry.item.layer = layerOf(node); break; }
    }
  }
  window.scrollTo({ top: startY, behavior: 'instant' });
  const texts = entries.map((entry) => entry.item);
  const nearText = (element) => {
    for (let node = element.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 8 && text.length <= 400) return text.slice(0, 140);
    }
    return '';
  };
  const images = [];
  for (const img of document.images) {
    if (images.length >= maxImages) break;
    if (!visible(img)) continue;
    const rect = img.getBoundingClientRect();
    images.push({ src: img.currentSrc || img.src || img.getAttribute('data-src') || '', alt: (img.alt || '').slice(0, 120), documentY: documentTop(img), width: Math.round(rect.width), height: Math.round(rect.height), near: nearText(img), kind: 'img' });
  }
  const urlOf = (value) => (/url\(["']?([^"')]+)["']?\)/.exec(value || '') || [])[1] || '';
  for (const element of document.querySelectorAll('body *')) {
    if (images.length >= maxImages) break;
    const style = getComputedStyle(element);
    const url = urlOf(style.backgroundImage);
    if (!url || url.startsWith('data:') || !visible(element)) continue;
    const rect = element.getBoundingClientRect();
    images.push({ src: url, alt: '', documentY: documentTop(element), width: Math.round(rect.width), height: Math.round(rect.height), near: nearText(element), kind: 'background' });
  }
  const bodyStyle = getComputedStyle(document.body);
  const root = { background: ancestorBackground(document.body), color: bodyStyle.color, fontFamily: String(bodyStyle.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase() };
  return { docHeight: Math.round(document.documentElement.scrollHeight), root, texts, images };
}
/* eslint-enable no-undef */

const parseColor = (value) => {
  const m = /^rgba?\(([^)]+)\)$/.exec(String(value || '').trim());
  if (!m) return null;
  const [r, g, b] = m[1].split(',').map((part) => Number.parseFloat(part));
  return [r, g, b];
};
const colorDistance = (a, b) => {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 0;
  return Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2]));
};
const luminance = (color) => {
  const parsed = parseColor(color);
  if (!parsed) return null;
  const [r, g, b] = parsed.map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// WCAG contrast ratio between a text colour and the background behind it (null when the background is an image/unknown).
const contrastRatio = (foreground, background) => {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const toHex = (color) => {
  const parsed = parseColor(color);
  return parsed ? `#${parsed.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}` : String(color);
};

/** Pairs elements by their own text (in page order) and lists every colour, background and font difference. */
function compareStyles(real, project, { colorTolerance = 14, sizeTolerance = 2 } = {}) {
  const projectByKey = new Map();
  for (const item of project?.texts || []) {
    if (!projectByKey.has(item.key)) projectByKey.set(item.key, []);
    projectByKey.get(item.key).push(item);
  }
  const used = new Map();
  const mismatches = [];
  const problems = [];
  let matched = 0;
  let notFound = 0;
  for (const item of real?.texts || []) {
    const candidates = projectByKey.get(item.key);
    if (!candidates?.length) { notFound += 1; continue; }
    const index = used.get(item.key) || 0;
    const other = candidates[Math.min(index, candidates.length - 1)];
    used.set(item.key, index + 1);
    matched += 1;
    const diffs = [];
    if (colorDistance(item.color, other.color) > colorTolerance) diffs.push({ property: 'color', real: toHex(item.color), project: toHex(other.color) });
    if (item.bg !== 'image' && other.bg !== 'image' && colorDistance(item.bg, other.bg) > colorTolerance) diffs.push({ property: 'background', real: toHex(item.bg), project: toHex(other.bg) });
    if (item.fontFamily && other.fontFamily && item.fontFamily !== other.fontFamily) diffs.push({ property: 'font-family', real: item.fontFamily, project: other.fontFamily });
    if (Math.abs(item.fontSize - other.fontSize) > sizeTolerance) diffs.push({ property: 'font-size', real: `${item.fontSize}px`, project: `${other.fontSize}px` });
    if (Math.abs(item.fontWeight - other.fontWeight) >= 200) diffs.push({ property: 'font-weight', real: String(item.fontWeight), project: String(other.fontWeight) });
    if (diffs.length) mismatches.push({ key: item.key, text: item.text, tag: item.tag, documentY: item.documentY, diffs, realLayer: item.layer || null, projectLayer: other.layer || null, projectChain: other.chain || [] });
    // Problems that make the project's text unusable even where the real page has none: hidden under another layer, or unreadable.
    if (other.covered && !item.covered) problems.push({ kind: 'covered', text: item.text, tag: item.tag, documentY: other.documentY });
    const projectContrast = other.bg === 'image' ? null : contrastRatio(other.color, other.bg);
    const realContrast = item.bg === 'image' ? null : contrastRatio(item.color, item.bg);
    if (projectContrast !== null && projectContrast < 3 && !(realContrast !== null && realContrast < 3)) {
      problems.push({ kind: 'unreadable', text: item.text, tag: item.tag, documentY: other.documentY, color: toHex(other.color), background: toHex(other.bg), contrast: Math.round(projectContrast * 10) / 10, realBackgroundOfThisText: item.bg === 'image' ? 'image' : toHex(item.bg), realLayer: item.layer || null, projectLayer: other.layer || null, projectChain: other.chain || [] });
    }
  }
  return { matched, notFound, mismatches, problems, realTotal: (real?.texts || []).length };
}

const stripQuery = (value) => String(value || '').split(/[?#]/)[0];
const pathOf = (value) => { try { return new URL(value, 'http://preview.local').pathname; } catch { return stripQuery(value); } };

/**
 * Which downloaded assets belong on this page but are not used by the project yet, with where each one sits on the real page.
 * Used = referenced by the project's rendered page or by its source.
 */
function assetPlacementState({ assets = [], realImages = [], projectImages = [], sourceText = '' }) {
  const rendered = new Set(projectImages.map((image) => pathOf(image.src)));
  const placementsByAsset = new Map();
  for (const asset of assets) {
    const urls = new Set((asset.sourceUrls || []).flatMap((url) => [url, stripQuery(url)]));
    const spots = realImages
      .filter((image) => urls.has(image.src) || urls.has(stripQuery(image.src)))
      .map(({ documentY, width, height, alt, near, kind }) => ({ documentY, width, height, alt, near, kind }));
    placementsByAsset.set(asset.publicPath, spots);
  }
  const needed = assets.filter((asset) => placementsByAsset.get(asset.publicPath)?.length);
  const unplaced = needed
    .filter((asset) => !rendered.has(asset.publicPath) && !sourceText.includes(asset.publicPath))
    .map((asset) => ({ asset, spots: placementsByAsset.get(asset.publicPath).sort((a, b) => a.documentY - b.documentY) }))
    .sort((a, b) => a.spots[0].documentY - b.spots[0].documentY);
  return { needed: needed.length, placed: needed.length - unplaced.length, unplaced };
}

module.exports = { pageSnapshot, compareStyles, assetPlacementState, colorDistance, contrastRatio, toHex, pathOf };
