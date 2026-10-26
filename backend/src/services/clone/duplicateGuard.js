// Strict duplicate guard. A clone or a generated site must not contain the same page, asset file, asset path, queue
// placement or registered route twice. Everything here has two halves: a collector that LISTS the duplicates found (so
// they are reported, never silently dropped) and an enforcer that merges the safe ones and then verifies that none remain.
const { createHash } = require('node:crypto');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const unique = (values) => [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];

// ---------------------------------------------------------------------------------------------------------------------
// Captured website (pages, assets, placement queue)
// ---------------------------------------------------------------------------------------------------------------------

function pageKey(page, normalizeRoute, origin) {
  const url = page.url || page.path || '';
  return (origin && normalizeRoute(url, origin)) || String(page.path || url).split('#')[0].replace(/\/+$/, '') || '/';
}

function assetBytesHash(asset) {
  if (asset.hash) return asset.hash;
  const body = asset.content || asset.bodyBase64;
  return body ? sha256(Buffer.from(body, 'base64')) : null;
}

/** Lists every duplicate in a capture. An empty list means the capture is clean. */
function findCaptureDuplicates(capture, { normalizeRoute, origin } = {}) {
  const found = [];
  const group = (kind, items, keyOf, describe) => {
    const map = new Map();
    for (const item of items) {
      const key = keyOf(item);
      if (key === undefined || key === null || key === '' || key === false) continue;
      (map.get(key) || map.set(key, []).get(key)).push(item);
    }
    for (const [key, list] of map) if (list.length > 1) found.push({ kind, key: String(key).slice(0, 200), count: list.length, items: list.map(describe) });
  };
  const pages = capture.pages || [];
  group('page', pages, (page) => pageKey(page, normalizeRoute, origin), (page) => ({ path: page.path, url: page.url, status: page.captureStatus }));
  for (const page of pages.filter((item) => item.captureStatus === 'duplicate-route')) found.push({ kind: 'page-status', key: page.path, count: 1, items: [{ path: page.path, duplicateOf: page.duplicateOf || null }] });
  const assets = capture.assets || [];
  group('asset-bytes', assets, assetBytesHash, (asset) => ({ token: asset.token, publicPath: asset.publicPath }));
  group('asset-path', assets, (asset) => asset.publicPath, (asset) => ({ token: asset.token, publicPath: asset.publicPath }));
  group('asset-token', assets, (asset) => asset.token, (asset) => ({ token: asset.token, publicPath: asset.publicPath }));
  const byUrl = new Map();
  for (const asset of assets) for (const url of asset.sourceUrls || []) (byUrl.get(url) || byUrl.set(url, new Set()).get(url)).add(asset.token);
  for (const [url, tokens] of byUrl) if (tokens.size > 1) found.push({ kind: 'asset-source-url', key: url.slice(0, 200), count: tokens.size, items: [...tokens].map((token) => ({ token })) });
  const queue = capture.assetQueue || [];
  group('queue-id', queue, (item) => item.id, (item) => ({ id: item.id, page: item.page }));
  group('queue-order', queue, (item) => item.order, (item) => ({ id: item.id, order: item.order }));
  const placed = queue.filter((item) => item.rect && item.token && item.status !== 'unavailable');
  group('queue-spot', placed, (item) => [item.page, item.token, item.rect.x, item.rect.documentY, item.rect.width, item.rect.height].join('|'), (item) => ({ id: item.id, page: item.page, source: item.source }));
  group('queue-element', placed.filter((item) => item.selector), (item) => [item.page, item.token, item.selector, item.rect.x, item.rect.documentY].join('|'), (item) => ({ id: item.id, page: item.page, selector: item.selector }));
  const flat = queue.filter((item) => !item.rect || !item.token || item.status === 'unavailable');
  group('queue-reference', flat, (item) => ['f', item.page, item.token, item.status, (item.sourceUrls || [])[0], item.source, item.selector, item.element?.tag, item.section?.tag, item.alt].join('|'), (item) => ({ id: item.id, page: item.page, source: item.source }));
  return found;
}

/**
 * Removes duplicates from a capture and returns the cleaned capture plus a report of everything that was collected.
 * Assets that are the same file are merged (their URLs, pages and associations are combined) and the queue is remapped to
 * the surviving asset before it is de-duplicated. The result is verified: anything left over is reported as `remaining`.
 */
