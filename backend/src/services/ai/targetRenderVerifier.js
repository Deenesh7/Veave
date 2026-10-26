const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const Babel = require('@babel/standalone');
const sharp = require('sharp');
const { launchChromium } = require('../browser/launchChromium');
const { compareScreenshot } = require('../../../runner/visualComparison.cjs');

let transformerPromise;
let runtimeAssets;
let previewCssCompiler;
const frontendRoot = path.resolve(__dirname, '../../../../frontend');

function loadTransformer() {
  if (!transformerPromise) {
    const transformerPath = path.join(frontendRoot, 'src/utils/codeTransformer.js');
    transformerPromise = import(pathToFileURL(transformerPath).href);
  }
  return transformerPromise;
}

function loadRuntimeAssets() {
  if (!runtimeAssets) {
    const frontendModules = path.join(frontendRoot, 'node_modules');
    runtimeAssets = {
      react: fs.readFileSync(path.join(frontendModules, 'react/umd/react.development.js')),
      reactDom: fs.readFileSync(path.join(frontendModules, 'react-dom/umd/react-dom.development.js')),
      babel: fs.readFileSync(require.resolve('@babel/standalone/babel.min.js'))
    };
  }
  return runtimeAssets;
}

async function buildOfflinePreviewHTMLInProcess(files, headMarkup = '') {
  // Shared compiler (see services/preview/offlineCompile.js): Tailwind scans source only, not embedded assets.
  return require('../preview/offlineCompile').compileOffline(files, { headMarkup, sourceMaps: 'inline' });
}

const previewHtmlCache = new Map();
const inFlightPreviewBuilds = new Map();
const MAX_PREVIEW_CACHE_ENTRIES = 12;

function computePreviewCacheKey(files = [], headMarkup = '') {
  const hash = createHash('sha256');
  hash.update(String(headMarkup || ''));
  for (const file of files) {
    if (!file) continue;
    hash.update(`\0${file.path || ''}\0${file.encoding || 'utf8'}\0`);
    hash.update(String(file.content || ''));
  }
  return hash.digest('hex');
}

function buildOfflinePreviewHTMLUncached(files, headMarkup = '') {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { task: 'build-offline-preview', files, headMarkup }
    });
    let settled = false;
    worker.once('message', (message) => {
      settled = true;
      if (message.ok) {
        resolve(message.html);
      } else {
        const error = new Error(message.error?.message || 'Offline preview compilation failed.');
        Object.assign(error, message.error);
        reject(error);
      }
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`Offline preview compiler exited with code ${code}.`));
    });
  });
}

function buildOfflinePreviewHTML(files, headMarkup = '') {
  const cacheKey = computePreviewCacheKey(files, headMarkup);
  if (previewHtmlCache.has(cacheKey)) {
    const cached = previewHtmlCache.get(cacheKey);
    previewHtmlCache.delete(cacheKey);
    previewHtmlCache.set(cacheKey, cached);
    return Promise.resolve(cached);
  }
  if (inFlightPreviewBuilds.has(cacheKey)) return inFlightPreviewBuilds.get(cacheKey);
  const build = buildOfflinePreviewHTMLUncached(files, headMarkup)
    .then((html) => {
      previewHtmlCache.set(cacheKey, html);
      while (previewHtmlCache.size > MAX_PREVIEW_CACHE_ENTRIES) previewHtmlCache.delete(previewHtmlCache.keys().next().value);
      return html;
    })
    .finally(() => inFlightPreviewBuilds.delete(cacheKey));
  inFlightPreviewBuilds.set(cacheKey, build);
  return build;
}

// One browser process is shared by every check and closed shortly after the last one finishes.
let sharedBrowser = null;
let sharedBrowserOpening = null;
let idleBrowserTimer = null;
let activeBrowserContexts = 0;
const MAX_CONCURRENT_CONTEXTS = Math.max(1, Number.parseInt(process.env.PREVIEW_BROWSER_CONTEXTS, 10) || 4);
const contextWaitQueue = [];

