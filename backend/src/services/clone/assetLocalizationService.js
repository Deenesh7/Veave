const { createHash } = require('node:crypto');
const path = require('node:path').posix;

const MIME_TYPES = {
  'image/png': { extension: 'png', signature: (body) => body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { extension: 'jpg', signature: (body) => body[0] === 0xff && body[1] === 0xd8 },
  'image/webp': { extension: 'webp', signature: (body) => body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP' },
  'image/gif': { extension: 'gif', signature: (body) => /^GIF8[79]a$/.test(body.subarray(0, 6).toString('ascii')) },
  'image/avif': { extension: 'avif', signature: (body) => body.subarray(4, 12).toString('ascii').includes('ftyp') },
  'image/svg+xml': { extension: 'svg', signature: (body) => /<svg(?:\s|>)/i.test(body.toString('utf8', 0, Math.min(body.length, 2048))) },
  'image/x-icon': { extension: 'ico', signature: (body) => body.length > 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0 },
  'image/vnd.microsoft.icon': { extension: 'ico', signature: (body) => body.length > 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0 },
  'font/woff2': { extension: 'woff2', signature: (body) => body.subarray(0, 4).toString('ascii') === 'wOF2' },
  'font/woff': { extension: 'woff', signature: (body) => body.subarray(0, 4).toString('ascii') === 'wOFF' },
  'application/font-woff': { extension: 'woff', signature: (body) => body.subarray(0, 4).toString('ascii') === 'wOFF' },
  'font/ttf': { extension: 'ttf', signature: (body) => body.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || body.subarray(0, 4).toString('ascii') === 'true' },
  'application/x-font-ttf': { extension: 'ttf', signature: (body) => body.subarray(0, 4).equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || body.subarray(0, 4).toString('ascii') === 'true' },
  'font/otf': { extension: 'otf', signature: (body) => body.subarray(0, 4).toString('ascii') === 'OTTO' }
};

function decodeDataUrl(value, mimeType) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match || match[1].toLowerCase() !== mimeType) return null;
  return Buffer.from(match[2].replace(/\s/g, ''), 'base64');
}

function slug(value) {
  return decodeURIComponent(value || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48) || 'asset';
}

function assetCategory(asset) {
  if (/^(?:font|application\/(?:font-woff|x-font-ttf))/.test(asset.mimeType || '')) return 'fonts';
  const description = `${asset.url || ''} ${asset.alt || ''}`.toLowerCase();
  if (/favicon/.test(description)) return 'icons';
  if (/logo|brand|wordmark/.test(description)) return 'logos';
  if (/icon|sprite/.test(description) || asset.mimeType === 'image/svg+xml') return 'icons';
  if (/background|\bbg\b|hero|banner/.test(description)) return 'images/backgrounds';
  return 'images';
}

function sourcePathReferences(urls = []) {
  const references = [];
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      references.push(`${url.pathname}${url.search}`);
      if (url.search) references.push(url.pathname);
    } catch { /* Data URLs do not have source-relative aliases. */ }
  }
  return [...new Set(references)];
}

function assetReferenceAliases(asset) {
  const aliases = [...(asset.sourcePaths || sourcePathReferences(asset.sourceUrls))];
  for (const sourcePath of asset.sourcePaths || []) {
    const basename = path.basename(sourcePath.split('?')[0]);
    if (basename) aliases.push(`/assets/${basename}`);
  }
  return [...new Set(aliases)];
}

