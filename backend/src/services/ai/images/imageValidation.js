/**
 * What counts as a working image.
 *
 * A reference such as <img src="/assets/images/home-hero.webp"> only counts when (1) the file exists in THIS project, (2) it is not
 * empty and decodes as a picture with real dimensions, (3) it is a different picture from the others counted (identical or
 * near-identical copies count once), and (4) it is reachable from the page being checked. Remote links, empty frames, gradients
 * and SVG placeholders never count. The browser check then confirms the pictures really render, scrolling the page first so
 * lazy images have been requested.
 */
const { createHash } = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { imageConfig } = require('./imageConfig');
const { averageHash, hamming } = require('./imageVerification');

const IMAGE_EXT = /\.(?:png|jpe?g|webp|avif|gif|svg)$/i;
const RASTER_MIME = /^image\/(?:jpeg|png|webp|avif|gif)$/;
const cache = new Map(); // content sha -> inspection (a file is decoded once however many rounds look at it)

async function inspectFile(file) {
  const content = String(file.content || '');
  const key = createHash('sha256').update(content).digest('hex');
  if (cache.has(key)) return { ...cache.get(key), path: file.path };
  let result;
  const body = content ? Buffer.from(content, 'base64') : Buffer.alloc(0);
  if (!body.length) result = { valid: false, reason: 'the file is empty' };
  else if (/\.svg$/i.test(file.path)) result = { valid: false, countable: false, reason: 'an SVG is not counted as a photograph' };
  else {
    const { sniffImage } = require('../remoteImageLocalizer');
    const sniffed = sniffImage(body);
    if (!sniffed || !RASTER_MIME.test(sniffed.mime)) result = { valid: false, reason: 'the file is not image data' };
    else {
      try {
        const meta = await sharp(body, { failOn: 'error' }).metadata();
        if (!meta.width || !meta.height) throw new Error('no dimensions');
        await sharp(body, { failOn: 'error' }).resize(48, 48, { fit: 'inside' }).raw().toBuffer(); // a decode, not just a header read
        const shortSide = Math.min(meta.width, meta.height);
        result = shortSide < 64
          ? { valid: false, reason: `the image is only ${meta.width}x${meta.height}`, width: meta.width, height: meta.height }
          : { valid: true, width: meta.width, height: meta.height, mime: sniffed.mime, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), hash: await averageHash(body).catch(() => '') };
      } catch (error) { result = { valid: false, reason: `the file could not be decoded (${String(error.message).slice(0, 60)})` }; }
    }
  }
  if (cache.size > 400) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return { ...result, path: file.path };
}

/** Every binary image in the project, decoded: Map<path, inspection>. */
async function inspectProjectImages(files = []) {
  const info = new Map();
  const images = files.filter((file) => file && file.encoding === 'base64' && IMAGE_EXT.test(file.path || ''));
  for (const file of images) info.set(file.path, await inspectFile(file));
  return info;
}

const norm = (value) => path.posix.normalize(value);