async function getSharedBrowser() {
  if (idleBrowserTimer) {
    clearTimeout(idleBrowserTimer);
    idleBrowserTimer = null;
  }
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  if (sharedBrowserOpening) return sharedBrowserOpening;
  sharedBrowserOpening = launchChromium({ browserType: chromium })
    .then((browser) => {
      sharedBrowser = browser;
      sharedBrowserOpening = null;
      browser.on('disconnected', () => {
        if (sharedBrowser === browser) sharedBrowser = null;
      });
      return browser;
    })
    .catch((err) => {
      sharedBrowserOpening = null;
      throw err;
    });
  return sharedBrowserOpening;
}

function scheduleIdleBrowserClose() {
  if (activeBrowserContexts > 0 || idleBrowserTimer) return;
  idleBrowserTimer = setTimeout(() => {
    idleBrowserTimer = null;
    if (activeBrowserContexts === 0 && sharedBrowser) {
      const browserToClose = sharedBrowser;
      sharedBrowser = null;
      browserToClose.close().catch(() => {});
    }
  }, 600);
  if (typeof idleBrowserTimer.unref === 'function') idleBrowserTimer.unref();
}

async function acquireSharedBrowser() {
  const browser = await getSharedBrowser();
  activeBrowserContexts += 1;
  return browser;
}

function releaseSharedBrowser(browser) {
  if (!browser) return;
  activeBrowserContexts = Math.max(0, activeBrowserContexts - 1);
  scheduleIdleBrowserClose();
}

async function withSharedBrowserContext(contextOptions, fn) {
  if (activeBrowserContexts >= MAX_CONCURRENT_CONTEXTS) {
    await new Promise((resolve) => contextWaitQueue.push(resolve));
  }
  activeBrowserContexts += 1;
  let context;
  try {
    const browser = await getSharedBrowser();
    context = await browser.newContext(contextOptions);
    return await fn(context);
  } finally {
    await context?.close().catch(() => {});
    activeBrowserContexts -= 1;
    if (contextWaitQueue.length > 0) {
      const next = contextWaitQueue.shift();
      next();
    } else {
      scheduleIdleBrowserClose();
    }
  }
}

async function routeLocalPreviewDependencies(context, previewHtml = '') {
  const assets = loadRuntimeAssets();
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (previewHtml && url.hostname === 'preview.local' && route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: previewHtml });
    } else if (url.hostname === 'unpkg.com' && /^\/react@/i.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: assets.react });
    } else if (url.hostname === 'unpkg.com' && /^\/react-dom@/i.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: assets.reactDom });
    } else if (url.hostname === 'unpkg.com' && /\/babel(?:\.min)?\.js$/i.test(url.pathname)) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: assets.babel });
    } else if (url.hostname === 'cdn.tailwindcss.com') {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || { config: {} };' });
    } else if (url.hostname === 'fonts.googleapis.com') {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    } else if (['data:', 'blob:', 'about:'].includes(url.protocol)) {
      await route.continue();
    } else {
      await route.abort('blockedbyclient');
    }
  });
}

