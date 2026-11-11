'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseColor, mix } = require('./colorUtils');

// Stages 5 and 6 (assets): a deterministic manifest of every image on the reference site, tied to the element it appears
// in, and from it a set of ASSET SLOTS for the new site.
//
// A prototype keeps the reference's look and structure but not its pictures (those belong to the reference's owner).
// So every reference image becomes a SLOT with a stable id, a role, a position and a size. The generated page must
// render its own image in that slot (`data-asset-slot="<id>"`); the reference file is only downloaded to measure it.
// When nothing is available for a slot it is filled with a neutral placeholder of the same size, never with some other
// image.

const sha = (text, n = 10) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, n);
const TRACKING = /(?:googletagmanager|google-analytics|doubleclick|facebook\.com\/tr|pixel|beacon|analytics|adservice|scorecardresearch)/i;

/** The same picture served with different sizing parameters is one asset. */
function canonicalAssetUrl(value) {
  if (!value || String(value).startsWith('inline-svg:')) return value;
  if (String(value).startsWith('data:')) return `data:${sha(value, 16)}`;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (/^(?:format|width|height|w|h|quality|q|dpr|fit|crop|auto|fm|ixlib|s|v|ver|version)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort(); url.hash = '';
    return url.href;
  } catch { return value; }
}
const assetIdFor = (canonical) => `a_${sha(canonical)}`;

function inferRole(item, section = null) {
  const hint = `${item.alt} ${item.title} ${item.className} ${item.nearText}`.toLowerCase();
  const { w, h } = item.rect || { w: 0, h: 0 };
  const aspect = h ? w / h : 1;
  if (item.kind === 'background') return section?.kind === 'hero' || (item.rect.y < 900 && w > 900) ? 'hero' : (aspect > 2.4 ? 'banner' : 'background');
  if (item.kind === 'svg') return (item.zone === 'header' || item.zone === 'footer' || /logo/.test(hint)) && w <= 260 ? 'logo' : 'icon';
  if (/logo|brand/.test(hint) && w <= 320) return 'logo';
  if ((item.zone === 'header' || item.zone === 'footer') && item.inLink && item.linkHref && w <= 260 && h <= 120) return 'logo';
  if (w <= 72 && h <= 72) return 'icon';
  if (/avatar|profile|team|author|testimonial|person|portrait/.test(hint) || (Math.abs(aspect - 1) < 0.12 && /999|50%|9999/.test(String(item.borderRadius)) && w <= 220)) return 'avatar';
  if (section?.kind === 'hero' && w >= 480) return 'hero';
  if (aspect > 2.6 && w >= 700) return 'banner';
  if (section?.kind === 'gallery') return 'gallery';
  if (section?.kind === 'cards' || section?.items > 2) return 'card-image';
  return item.decorative ? 'decorative' : 'content';
}

/**
 * Builds the manifest from the crawler's pages. Every appearance keeps its route, element selector, size and section.
 */
