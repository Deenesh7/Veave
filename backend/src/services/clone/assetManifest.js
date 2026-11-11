/**
 * Asset identity for website cloning.
 *
 * A clone goes wrong when "an image that loads" is treated as "the right image". This module keeps three things explicit:
 *
 *   manifest    every downloaded asset with a stable id, where it came from (route, element, alt, srcset, source), what ROLE it
 *               plays (logo, hero, banner, product, profile, icon, decorative, content) and which routes may use it
 *   resolve     strict lookup of a source reference to its asset. Only evidence that the source itself provides is accepted
 *               (the same URL, the same element, a srcset candidate of that element, the same canonical file). A similar
 *               filename, similar size or similar look is NEVER enough, and nothing is substituted when there is no match
 *   verify      compares what the browser rendered with what the source page shows in the same place (alt text, nearby text),
 *               and reports wrong-asset, wrong-route, broken, collapsed and stretched images
 *
 * Everything here is pure (no I/O), so it runs the same in the pipeline and in tests.
 */

const crypto = require('node:crypto');

const GLOBAL_SECTIONS = new Set(['header', 'nav', 'footer']);

function stripQuery(value) {
  return String(value || '').split(/[?#]/)[0];
}

/** The part of a URL that identifies the file: host + path, without sizing/format parameters. */
function canonicalUrl(value) {
  const text = String(value || '');
  if (!text || text.startsWith('data:')) return text;
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

function localPathOf(value) {
  const text = String(value || '');
  if (!text || text.startsWith('data:')) return '';
  try {
    return stripQuery(new URL(text, 'http://local.invalid').pathname);
  } catch {
    return stripQuery(text);
  }
}

function assetIdFor(asset) {
  const basis = asset.hash || canonicalUrl(asset.url || (asset.sourceUrls || [])[0] || '') || asset.publicPath || '';
  return `asset_${crypto.createHash('sha256').update(String(basis)).digest('hex').slice(0, 12)}`;
}

function parseSrcset(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [url, descriptor] = part.split(/\s+/);
    return { url, descriptor: descriptor || '' };
  }).filter((item) => item.url);
}

/** Role of an asset, decided from what the source page says about it (never from how it looks). */
function classifyAssetRole(asset = {}) {
  const associations = asset.associations || [];
  const text = [asset.url, asset.alt, ...associations.flatMap((item) => [item.alt, item.selector, item.element?.classes, item.element?.id, item.section?.classes, item.section?.heading])]
    .filter(Boolean).join(' ').toLowerCase();
  const width = Number(asset.width) || 0;
  const height = Number(asset.height) || 0;
  const rects = associations.map((item) => item.rect).filter(Boolean);
  const insideGlobal = associations.some((item) => GLOBAL_SECTIONS.has(item.section?.tag));
  const inHeader = associations.some((item) => ['header', 'nav'].includes(item.section?.tag));
  const smallestBox = rects.length ? Math.min(...rects.map((rect) => Math.max(rect.width || 0, rect.height || 0))) : Math.max(width, height);

  if (/favicon|sprite|\bicon\b|icon[-_]/.test(text) || asset.mimeType === 'image/x-icon' || (asset.mimeType === 'image/svg+xml' && smallestBox && smallestBox <= 64)) {
    if (!/logo|brand|wordmark/.test(text)) return 'icon';
  }
  if (/logo|brand|wordmark/.test(text) || (inHeader && rects.some((rect) => rect.documentY < 200 && rect.width <= 320 && rect.height <= 140))) return 'logo';
  if (/\bhero\b/.test(text) || rects.some((rect) => rect.documentY < 900 && rect.width >= 800 && rect.height >= 300)) return 'hero';
  if (/banner/.test(text) || (width >= 600 && height && width / height >= 2.5)) return 'banner';
  if (/product|shop|catalog|\bsku\b|merch/.test(text)) return 'product';
  if (/avatar|profile|team|author|headshot|portrait|member|staff|testimonial/.test(text)) return 'profile';
  if (associations.length && associations.every((item) => item.source === 'css-background' || item.source === 'background') && associations.every((item) => !item.alt)) return 'decorative';
  if (/pattern|shape|decor|divider|texture|\bbg\b|background/.test(text) && !asset.alt) return 'decorative';
  if (insideGlobal && smallestBox && smallestBox <= 64) return 'icon';
  return 'content';
}

/** A shared asset appears on several routes or in the shared header/footer, so it may be used on any route. */
function isSharedAsset(asset = {}) {
  const pages = new Set((asset.pages || []).concat((asset.associations || []).map((item) => item.page)).filter(Boolean));
  return pages.size >= 2 || (asset.associations || []).some((item) => GLOBAL_SECTIONS.has(item.section?.tag));
}

/**
 * Structured manifest of the captured assets. `assets` are the localized assets (publicPath, sourceUrls, associations, ...),
 * `unavailable` the references the capture could not download.
 */
function buildAssetManifest({ assets = [], unavailable = [] } = {}) {
  const entries = assets.filter((asset) => asset.publicPath).map((asset) => {
    const associations = asset.associations || [];
    const pages = [...new Set([...(asset.pages || []), ...associations.map((item) => item.page)].filter(Boolean))];
    const width = Number(asset.width) || null;
    const height = Number(asset.height) || null;
    return {
      id: assetIdFor(asset),
      token: asset.token || null,
      originalUrl: asset.url || (asset.sourceUrls || [])[0] || null,
      sourceUrls: asset.sourceUrls || (asset.url ? [asset.url] : []),
      localPath: asset.localPath || null,
      publicPath: asset.publicPath,
      mimeType: asset.mimeType || null,
      byteLength: asset.byteLength || null,
      width,
      height,
      aspectRatio: width && height ? Math.round((width / height) * 1000) / 1000 : null,
      role: classifyAssetRole(asset),
      pages,
      shared: isSharedAsset(asset),
      elements: associations.slice(0, 50).map((item) => ({
        page: item.page || null,
        selector: item.selector || null,
        tag: item.element?.tag || null,
        alt: item.alt || '',
        title: item.title || '',
        srcset: item.srcset || '',
        source: item.source || 'html',
        section: item.section ? { tag: item.section.tag, heading: item.section.heading || '' } : null,
        rect: item.rect || null
      })),
      status: 'downloaded',
      validation: { signature: 'checked', verifiedOnRoutes: [] }
    };
  });
  const missing = unavailable.map((item, index) => ({
    id: `missing_${crypto.createHash('sha256').update(`${(item.sourceUrls || [])[0] || index}|${item.page || ''}|${item.selector || ''}`).digest('hex').slice(0, 12)}`,
    originalUrl: (item.sourceUrls || [])[0] || null,
    sourceUrls: item.sourceUrls || [],
    page: item.page || null,
    selector: item.selector || null,
    alt: item.alt || '',
    reason: item.reason || 'not downloaded',
    status: 'unavailable'
  }));
  const routes = {};
  for (const entry of entries) {
    for (const page of entry.pages.length ? entry.pages : ['*']) (routes[page] ||= []).push(entry.id);
  }
  return { version: 1, assets: entries, unavailable: missing, routes };
}

/** Explicit element -> asset mapping: the page and selector the source used the asset on. */
function mapAssetsToElements(manifest) {
  const mapping = new Map();
  for (const asset of manifest.assets) {
    for (const element of asset.elements) {
      if (!element.page || !element.selector) continue;
      mapping.set(`${element.page}|${element.selector}`, { status: 'mapped', assetId: asset.id, publicPath: asset.publicPath, role: asset.role });
    }
  }
  for (const item of manifest.unavailable) {
    if (item.page && item.selector) mapping.set(`${item.page}|${item.selector}`, { status: 'unavailable', assetId: null, reason: item.reason });
  }
  return mapping;
}

/**
 * Strict resolution of a source reference. Accepted evidence, in order: the exact URL, the element the source placed it in,
 * a srcset candidate of that element, the same canonical file. Anything else is reported as unavailable: no filename,
 * dimension or look-alike matching, and no asset borrowed from another route.
 */
function resolveAssetReference(manifest, { requestedUrl = '', route = null, selector = null, srcset = '' } = {}) {
  const wanted = String(requestedUrl || '');
  const byUrl = (url) => manifest.assets.find((asset) => asset.sourceUrls.includes(url));
  let asset = wanted && byUrl(wanted);
  if (asset) return { status: 'resolved', via: 'exact-url', asset };

  if (route && selector) {
    const mapped = manifest.assets.find((candidate) => candidate.elements.some((element) => element.page === route && element.selector === selector));
    if (mapped) return { status: 'resolved', via: 'source-element', asset: mapped };
  }
  for (const candidate of parseSrcset(srcset)) {
    asset = byUrl(candidate.url);
    if (asset) return { status: 'resolved', via: 'srcset-candidate', asset };
  }
  if (wanted) {
    const canonical = canonicalUrl(wanted);
    asset = manifest.assets.find((candidate) => candidate.sourceUrls.some((url) => canonicalUrl(url) === canonical));
    if (asset) return { status: 'resolved', via: 'same-file', asset };
  }
  return { status: 'unavailable', reason: 'No captured asset is tied to this reference by the source page; none is substituted.' };
}

/**
 * Chooses among the srcset candidates of ONE source element for a viewport: the smallest downloaded candidate that is at least
 * as wide as the viewport (times the pixel ratio), else the widest downloaded one. Candidates that were not captured are
 * skipped; candidates of other elements are never considered.
 */
function selectResponsiveCandidate(manifest, srcset, { viewportWidth = 1440, pixelRatio = 1 } = {}) {
  const needed = viewportWidth * pixelRatio;
  const available = parseSrcset(srcset)
    .map((candidate) => ({ ...candidate, width: /^(\d+)w$/.test(candidate.descriptor) ? Number.parseInt(candidate.descriptor, 10) : (/^(\d+(?:\.\d+)?)x$/.test(candidate.descriptor) ? Number.parseFloat(candidate.descriptor) * 1000 : 0), asset: manifest.assets.find((asset) => asset.sourceUrls.includes(candidate.url)) }))
    .filter((candidate) => candidate.asset);
  if (!available.length) return null;
  available.sort((a, b) => a.width - b.width);
  return (available.find((candidate) => candidate.width >= needed) || available[available.length - 1]).asset;
}

function neutralPlaceholder(width = 0, height = 0) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f3f4f6"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const norm = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function assetForRenderedSrc(manifest, src) {
  const path = localPathOf(src);
  return path ? manifest.assets.find((asset) => asset.publicPath === path) : null;
}