// The preview shim keeps a virtual pathname that always starts at "/". Seed it with the route under
// test so apps that read location.pathname render that route instead of Home.
function seedPreviewRoute(html, routePath = '/') {
  const route = String(routePath || '/').startsWith('/') ? String(routePath || '/') : '/';
  return html.replace("var virtualPath = '/';", `var virtualPath = ${JSON.stringify(route.split(/[?#]/)[0] || '/')};`);
}
async function verifyPreviewRuntime(files, { signal, routePath = '/', expectedHeading = '', minimumTextLength = 0, expectedColors = [] } = {}) {
  signal?.throwIfAborted();
  const monitor = `<script>
    window.__veaveRuntimeEvents = [];
    window.addEventListener('message', function(event) {
      if (event.data && (event.data.type === 'preview-error' || event.data.type === 'preview-rendered')) {
        window.__veaveRuntimeEvents.push(event.data);
      }
    });
  <\/script>`;
  let html;
  try {
    html = seedPreviewRoute(await buildOfflinePreviewHTML(files, monitor), routePath);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [{
        category: 'preview-transform',
        path: error.filePath || null,
        line: error.loc?.line || null,
        message: error.message
      }],
      checks: [{ name: 'preview-transform', status: 'failed' }],
      coverage: { exhaustive: false }
    };
  }
  let browser;
  try {
    browser = await acquireSharedBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await routeLocalPreviewDependencies(context, html);
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const firstPageError = new Promise((resolve) => page.once('pageerror', resolve));
    const previewRoute = String(routePath || '/').startsWith('/') ? String(routePath || '/') : '/';
    await page.goto(`http://preview.local${previewRoute}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await Promise.race([
      page.waitForFunction(() => window.__veaveRuntimeEvents?.some((event) =>
        event.type === 'preview-error' || event.type === 'preview-rendered'
      ), null, { timeout: 60000 }),
      firstPageError
    ]);
    await page.waitForTimeout(150);

    const events = await page.evaluate(() => window.__veaveRuntimeEvents || []);
    const runtimeError = events.find((event) => event.type === 'preview-error');
    const rendered = events.findLast((event) => event.type === 'preview-rendered');
    if (runtimeError || pageErrors.length || rendered?.status !== 'success') {
      const error = runtimeError?.error;
      const genericRuntimeMessage = typeof error === 'string'
        ? error
        : error?.message || pageErrors[0] || `Preview finished with status "${rendered?.status || 'unknown'}".`;
      const message = /^Script error\.?$/i.test(genericRuntimeMessage) && consoleErrors.length
        ? consoleErrors.join('\n').slice(0, 12000)
        : genericRuntimeMessage;
      const fileMatch = message.match(/Error in ([^:]+\.(?:jsx?|tsx?)):/i);
      const babelFileMatch = message.match(/(?:^|\s)(src\/[^:\s]+\.(?:jsx?|tsx?))(?::|\s)/i);
      return {
        ok: false,
        diagnostics: [{
          category: 'preview-runtime',
          path: fileMatch?.[1] || babelFileMatch?.[1] || null,
          line: error?.line || null,
          message
        }],
        checks: [{ name: 'preview-runtime', status: 'failed' }],
        coverage: { exhaustive: false }
      };
    }

    const hasVisibleContent = await page.locator('#root').evaluate((root) => {
      const text = (root.innerText || '').trim();
      const visibleMedia = [...root.querySelectorAll('img,svg,canvas,input,video,button')].some((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      return Boolean(text || visibleMedia);
    });
    if (!hasVisibleContent) {
      return {
        ok: false,
        diagnostics: [{ category: 'preview-runtime', path: 'src/App.jsx', message: 'Blank screen detected after rendering.' }],
        checks: [{ name: 'preview-runtime', status: 'failed' }],
        coverage: { exhaustive: false }
      };
    }

    if (minimumTextLength > 0) {
      const renderedTextLength = await page.locator('#root').evaluate((root) => (root.innerText || '').trim().length);
      if (renderedTextLength < minimumTextLength) {
        return {
          ok: false,
          diagnostics: [{ category: 'route-content', path: routePath, message: `Rendered route content is too short: ${renderedTextLength} characters; expected at least ${minimumTextLength}.` }],
          checks: [{ name: 'preview-route-content', status: 'failed', route: routePath }],
          coverage: { exhaustive: false },
          artifacts: []
        };
      }
    }

    if (expectedColors.length) {
      const palette = await page.locator('#root').evaluate((root, colors) => {
        const probe = document.createElement('span');
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const normalize = (value) => {
          probe.style.color = '';
          probe.style.color = value;
          if (!probe.style.color) return null;
          return getComputedStyle(probe).color;
        };
        const expected = [...new Set(colors.map(normalize).filter(Boolean))];
        const actual = new Set();
        for (const element of [document.documentElement, document.body, root, ...root.querySelectorAll('*')]) {
          const style = getComputedStyle(element);
          for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.fill, style.stroke]) {
            if (value && value !== 'rgba(0, 0, 0, 0)' && value !== 'none') actual.add(value);
          }
        }
        probe.remove();
        return { expected, matched: expected.filter((color) => actual.has(color)) };
      }, expectedColors);
      const requiredMatches = Math.min(3, palette.expected.length);
      if (palette.matched.length < requiredMatches) {
        return {
          ok: false,
          diagnostics: [{ category: 'route-color', path: routePath, message: `Captured palette mismatch: matched ${palette.matched.length}/${palette.expected.length} colors; required ${requiredMatches}.` }],
          checks: [{ name: 'preview-route-colors', status: 'failed', route: routePath }],
          coverage: { exhaustive: false },
          artifacts: []
        };
      }
    }

    const brokenImages = await page.locator('img').evaluateAll((images) => [...new Set(images
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute('src') || ''))].slice(0, 20));
    if (brokenImages.length) {
      return {
        ok: false,
        diagnostics: [{ category: 'missing-asset', path: null, message: `Broken preview images: ${brokenImages.join(', ')}` }],
        checks: [{ name: 'preview-assets', status: 'failed' }],
        coverage: { exhaustive: false },
        artifacts: []
      };
    }

    if (expectedHeading) {
      const headingMatches = await page.locator('h1,h2,h3').filter({ hasText: expectedHeading }).count();
      if (!headingMatches) {
        return {
          ok: false,
          diagnostics: [{ category: 'route-content', path: routePath, message: `Expected heading was not rendered: ${expectedHeading}` }],
          checks: [{ name: 'preview-route', status: 'failed', route: routePath }],
          coverage: { exhaustive: false },
          artifacts: []
        };
      }
    }

    await context.close();
    return {
      ok: true,
      diagnostics: [],
      checks: [{ name: 'preview-runtime', status: 'passed' }, { name: 'preview-assets', status: 'passed' }, { name: 'preview-route', status: 'passed', route: routePath }, { name: 'browser', status: 'passed' }],
      coverage: { exhaustive: false },
      artifacts: []
    };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return {
      ok: false,
      blocked: true,
      diagnostics: [{ category: 'infrastructure', path: null, message: `Local preview validation failed: ${error.message}` }],
      checks: [{ name: 'preview-runtime', status: 'blocked' }],
      coverage: { exhaustive: false }
    };
  } finally {
    releaseSharedBrowser(browser);
  }
}

// Finds sections that render as empty space: containers whose fixed height / padding is much larger
// than the content they hold. Returns the element class strings so the source can be repaired.
const BLANK_SPACE_MONITOR = `<script>window.__veaveRuntimeEvents=[];window.addEventListener('message',function(e){if(e.data&&(e.data.type==='preview-error'||e.data.type==='preview-rendered'))window.__veaveRuntimeEvents.push(e.data)});<\/script>`;

// Measures one route in an already-open browser context (the preview HTML is built once by the caller).
/**
 * Renders the project's preview (same offline build as the runtime check), lets the page settle and lazy content load,
 * and returns whatever `inspect` (a function run inside the page) measures. Binary project files are served to the page
 * from memory, so images have their real size and layout matches. Used for fidelity audits against a real website.
 */
async function inspectRenderedPreview(files, { signal, routePath = '/', inspect, argument = null, viewport = { width: 1440, height: 900 }, timeoutMs = 90000, onPage = null } = {}) {
  signal?.throwIfAborted();
  const textFiles = files.filter((file) => file && file.encoding !== 'base64');
  const binaries = new Map(files.filter((file) => file && file.encoding === 'base64' && /^public\//.test(file.path || '')).map((file) => [`/${file.path.slice('public/'.length)}`, file]));
  const monitor = `<script>
    window.__veaveRuntimeEvents = [];
    window.addEventListener('message', function(event) {
      if (event.data && (event.data.type === 'preview-error' || event.data.type === 'preview-rendered')) window.__veaveRuntimeEvents.push(event.data);
    });
  <\/script>`;
  const html = seedPreviewRoute(await buildOfflinePreviewHTML(textFiles, monitor), routePath);
  return withSharedBrowserContext({ viewport, serviceWorkers: 'block' }, async (context) => {
    await routeLocalPreviewDependencies(context, html);
    // Registered last, so it wins over the catch-all above: project assets are served from memory.
    await context.route(/^http:\/\/preview\.local\/(?!$).*/, async (route) => {
      const url = new URL(route.request().url());
      const file = binaries.get(decodeURIComponent(url.pathname));
      if (!file) return route.fallback();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[String(file.path).split('.').pop().toLowerCase()] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: mime, body: Buffer.from(String(file.content || ''), 'base64') });
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`http://preview.local${String(routePath || '/').startsWith('/') ? routePath : '/'}`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForFunction(() => window.__veaveRuntimeEvents?.some((event) => event.type === 'preview-error' || event.type === 'preview-rendered'), null, { timeout: timeoutMs });
    const events = await page.evaluate(() => window.__veaveRuntimeEvents || []);
    const failed = events.find((event) => event.type === 'preview-error') || events.findLast((event) => event.type === 'preview-rendered' && event.status !== 'success');
    if (failed || pageErrors.length) throw new Error(`The project did not render: ${failed?.error?.message || failed?.error || pageErrors[0] || 'preview failed'}`);
    // Scroll through the page so lazy images and reveal-on-scroll sections are laid out like on the real site.
    await page.evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight && y < 60000; y += step) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((resolve) => setTimeout(resolve, 40)); }
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(250);
    const measured = await page.evaluate(inspect, argument);
    if (onPage) await onPage(page);
    return measured;
  });
}

