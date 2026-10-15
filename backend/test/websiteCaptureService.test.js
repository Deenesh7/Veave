const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress, normalizeRoute, validatePublicUrl, prioritizeDiscoveredRoutes, selectCapturedAssets, navigateForCapture, captureViewportScreenshot, analyzeRenderedPage, classifyPage, linkPriority, canonicalAssetIdentity, isTrackingAssetUrl, buildSiteMap, discoverSitemapLinks } = require('../src/services/clone/websiteCaptureService');

test('website clone URL policy rejects private and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.4.2', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('website clone URL validation allows only credential-free public HTTP URLs', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const privateLookup = async () => [{ address: '127.0.0.1', family: 4 }];
  assert.equal((await validatePublicUrl('https://example.com/path#section', publicLookup)).href, 'https://example.com/path');
  await assert.rejects(() => validatePublicUrl('file:///etc/passwd', publicLookup), /HTTP or HTTPS/);
  await assert.rejects(() => validatePublicUrl('https://user:secret@example.com', publicLookup), /credentials/);
  await assert.rejects(() => validatePublicUrl('https://internal.example', privateLookup), /private or reserved/);
});

test('website clone URL validation reports unresolvable hostnames clearly', async () => {
  const missingLookup = async () => {
    const error = new Error('getaddrinfo ENOTFOUND missing.example');
    error.code = 'ENOTFOUND';
    throw error;
  };

  await assert.rejects(
    () => validatePublicUrl('https://missing.example/path', missingLookup),
    /Website hostname could not be resolved: missing\.example/
  );
});

test('website route normalization keeps same-origin routes and removes tracking parameters', () => {
  assert.equal(
    normalizeRoute('/about?utm_source=test&tab=team#people', 'https://example.com'),
    'https://example.com/about?tab=team'
  );
  assert.equal(normalizeRoute('https://other.example/about', 'https://example.com'), null);
  assert.equal(normalizeRoute('mailto:test@example.com', 'https://example.com'), null);
  assert.equal(normalizeRoute('/about/?b=2&a=1&a=1#team', 'https://example.com'), 'https://example.com/about?a=1&b=2');
});

test('multi-page discovery prioritizes navigation, dropdowns, CTAs, footer, cards, and pagination', () => {
  assert.ok(linkPriority({ inNavigation: true }) < linkPriority({ inDropdown: true, inNavigation: true }) + 1);
  assert.ok(linkPriority({ isCta: true }) < linkPriority({ inFooter: true }));
  assert.ok(linkPriority({ inFooter: true }) < linkPriority({ inCard: true }));
  assert.ok(linkPriority({ inCard: true }) < linkPriority({ inPagination: true }));
});

test('captured pages are classified into reusable page families', () => {
  assert.equal(classifyPage({ path: '/', title: 'Welcome' }), 'landing');
  assert.equal(classifyPage({ path: '/about-us', title: 'Our History' }), 'about');
  assert.equal(classifyPage({ path: '/products/widget', title: 'Widget' }), 'product');
  assert.equal(classifyPage({ path: '/contact', title: 'Contact' }), 'contact');
  assert.equal(classifyPage({ path: '/news', title: 'Latest News' }), 'blog-listing');
});

test('site map preserves nested captured route hierarchy', () => {
  const map = buildSiteMap([
    { path: '/', title: 'Home', pageType: 'landing', captureStatus: 'captured' },
    { path: '/academics', title: 'Academics', pageType: 'category', captureStatus: 'captured' },
    { path: '/academics/phd', title: 'PhD', pageType: 'category', captureStatus: 'captured' },
    { path: '/restricted', title: 'Restricted', captureStatus: 'navigation-timeout' }
  ]);
  assert.equal(map.$page.path, '/');
  assert.equal(map.academics.$page.path, '/academics');
  assert.equal(map.academics.phd.$page.path, '/academics/phd');
  assert.equal(map.restricted, undefined);
});