function prepareLocalizedAssets(assets = []) {
  const byHash = new Map();
  for (const asset of assets) {
    const type = MIME_TYPES[asset.mimeType];
    if (!type) continue;
    const body = asset.bodyBase64 ? Buffer.from(asset.bodyBase64, 'base64') : decodeDataUrl(asset.dataUrl, asset.mimeType);
    if (!body?.length || !type.signature(body)) continue;
    const hash = createHash('sha256').update(body).digest('hex');
    const existing = byHash.get(hash);
    if (existing) {
      existing.sourceUrls = [...new Set([...existing.sourceUrls, ...(asset.sourceUrls || []), asset.url].filter(Boolean))];
      existing.sourcePaths = sourcePathReferences(existing.sourceUrls);
      existing.pages = [...new Set([...(existing.pages || []), ...(asset.pages || [])])];
      existing.associations = [...(existing.associations || []), ...(asset.associations || [])].slice(0, 100);
      continue;
    }
    let basename = 'asset';
    try { basename = path.basename(new URL(asset.url).pathname); } catch { /* Data URLs use a generic name. */ }
    const localPath = `public/assets/${assetCategory(asset)}/${slug(basename)}-${hash.slice(0, 10)}.${type.extension}`;
    byHash.set(hash, {
      ...asset,
      hash,
      sourceUrls: [...new Set(asset.sourceUrls || [asset.url])],
      sourcePaths: sourcePathReferences(asset.sourceUrls || [asset.url]),
      localPath,
      publicPath: `/${localPath.slice('public/'.length)}`,
      content: body.toString('base64'),
      encoding: 'base64'
    });
  }
  return [...byHash.values()].map((asset, index) => ({ ...asset, token: `__VEAVE_CLONE_ASSET_${index}__` }));
}

function replaceAssetReferences(content, assets) {
  let result = String(content || '');
  const pathOwners = new Map();
  for (const asset of assets) {
    for (const sourcePath of assetReferenceAliases(asset)) {
      if (!pathOwners.has(sourcePath)) pathOwners.set(sourcePath, new Set());
      pathOwners.get(sourcePath).add(asset.publicPath);
    }
  }
  for (const asset of assets) {
    result = result.split(asset.token).join(asset.publicPath);
    for (const sourceUrl of asset.sourceUrls) result = result.split(sourceUrl).join(asset.publicPath);
    for (const sourcePath of assetReferenceAliases(asset)) {
      if (pathOwners.get(sourcePath)?.size === 1) result = result.split(sourcePath).join(asset.publicPath);
    }
  }
  return result;
}

function buildAssetPlacementQueue(assets = [], pages = []) {
  const pageOrder = new Map(pages.map((page, index) => [page.path, index]));
  const queue = [];
  for (const asset of assets) {
    const associations = asset.associations?.length
      ? asset.associations
      : (asset.pages?.length
        ? asset.pages.map((page) => ({ page, section: null, selector: null, source: 'page-resource', rect: null, style: null }))
        : [{ page: null, section: null, selector: null, source: 'shared-resource', rect: null, style: null }]);
    for (const association of associations) {
      queue.push({
        id: `${asset.token}:${queue.length}`,
        order: 0,
        status: 'pending',
        token: asset.token,
        publicPath: asset.publicPath,
        sourceUrls: asset.sourceUrls,
        sourcePaths: asset.sourcePaths || sourcePathReferences(asset.sourceUrls),
        mimeType: asset.mimeType,
        alt: association.alt || asset.alt || '',
        width: asset.width || null,
        height: asset.height || null,
        page: association.page || asset.pages?.[0] || null,
        section: association.section || null,
        element: association.element || null,
        selector: association.selector || null,
        source: association.source || null,
        rect: association.rect || null,
        style: association.style || null
      });
    }
  }
  queue.sort((a, b) => {
    const pageDifference = (pageOrder.get(a.page) ?? Number.MAX_SAFE_INTEGER) - (pageOrder.get(b.page) ?? Number.MAX_SAFE_INTEGER);
    if (pageDifference) return pageDifference;
    const yDifference = (a.rect?.documentY ?? Number.MAX_SAFE_INTEGER) - (b.rect?.documentY ?? Number.MAX_SAFE_INTEGER);
    if (yDifference) return yDifference;
    return String(a.selector || a.publicPath).localeCompare(String(b.selector || b.publicPath));
  });
  return queue.map((item, index) => ({ ...item, order: index }));
}