async function measureRouteBlankSpace(context, html, routePath) {
  const page = await context.newPage();
  try {
    await page.goto(`http://preview.local${String(routePath).startsWith('/') ? routePath : '/'}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__veaveRuntimeEvents?.some((event) => event.type === 'preview-error' || event.type === 'preview-rendered'), null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(async () => {
      document.querySelectorAll('img').forEach((image) => { image.loading = 'eager'; });
      const step = Math.max(700, window.innerHeight);
      for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 15)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(150);
    const findings = await page.locator('#root').evaluate((root) => {
      const scrollY = window.scrollY;
      const rectOf = (element) => { const r = element.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, width: r.width, height: r.height }; };
      const hasPaint = (element, style) => style.backgroundImage !== 'none';
      const contentExtent = (container) => {
        let minTop = Infinity; let maxBottom = -Infinity;
        const consider = (r) => { if (r.height <= 0 || r.width <= 0) return; minTop = Math.min(minTop, r.top); maxBottom = Math.max(maxBottom, r.bottom); };
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            const r = range.getBoundingClientRect(); consider({ top: r.top + scrollY, bottom: r.bottom + scrollY, width: r.width, height: r.height });
            continue;
          }
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
          if (/^(IMG|SVG|VIDEO|CANVAS|INPUT|BUTTON|SELECT|TEXTAREA|IFRAME|PICTURE)$/i.test(node.tagName) || hasPaint(node, style)) consider(rectOf(node));
        }
        return { minTop, maxBottom };
      };
      const results = [];
      const candidates = [...root.querySelectorAll('section,div,main,article,aside,footer,header')];
      for (const element of candidates) {
        const rect = rectOf(element);
        if (rect.height < 160 || rect.width < 200) continue;
        const style = getComputedStyle(element);
        if (style.position === 'fixed' || style.display === 'none') continue;
        const className = element.getAttribute('class') || '';
        // Only elements whose size comes from an explicit fixed height/padding class can be repaired in source.
        if (!/(?:^|\s)(?:min-)?h-\[[\d.]+px\]|(?:^|\s)p[tby]-\[[\d.]+px\]/.test(className)) continue;
        const extent = contentExtent(element);
        const empty = !Number.isFinite(extent.minTop);
        const leading = empty ? rect.height : Math.max(0, extent.minTop - rect.top);
        const trailing = empty ? 0 : Math.max(0, rect.bottom - extent.maxBottom);
        const gap = empty ? rect.height : leading + trailing;
        // Hero-style blocks (a tall banner whose heading sits at the bottom) are deliberate design, not blank space:
        // keep any non-empty block up to hero height; only empty blocks and very tall blocks are treated as blank.
        if (!empty && rect.height <= 1100) continue;
        if (gap >= Math.max(200, rect.height * 0.4)) {
          results.push({ className, tag: element.tagName.toLowerCase(), height: Math.round(rect.height), gap: Math.round(gap), leading: Math.round(leading), trailing: Math.round(trailing), empty, top: Math.round(rect.top), text: (element.getAttribute('aria-label') || element.innerText || '').trim().slice(0, 60) });
        }
      }
      // Keep the innermost offenders only; fixing a child resolves the parent.
      return results.filter((item) => !results.some((other) => other !== item && other.className !== item.className && other.top >= item.top && other.top + other.height <= item.top + item.height && other.gap >= item.gap * 0.5));
    });
    const metrics = await page.locator('#root').evaluate((root) => ({ textLength: (root.innerText || '').trim().length, imageCount: root.querySelectorAll('img').length, height: document.documentElement.scrollHeight })).catch(() => null);
    return { ok: true, findings, metrics };
  } catch (error) {
    return { ok: false, findings: [], error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

// Checks many routes with ONE preview build, ONE browser and a small pool of parallel pages.
async function detectBlankSpaceBatch(files, routePaths = ['/'], { signal, viewport = { width: 1440, height: 900 }, concurrency = 4 } = {}) {
  signal?.throwIfAborted();
  const results = new Map();
  if (!routePaths.length) return results;
  let baseHtml;
  try { baseHtml = await buildOfflinePreviewHTML(files, BLANK_SPACE_MONITOR); } catch (error) { for (const route of routePaths) results.set(route, { ok: false, findings: [], error: error.message }); return results; }
  let browser;
  try {
    browser = await acquireSharedBrowser();
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await routeLocalPreviewDependencies(context, baseHtml);
    // Registered last so it takes priority: serve per-route seeded HTML (the virtual path differs per route).
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === 'preview.local' && request.resourceType() === 'document') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: seedPreviewRoute(baseHtml, url.pathname) });
      }
      return route.fallback();
    });
    const queue = [...routePaths];
    const worker = async () => {
      while (queue.length) {
        signal?.throwIfAborted();
        const route = queue.shift();
        results.set(route, await measureRouteBlankSpace(context, baseHtml, route));
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, routePaths.length)) }, worker));
    await context.close();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    for (const route of routePaths) if (!results.has(route)) results.set(route, { ok: false, findings: [], error: error.message });
  } finally {
    releaseSharedBrowser(browser);
  }
  return results;
}

// Single-route convenience wrapper.

/**
 * Pages rebuilt from a capture contain content the original only revealed with a script (fade-ins, galleries that start at
 * opacity 0). Renders each route and returns class selectors of elements that are hidden although they hold an image or
 * real text, so a rule can show them. Menus, dialogs and similar things that are meant to be hidden are left alone.
 */
async function findHiddenContent(files, routePaths = ['/'], { signal, timeoutMs = 90000 } = {}) {
  const selectors = new Set();
  for (const routePath of routePaths) {
    signal?.throwIfAborted();
    const found = await inspectRenderedPreview(files, { signal, routePath, timeoutMs, inspect: () => {
      const root = document.querySelector('.veave-fallback');
      if (!root) return [];
      const intended = /(modal|menu|dropdown|popup|overlay|lightbox|tooltip|search|cart|drawer|cookie|mobile|hamburger|folder|subnav|skip|sr-only|screen-reader|hidden-)/i;
      const out = new Set();
      for (const element of root.querySelectorAll('*')) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || !(style.opacity === '0' || style.visibility === 'hidden')) continue;
        if (element.closest('[aria-hidden="true"],[hidden]')) continue;
        const classes = [...element.classList].filter((name) => /^[\w-]+$/.test(name) && !/[0-9]{4,}/.test(name));
        if (!classes.length || intended.test(classes.join(' '))) continue;
        // An image that fades in after load hides ITSELF (inline opacity:0), so the element counts when it is a loaded image too.
        const hasImage = (element.tagName === 'IMG' && element.naturalWidth > 0 && element.getBoundingClientRect().width > 1) || [...element.querySelectorAll('img')].some((image) => image.naturalWidth > 0);
        if (!hasImage && (element.innerText || '').trim().length < 20) continue;
        out.add(classes.slice(0, 3).map((name) => `.${CSS.escape(name)}`).join(''));
        if (out.size >= 300) break;
      }
      return [...out];
    } }).catch(() => []);
    for (const selector of found || []) selectors.add(selector);
  }
  return [...selectors];
}

async function detectBlankSpace(files, { signal, routePath = '/', viewport } = {}) {
  const results = await detectBlankSpaceBatch(files, [routePath], { signal, viewport, concurrency: 1 });
  return results.get(routePath) || { ok: false, findings: [] };
}
async function verifyPreviewVisual(files, { signal, routePath = '/', reference, threshold = 0.8 } = {}) {
  signal?.throwIfAborted();
  const match = String(reference || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('Visual comparison requires a PNG, JPEG, or WebP data URL.');
  const input = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Visual reference dimensions could not be read.');
  const html = await buildOfflinePreviewHTML(files);
  let browser;
  try {
    browser = await acquireSharedBrowser();
    const context = await browser.newContext({ viewport: { width: metadata.width, height: metadata.height }, serviceWorkers: 'block' });
    await routeLocalPreviewDependencies(context, html);
    const page = await context.newPage();
    const normalizedRoute = String(routePath || '/').startsWith('/') ? String(routePath || '/') : '/';
    await page.goto(`http://preview.local${normalizedRoute}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#root').waitFor({ state: 'visible', timeout: 30000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(250);
    const rendered = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', timeout: 30000 });
    const comparison = await compareScreenshot({ input, width: metadata.width, height: metadata.height, format: metadata.format }, rendered, threshold);
    await context.close();
    return {
      ok: comparison.passed,
      comparison,
      diagnostics: comparison.passed ? [] : [{
        category: 'visual',
        path: routePath,
        message: `Rendered similarity ${comparison.score} is below ${comparison.threshold}; lowest regions: ${comparison.lowestScoringRegions.map((region) => `${region.name} ${region.score}`).join(', ')}.`
      }]
    };
  } finally {
    releaseSharedBrowser(browser);
  }
}

async function verifyRenderedTarget(files, verification, { signal } = {}) {
  signal?.throwIfAborted();
  const html = await buildOfflinePreviewHTML(files);
  let browser;
  try {
    browser = await acquireSharedBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await routeLocalPreviewDependencies(context);
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const locator = page.locator(verification.selector).filter({ hasText: verification.targetText });
    await locator.first().waitFor({ state: 'visible', timeout: 30000 });
    const exact = locator.filter({ hasText: verification.targetText });
    const count = await exact.count();
    if (count !== 1) {
      throw new Error(`Expected one rendered target for "${verification.targetText}", found ${count}.`);
    }
    if (verification.expectedText !== undefined) {
      const actualText = await exact.evaluate((element) => (element.innerText || element.textContent || '').trim());
      if (actualText !== verification.expectedText) {
        throw new Error(`Rendered text is "${actualText}", expected "${verification.expectedText}".`);
      }
      await context.close();
      return { status: 'passed', actual: actualText, ...verification };
    }
    const expectedValue = verification.cssValue
      ? await page.evaluate(({ property, cssValue }) => {
          const probe = document.createElement('span');
          probe.style.setProperty(property, cssValue);
          document.body.appendChild(probe);
          const computed = getComputedStyle(probe).getPropertyValue(property);
          probe.remove();
          return computed;
        }, { property: verification.property, cssValue: verification.cssValue })
      : verification.value;
    const actual = await exact.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), verification.property);
    if (!expectedValue || actual.trim().toLowerCase() !== expectedValue.trim().toLowerCase()) {
      throw new Error(`Rendered ${verification.property} for "${verification.targetText}" is "${actual.trim()}", expected "${expectedValue || verification.cssValue}".`);
    }
    await context.close();
    return { status: 'passed', actual: actual.trim(), ...verification };
  } finally {
    releaseSharedBrowser(browser);
  }
}