function buildAssetManifest(pages, { origin = '', maxAssets = 400 } = {}) {
  const assets = new Map();
  const slots = [];
  const skipped = [];
  for (const page of pages || []) {
    const m = page.desktop; if (!m) continue;
    const mobileBySelector = new Map((page.mobile?.assets || []).map((a) => [a.selector, a]));
    for (const raw of m.assets || []) {
      if (!raw.src || (raw.kind !== 'svg' && TRACKING.test(raw.src))) { skipped.push({ route: page.route, src: raw.src, reason: 'tracking-pixel' }); continue; }
      if (!raw.visible) { skipped.push({ route: page.route, src: raw.src, reason: 'not-visible' }); continue; }
      if (raw.rect.w <= 4 && raw.rect.h <= 4) { skipped.push({ route: page.route, src: raw.src, reason: 'tracking-pixel' }); continue; }
      const section = m.sections?.[raw.sectionIndex] || null;
      const canonical = raw.kind === 'svg' ? `inline-svg:${page.route}:${raw.selector}` : canonicalAssetUrl(raw.src);
      const id = assetIdFor(canonical);
      const role = inferRole(raw, section);
      const mobile = mobileBySelector.get(raw.selector) || null;
      const appearance = {
        route: page.route, selector: raw.selector, tag: raw.tag, kind: raw.kind, alt: raw.alt, role, zone: raw.zone,
        sectionIndex: raw.sectionIndex, sectionKind: section?.kind || null, sectionHeading: section?.heading || '',
        rect: { x: raw.rect.x, y: raw.rect.y, w: raw.rect.w, h: raw.rect.h }, mobileRect: mobile ? { w: mobile.rect.w, h: mobile.rect.h } : null,
        nearText: raw.nearText, linkHref: raw.linkHref, objectFit: raw.objectFit, borderRadius: raw.borderRadius, order: raw.order
      };
      let asset = assets.get(id);
      if (!asset) {
        if (assets.size >= maxAssets) { skipped.push({ route: page.route, src: raw.src, reason: 'asset-limit' }); continue; }
        asset = { id, canonicalUrl: canonical, urls: [], kind: raw.kind, naturalWidth: raw.naturalWidth || null, naturalHeight: raw.naturalHeight || null, role, appearances: [], status: raw.loaded === false ? 'failed-in-source' : 'discovered' };
        assets.set(id, asset);
      }
      if (raw.src && !asset.urls.includes(raw.src)) asset.urls.push(raw.src);
      asset.appearances.push(appearance);
      // slot: one per (route, element)
      const slotId = `s_${sha(`${page.route}|${raw.selector}|${id}`)}`;
      if (!slots.some((s) => s.slotId === slotId)) {
        slots.push({
          slotId, assetId: id, route: page.route, role, selector: raw.selector, tag: raw.tag, kind: raw.kind, alt: raw.alt || section?.heading || '',
          width: raw.rect.w, height: raw.rect.h, aspect: raw.rect.h ? Number((raw.rect.w / raw.rect.h).toFixed(3)) : 1,
          mobileWidth: mobile?.rect.w || null, mobileHeight: mobile?.rect.h || null, objectFit: raw.objectFit, borderRadius: raw.borderRadius,
          sectionIndex: raw.sectionIndex, sectionKind: section?.kind || null, sectionHeading: section?.heading || '', zone: raw.zone, order: raw.order,
          decorative: Boolean(raw.decorative), status: 'planned'
        });
      }
    }
  }
  const list = [...assets.values()];
  const roles = {};
  slots.forEach((s) => { roles[s.role] = (roles[s.role] || 0) + 1; });
  return { version: 1, assets: list, slots, skipped: skipped.slice(0, 200), stats: { assets: list.length, slots: slots.length, skipped: skipped.length, roles, appearances: list.reduce((n, a) => n + a.appearances.length, 0) } };
}

/**
 * Downloads the reference images into a cache OUTSIDE the project, to measure real dimensions and a content hash.
 * Images that cannot be fetched are recorded as unavailable (with the reason); nothing is substituted for them.
 */
async function downloadReferenceAssets(manifest, { cacheDir, fetchImpl = fetch, validateUrl = async () => {}, signal, maxAssets = 80, maxBytes = 6 * 1024 * 1024, totalBytes = 60 * 1024 * 1024, timeoutMs = 20000, concurrency = 4 } = {}) {
  const sharp = require('sharp');
  fs.mkdirSync(cacheDir, { recursive: true });
  let used = 0; let index = 0;
  const targets = manifest.assets.filter((a) => a.kind !== 'svg').slice(0, maxAssets);
  const unavailable = [];
  const byHash = new Map();
  const next = async () => {
    for (;;) {
      signal?.throwIfAborted();
      const asset = targets[index++];
      if (!asset) return;
      const url = asset.urls.find((u) => /^https?:\/\//i.test(u) || u.startsWith('data:'));
      if (!url) { asset.status = 'unavailable'; unavailable.push({ assetId: asset.id, reason: 'no-fetchable-url' }); continue; }
      try {
        let buffer;
        if (url.startsWith('data:')) {
          const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
          if (!m) throw new Error('unreadable data URI');
          buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
        } else {
          await validateUrl(url);
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; VeavePrototype/1.0)' } });
          if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'http' });
          const length = Number(response.headers.get('content-length')) || 0;
          if (length > maxBytes) throw new Error(`larger than ${Math.round(maxBytes / 1048576)} MB`);
          buffer = Buffer.from(await response.arrayBuffer());
        }
        if (buffer.length > maxBytes) throw new Error(`larger than ${Math.round(maxBytes / 1048576)} MB`);
        if (used + buffer.length > totalBytes) throw new Error('download budget used up');
        used += buffer.length;
        const meta = await sharp(buffer, { animated: false, limitInputPixels: 120e6 }).metadata();
        if (!meta.width || !meta.height) throw new Error('not a readable image');
        const hash = crypto.createHash('sha1').update(buffer).digest('hex');
        const file = path.join(cacheDir, `${asset.id}.${meta.format === 'jpeg' ? 'jpg' : meta.format || 'img'}`);
        fs.writeFileSync(file, buffer);
        Object.assign(asset, { status: 'downloaded', localPath: file, width: meta.width, height: meta.height, mime: `image/${meta.format}`, bytes: buffer.length, hash });
        if (byHash.has(hash)) asset.duplicateOf = byHash.get(hash); else byHash.set(hash, asset.id);
      } catch (error) {
        if (signal?.aborted) throw error;
        asset.status = 'unavailable';
        asset.error = String(error.message).slice(0, 160);
        unavailable.push({ assetId: asset.id, reason: asset.error, url });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, next));
  // inline SVGs were measured in the page; they are not downloaded
  manifest.assets.filter((a) => a.kind === 'svg').forEach((a) => { a.status = 'inline'; a.width = a.appearances[0]?.rect.w || null; a.height = a.appearances[0]?.rect.h || null; });
  manifest.slots.forEach((slot) => {
    const asset = manifest.assets.find((a) => a.id === slot.assetId);
    slot.referenceStatus = asset?.status || 'unknown';
    if (asset?.width && asset?.height) { slot.referenceWidth = asset.width; slot.referenceHeight = asset.height; }
  });
  manifest.unavailable = unavailable;
  manifest.stats = { ...manifest.stats, downloaded: manifest.assets.filter((a) => a.status === 'downloaded').length, unavailable: unavailable.length, bytes: used };
  return manifest;
}