test('sitemap discovery adds same-site crawl candidates', async () => {
  const page = {
    evaluate: async () => '<?xml version="1.0"?><urlset><url><loc>https://example.com/about</loc></url><url><loc>https://example.com/academics/phd?utm_source=map&amp;level=1</loc></url></urlset>'
  };
  const links = await discoverSitemapLinks(page, 'https://example.com', async () => true);
  assert.deepEqual(links.map((link) => link.href), ['https://example.com/about', 'https://example.com/academics/phd?utm_source=map&level=1']);
  assert.ok(links.every((link) => link.fromSitemap));
});

test('clone assets prioritize visible PNG and JPEG images and preserve metadata', () => {
  const candidates = [
    { url: 'https://cdn.example/icon.svg', mimeType: 'image/svg+xml', byteLength: 100, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { url: 'https://cdn.example/hero.jpg', mimeType: 'image/jpeg', byteLength: 200, dataUrl: 'data:image/jpeg;base64,aGVybw==' },
    { url: 'https://cdn.example/logo.png', mimeType: 'image/png', byteLength: 120, dataUrl: 'data:image/png;base64,bG9nbw==' }
  ];
  const visible = [
    { src: 'https://cdn.example/hero.jpg', alt: 'Campus hero', width: 1600, height: 900, pagePath: '/', selector: 'main > section.hero > img', section: { tag: 'section', heading: 'Welcome' }, source: 'currentSrc' },
    { src: 'https://cdn.example/logo.png', alt: 'University logo', width: 240, height: 240 }
  ];
  const selected = selectCapturedAssets(candidates, visible);

  assert.equal(selected[0].url, 'https://cdn.example/hero.jpg');
  assert.equal(selected[0].token, '__VEAVE_CLONE_ASSET_0__');
  assert.equal(selected[0].alt, 'Campus hero');
  assert.equal(selected[0].associations[0].selector, 'main > section.hero > img');
  assert.equal(selected[0].associations[0].section.heading, 'Welcome');
  assert.equal(selected[1].url, 'https://cdn.example/logo.png');
  assert.ok(selected.every((asset) => asset.dataUrl.startsWith('data:image/')));
});

test('S3-backed clone asset selection has no project binary budget', () => {
  const twoMiB = 2 * 1024 * 1024;
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    url: `https://cdn.example/image-${index}.webp`,
    mimeType: 'image/webp',
    byteLength: twoMiB,
    bodyBase64: 'unused'
  }));
  const selected = selectCapturedAssets(candidates, []);
  assert.equal(selected.length, 6);
});

test('S3-backed clone asset selection has no per-page binary budget', () => {
  const twoMiB = 2 * 1024 * 1024;
  const candidates = [0, 1].map((index) => ({
    url: `https://cdn.example/page-image-${index}.webp`,
    mimeType: 'image/webp',
    byteLength: twoMiB,
    bodyBase64: 'unused'
  }));
  const visible = candidates.map((asset) => ({ src: asset.url, pagePath: '/about' }));

  const selected = selectCapturedAssets(candidates, visible);

  assert.equal(selected.length, 2);
});

test('responsive CDN variants consume one logical asset slot', () => {
  const original = 'https://images.example.com/content/hero.png';
  const candidates = [300, 1000, 1500].map((width) => ({
    url: `${original}?format=${width}w`,
    mimeType: 'image/webp',
    byteLength: width,
    bodyBase64: 'unused'
  }));
  const selected = selectCapturedAssets(candidates, [{ src: candidates[2].url, width: 1500, height: 900 }]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].url, candidates[2].url);
  assert.deepEqual(selected[0].sourceUrls.sort(), candidates.map((item) => item.url).sort());
  assert.equal(canonicalAssetIdentity(candidates[0].url), canonicalAssetIdentity(candidates[2].url));
});

test('asset discovery excludes analytics and advertising pixels', () => {
  assert.equal(isTrackingAssetUrl('https://p.typekit.net/p.gif?s=2&k=test'), true);
  assert.equal(isTrackingAssetUrl('https://www.google.com/pagead/1p-user-list/123/?random=1'), true);
  assert.equal(isTrackingAssetUrl('https://www.google.co.in/ads/ga-audiences?v=1'), true);
  assert.equal(isTrackingAssetUrl('https://images.example.com/campus/hero.webp'), false);
});