/**
 * Compares the rendered route with the source page. `realImages` are the images the SOURCE page shows (src, alt, near text),
 * `rendered` the images the clone shows (src, alt, near, natural/rendered size, fit). Source and clone images are paired by
 * alt text, then by the text next to them; images that cannot be paired are not judged for identity.
 */
function verifyRenderedAssets({ manifest, route = '/', rendered = [], realImages = [] } = {}) {
  const defects = [];
  const used = new Set();

  for (const image of rendered) {
    const asset = assetForRenderedSrc(manifest, image.src);
    const label = { src: image.src, alt: image.alt || '', near: image.near || '' };
    if (image.kind !== 'background' && image.src && !String(image.src).startsWith('data:')) {
      if (image.loaded === false || image.naturalWidth === 0) defects.push({ type: 'broken-image', ...label });
      else if (image.naturalWidth > 0 && (image.width === 0 || image.height === 0)) defects.push({ type: 'collapsed-image', ...label });
      else if (image.naturalWidth > 0 && image.naturalHeight > 0 && image.width > 0 && image.height > 0 && (!image.fit || image.fit === 'fill')) {
        const natural = image.naturalWidth / image.naturalHeight;
        const shown = image.width / image.height;
        if (Math.abs(shown / natural - 1) > 0.15) defects.push({ type: 'stretched-image', ...label, naturalRatio: Math.round(natural * 100) / 100, renderedRatio: Math.round(shown * 100) / 100 });
      }
    }
    if (asset) {
      used.add(asset.id);
      if (!asset.shared && asset.pages.length && !asset.pages.includes(route)) {
        defects.push({ type: 'wrong-route-asset', ...label, assetId: asset.id, belongsTo: asset.pages, route });
      }
    } else if (localPathOf(image.src).startsWith('/assets/')) {
      defects.push({ type: 'unmapped-asset', ...label });
    }
  }

  for (const real of realImages) {
    const expected = manifest.assets.find((asset) => asset.sourceUrls.includes(real.src) || asset.sourceUrls.some((url) => stripQuery(url) === stripQuery(real.src)));
    const realAlt = norm(real.alt);
    const realNear = norm(real.near);
    const paired = rendered.filter((image) => (realAlt && norm(image.alt) === realAlt) || (!realAlt && realNear && norm(image.near) === realNear));
    if (!paired.length) continue;
    if (!expected) {
      // The source image could not be captured: whatever sits in its place must not be another real asset.
      for (const image of paired) {
        const shown = assetForRenderedSrc(manifest, image.src);
        if (shown) defects.push({ type: 'unrelated-substitute', src: image.src, alt: image.alt || '', near: image.near || '', assetId: shown.id, sourceSrc: real.src });
      }
      continue;
    }
    if (paired.some((image) => localPathOf(image.src) === expected.publicPath)) continue;
    for (const image of paired) {
      const shown = assetForRenderedSrc(manifest, image.src);
      defects.push({ type: 'asset-mismatch', src: image.src, alt: image.alt || '', near: image.near || '', expectedAssetId: expected.id, expectedPublicPath: expected.publicPath, actualAssetId: shown?.id || null });
    }
  }
  return { ok: defects.length === 0, route, defects, checked: rendered.length };
}