function enforceUniqueCapture(capture, { normalizeRoute, dedupePlacements, origin } = {}) {
  const before = findCaptureDuplicates(capture, { normalizeRoute, origin });
  const report = { collected: { pages: [], assets: [], queue: 0 }, found: before.length, remaining: [] };

  // Pages: the first captured entry for a route wins; copies and "duplicate-route" records are removed.
  const rank = (page) => (page.captureStatus === 'captured' ? 0 : 1);
  const chosen = new Map();
  for (const page of capture.pages || []) {
    if (page.captureStatus === 'duplicate-route') { report.collected.pages.push({ path: page.path, duplicateOf: page.duplicateOf || null }); continue; }
    const key = pageKey(page, normalizeRoute, origin);
    const current = chosen.get(key);
    if (!current || rank(page) < rank(current)) {
      if (current) report.collected.pages.push({ path: current.path, duplicateOf: key });
      chosen.set(key, page);
    } else report.collected.pages.push({ path: page.path, duplicateOf: key });
  }
  const pages = (capture.pages || []).filter((page) => [...chosen.values()].includes(page));

  // Assets: one entry per distinct file (bytes), per public path, per token and per source URL.
  const kept = [];
  const remap = new Map(); // dropped token -> kept asset
  const owner = { bytes: new Map(), path: new Map(), token: new Map(), url: new Map() };
  const absorb = (target, asset) => {
    target.sourceUrls = unique([...(target.sourceUrls || []), ...(asset.sourceUrls || []), asset.url]);
    target.sourcePaths = unique([...(target.sourcePaths || []), ...(asset.sourcePaths || [])]);
    target.pages = unique([...(target.pages || []), ...(asset.pages || [])]);
    target.associations = [...(target.associations || []), ...(asset.associations || [])].slice(0, 100);
  };
  for (const asset of capture.assets || []) {
    const hash = assetBytesHash(asset);
    const existing = (hash && owner.bytes.get(hash)) || owner.path.get(asset.publicPath) || owner.token.get(asset.token)
      || (asset.sourceUrls || []).map((url) => owner.url.get(url)).find(Boolean);
    if (existing) {
      absorb(existing, asset);
      remap.set(asset.token, existing);
      report.collected.assets.push({ token: asset.token, publicPath: asset.publicPath, mergedInto: existing.publicPath });
      for (const url of existing.sourceUrls) owner.url.set(url, existing);
      continue;
    }
    const copy = { ...asset };
    kept.push(copy);
    if (hash) owner.bytes.set(hash, copy);
    if (copy.publicPath) owner.path.set(copy.publicPath, copy);
    if (copy.token) owner.token.set(copy.token, copy);
    for (const url of copy.sourceUrls || []) owner.url.set(url, copy);
  }

  // Queue: point every placement at the surviving asset, then keep one placement per spot / element / reference.
  const remapped = (capture.assetQueue || []).map((item) => {
    const target = remap.get(item.token);
    return target ? { ...item, token: target.token, publicPath: target.publicPath, mimeType: target.mimeType || item.mimeType } : item;
  });
  const idSeen = new Set();
  const identified = remapped.filter((item) => {
    if (item.id && idSeen.has(item.id)) return false;
    if (item.id) idSeen.add(item.id);
    return true;
  });
  const elementSeen = new Set();
  const byElement = dedupePlacements(identified).filter((item) => {
    if (!item.selector || !item.rect || !item.token || item.status === 'unavailable') return true;
    const key = [item.page, item.token, item.selector, item.rect.x, item.rect.documentY].join('|');
    if (elementSeen.has(key)) return false;
    elementSeen.add(key);
    return true;
  });
  const assetQueue = byElement.map((item, index) => ({ ...item, order: index }));
  report.collected.queue = (capture.assetQueue || []).length - assetQueue.length;
  const cleanedPages = pages.map((page) => ({ ...page, assetQueue: assetQueue.filter((item) => item.page === page.path) }));

  const cleaned = { ...capture, pages: cleanedPages, assets: kept, assetQueue };
  report.remaining = findCaptureDuplicates(cleaned, { normalizeRoute, origin });
  return { capture: cleaned, report };
}