// ---- slot files for the generated project --------------------------------------------------------------------------

const escapeXml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** Neutral placeholder with the slot's exact proportions. It is plainly a placeholder, never a stand-in picture. */
function placeholderSvg(slot, palette = {}) {
  const w = Math.max(16, Math.min(2400, Math.round(slot.width || 600)));
  const h = Math.max(16, Math.min(2400, Math.round(slot.height || 400)));
  const base = palette.surface2 || '#e5e7eb';
  const ink = palette.muted || '#6b7280';
  const label = slot.role === 'logo' ? 'Logo' : slot.role === 'avatar' ? 'Photo' : slot.role === 'icon' ? '' : 'Image';
  const small = Math.min(w, h) < 120;
  const light = parseColor(base) ? mix(base, '#ffffff', 0.35) : '#f3f4f6';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeXml(slot.alt || label || 'Placeholder')}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${base}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${small || !label ? '' : `<g fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="2"><rect x="${w / 2 - 28}" y="${h / 2 - 26}" width="56" height="40" rx="6"/><circle cx="${w / 2 - 12}" cy="${h / 2 - 12}" r="5"/><path d="M${w / 2 - 28} ${h / 2 + 8} l18 -16 14 12 10 -8 12 12"/></g><text x="${w / 2}" y="${h / 2 + 38}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="${ink}" fill-opacity=".8">${escapeXml(label)} ${w}×${h}</text>`}</svg>`;
}

/**
 * Files for every slot of the given routes: the user's own image when one was supplied for it, else the placeholder.
 * `userImages`: [{ name, content (base64), mimeType }] assigned to the largest content slots, in order.
 */
function renderSlotFiles(manifest, { routes = null, palette = {}, userImages = [] } = {}) {
  const files = [];
  const mapping = new Map(); // slotId -> public path
  const wanted = manifest.slots.filter((s) => !routes || routes.includes(s.route));
  const pool = [...userImages];
  const eligible = new Set(wanted.filter((s) => ['hero', 'content', 'card-image', 'banner', 'gallery'].includes(s.role)).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, pool.length).map((s) => s.slotId));
  const seen = new Set();
  for (const slot of wanted) {
    if (seen.has(slot.slotId)) continue; seen.add(slot.slotId);
    if (eligible.has(slot.slotId) && pool.length) {
      const image = pool.shift();
      const ext = (String(image.name || '').match(/\.(png|jpe?g|webp|gif|avif|svg)$/i) || [null, 'png'])[1].toLowerCase().replace('jpeg', 'jpg');
      const publicPath = `/prototype-assets/${slot.slotId}.${ext}`;
      files.push({ path: `public${publicPath}`, content: image.content, encoding: 'base64', language: 'binary' });
      mapping.set(slot.slotId, { publicPath, source: 'user-upload' });
    } else {
      const publicPath = `/prototype-assets/${slot.slotId}.svg`;
      // base64 like every other binary under public/, so the preview and the project storage serve it as a file
      files.push({ path: `public${publicPath}`, content: Buffer.from(placeholderSvg(slot, palette), 'utf8').toString('base64'), encoding: 'base64', language: 'binary' });
      mapping.set(slot.slotId, { publicPath, source: 'placeholder' });
    }
    slot.fill = mapping.get(slot.slotId).source;
    slot.status = 'filled';
  }
  return { files, mapping };
}

/**
 * Checks the rendered page against its slots: identity (the right file, in the right slot), load status, size, and
 * position. `rendered` is the generated page's metrics (`slots`, `assets`, `sections`) at one viewport.
 */
function validateSlots(manifest, route, rendered, { viewport = 'desktop', tolerances = {}, mapping = null } = {}) {
  const tol = { aspect: tolerances.aspectRatio ?? 0.25, width: 0.45 };
  const planned = manifest.slots.filter((s) => s.route === route && s.kind !== 'svg' && !s.decorative);
  const issues = [];
  const bySlot = new Map((rendered.slots || []).map((s) => [s.slot, s]));
  const known = new Set(manifest.slots.map((s) => s.slotId));
  for (const slot of planned) {
    const got = bySlot.get(slot.slotId);
    if (!got) { issues.push({ kind: 'slot-missing', severity: 'major', slotId: slot.slotId, role: slot.role, message: `Slot ${slot.slotId} (${slot.role}, ${slot.width}x${slot.height}) is not on the page.`, fix: `Add <img data-asset-slot="${slot.slotId}" src="${mapping?.get(slot.slotId)?.publicPath || `/prototype-assets/${slot.slotId}.svg`}" ...> in the ${slot.sectionKind || 'matching'} section.` }); continue; }
    if (!got.visible || got.width < 2 || got.height < 2) issues.push({ kind: 'slot-zero-size', severity: 'major', slotId: slot.slotId, role: slot.role, message: `Slot ${slot.slotId} renders at ${got.width}x${got.height}.`, fix: 'Give the image an explicit width/height or aspect ratio so it is visible.' });
    if (!got.loaded) issues.push({ kind: 'slot-not-loaded', severity: 'major', slotId: slot.slotId, role: slot.role, message: `Slot ${slot.slotId} did not load (${got.src || 'no src'}).`, fix: `Use src="${mapping?.get(slot.slotId)?.publicPath || `/prototype-assets/${slot.slotId}.svg`}".` });
    const expected = mapping?.get(slot.slotId)?.publicPath;
    if (expected && got.src && !got.src.includes(expected) && !got.src.includes(slot.slotId)) issues.push({ kind: 'asset-substituted', severity: 'major', slotId: slot.slotId, role: slot.role, message: `Slot ${slot.slotId} shows ${got.src.slice(0, 90)} instead of its own file ${expected}.`, fix: `Use src="${expected}".` });
    const refW = viewport === 'mobile' ? (slot.mobileWidth || slot.width) : slot.width;
    const refH = viewport === 'mobile' ? (slot.mobileHeight || slot.height) : slot.height;
    if (got.width > 2 && got.height > 2 && refW > 2 && refH > 2 && slot.role !== 'logo' && slot.role !== 'icon') {
      const aspectDiff = Math.abs(got.width / got.height - refW / refH) / (refW / refH);
      if (aspectDiff > tol.aspect && slot.role !== 'background') issues.push({ kind: 'slot-aspect', severity: 'minor', slotId: slot.slotId, role: slot.role, message: `Slot ${slot.slotId} is ${got.width}x${got.height} (ratio ${(got.width / got.height).toFixed(2)}); the reference is ${refW}x${refH} (${(refW / refH).toFixed(2)}).`, fix: `Use aspect ratio ${(refW / refH).toFixed(2)} (about ${refW}x${refH}).` });
    }
  }
  const slotImages = new Set((rendered.slots || []).map((s) => s.slot));
  (rendered.slots || []).forEach((s) => { if (!known.has(s.slot)) issues.push({ kind: 'slot-unknown', severity: 'major', slotId: s.slot, message: `data-asset-slot="${s.slot}" is not a slot of this site.`, fix: 'Only use the slot ids listed for this page.' }); });
  // pictures that bypass the slot system (hot-linked or invented images)
  (rendered.assets || []).filter((a) => a.kind === 'img' && a.visible && a.rect.w > 48 && a.rect.h > 48).forEach((a) => {
    const mapped = /\/prototype-assets\//.test(a.src) || /^data:/.test(a.src);
    if (!mapped && !slotImages.size) issues.push({ kind: 'image-unmapped', severity: 'major', message: `An image (${a.src.slice(0, 80)}) is not one of the page's asset slots.`, selector: a.selector, fix: 'Replace it with the matching slot image.' });
    else if (!mapped) issues.push({ kind: 'image-unmapped', severity: 'minor', message: `An image (${a.src.slice(0, 80)}) is not one of the page's asset slots.`, selector: a.selector, fix: 'Use a slot image, or remove it.' });
  });
  return { route, viewport, planned: planned.length, found: planned.filter((s) => bySlot.has(s.slotId)).length, issues };
}

module.exports = { canonicalAssetUrl, assetIdFor, inferRole, buildAssetManifest, downloadReferenceAssets, placeholderSvg, renderSlotFiles, validateSlots };
