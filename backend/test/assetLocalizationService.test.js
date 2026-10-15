const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareLocalizedAssets,
  materializeLocalizedAssets,
  replaceAssetReferences,
  buildAssetPlacementQueue,
  localizeGeneratedRemoteImages,
  removeRemoteStylesheetImports,
  repairMissingLocalImageReferences,
  unresolvedAssetTokens,
  validateLocalizedAssetReferences,
  localizeInternalRouteLinks
} = require('../src/services/clone/assetLocalizationService');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test('localization deduplicates content and creates deterministic project paths', () => {
  const input = [
    { url: 'https://cdn.example/hero.png?width=1200', mimeType: 'image/png', byteLength: PNG.length, bodyBase64: PNG.toString('base64'), alt: 'Hero banner' },
    { url: 'https://cdn.example/hero-copy.png', mimeType: 'image/png', byteLength: PNG.length, bodyBase64: PNG.toString('base64'), alt: 'Hero banner' }
  ];
  const first = prepareLocalizedAssets(input);
  const second = prepareLocalizedAssets(input);

  assert.equal(first.length, 1);
  assert.equal(first[0].localPath, second[0].localPath);
  assert.match(first[0].localPath, /^public\/assets\/images\/backgrounds\/hero-[a-f0-9]{10}\.png$/);
  assert.deepEqual(first[0].sourceUrls, input.map((asset) => asset.url));
});

test('materialization rewrites tokens and remote URLs and emits an asset map', () => {
  const [asset] = prepareLocalizedAssets([
    { url: 'https://cdn.example/logo.png', mimeType: 'image/png', byteLength: PNG.length, bodyBase64: PNG.toString('base64'), alt: 'Company logo', associations: [{ page: '/', section: { tag: 'header' }, selector: 'header img', source: 'currentSrc' }] }
  ]);
  const files = materializeLocalizedAssets([
    { path: 'src/components/Header.jsx', content: `export default () => <img src="${asset.token}" />`, language: 'javascript' },
    { path: 'src/styles.css', content: `body { background-image: url("${asset.url}"); }`, language: 'css' }
  ], [asset]);

  assert.ok(files.some((file) => file.path === asset.localPath && file.encoding === 'base64'));
  assert.ok(files.some((file) => file.path === 'src/assets/asset-map.json'));
  assert.ok(files.filter((file) => file.path !== 'src/assets/asset-map.json' && (!file.encoding || file.encoding === 'utf8')).every((file) => !String(file.content).includes('cdn.example')));
  assert.deepEqual(unresolvedAssetTokens(files), []);
  const manifest = JSON.parse(files.find((file) => file.path === 'src/assets/asset-map.json').content);
  assert.deepEqual(manifest.assets[0].usedBy.sort(), ['src/components/Header.jsx', 'src/styles.css']);
  assert.equal(manifest.assets[0].associations[0].selector, 'header img');
});

test('only exact captured remote images are localized without changing links', () => {
  const assets = [
    { publicPath: '/assets/images/campus.webp', mimeType: 'image/webp', pages: ['/infrastructure'], sourceUrls: ['https://source.example/campus.webp'] },
    { publicPath: '/assets/images/logo.png', mimeType: 'image/png', pages: ['/'], sourceUrls: ['https://source.example/logo.png'] }
  ];
  const remote = 'https://source.example/campus.webp';
  const [file] = localizeGeneratedRemoteImages([{
    path: 'src/pages/Infrastructure.jsx',
    content: `export const href = "${remote}"; export default () => <main><a href="${remote}">Link</a><img src="${remote}" /><div style={{ backgroundImage: "url(${remote})" }} /></main>;`
  }], assets, '/infrastructure');

  assert.match(file.content, /<img src="\/assets\/images\/campus\.webp"/);
  assert.match(file.content, /url\(\/assets\/images\/campus\.webp\)/);
  assert.match(file.content, new RegExp(`<a href="${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`));
});

