/**
 * An edit that "adds an image" often references a public URL the model chose (a stock-photo link). Left remote, that
 * image is a dependency nobody verified: the preview/validation sandbox does not load third-party hosts, links the model
 * invented are dead, and a live site would depend on someone else's server.
 *
 * So every NEW remote image an edit introduces is downloaded by the server (public addresses only, size-capped, content
 * checked by signature), saved as a project asset and referenced locally. A link that cannot be downloaded is reported
 * instead of being kept as a broken remote image or swapped for an unrelated one.
 */

const { createHash } = require('node:crypto');
const { MIME_TYPES } = require('../clone/assetLocalizationService');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES_PER_EDIT = 40; // an edit may add a whole gallery; every one of them is downloaded
const DOWNLOAD_CONCURRENCY = 6;
const NON_IMAGE_TAGS = new Set(['iframe', 'script', 'embed', 'video', 'audio', 'object', 'link']);
const NON_IMAGE_EXTENSION = /\.(?:js|mjs|css|html?|json|pdf|mp4|webm|mp3|wav|zip)(?:[?#]|$)/i;

// Stylesheets and fonts (Google Fonts @import url(...) etc.) are not images and must never be downloaded or counted as broken images.
const NON_IMAGE_URL = /^https?:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|use\.typekit\.net|use\.fontawesome\.com|kit\.fontawesome\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome)\b|[?&]family=|\/css2?(?:[?#\/]|$)|\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i;

const CONTEXTS = [
  /\b(?:src|poster|data-src)\s*=\s*\{?\s*["'`](https?:\/\/[^"'`\s]+)["'`]/gi,
  /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi,
  /\b(?:src|image|imageUrl|img|thumbnail|backgroundImage|poster|photo|avatar|logo|banner|cover|picture)\s*:\s*["'`](https?:\/\/[^"'`\s]+)["'`]/gi
];

function findRemoteImageUrls(content = '') {
  const text = String(content);
  const found = new Set();
  for (const pattern of CONTEXTS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const url = match[1];
      if (NON_IMAGE_EXTENSION.test(url) || NON_IMAGE_URL.test(url)) continue;
      if (/@import\s*(?:url\(\s*)?["']?$/i.test(text.slice(Math.max(0, match.index - 20), match.index + match[0].indexOf(url)))) continue;
      const tagStart = text.lastIndexOf('<', match.index);
      const tagEnd = text.lastIndexOf('>', match.index);
      if (tagStart > tagEnd) {
        const tag = (/^<\s*([a-z][\w-]*)/i.exec(text.slice(tagStart)) || [])[1];
        if (tag && NON_IMAGE_TAGS.has(tag.toLowerCase())) continue;
      }
      found.add(url);
    }
  }
  return found;
}

function sniffImage(body) {
  for (const [mime, type] of Object.entries(MIME_TYPES)) {
    if (/^image\//.test(mime) && type.signature(body)) return { mime, extension: type.extension };
  }
  return null;
}

// Pictures the generator already fetched and verified (named people / brands in the prompt) are kept for a while so the
// project save does not download them a second time from a host that might refuse the repeat request.
const PRIMED = new Map();
const PRIMED_TTL_MS = 30 * 60 * 1000;
function primeImageCache(url, body) {
  const now = Date.now();
  for (const [key, entry] of PRIMED) if (now - entry.at > PRIMED_TTL_MS) PRIMED.delete(key);
  if (PRIMED.size >= 200) PRIMED.delete(PRIMED.keys().next().value);
  PRIMED.set(url, { at: now, body });
}

/** Default downloader: public hosts only, redirects re-validated, size and time limited. */
async function downloadPublicImage(url, { signal } = {}) {
  const primed = PRIMED.get(url);
  if (primed && Date.now() - primed.at <= PRIMED_TTL_MS) return primed.body;
  const { validatePublicUrl } = require('../clone/websiteCaptureService');
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    await validatePublicUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; VeaveImageFetcher/1.0)', accept: 'image/*,*/*;q=0.5' }
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    if (response.status !== 200) throw new Error(`the server answered HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) throw new Error('the response was empty');
    if (body.length > MAX_IMAGE_BYTES) throw new Error('the image is larger than 8 MB');
    return body;
  }
  throw new Error('too many redirects');
}

/**
 * @param beforeFiles  the saved project (URLs it already uses are left alone)
 * @param files        the project after the edit was applied
 * @param changedPaths text files the edit changed
 * @returns {{files, added, replaced, failed}}  `replaced` are rewritten files; `added` the downloaded image files
 */
async function localizeIntroducedRemoteImages({ beforeFiles = [], files = [], changedPaths = [], download = downloadPublicImage, signal, skipFailed = false } = {}) {
  const existingText = beforeFiles.filter((file) => file && file.encoding !== 'base64').map((file) => String(file.content || '')).join('\n');
  const changed = files.filter((file) => file && file.encoding !== 'base64' && changedPaths.includes(file.path));
  const introduced = new Set();
  for (const file of changed) {
    for (const url of findRemoteImageUrls(file.content)) if (!existingText.includes(url)) introduced.add(url);
  }
  const urls = [...introduced];
  if (!urls.length) return { files, added: [], replaced: [], failed: [], skipped: [] };

  const localPathByUrl = new Map();
  const added = [];
  const failed = [];
  const existingPaths = new Set(files.map((file) => file.path));
  // Beyond the cap nothing is silently left remote: those links are reported like any other that could not be saved.
  for (const url of urls.slice(MAX_IMAGES_PER_EDIT)) failed.push({ url, reason: `more than ${MAX_IMAGES_PER_EDIT} new images in one edit` });

  const fetchOne = async (url) => {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const body = await download(url, { signal });
        const image = sniffImage(body);
        if (!image) throw new Error('the file is not a supported image');
        const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
        const filePath = `public/assets/images/added-${hash}.${image.extension}`;
        localPathByUrl.set(url, `/${filePath.slice('public/'.length)}`);
        if (!existingPaths.has(filePath) && !added.some((file) => file.path === filePath)) {
          added.push({ path: filePath, content: body.toString('base64'), language: 'binary', encoding: 'base64' });
        }
        return;
      } catch (error) {
        lastError = error;
        // A missing page or a non-image answer will not change on a retry; a network hiccup might.
        if (/HTTP 4\d\d|not a supported image|larger than/.test(String(error?.message))) break;
      }
    }
    failed.push({ url, reason: String(lastError?.message || lastError).slice(0, 160) });
  };
  const queue = urls.slice(0, MAX_IMAGES_PER_EDIT);
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await fetchOne(queue.shift());
  }));

  // When an edit adds several images, a few dead links must not throw the good ones away: the <img> of a link that could not
  // be saved is removed (never swapped for another picture) and reported. Any other kind of reference to it still fails the edit.
  const skipped = [];
  if (skipFailed && added.length && failed.length) {
    const unremovable = [];
    for (const item of failed) {
      const escaped = item.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tag = new RegExp(`<img\\b[^>]*${escaped}[^>]*?/?>\\s*`, 'gi');
      let removedAnywhere = false;
      for (const file of changed) {
        const text = String(file.content || '');
        if (!text.includes(item.url)) continue;
        const stripped = text.replace(tag, '');
        if (stripped !== text) { file.content = stripped; removedAnywhere = true; }
        if (file.content.includes(item.url)) unremovable.push(item);
      }
      if (removedAnywhere) skipped.push(item);
    }
    const hard = new Set(unremovable.map((item) => item.url));
    failed.splice(0, failed.length, ...failed.filter((item) => hard.has(item.url)));
  }

  const replaced = [];
  const next = files.map((file) => {
    if (!changed.includes(file) || (!localPathByUrl.size && !skipped.length)) return file;
    let content = String(file.content || '');
    for (const [url, localPath] of localPathByUrl) content = content.split(url).join(localPath);
    if (content === file.content && !skipped.length) return file;
    const updated = { ...file, content };
    replaced.push(updated);
    return updated;
  });
  return { files: [...next, ...added], added, replaced, failed, skipped };
}

module.exports = { primeImageCache, findRemoteImageUrls, localizeIntroducedRemoteImages, downloadPublicImage, sniffImage };