/** Replaces `from` with `to` inside the one tag/attribute that is the defective element (matched by its alt text). */
function repairInTag(content, from, to, alt) {
  const tags = [...content.matchAll(/<img\b[^>]*>/gi)].filter((match) => match[0].includes(from));
  const wantedAlt = norm(alt);
  const candidates = wantedAlt
    ? tags.filter((match) => norm((/\balt\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/i.exec(match[0]) || [])[1]) === wantedAlt)
    : tags;
  if (candidates.length !== 1) return null;
  const [match] = candidates;
  return content.slice(0, match.index) + match[0].split(from).join(to) + content.slice(match.index + match[0].length);
}

/**
 * Bounded, element-scoped repair of identity defects. It only ever writes the asset the SOURCE tied to the element (or a
 * neutral placeholder when there is none); ambiguous cases are reported, never guessed.
 */
function repairAssetReferences(files = [], defects = [], manifest) {
  let working = files;
  const repaired = [];
  const unresolved = [];
  for (const defect of defects) {
    if (!['asset-mismatch', 'unrelated-substitute'].includes(defect.type)) continue;
    const wrongPath = localPathOf(defect.src);
    const replacement = defect.type === 'asset-mismatch' ? defect.expectedPublicPath : neutralPlaceholder(0, 0);
    if (!wrongPath || !replacement) { unresolved.push({ defect, reason: 'no reference to repair' }); continue; }
    let fixed = false;
    working = working.map((file) => {
      if (fixed || file.encoding === 'base64' || !/\.(?:jsx?|tsx?|html)$/i.test(file.path || '') || file.path === 'src/assets/asset-map.json') return file;
      const next = repairInTag(String(file.content || ''), wrongPath, replacement, defect.alt);
      if (next === null || next === file.content) return file;
      fixed = true;
      repaired.push({ type: defect.type, file: file.path, from: wrongPath, to: defect.type === 'asset-mismatch' ? replacement : 'neutral-placeholder' });
      return { ...file, content: next };
    });
    if (!fixed) unresolved.push({ defect, reason: 'the element could not be identified uniquely in the source files' });
  }
  return { files: working, repaired, unresolved };
}

module.exports = {
  stripQuery, canonicalUrl, assetIdFor, parseSrcset, classifyAssetRole, isSharedAsset, buildAssetManifest, mapAssetsToElements,
  resolveAssetReference, selectResponsiveCandidate, neutralPlaceholder, verifyRenderedAssets, repairAssetReferences
};