function assertNoCaptureDuplicates(capture, options) {
  const remaining = findCaptureDuplicates(capture, options);
  if (remaining.length) {
    throw new Error(`Duplicate check failed: ${remaining.slice(0, 5).map((item) => `${item.kind} "${item.key}" x${item.count}`).join('; ')}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Generated project files
// ---------------------------------------------------------------------------------------------------------------------

const ASSET_FILE = /^(?:public|src\/assets)\/.+\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|pdf)$/i;
const SOURCE_FILE = /\.(?:jsx?|tsx?)$/i;
const TEXT_FILE = /\.(?:jsx?|tsx?|css|scss|html|json|md)$/i;
const textOf = (file) => (file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const bytesOf = (file) => Buffer.from(file.content || '', file.encoding === 'base64' ? 'base64' : 'utf8');
const referenceSuffix = (filePath) => filePath.replace(/^public\//, '').replace(/^src\//, '');

function routePaths(files) {
  const found = [];
  for (const file of files.filter((item) => SOURCE_FILE.test(item.path))) {
    for (const match of textOf(file).matchAll(/<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g)) {
      if (!match[1].startsWith('/')) continue; // relative child routes are only unique within their parent
      found.push({ path: (match[1].replace(/\/+$/, '') || '/').toLowerCase(), file: file.path });
    }
  }
  return found;
}

/** Lists duplicates in generated files that cannot be merged mechanically; each becomes an instruction for the repair model. */
function findProjectDuplicates(files) {
  const issues = [];
  const add = (kind, path, message) => issues.push({ category: 'duplicate', kind, path, message });
  const byLower = new Map();
  for (const file of files) (byLower.get(file.path.toLowerCase()) || byLower.set(file.path.toLowerCase(), []).get(file.path.toLowerCase())).push(file.path);
  for (const paths of byLower.values()) {
    if (paths.length > 1) add('path-case', paths[1], `Files ${paths.join(' and ')} differ only by letter case, which breaks on case-sensitive systems. Keep one, move its content there and update every import.`);
  }
  const routeCount = new Map();
  for (const route of routePaths(files)) (routeCount.get(route.path) || routeCount.set(route.path, []).get(route.path)).push(route.file);
  for (const [route, where] of routeCount) {
    if (where.length > 1) add('route', where[1], `The route "${route}" is registered ${where.length} times (${[...new Set(where)].join(', ')}). Register each route once.`);
  }
  const byContent = new Map();
  for (const file of files.filter((item) => SOURCE_FILE.test(item.path) && textOf(item).trim().length > 300)) {
    const key = sha256(textOf(file).replace(/\s+/g, ' ').trim());
    (byContent.get(key) || byContent.set(key, []).get(key)).push(file.path);
  }
  for (const paths of byContent.values()) {
    if (paths.length > 1) add('file-content', paths[1], `${paths.join(' and ')} have identical content. Keep one component and import it where needed instead of duplicating it.`);
  }
  return issues;
}

/**
 * Deterministically merges byte-identical asset files: the first path (sorted) stays, the others are deleted and every
 * reference to them is rewritten. Returns the new files and what was collected.
 */
function enforceUniqueProjectFiles(files) {
  const collected = [];
  const owners = new Map();
  const dropped = new Map(); // dropped path -> kept path
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!ASSET_FILE.test(file.path) || !file.content) continue;
    const key = `${file.path.split('.').pop().toLowerCase()}:${sha256(bytesOf(file))}`;
    if (owners.has(key)) { dropped.set(file.path, owners.get(key)); collected.push({ path: file.path, mergedInto: owners.get(key) }); } else owners.set(key, file.path);
  }
  if (!dropped.size) return { files, collected };
  const rewrite = (content) => {
    let result = content;
    for (const [from, to] of dropped) result = result.split(referenceSuffix(from)).join(referenceSuffix(to));
    return result;
  };
  const next = files.filter((file) => !dropped.has(file.path)).map((file) => {
    if (!TEXT_FILE.test(file.path) || file.encoding === 'base64' || typeof file.content !== 'string') return file;
    const content = rewrite(file.content);
    return content === file.content ? file : { ...file, content };
  });
  return { files: next, collected };
}

module.exports = {
  findCaptureDuplicates, enforceUniqueCapture, assertNoCaptureDuplicates,
  findProjectDuplicates, enforceUniqueProjectFiles, routePaths
};