function materializeLocalizedAssets(files = [], assets = [], placementQueue = []) {
  if (!assets.length) return files;
  const sourceFiles = files.map((file) => file.encoding === 'base64'
    ? file
    : { ...file, content: replaceAssetReferences(file.content, assets) });
  const mappings = assets.map((asset) => ({
    referenceUrls: asset.sourceUrls,
    referencePaths: asset.sourcePaths || sourcePathReferences(asset.sourceUrls),
    referenceAliases: assetReferenceAliases(asset),
    localFile: asset.localPath,
    publicPath: asset.publicPath,
    mimeType: asset.mimeType,
    width: asset.width || null,
    height: asset.height || null,
    pages: asset.pages || [],
    associations: asset.associations || [],
    usedBy: sourceFiles.filter((file) => file.encoding !== 'base64' && String(file.content).includes(asset.publicPath)).map((file) => file.path)
  }));
  const binaryFiles = assets.map((asset) => ({
    path: asset.localPath,
    content: asset.content,
    encoding: 'base64',
    language: 'binary'
  }));
  const manifest = {
    path: 'src/assets/asset-map.json',
    content: JSON.stringify({
      generatedAt: new Date().toISOString(),
      assets: mappings,
      placementQueue: placementQueue.map((item) => {
        const usedBy = sourceFiles
          .filter((file) => item.publicPath && file.encoding !== 'base64' && String(file.content).includes(item.publicPath))
          .map((file) => file.path);
        return { ...item, status: item.status === 'unavailable' ? 'unavailable' : (usedBy.length ? 'applied' : 'pending'), usedBy };
      })
    }, null, 2),
    language: 'json'
  };
  const replacedPaths = new Set([...binaryFiles, manifest].map((file) => file.path));
  return [...sourceFiles.filter((file) => !replacedPaths.has(file.path)), ...binaryFiles, manifest];
}