async function verifyPageIsolation(files, verification, { signal } = {}) {
  signal?.throwIfAborted();
  const html = await buildOfflinePreviewHTML(files);
  let browser;
  try {
    browser = await acquireSharedBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await routeLocalPreviewDependencies(context);
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => { document.body.dataset.veaveInspect = 'false'; });
    const home = page.locator(verification.homeSelector);
    const created = page.locator(verification.pageSelector);
    await home.waitFor({ state: 'visible', timeout: 30000 });
    if (await created.count() && await created.first().isVisible()) throw new Error('New page is visible while Home is active.');
    const sharedHeader = verification.headerSelector ? page.locator(verification.headerSelector) : null;
    const sharedFooter = verification.footerSelector ? page.locator(verification.footerSelector) : null;
    if (sharedHeader && await sharedHeader.count() !== 1) throw new Error('Expected exactly one shared header/navbar on Home.');
    if (sharedFooter && await sharedFooter.count() !== 1) throw new Error('Expected exactly one shared footer on Home.');
    const headerText = sharedHeader ? await sharedHeader.innerText() : null;
    const footerText = sharedFooter ? await sharedFooter.innerText() : null;

    await page.locator(verification.openSelector).first().click();
    await created.waitFor({ state: 'visible', timeout: 10000 });
    if (await home.count() && await home.first().isVisible()) throw new Error('Home remains visible behind the new page.');
    if (sharedHeader && (await sharedHeader.count() !== 1 || await sharedHeader.innerText() !== headerText)) {
      throw new Error('The shared header/navbar was duplicated or changed on the new page.');
    }
    if (sharedFooter && (await sharedFooter.count() !== 1 || await sharedFooter.innerText() !== footerText)) {
      throw new Error('The shared footer was duplicated or changed on the new page.');
    }
    if (verification.headerSelector && await created.locator(verification.headerSelector).count()) {
      throw new Error('The new page embeds a duplicate header/navbar inside its page root.');
    }
    if (verification.footerSelector && await created.locator(verification.footerSelector).count()) {
      throw new Error('The new page embeds a duplicate footer inside its page root.');
    }

    const escapedLayers = await created.evaluate((root) => [...root.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element);
      return style.position === 'fixed' && (style.inset === '0px' || style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)');
    }).length);
    if (escapedLayers) throw new Error(`New page contains ${escapedLayers} fixed background layer(s).`);

    await page.locator(verification.homeLinkSelector).first().click();
    await home.waitFor({ state: 'visible', timeout: 10000 });
    if (await created.count() && await created.first().isVisible()) throw new Error('New page remains visible after returning Home.');
    if (sharedHeader && (await sharedHeader.count() !== 1 || await sharedHeader.innerText() !== headerText)) {
      throw new Error('The shared header/navbar changed after returning Home.');
    }
    if (sharedFooter && (await sharedFooter.count() !== 1 || await sharedFooter.innerText() !== footerText)) {
      throw new Error('The shared footer changed after returning Home.');
    }

    await page.locator(verification.openSelector).first().click();
    await created.waitFor({ state: 'visible', timeout: 10000 });
    if (await home.count() && await home.first().isVisible()) throw new Error('Repeated navigation leaked Home into the new page.');
    await context.close();
    return { status: 'passed', slug: verification.slug };
  } finally {
    releaseSharedBrowser(browser);
  }
}

if (!isMainThread && workerData?.task === 'build-offline-preview') {
  buildOfflinePreviewHTMLInProcess(workerData.files, workerData.headMarkup)
    .then((html) => parentPort.postMessage({ ok: true, html }))
    .catch((error) => parentPort.postMessage({
      ok: false,
      error: {
        message: error.message,
        name: error.name,
        filePath: error.filePath || null,
        loc: error.loc || null
      }
    }));
}

module.exports = {
  findHiddenContent, inspectRenderedPreview, buildOfflinePreviewHTML, detectBlankSpaceBatch, detectBlankSpace, verifyPreviewRuntime, verifyPreviewVisual, verifyRenderedTarget, verifyPageIsolation };
