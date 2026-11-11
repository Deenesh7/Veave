'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { launchChromium } = require('../browser/launchChromium');
const capture = require('../clone/websiteCaptureService');
const { collectPageMetrics } = require('./pageMetrics');
const { routeKey, sameSite, FILE_EXTENSION } = require('./urlNormalizer');

// Stage 2 (+ the browser part of 3-5): visit the reference site and measure every page at desktop and mobile size.
// Route discovery follows navigation menus (including dropdowns), the footer, sitemaps and links found in page bodies.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BOT_WALL = /just a moment|attention required|access denied|verify you are human|are you a robot|captcha|checking your browser|unusual traffic/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits a failure into "worth retrying" (transient) or final, and names it for the report. */
function classifyFailure(error, httpStatus) {
  const message = String(error?.message || error || '');
  if (httpStatus === 404 || httpStatus === 410) return { kind: 'not-found', transient: false, message: `The page returned HTTP ${httpStatus}.` };
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 451) return { kind: 'blocked', transient: false, message: `The site refused access (HTTP ${httpStatus}).` };
  if (httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600)) return { kind: 'server-error', transient: true, message: `The site answered HTTP ${httpStatus}.` };
  if (/bot protection|blocked automated/i.test(message)) return { kind: 'blocked', transient: false, message };
  if (/timeout|net::err_(?:timed_out|connection|network|aborted|empty_response)|econnreset|socket hang up|target (?:page|closed)|navigation.*interrupted/i.test(message)) return { kind: 'transient', transient: true, message };
  if (/net::err_(?:name_not_resolved|cert|ssl)|enotfound/i.test(message)) return { kind: 'unreachable', transient: false, message };
  return { kind: 'error', transient: false, message };
}

async function withRetries(operation, { retries, signal, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try {
      return { value: await operation(attempt), attempts: attempt + 1 };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      const info = classifyFailure(error, error?.httpStatus);
      if (!info.transient || attempt >= retries) {
        const failure = new Error(info.message);
        failure.kind = info.kind; failure.attempts = attempt + 1; failure.httpStatus = error?.httpStatus || null;
        throw failure;
      }
      if (onRetry) onRetry({ attempt: attempt + 1, error: info });
      await sleep(Math.min(8000, 700 * 2 ** attempt));
      attempt += 1;
    }
  }
}

async function newReferenceContext(browser, viewport, validateUrl = capture.validatePublicUrl) {
  const context = await browser.newContext({
    viewport, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: true, userAgent: UA, locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const validated = new Set();
  // The crawler may only reach public hosts, never the machine's own network.
  await context.route('**/*', async (route) => {
    try {
      const parsed = new URL(route.request().url());
      if (!['data:', 'blob:', 'about:'].includes(parsed.protocol) && !validated.has(parsed.hostname)) { await validateUrl(parsed.href); validated.add(parsed.hostname); }
      if (route.request().resourceType() === 'media') return route.abort();
      return route.continue();
    } catch { return route.abort('blockedbyclient'); }
  });
  return context;
}

async function settlePage(page) {
  await page.waitForLoadState('networkidle', { timeout: 9000 }).catch(() => {});
  await page.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;scroll-behavior:auto!important}' }).catch(() => {});
  // Scroll the whole page so lazy images, reveal-on-scroll sections and infinite-ish sections are laid out.
  await page.evaluate(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
    const step = Math.max(500, Math.floor(window.innerHeight * 0.7));
    for (let y = 0; y < document.documentElement.scrollHeight && y < 24000; y += step) { window.scrollTo(0, y); await new Promise((resolve) => setTimeout(resolve, 110)); }
    window.scrollTo(0, 0);
  }).catch(() => {});
  await page.waitForTimeout(700);
}

// Menus that only render their links when opened: hover/focus every trigger so those routes can be discovered.
async function openMenus(page, limit = 14) {
  const triggers = await page.$$('header [aria-haspopup], header [aria-expanded], nav [aria-haspopup], nav [aria-expanded], header li:has(ul) > a, nav li:has(ul) > a, header button, nav button');
  let opened = 0;
  for (const trigger of triggers) {
    if (opened >= limit) break;
    try {
      if (!(await trigger.isVisible())) continue;
      await trigger.hover({ timeout: 800 });
      await page.waitForTimeout(120);
      opened += 1;
    } catch { /* not hoverable */ }
  }
  await page.mouse.move(0, 0).catch(() => {});
  return opened;
}

async function measureAt(page, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(350);
  await settlePage(page);
  return page.evaluate(collectPageMetrics, {});
}

/**
 * Captures one URL: desktop metrics, mobile metrics, request failures. Throws an Error with `kind`, `attempts`,
 * `httpStatus` when the page cannot be read.
 */
