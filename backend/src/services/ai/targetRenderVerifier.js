const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
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
  const { buildPreviewHTML } = await loadTransformer();
  let html = buildPreviewHTML(files);
  if (!previewCssCompiler) {
    const postcss = require(path.join(frontendRoot, 'node_modules/postcss'));
    const tailwindcss = require(path.join(frontendRoot, 'node_modules/tailwindcss'));
    previewCssCompiler = async (source) => {
      const result = await postcss([tailwindcss({
        content: [{ raw: source, extension: 'html' }],
        corePlugins: { preflight: true }
      })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined });
      return result.css;
    };
  }
  const css = await previewCssCompiler(html);
  html = html.replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/i, `<style>${css}</style>`);
  html = html.replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"']+"><\/script>/i, '');
  html = html.replace(/<script\s+type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/gi, (_, attributes, source) => {
    const filename = attributes.match(/data-filename="([^"]+)"/i)?.[1] || 'preview-bootstrap.jsx';
    try {
      const compiled = Babel.transform(source, {
        filename,
        presets: ['react', 'typescript'],
        sourceType: 'script',
        sourceMaps: 'inline'
      }).code;
      return `<script data-source-file="${filename}">${compiled}<\/script>`;
    } catch (error) {
      error.filePath = filename;
      throw error;
    }
  });
  if (headMarkup) html = html.replace(/<head>/i, `<head>${headMarkup}`);
  return html;
}

function buildOfflinePreviewHTML(files, headMarkup = '') {
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
    browser = await launchChromium({ browserType: chromium });
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
    await browser?.close().catch(() => {});
  }
}

// Finds sections that render as empty space: containers whose fixed height / padding is much larger
// than the content they hold. Returns the element class strings so the source can be repaired.
const BLANK_SPACE_MONITOR = `<script>window.__veaveRuntimeEvents=[];window.addEventListener('message',function(e){if(e.data&&(e.data.type==='preview-error'||e.data.type==='preview-rendered'))window.__veaveRuntimeEvents.push(e.data)});<\/script>`;

// Measures one route in an already-open browser context (the preview HTML is built once by the caller).
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
    browser = await launchChromium({ browserType: chromium });
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
    await browser?.close().catch(() => {});
  }
  return results;
}

// Single-route convenience wrapper.
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
    browser = await launchChromium({ browserType: chromium });
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
    await browser?.close().catch(() => {});
  }
}

async function verifyRenderedTarget(files, verification, { signal } = {}) {
  signal?.throwIfAborted();
  const html = await buildOfflinePreviewHTML(files);
  let browser;
  try {
    browser = await launchChromium({ browserType: chromium });
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
    await browser?.close().catch(() => {});
  }
}

async function verifyPageIsolation(files, verification, { signal } = {}) {
  signal?.throwIfAborted();
  const html = await buildOfflinePreviewHTML(files);
  let browser;
  try {
    browser = await launchChromium({ browserType: chromium });
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
    await browser?.close().catch(() => {});
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

module.exports = { detectBlankSpaceBatch, detectBlankSpace, verifyPreviewRuntime, verifyPreviewVisual, verifyRenderedTarget, verifyPageIsolation };