function localizeGeneratedRemoteImages(files = [], assets = [], pagePath = '/') {
  const pageAssets = assets.filter((asset) => asset.publicPath && /^image\//i.test(asset.mimeType || '') && asset.pages?.includes(pagePath));
  const imageAssets = pageAssets.length
    ? pageAssets
    : assets.filter((asset) => asset.publicPath && /^image\//i.test(asset.mimeType || ''));
  if (!imageAssets.length) return files;

  const localPathFor = (remoteUrl) => {
    const captured = assets.find((asset) => asset.publicPath && (asset.url === remoteUrl || asset.sourceUrls?.includes(remoteUrl)));
    if (captured) return captured.publicPath;
    return remoteUrl;
  };

  return files.map((file) => {
    if (file.encoding === 'base64') return file;
    let content = String(file.content || '');
    content = content.replace(/(\b(?:src|poster)\s*=\s*["'])(https?:\/\/[^"']+)(["'])/gi, (_, before, url, after) => `${before}${localPathFor(url)}${after}`);
    content = content.replace(/(\b(?:src|poster)\s*=\s*\{\s*["'])(https?:\/\/[^"']+)(["']\s*\})/gi, (_, before, url, after) => `${before}${localPathFor(url)}${after}`);
    content = content.replace(/(\b(?:src|image|imageUrl|thumbnail|backgroundImage)\s*:\s*["'])(https?:\/\/[^"']+)(["'])/gi, (_, before, url, after) => `${before}${localPathFor(url)}${after}`);
    content = content.replace(/(url\(\s*["']?)(https?:\/\/[^"')\s]+)(["']?\s*\))/gi, (_, before, url, after) => `${before}${localPathFor(url)}${after}`);
    return { ...file, content };
  });
}

function removeRemoteStylesheetImports(files = []) {
  return files.map((file) => {
    if (file.encoding === 'base64' || !/\.(?:css|scss|sass|less)$/i.test(file.path || '')) return file;
    const content = String(file.content || '')
      .replace(/@import\s+(?:url\(\s*)?(["'])https?:\/\/.*?\1\s*\)?\s*;/gi, '')
      .replace(/@import\s+url\(\s*https?:\/\/[^)\s]+\s*\)\s*;/gi, '')
      .replace(/@import\s+(?:url\(\s*(?:(['"])\s*\1|)\s*\)|(['"])\s*\2)\s*;?/gi, '');
    return content === file.content ? file : { ...file, content };
  });
}

function repairMissingLocalImageReferences(files = [], assets = [], pagePath = '/') {
  const availablePaths = new Set(files
    .filter((file) => file.encoding === 'base64' && file.path?.startsWith('public/'))
    .map((file) => `/${file.path.slice('public/'.length)}`));
  const validPathFor = (localPath) => {
    if (availablePaths.has(localPath)) return localPath;
    // Never preserve an invented path or substitute an unrelated image.
    return '';
  };

  return files.map((file) => {
    if (file.encoding === 'base64' || file.path === 'src/assets/asset-map.json') return file;
    let content = String(file.content || '');
    content = content.replace(/(\b(?:src|poster)\s*=\s*["'])(\/assets\/[^"']+)(["'])/gi, (_, before, localPath, after) => `${before}${validPathFor(localPath)}${after}`);
    content = content.replace(/(\b(?:src|poster)\s*=\s*\{\s*["'])(\/assets\/[^"']+)(["']\s*\})/gi, (_, before, localPath, after) => `${before}${validPathFor(localPath)}${after}`);
    content = content.replace(/(\b(?:src|image|imageUrl|thumbnail|backgroundImage)\s*:\s*["'])(\/assets\/[^"']+)(["'])/gi, (_, before, localPath, after) => `${before}${validPathFor(localPath)}${after}`);
    content = content.replace(/(url\(\s*["']?)(\/assets\/[^"')\s]+)(["']?\s*\))/gi, (_, before, localPath, after) => `${before}${validPathFor(localPath)}${after}`);
    return { ...file, content };
  });
}

function unresolvedAssetTokens(files = []) {
  return files
    .filter((file) => file.encoding !== 'base64' && file.path !== 'src/assets/asset-map.json' && /__VEAVE_CLONE_ASSET_\d+__/.test(String(file.content || '')))
    .map((file) => file.path);
}

function validateLocalizedAssetReferences(files = []) {
  const available = new Set(files
    .filter((file) => file.path?.startsWith('public/assets/'))
    .map((file) => `/${file.path.slice('public/'.length)}`));
  const missing = [];
  const remote = [];
  for (const file of files) {
    if (file.encoding === 'base64' || file.path === 'src/assets/asset-map.json') continue;
    const content = String(file.content || '');
    for (const match of content.matchAll(/\/assets\/[^\s"'`)},;]+/g)) {
      const publicPath = match[0].split(/[?#]/)[0];
      if (!available.has(publicPath)) missing.push({ file: file.path, reference: publicPath });
    }
    const patterns = [
      /\b(?:src|poster)\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
      /\b(?:src|poster)\s*=\s*\{\s*["'](https?:\/\/[^"']+)["']\s*\}/gi,
      /url\(\s*["']?(https?:\/\/[^"')\s]+)["']?\s*\)/gi
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) remote.push({ file: file.path, reference: match[1] });
    }
  }
  const unique = (items) => [...new Map(items.map((item) => [`${item.file}\u0000${item.reference}`, item])).values()];
  return { missing: unique(missing), remote: unique(remote) };
}

function localizeInternalRouteLinks(files = [], capture = {}) {
  const replacements = new Map();
  for (const page of capture.pages || []) {
    if (page.captureStatus !== 'captured' || !page.url || !page.path) continue;
    replacements.set(page.url, page.path);
    try {
      const parsed = new URL(page.url);
      replacements.set(`${parsed.origin}${parsed.pathname}${parsed.search}`, page.path);
      if (parsed.pathname !== '/') replacements.set(`${parsed.origin}${parsed.pathname}/${parsed.search}`, page.path);
    } catch { /* Capture URLs are validated before this stage. */ }
  }
  const ordered = [...replacements.entries()].sort((a, b) => b[0].length - a[0].length);
  return files.map((file) => {
    if (file.encoding === 'base64' || file.path === 'src/assets/asset-map.json') return file;
    let content = String(file.content || '');
    for (const [remoteUrl, localPath] of ordered) content = content.split(remoteUrl).join(localPath);
    return { ...file, content };
  });
}

module.exports = { MIME_TYPES, prepareLocalizedAssets, materializeLocalizedAssets, replaceAssetReferences, buildAssetPlacementQueue, localizeGeneratedRemoteImages, removeRemoteStylesheetImports, repairMissingLocalImageReferences, unresolvedAssetTokens, validateLocalizedAssetReferences, localizeInternalRouteLinks };