test('remote stylesheet imports are removed before asset validation', () => {
  const files = removeRemoteStylesheetImports([
    {
      path: 'src/styles.css',
      content: '@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Roboto:wght@400;500;700&family=Raleway:wght@700&family=Playfair+Display:ital,wght@1,700&family=Inter:wght@400;500;600;700;800&display=swap");\n@import "https://cdn.example/theme.css";\nbody { font-family: Poppins, sans-serif; }'
    },
    {
      path: 'src/App.jsx',
      content: 'export default () => <a href="https://example.com">Example</a>;'
    }
  ]);

  assert.equal(files[0].content.trim(), 'body { font-family: Poppins, sans-serif; }');
  assert.match(files[1].content, /https:\/\/example\.com/);
  assert.deepEqual(validateLocalizedAssetReferences(files), { missing: [], remote: [] });
});

test('missing local image paths are removed without substituting unrelated assets', () => {
  const assets = [{
    localPath: 'public/assets/images/media-campus.webp',
    publicPath: '/assets/images/media-campus.webp',
    mimeType: 'image/webp',
    pages: ['/mediacoverage']
  }];
  const files = repairMissingLocalImageReferences([
    {
      path: 'src/pages/MediaCoverage.jsx',
      content: 'export default () => <><img src="/assets/images/missing-story.webp" /><a href="/assets/images/download.pdf">Download</a></>;'
    },
    {
      path: assets[0].localPath,
      content: 'UklGRgAAAABXRUJQ',
      encoding: 'base64'
    }
  ], assets, '/mediacoverage');

  assert.match(files[0].content, /<img src=""/);
  assert.match(files[0].content, /<a href="\/assets\/images\/download\.pdf"/);
});

test('localization rejects corrupt content with a spoofed MIME type', () => {
  assert.deepEqual(prepareLocalizedAssets([{
    url: 'https://cdn.example/not-an-image.png',
    mimeType: 'image/png',
    byteLength: 4,
    bodyBase64: Buffer.from('nope').toString('base64')
  }]), []);
});

test('localization preserves captured web fonts as project assets', () => {
  const woff2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(24)]);
  const [font] = prepareLocalizedAssets([{
    url: 'https://fonts.example/source-serif.woff2',
    mimeType: 'font/woff2',
    byteLength: woff2.length,
    bodyBase64: woff2.toString('base64')
  }]);

  assert.match(font.localPath, /^public\/assets\/fonts\/source-serif-[a-f0-9]{10}\.woff2$/);
  assert.equal(font.publicPath, `/${font.localPath.slice('public/'.length)}`);
});

test('captured internal destinations are rewritten to local application routes', () => {
  const files = localizeInternalRouteLinks([{
    path: 'src/navigation.js',
    content: 'export const links = ["https://example.com/about/", "https://example.com/contact"]'
  }], {
    pages: [
      { url: 'https://example.com/about/', path: '/about', captureStatus: 'captured' },
      { url: 'https://example.com/contact', path: '/contact', captureStatus: 'captured' }
    ]
  });
  assert.equal(files[0].content, 'export const links = ["/about", "/contact"]');
});

test('asset validation reports missing local files and remote visual references', () => {
  const diagnostics = validateLocalizedAssetReferences([
    { path: 'src/Page.jsx', content: 'export default () => <><img src="/assets/images/missing.png" /><img src="https://cdn.example/remote.jpg" /></>;' },
    { path: 'src/styles.css', content: '.hero { background: url("/assets/images/present.png") }' },
    { path: 'public/assets/images/present.png', content: PNG.toString('base64'), encoding: 'base64' }
  ]);
  assert.deepEqual(diagnostics.missing, [{ file: 'src/Page.jsx', reference: '/assets/images/missing.png' }]);
  assert.deepEqual(diagnostics.remote, [{ file: 'src/Page.jsx', reference: 'https://cdn.example/remote.jpg' }]);
});