/** Where a source reference points inside the project, or null for anything that is not a project file. */
function resolveLocal(reference, fromPath) {
  let ref = String(reference || '').split(/[?#]/)[0].trim();
  if (!ref || /^(?:https?:)?\/\//i.test(ref) || ref.startsWith('data:') || !IMAGE_EXT.test(ref)) return null;
  if (ref.startsWith('@/')) return norm(`src/${ref.slice(2)}`);
  if (ref.startsWith('/')) return norm(`public${ref}`);
  if (ref.startsWith('./') || ref.startsWith('../')) return norm(path.posix.join(path.posix.dirname(fromPath), ref));
  return norm(`public/${ref}`);
}

/** The image references one source file makes: { local: [{ref, resolved}], remote: [url] }. */
function referencesIn(file) {
  const text = file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '';
  const local = [];
  const seen = new Set();
  const consider = (ref) => {
    const resolved = resolveLocal(ref, file.path);
    if (resolved && !seen.has(resolved)) { seen.add(resolved); local.push({ ref, resolved }); }
  };
  // Path-like tokens that end in an image extension and sit right after a quote or "(" (a src, an import, a data field, url(...)).
  // Matching the token itself, not quote pairs, keeps this correct inside JSX where quotes of other attributes interleave.
  for (const match of text.matchAll(/(?<=["'`(])((?:\.{1,2}\/|\/|@\/)?[\w@~%\-./]+\.(?:png|jpe?g|webp|avif|gif|svg))(?=[?#"'`)\s])/gi)) consider(match[1]);
  const remote = /\.(?:jsx?|tsx?|css|html)$/i.test(file.path || '') ? [...require('../remoteImageLocalizer').findRemoteImageUrls(text)] : [];
  return { local, remote };
}

/**
 * Counts the working, distinct pictures a set of source files shows.
 * @returns {{ count, paths, missing: [{ref, from}], invalid: [{path, from, reason}], remote: string[] }}
 */
function summarizeImages(sourceFiles, info) {
  const missing = []; const invalid = []; const remote = new Set();
  const counted = []; // { path, sha256, hash }
  for (const file of sourceFiles) {
    if (!file) continue;
    const refs = referencesIn(file);
    refs.remote.forEach((url) => remote.add(url));
    for (const { ref, resolved } of refs.local) {
      const found = info.get(resolved);
      if (!found) { if (!/\.svg$/i.test(resolved)) missing.push({ ref, from: file.path }); continue; }
      if (!found.valid) { if (found.countable !== false) invalid.push({ path: resolved, from: file.path, reason: found.reason }); continue; }
      const duplicate = counted.some((item) => item.sha256 === found.sha256 || (found.hash && item.hash && hamming(item.hash, found.hash) <= 4));
      if (!duplicate) counted.push({ path: resolved, sha256: found.sha256, hash: found.hash });
    }
  }
  return { count: counted.length, paths: counted.map((item) => item.path), missing, invalid, remote: [...remote] };
}

/** What a message to the repair model should say about the images the checks found wrong. */
function describeProblems(home, site) {
  const parts = [];
  const bad = [...site.missing.map((item) => `${item.ref} (${item.from}) does not exist in the project`), ...site.invalid.map((item) => `${item.path} (${item.from}) is not a working image: ${item.reason}`)];
  if (bad.length) parts.push(`These image references are broken: ${bad.slice(0, 6).join('; ')}.`);
  if (site.remote.length) parts.push(`${site.remote.length} image link(s) still point to other websites and do not count (${site.remote.slice(0, 3).join(', ')}).`);
  return parts.join(' ');
}

/* ---------------------------------------------------------------- browser check ---------------------------------------------------------------- */

// Runs inside the page: forces lazy images to load, waits for them to decode and reports what really rendered.
const PAGE_INSPECTION = async () => {
  const imgs = [...document.images];
  await Promise.all(imgs.map(async (img) => {
    try { img.loading = 'eager'; if (!img.complete || !img.naturalWidth) await Promise.race([img.decode().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 4000))]); } catch { /* reported below */ }
  }));
  return {
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    images: imgs.map((img) => {
      const rect = img.getBoundingClientRect();
      const style = getComputedStyle(img);
      return { src: img.currentSrc || img.src, alt: img.getAttribute('alt'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: Math.round(rect.width), height: Math.round(rect.height), complete: img.complete, hidden: style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 };
    })
  };
};

const pathOf = (src) => { try { return decodeURIComponent(new URL(src, 'http://preview.local').pathname); } catch { return String(src || ''); } };

/**
 * Opens every route in the headless browser and checks the images that render.
 * @param render async (files, { routePath, inspect }) => measurement   (inspectRenderedPreview in production)
 * @returns issues in the completeness format ({ category, kind, path, message })
 */
async function renderedImageReport(files, { routes = ['/'], render, signal, cfg = imageConfig(), info = null } = {}) {
  const issues = [];
  const homeUnique = new Set();
  const siteUnique = new Set();
  const sourcesByImage = (src) => files.find((file) => file.encoding !== 'base64' && typeof file.content === 'string' && file.content.includes(pathOf(src)) )?.path;
  const results = [];
  for (const route of [...new Set(['/', ...routes])].slice(0, 10)) {
    signal?.throwIfAborted();
    try { results.push({ route, page: await render(files, { routePath: route, inspect: PAGE_INSPECTION }) }); }
    catch (error) { if (signal?.aborted) throw error; return { issues: [], home: null, site: null, byRoute: {}, skipped: error.message }; } // the preview could not render at all: that is reported by the build checks, not here
  }
  for (const { route, page } of results) {
    for (const image of page.images || []) {
      const local = pathOf(image.src);
      const label = `${local}${image.alt ? ` ("${image.alt.slice(0, 50)}")` : ''}`;
      if (image.hidden) continue;
      if (!image.naturalWidth || !image.naturalHeight) {
        issues.push({ category: 'completeness', kind: 'images', path: sourcesByImage(image.src) || 'src/App.jsx', route, message: `On ${route} the image ${label} does not render in the browser (it is broken or empty). Its file must be replaced by a different working image from the project's verified images.` });
        continue;
      }
      siteUnique.add(local);
      if (route === '/') homeUnique.add(local);
      if (image.width >= 120 && image.height >= 80 && !String(image.alt || '').trim()) issues.push({ category: 'completeness', kind: 'image-alt', path: sourcesByImage(image.src) || 'src/App.jsx', route, message: `On ${route} the image ${local} has no alt text. Give it a meaningful alt describing the picture.` });
      if (image.width > page.viewport + 2) issues.push({ category: 'completeness', kind: 'image-layout', path: sourcesByImage(image.src) || 'src/App.jsx', route, message: `On ${route} the image ${local} is wider than the screen. Put it in a fixed-aspect frame with w-full max-w-full object-cover.` });
    }
  }
  const dedupe = (set) => { // count each picture once even if it is stored under two names
    if (!info) return set.size;
    const chosen = [];
    for (const item of set) {
      const found = info.get(norm(`public${item}`));
      const duplicate = found?.valid && chosen.some((other) => other.sha256 === found.sha256 || (other.hash && found.hash && hamming(other.hash, found.hash) <= 4));
      if (!duplicate) chosen.push(found?.valid ? found : { sha256: item });
    }
    return chosen.length;
  };
  const home = dedupe(homeUnique);
  const site = dedupe(siteUnique);
  const byRoute = {};
  for (const { route, page } of results) byRoute[route] = new Set((page.images || []).filter((image) => !image.hidden && image.naturalWidth > 0).map((image) => pathOf(image.src))).size;
  if (home < cfg.minHome || site < cfg.minSite) {
    issues.push({ category: 'completeness', kind: 'images', path: 'src/App.jsx', message: `When the site is opened in a browser only ${home} distinct image(s) render on the home page and ${site} across the checked pages; at least ${cfg.minHome} on the home page and ${cfg.minSite} across the site must render.` });
  }
  return { issues, home, site, byRoute };
}

/** Same check, issues only. */
async function checkRenderedImages(files, options = {}) { return (await renderedImageReport(files, options)).issues; }

/* ---------------------------------------------------------------- per-route counts and reconciliation ---------------------------------------------------------------- */

/** Pictures each route's page really shows (static): the home route, every other route, and the whole site. */
function countsByRoute(files, info) {
  const completeness = require('../siteCompleteness');
  const byPath = new Map(files.map((file) => [file.path, file]));
  const app = byPath.get('src/App.jsx') || byPath.get('src/App.tsx') || byPath.get('src/App.js');
  const out = { home: { count: 0, paths: [], file: null }, routes: {}, site: { count: 0, paths: [] } };
  if (!app) return out;
  const routes = require('../pageDistinctness').extractRoutes(files).filter((route) => route.path.startsWith('/') && !/[:*]/.test(route.path));
  for (const route of [...new Map(routes.map((item) => [item.path, item])).values()]) {
    const target = route.target && byPath.get(route.target);
    if (!target) continue;
    const stats = summarizeImages(completeness.reachable(target, byPath, 4), info);
    out.routes[route.path] = { count: stats.count, paths: stats.paths, file: target.path, missing: stats.missing, invalid: stats.invalid };
  }
  const homeFile = completeness.findHomeFile(files, byPath, app, []);
  const homeStats = summarizeImages(completeness.reachable(homeFile, byPath, 4), info);
  out.home = { count: homeStats.count, paths: homeStats.paths, file: homeFile.path, missing: homeStats.missing, invalid: homeStats.invalid };
  const siteStats = summarizeImages(completeness.reachable(app, byPath, 5), info);
  out.site = { count: siteStats.count, paths: siteStats.paths, missing: siteStats.missing, invalid: siteStats.invalid, remote: siteStats.remote };
  return out;
}

/**
 * The reconciliation of what was downloaded, what the code references and what renders.
 * @param assets   verified assets of the manifest ({ id, path, publicPath, route, page, sha256 })
 * @param rendered optional { home, site, byRoute } from the browser check
 */
function reconcile(files, { assets = [], info, rendered = null, cfg = imageConfig() } = {}) {
  const counts = countsByRoute(files, info);
  const sources = files.filter((file) => file.encoding !== 'base64' && typeof file.content === 'string' && /\.(?:jsx?|tsx?|css|html|json)$/i.test(file.path || '') && file.path !== 'src/assets/image-manifest.json');
  const text = sources.map((file) => file.content).join('\n');
  const referenced = assets.filter((asset) => text.includes(asset.publicPath));
  const unused = assets.filter((asset) => !text.includes(asset.publicPath));
  const usage = new Map();
  for (const [route, entry] of Object.entries(counts.routes)) for (const p of entry.paths) usage.set(p, [...(usage.get(p) || []), route]);
  const duplicates = [...usage.entries()].filter(([, pages]) => pages.length > 1).map(([file, pages]) => ({ file, pages }));
  const misplaced = [];
  for (const asset of assets) {
    const where = usage.get(asset.path) || [];
    if (where.length && asset.route && !where.includes(asset.route)) misplaced.push({ id: asset.id, assigned: asset.route, usedOn: where });
  }
  const brokenReferences = counts.site.invalid || [];
  const missingReferences = counts.site.missing || [];
  return {
    verifiedAssets: assets.length, referenced: referenced.map((asset) => asset.publicPath), unused: unused.map((asset) => ({ id: asset.id, publicPath: asset.publicPath, route: asset.route, section: asset.section, alt: asset.alt })),
    missingReferences, brokenReferences, duplicates, misplaced,
    staticCounts: { home: counts.home.count, site: counts.site.count, routes: Object.fromEntries(Object.entries(counts.routes).map(([route, entry]) => [route, entry.count])) },
    rendered: rendered ? { home: rendered.home, site: rendered.site, byRoute: rendered.byRoute } : null,
    required: { home: cfg.minHome, site: cfg.minSite },
    homeFile: counts.home.file, counts
  };
}

module.exports = { renderedImageReport, countsByRoute, reconcile, inspectProjectImages, summarizeImages, referencesIn, resolveLocal, describeProblems, checkRenderedImages, PAGE_INSPECTION };