async function capturePage(context, url, config, { wantImage = false } = {}) {
  const page = await context.newPage();
  const failedRequests = [];
  page.on('requestfailed', (request) => { if (failedRequests.length < 40) failedRequests.push({ url: request.url().slice(0, 200), type: request.resourceType(), reason: request.failure()?.errorText || 'failed' }); });
  page.on('response', (response) => { if (response.status() >= 400 && failedRequests.length < 40 && response.request().resourceType() !== 'document') failedRequests.push({ url: response.url().slice(0, 200), type: response.request().resourceType(), reason: `HTTP ${response.status()}` }); });
  try {
    await page.setViewportSize(config.viewports.desktop);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
    const status = response ? response.status() : 0;
    if (status >= 400) { const error = new Error(`HTTP ${status}`); error.httpStatus = status; throw error; }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
    const health = await page.evaluate(() => ({ title: document.title || '', text: (document.body?.innerText || '').slice(0, 700), nodes: document.querySelectorAll('body *').length })).catch(() => ({ title: '', text: '', nodes: 0 }));
    if (BOT_WALL.test(`${health.title} ${health.text}`) && health.nodes < 140) throw new Error('The site blocked automated access (bot protection page).');
    if (health.nodes < 8) throw new Error('The page rendered empty.');
    await openMenus(page);
    const desktop = await measureAt(page, config.viewports.desktop);
    let image = null;
    if (wantImage) {
      try {
        await page.setViewportSize(config.viewports.desktop);
        const shot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true, clip: { x: 0, y: 0, width: config.viewports.desktop.width, height: Math.min(desktop.scrollHeight, 5400) } });
        const sharp = require('sharp');
        image = await sharp(shot).resize({ width: 1000 }).jpeg({ quality: 70 }).toBuffer();
      } catch { image = null; }
    }
    const mobile = await measureAt(page, config.viewports.mobile).catch(() => null);
    return { finalUrl: page.url(), httpStatus: status, desktop, mobile, failedRequests, image };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Link candidates found on a captured page, in discovery priority order. */
function linkCandidates(metrics, origin) {
  const out = [];
  const seen = new Set();
  const add = (href, source, priority, label = '') => {
    if (!href || !sameSite(href, origin)) return;
    let parsed; try { parsed = new URL(href); } catch { return; }
    if (!['http:', 'https:'].includes(parsed.protocol) || FILE_EXTENSION.test(parsed.pathname)) return;
    const key = routeKey(href, origin);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, url: new URL(key.split('?')[0] + (key.includes('?') ? `?${key.split('?')[1]}` : ''), origin).href, source, priority, label });
  };
  (metrics?.nav || []).filter((item) => item.group === 'header').forEach((item) => add(item.href, item.level > 0 ? 'menu-dropdown' : 'menu', item.level > 0 ? 2 : 1, item.label));
  (metrics?.nav || []).filter((item) => item.group === 'footer').forEach((item) => add(item.href, 'footer', 4, item.label));
  (metrics?.links || []).forEach((href) => add(href, 'body', 5));
  return out;
}

/** Caps how many deep pages of one section are followed, so a long listing cannot use up the page budget. */
function sectionOf(key) { const parts = key.split('?')[0].split('/').filter(Boolean); return parts.length < 2 ? '' : parts[0].toLowerCase(); }

/**
 * Crawls the reference site.
 * @returns {{origin, pages: Array, failures: Array, discovered: number, truncated: boolean, truncatedReason: string|null, robots: object, sitemapRoutes: number}}
 */