test('source-relative CSS asset paths resolve to their exact localized files', () => {
  const [asset] = prepareLocalizedAssets([{
    url: 'https://www.saveetha.ac.in/wp-content/uploads/2024/03/shape.png',
    mimeType: 'image/png',
    byteLength: PNG.length,
    bodyBase64: PNG.toString('base64'),
    pages: ['/'],
    associations: [{ page: '/', section: { tag: 'section', heading: 'Programs' }, selector: '.programs', source: 'css-rule', rect: { documentY: 900 } }]
  }]);
  const queue = buildAssetPlacementQueue([asset], [{ path: '/' }]);
  const files = materializeLocalizedAssets([{
    path: 'src/styles.css',
    content: '.programs::before { background-image: url("/assets/shape.png"); }'
  }], [asset], queue);

  assert.match(files.find((file) => file.path === 'src/styles.css').content, new RegExp(asset.publicPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(validateLocalizedAssetReferences(files), { missing: [], remote: [] });
  const manifest = JSON.parse(files.find((file) => file.path === 'src/assets/asset-map.json').content);
  assert.deepEqual(manifest.assets[0].referencePaths, ['/wp-content/uploads/2024/03/shape.png']);
  assert.ok(manifest.assets[0].referenceAliases.includes('/assets/shape.png'));
  assert.equal(manifest.placementQueue[0].status, 'applied');
  assert.deepEqual(manifest.placementQueue[0].usedBy, ['src/styles.css']);
  assert.deepEqual(unresolvedAssetTokens(files), []);
});

test('asset placement queue follows page and section document order', () => {
  const assets = [
    { token: 'second', publicPath: '/assets/second.png', sourceUrls: [], sourcePaths: [], mimeType: 'image/png', pages: ['/'], associations: [{ page: '/', selector: '.second', rect: { documentY: 800 } }] },
    { token: 'first', publicPath: '/assets/first.png', sourceUrls: [], sourcePaths: [], mimeType: 'image/png', pages: ['/'], associations: [{ page: '/', selector: '.first', rect: { documentY: 100 } }] },
    { token: 'about', publicPath: '/assets/about.png', sourceUrls: [], sourcePaths: [], mimeType: 'image/png', pages: ['/about'], associations: [{ page: '/about', selector: '.about', rect: { documentY: 50 } }] }
  ];
  const queue = buildAssetPlacementQueue(assets, [{ path: '/' }, { path: '/about' }]);
  assert.deepEqual(queue.map(({ token, order }) => ({ token, order })), [
    { token: 'first', order: 0 },
    { token: 'second', order: 1 },
    { token: 'about', order: 2 }
  ]);
});

test('basename aliases are not applied when multiple scraped assets share the same name', () => {
  const assets = [
    { token: '__VEAVE_CLONE_ASSET_0__', publicPath: '/assets/a.png', sourceUrls: ['https://one.example/images/shape.png'], sourcePaths: ['/images/shape.png'] },
    { token: '__VEAVE_CLONE_ASSET_1__', publicPath: '/assets/b.png', sourceUrls: ['https://two.example/decor/shape.png'], sourcePaths: ['/decor/shape.png'] }
  ];
  assert.equal(replaceAssetReferences('url("/assets/shape.png")', assets), 'url("/assets/shape.png")');
});

test('asset queue tokens in the generated manifest are metadata, not unresolved runtime references', () => {
  assert.deepEqual(unresolvedAssetTokens([{
    path: 'src/assets/asset-map.json',
    content: JSON.stringify({ placementQueue: [{ token: '__VEAVE_CLONE_ASSET_4__', status: 'pending' }] })
  }]), []);
  assert.deepEqual(unresolvedAssetTokens([{
    path: 'src/Page.jsx',
    content: 'export default () => <img src="__VEAVE_CLONE_ASSET_4__" />'
  }]), ['src/Page.jsx']);
});