test('route discovery prioritizes navbar pages and excludes transactional links', () => {
  const links = [
    { href: 'https://example.com/blog', text: 'Blog article', inNavigation: false },
    { href: 'https://example.com/cart', text: 'Cart', inNavigation: true },
    { href: 'https://example.com/about', text: 'About', inNavigation: true },
    { href: 'https://example.com/programs', text: 'Programs', inNavigation: true },
    { href: 'https://example.com/contact', text: 'Contact', inNavigation: false }
  ];
  assert.deepEqual(prioritizeDiscoveredRoutes(links, 'https://example.com', 3), [
    'https://example.com/about',
    'https://example.com/programs',
    'https://example.com/blog'
  ]);
});

test('clone navigation keeps committed pages when DOMContentLoaded hangs', async () => {
  const calls = [];
  const page = {
    goto: async (url, options) => calls.push(['goto', url, options]),
    waitForLoadState: async () => { throw new Error('DOMContentLoaded timeout'); },
    evaluate: async () => calls.push(['stop']),
    waitForTimeout: async (timeout) => calls.push(['wait', timeout]),
    url: () => 'https://example.com/'
  };

  const result = await navigateForCapture(page, 'https://example.com/');

  assert.deepEqual(calls[0], ['goto', 'https://example.com/', { waitUntil: 'commit', timeout: 30000 }]);
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.status, null);
  assert.equal(result.domContentLoaded, false);
  assert.ok(calls.some(([name]) => name === 'stop'));
});

test('clone navigation reports the committed response status', async () => {
  const page = {
    goto: async () => ({ status: () => 404 }),
    waitForLoadState: async () => {},
    url: () => 'https://example.com/404.html'
  };

  const result = await navigateForCapture(page, 'https://example.com/');

  assert.equal(result.status, 404);
  assert.equal(result.url, 'https://example.com/404.html');
});

test('initial clone navigation retries a commit timeout after stopping the page', async () => {
  const calls = [];
  let attempts = 0;
  const page = {
    goto: async (url, options) => {
      calls.push(['goto', url, options]);
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('page.goto: Timeout 45000ms exceeded.');
        error.name = 'TimeoutError';
        throw error;
      }
    },
    waitForLoadState: async () => {},
    evaluate: async () => calls.push(['stop']),
    waitForTimeout: async (timeout) => calls.push(['wait', timeout]),
    url: () => 'https://example.com/'
  };

  const result = await navigateForCapture(page, 'https://example.com/', {
    navigationTimeout: 45000,
    maxAttempts: 2
  });

  assert.equal(calls.filter(([name]) => name === 'goto').length, 2);
  assert.ok(calls.some(([name]) => name === 'stop'));
  assert.equal(result.domContentLoaded, true);
});

test('required screenshots fall back to the Chromium protocol after a Playwright timeout', async () => {
  const calls = [];
  const session = {
    send: async (method, options) => {
      calls.push([method, options]);
      return { data: Buffer.from('jpeg-data').toString('base64') };
    },
    detach: async () => calls.push(['detach'])
  };
  const page = {
    screenshot: async () => { throw new Error('screenshot timeout'); },
    context: () => ({ newCDPSession: async () => session })
  };

  const image = await captureViewportScreenshot(page, { quality: 74 });

  assert.equal(image.toString(), 'jpeg-data');
  assert.equal(calls[0][0], 'Page.captureScreenshot');
  assert.equal(calls[0][1].quality, 74);
  assert.deepEqual(calls.at(-1), ['detach']);
});

test('optional route screenshots can be skipped after a timeout', async () => {
  const page = {
    screenshot: async () => { throw new Error('screenshot timeout'); },
    context: () => { throw new Error('optional screenshots must not open a protocol session'); }
  };

  assert.equal(await captureViewportScreenshot(page, { optional: true }), null);
});

test('render analysis requests a bounded computed-style and geometry manifest', async () => {
  let argument;
  const expected = { visualElements: [{ style: { fontFamily: 'Source Sans' } }] };
  const page = {
    evaluate: async (callback, value) => {
      assert.equal(typeof callback, 'function');
      argument = value;
      return expected;
    }
  };

  assert.equal(await analyzeRenderedPage(page, { maxVisualElements: 175 }), expected);
  assert.deepEqual(argument, { maximumVisualElements: 175 });
});