async function crawlReference({ url, config, signal, onProgress = () => {}, browserType = chromium, keepImages = true, validateUrl = capture.validatePublicUrl } = {}) {
  const origin = new URL(url).origin;
  await validateUrl(url);
  const browser = await launchChromium({ browserType });
  const startedAt = Date.now();
  const pages = [];
  const failures = [];
  const images = new Map();
  let truncated = false;
  let truncatedReason = null;
  try {
    const context = await newReferenceContext(browser, config.viewports.desktop, validateUrl);
    // robots.txt + sitemaps through the browser, like the clone crawler does (same SSRF guard).
    let robotsRules = null;
    let sitemapLinks = [];
    const probe = await context.newPage();
    try {
      await probe.goto(origin, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs }).catch(() => {});
      const robotsText = await probe.evaluate(async (target) => { try { const r = await fetch(target, { credentials: 'omit' }); return r.ok ? r.text() : ''; } catch { return ''; } }, `${origin}/robots.txt`).catch(() => '');
      robotsRules = config.respectRobots ? capture.parseRobots(robotsText) : null;
      sitemapLinks = await capture.discoverSitemapLinks(probe, origin, validateUrl).catch(() => []);
    } finally { await probe.close().catch(() => {}); }

    const queue = [{ key: routeKey(url, origin) || '/', url, depth: 0, source: 'entry', priority: 0 }];
    const known = new Set([queue[0].key]);
    const sectionCount = new Map();
    const enqueue = (candidate, depth) => {
      if (known.has(candidate.key)) return;
      if (config.respectRobots && robotsRules && capture.isRobotsDisallowed(robotsRules, candidate.url)) {
        failures.push({ route: candidate.key, url: candidate.url, kind: 'robots-disallowed', message: 'robots.txt disallows this page, so it was not read.', attempts: 0 });
        known.add(candidate.key);
        return;
      }
      const section = sectionOf(candidate.key);
      if (depth >= 2 && section) { const n = sectionCount.get(section) || 0; if (n >= 6) { known.add(candidate.key); return; } sectionCount.set(section, n + 1); }
      known.add(candidate.key);
      queue.push({ ...candidate, depth });
    };
    sitemapLinks.forEach((entry) => { const key = routeKey(entry.href, origin); if (key && sameSite(entry.href, origin) && !FILE_EXTENSION.test(key)) enqueue({ key, url: new URL(key, origin).href, source: 'sitemap', priority: 6 }, 1); });

    let active = 0;
    let started = 0; // pages taken by a worker; counted when taken, so concurrent workers can never overshoot the limit
    const takeNext = () => {
      queue.sort((a, b) => (a.depth - b.depth) || (a.priority - b.priority));
      return queue.shift();
    };
    const worker = async () => {
      for (;;) {
        signal?.throwIfAborted();
        if (started >= config.maxPages) { if (queue.length) { truncated = true; truncatedReason = `page limit (${config.maxPages})`; } return; }
        if (Date.now() - startedAt > config.crawlDeadlineMs) { if (queue.length) { truncated = true; truncatedReason = 'time limit'; } return; }
        const entry = takeNext();
        if (!entry) { if (active === 0) return; await sleep(80); continue; }
        started += 1;
        active += 1;
        const route = entry.key;
        const pageContext = await newReferenceContext(browser, config.viewports.desktop, validateUrl);
        try {
          const { value, attempts } = await withRetries(() => capturePage(pageContext, entry.url, config, { wantImage: keepImages }), {
            retries: config.crawlRetries, signal, onRetry: ({ attempt, error }) => onProgress({ type: 'retry', route, attempt, reason: error.message })
          });
          if (value.image) images.set(route, value.image);
          pages.push({ route, url: entry.url, finalUrl: value.finalUrl, status: 'captured', attempts, depth: entry.depth, discoveredFrom: entry.source, title: value.desktop.title, httpStatus: value.httpStatus, desktop: value.desktop, mobile: value.mobile, failedRequests: value.failedRequests });
          onProgress({ type: 'captured', route, count: pages.length });
          if (entry.depth < config.maxDepth) linkCandidates(value.desktop, origin).forEach((candidate) => enqueue(candidate, entry.depth + 1));
          // a same-site redirect target counts as the same route
          if (value.finalUrl) { const finalKey = routeKey(value.finalUrl, origin); if (finalKey) known.add(finalKey); }
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          failures.push({ route, url: entry.url, kind: error.kind || 'error', message: String(error.message).slice(0, 240), attempts: error.attempts || 1, httpStatus: error.httpStatus || null, depth: entry.depth });
          onProgress({ type: 'failed', route, kind: error.kind || 'error' });
        } finally {
          await pageContext.close().catch(() => {});
          active -= 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, config.crawlConcurrency) }, worker));
    if (queue.length && !truncated) { truncated = true; truncatedReason = 'page limit'; }
    await context.close().catch(() => {});
    pages.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : (a.depth - b.depth)));
    return {
      origin, pages, failures, discovered: known.size, truncated, truncatedReason,
      queued: queue.map((item) => item.key), robots: { respected: Boolean(config.respectRobots), disallowed: robotsRules?.disallow?.length || 0 },
      sitemapRoutes: sitemapLinks.length, images, durationMs: Date.now() - startedAt
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---- reference screenshot cache (kept outside the project and outside MongoDB; re-captured if missing, e.g. after a restart)
function cacheDirFor(runId) { return path.join(os.tmpdir(), 'veave-prototype', String(runId).replace(/[^\w-]/g, '_')); }
function writeCachedImage(runId, route, buffer) {
  try { const dir = cacheDirFor(runId); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${Buffer.from(route).toString('base64url')}.jpg`), buffer); } catch { /* cache is best-effort */ }
}
function readCachedImage(runId, route) {
  try { return fs.readFileSync(path.join(cacheDirFor(runId), `${Buffer.from(route).toString('base64url')}.jpg`)); } catch { return null; }
}
function clearCache(runId) { try { fs.rmSync(cacheDirFor(runId), { recursive: true, force: true }); } catch { /* ignore */ } }

/** Fresh capture of just one page (reference image and metrics), used when a checkpoint is resumed after a restart. */
async function recapturePage(url, config, { browserType = chromium, validateUrl = capture.validatePublicUrl } = {}) {
  await validateUrl(url);
  const browser = await launchChromium({ browserType });
  try {
    const context = await newReferenceContext(browser, config.viewports.desktop, validateUrl);
    return await capturePage(context, url, config, { wantImage: true });
  } finally { await browser.close().catch(() => {}); }
}

module.exports = { crawlReference, capturePage, recapturePage, linkCandidates, classifyFailure, withRetries, writeCachedImage, readCachedImage, clearCache, cacheDirFor, newReferenceContext };
