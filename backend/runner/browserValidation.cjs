'use strict';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
};

const { inspectReference, compareScreenshot } = require('./visualComparison.cjs');

function diagnostic(category, message, path = null, line = null, column = null) {
  return { category, path, line, column, message };
}

function validatePlan(plan) {
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
  const string = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
  if (!keys(plan, ['version', 'tests']) || plan.version !== 1 || !Array.isArray(plan.tests) ||
      !plan.tests.length || plan.tests.length > 1000) {
    throw new Error('Expected {version:1, tests:[...]} with 1-1000 tests. Unknown fields are rejected.');
  }
  let steps = 0;
  const names = new Set();
  for (const test of plan.tests) {
    if (!keys(test, ['name', 'path', 'viewports', 'steps']) || !string(test.name) || names.has(test.name) ||
        (test.path !== undefined && (!string(test.path) || !test.path.startsWith('/') ||
          test.path.startsWith('//') || /[\\\x00-\x20]/.test(test.path))) ||
        (test.viewports !== undefined && (!Array.isArray(test.viewports) || !test.viewports.length ||
          test.viewports.some((name) => !Object.hasOwn(VIEWPORTS, name)) ||
          new Set(test.viewports).size !== test.viewports.length)) ||
        !Array.isArray(test.steps) || !test.steps.length || test.steps.length > 50) {
      throw new Error('Invalid test: unique name, local path, desktop/mobile viewports and 1-50 steps required.');
    }
    names.add(test.name);
    let assertions = 0;
    for (const step of test.steps) {
      if (!object(step) || !string(step.selector)) throw new Error(`Invalid selector in test ${test.name}.`);
      const allowed = {
        click: ['action', 'selector'],
        fill: ['action', 'selector', 'value'],
        select: ['action', 'selector', 'value'],
        check: ['action', 'selector', 'checked'],
        assert: ['action', 'selector', 'text', 'targetText', 'visible', 'style', 'count']
      };
      if (!Object.hasOwn(allowed, step.action) || !keys(step, allowed[step.action])) {
        throw new Error(`Unknown action or field in test ${test.name}. No script/eval actions are supported.`);
      }
      if (['fill', 'select'].includes(step.action) &&
          (typeof step.value !== 'string' || step.value.length > 4096)) throw new Error('A string value is required.');
      if (step.action === 'check' && typeof step.checked !== 'boolean') throw new Error('A boolean checked is required.');
      if (step.action === 'assert') {
        assertions++;
        if ((step.text === undefined && step.visible === undefined && step.style === undefined && step.count === undefined) ||
            (step.text !== undefined && typeof step.text !== 'string') ||
            (step.targetText !== undefined && typeof step.targetText !== 'string') ||
            (step.visible !== undefined && typeof step.visible !== 'boolean') ||
            (step.count !== undefined && (!Number.isInteger(step.count) || step.count < 0 || step.count > 1000)) ||
            (step.style !== undefined && (!keys(step.style, ['property', 'value']) || !string(step.style.property) || !string(step.style.value))) ||
            (step.text !== undefined && step.text.length > 4096)) throw new Error('An assertion needs text and/or boolean visible.');
      }
    }
    if (!assertions) throw new Error(`Test ${test.name} must contain at least one assertion.`);
    steps += test.steps.length;
  }
  if (steps > 2000) throw new Error('A plan may contain at most 2000 steps.');
  return plan;
}

// This code is fixed by the runner, never supplied by a project/test plan.
async function hasVisibleContent(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#root') || document.querySelector('#app') || document.body;
    if (!root) return false;
    const visible = (element, rect) => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || node.hidden) return false;
      }
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < innerHeight && rect.left < innerWidth;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let count = 0;
    while ((node = walker.nextNode()) && count++ < 10000) {
      if (!node.textContent.trim() || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.parentElement.tagName)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (visible(node.parentElement, range.getBoundingClientRect())) return true;
    }
    const media = 'img,svg,canvas,video,iframe,input:not([type="hidden"]),textarea,select';
    return [...(root.matches(media) ? [root] : []), ...root.querySelectorAll(media)]
      .slice(0, 10000).some((element) => visible(element, element.getBoundingClientRect()) &&
        (element.tagName !== 'IMG' || (element.complete && element.naturalWidth > 0)));
  });
}

async function validateBrowser(url, options = {}) {
  const diagnostics = [];
  const checks = [];
  const coverage = {
    kind: 'bounded-smoke', exhaustive: false, viewports: [], routes: [], interactions: [], plannedTests: [], skips: [],
    network: { completedRequests: 0, noContentCompletions: 0, teardownAborts: 0 },
    limits: {},
    statement: 'Bounded smoke checks, not exhaustive functional, visual, accessibility or security testing. External dependencies require local mocks.'
  };
  let visual = null;
  const result = () => ({ ok: diagnostics.length === 0, diagnostics, checks, coverage, visual });
  const seen = new Set();
  let errorCount = 0;
  function add(category, message, path = null, line = null, column = null) {
    errorCount++;
    if (diagnostics.length > 200) return;
    if (message.length > 65536) message = `${message.slice(0, 65536)}\n[Diagnostic exceeded 64 KiB; truncated.]`;
    if (typeof path === 'string') path = path.slice(0, 4096);
    const key = JSON.stringify([category, message, path, line, column]);
    if (seen.has(key)) return;
    seen.add(key);
    if (diagnostics.length < 200) diagnostics.push(diagnostic(category, message, path, line, column));
    else if (diagnostics.length === 200) diagnostics.push(diagnostic('limit', 'Diagnostic limit reached; validation failed.'));
  }
  function skip(message) {
    if (coverage.skips.length < 500) coverage.skips.push(message.slice(0, 4096));
    else if (coverage.skips.length === 500) coverage.skips.push('Additional skips omitted after limit 500.');
  }
  const check = (name, status, details = {}) => checks.push({ name, status, ...details });
  let browser;
  let timer;
  let expired = false;
  const pending = new Set();
  const contexts = new Map();
  const beginCleanup = (state) => {
    state.closing = true;
    state.teardownRequests = new Set(state.requests);
  };
  try {
    const base = new URL(url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
        !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Validation URL must be a loopback HTTP(S) URL without credentials.');
    if (options.plan !== undefined) validatePlan(options.plan);
    function limit(name, fallback, maximum, minimum = 0) {
      const value = options[name] ?? fallback;
      if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}; expected integer ${minimum}-${maximum}.`);
      return value;
    }
    const maxRoutes = limit('maxRoutes', 6, 1000);
    const maxInteractions = limit('maxInteractions', 12, 40);
    const settleMs = limit('settleMs', 300, 2000);
    const actionTimeout = limit('actionTimeout', 3000, 10000, 100);
    const navigationTimeout = limit('navigationTimeout', 15000, 30000, 100);
    const networkTimeout = limit('networkTimeout', 5000, 30000, 100);
    const timeoutMs = limit('timeoutMs', 90000, 900000, 1000);
    coverage.limits = { maxRoutes, maxInteractions, settleMs, actionTimeout, navigationTimeout, networkTimeout, timeoutMs };
    const chromium = options.chromium || require('playwright').chromium;
    const work = async () => {
      browser = await chromium.launch({ headless: true, timeout: Math.min(timeoutMs, 90000) });
      if (expired) { await browser.close(); return; }
      const internal = (target) => {
        try {
          const parsed = new URL(target, base);
          return ['data:', 'blob:'].includes(parsed.protocol) ||
            (parsed.origin === base.origin && !parsed.username && !parsed.password);
        } catch { return false; }
      };
      if (options.visualReferencePath) {
        const visualStart = errorCount;
        let visualContext;
        try {
          const reference = await inspectReference(options.visualReferencePath);
          visualContext = await browser.newContext({
            viewport: { width: reference.width, height: reference.height },
            serviceWorkers: 'block',
            acceptDownloads: false
          });
          await visualContext.route('**/*', async (route) => {
            if (internal(route.request().url())) await route.continue();
            else await route.abort('blockedbyclient');
          });
          const visualPage = await visualContext.newPage();
          await visualPage.goto(url, { waitUntil: 'networkidle', timeout: navigationTimeout });
          await visualPage.evaluate(() => document.fonts?.ready);
          await visualPage.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
          const rendered = await visualPage.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
          visual = await compareScreenshot(reference, rendered, options.visualThreshold);
          coverage.visual = visual;
          if (!visual.passed) {
            const regions = visual.lowestScoringRegions.map((region) => `${region.name} ${region.score}`).join(', ');
            add('visual', `Rendered screenshot similarity ${visual.score} is below required ${visual.threshold}. Lowest-scoring regions: ${regions}. Match layout, spacing, typography, colors, image crop, and visible content to the reference.`, 'screenshot-reference');
          }
        } catch (error) {
          add('visual', error.stack || String(error), 'screenshot-reference');
        } finally {
          await visualContext?.close().catch(() => {});
        }
        check('visual', errorCount === visualStart ? 'passed' : 'failed', visual || {});
      }
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        if (expired) return;
        const makeContext = async () => {
          const context = await browser.newContext({ viewport, isMobile: viewportName === 'mobile',
            hasTouch: viewportName === 'mobile', serviceWorkers: 'block', acceptDownloads: false });
          const state = { requests: new Set(), responses: new WeakMap(), routes: 0,
            activity: Date.now(), closing: false, teardownRequests: new Set(), drainError: null };
          contexts.set(context, state);
          await context.route('**/*', async (route) => {
            const request = route.request();
            state.routes++;
            state.activity = Date.now();
            try {
              if (!internal(request.url())) {
                add('external-blocked', `Blocked external ${request.method()} ${request.url()}. Provide a local mock; external dependencies are not validated.`, request.url());
                await route.abort('blockedbyclient');
                return;
              }
              // continue() can follow redirects without invoking the route handler again.
              // Fetch without redirects, inspect Location, and never release a redirect to the browser.
              const response = await route.fetch({ maxRedirects: 0, timeout: navigationTimeout });
              const location = response.headers().location;
              if (response.status() >= 300 && response.status() < 400 && location) {
                const target = new URL(location, request.url()).href;
                add(internal(target) ? 'redirect-blocked' : 'external-blocked',
                  `Blocked HTTP ${response.status()} redirect from ${request.url()} to ${target}. Use a direct local URL or mock; redirects are unsupported.`, request.url());
                await route.abort('blockedbyclient');
              } else {
                await route.fulfill({ response });
              }
              await response.dispose();
            } catch (error) {
              if (!expired && !(state.closing && state.teardownRequests.has(request))) {
                add('network', error.stack || String(error), request.url());
              }
              await route.abort('failed').catch(() => {});
            } finally {
              state.routes--;
              state.activity = Date.now();
            }
          });
          // HTTP routing does not intercept WebSockets. Never silently allow an external socket.
          if (typeof context.routeWebSocket !== 'function') throw new Error('Playwright routeWebSocket support is required (1.58.2).');
          await context.routeWebSocket('**/*', (socket) => {
            const target = new URL(socket.url());
            target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
            if (target.origin === base.origin) socket.connectToServer();
            else {
              add('external-blocked', `Blocked external WebSocket ${socket.url()}. Provide a local mock.`, socket.url());
              socket.close();
            }
          });
          context.on('request', (request) => {
            state.requests.add(request);
            if (state.closing) state.teardownRequests.add(request);
            state.activity = Date.now();
          });
          context.on('requestfinished', (request) => {
            state.requests.delete(request);
            state.activity = Date.now();
            coverage.network.completedRequests++;
          });
          context.on('requestfailed', (request) => {
            state.requests.delete(request);
            state.activity = Date.now();
            const error = request.failure()?.errorText || 'unknown failure';
            // Chromium can abandon an unconsumed, bodyless fetch after delivering its 204.
            // This is not a failed transport; never extend this exception to other responses.
            if (error === 'net::ERR_ABORTED' && request.resourceType() === 'fetch' && state.responses.get(request) === 204) {
              coverage.network.noContentCompletions++;
              coverage.network.completedRequests++;
            } else if (error === 'net::ERR_ABORTED' && state.closing && state.teardownRequests.has(request)) {
              coverage.network.teardownAborts++;
            } else {
              add('network', `${request.method()} ${request.url()} failed: ${error}`, request.url());
            }
          });
          context.on('response', (response) => {
            state.responses.set(response.request(), response.status());
            state.activity = Date.now();
            if (response.status() >= 400) add('http', `HTTP ${response.status()} ${response.statusText()} for ${response.url()}`, response.url());
          });
          context.on('page', (page) => {
            page.setDefaultTimeout(actionTimeout);
            page.setDefaultNavigationTimeout(navigationTimeout);
            page.on('pageerror', (error) => {
              const stack = error.stack || String(error);
              const location = stack.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
              add('pageerror', stack, location?.[1] || page.url(), location ? Number(location[2]) : null, location ? Number(location[3]) : null);
            });
            page.on('crash', () => add('browser', 'Page crashed.', page.url()));
            page.on('console', (message) => {
              if (message.type() !== 'error') return;
              state.activity = Date.now();
              if (pending.size >= 200) { add('limit', 'Console event limit reached.'); return; }
              const location = message.location();
              const task = (async () => {
                const stacks = await Promise.all(message.args().map((arg) =>
                  arg.evaluate((value) => value instanceof Error ? value.stack : null).catch(() => null)));
                add('console', [message.text(), ...stacks.filter(Boolean)].join('\n'), location.url || page.url(),
                  location.lineNumber == null ? null : location.lineNumber + 1,
                  location.columnNumber == null ? null : location.columnNumber + 1);
              })();
              pending.add(task);
              task.finally(() => { pending.delete(task); state.activity = Date.now(); });
            });
            page.on('dialog', (dialog) => {
              skip(`${viewportName}: dismissed ${dialog.type()} dialog; confirmation branch not covered.`);
              dialog.dismiss().catch(() => {});
            });
            page.on('download', (download) => {
              skip(`${viewportName}: download ${download.suggestedFilename()} not inspected.`);
              download.cancel().catch(() => {});
            });
          });
          return context;
        };
        coverage.viewports.push({ name: viewportName, ...viewport });
        let context = await makeContext();
        let page = await context.newPage();
        const settle = async () => {
          const state = contexts.get(context);
          if (state.drainError) throw state.drainError;
          const deadline = Date.now() + networkTimeout + settleMs;
          // A quiet window starts after completion, not after dispatch or receipt of headers.
          let quietSince = Date.now();
          while (true) {
            if (expired) throw new Error('Browser validation deadline exceeded.');
            const busy = state.requests.size || state.routes || pending.size;
            if (busy) quietSince = Date.now();
            else if (Date.now() - Math.max(quietSince, state.activity) >= settleMs) return;
            if (Date.now() >= deadline) {
              const outstanding = [...state.requests].slice(0, 20).map((request) => `${request.method()} ${request.url()}`);
              state.drainError = new Error(`Network did not settle within ${networkTimeout}ms plus ${settleMs}ms quiet window.\n${outstanding.join('\n')}`);
              add('network-timeout', state.drainError.stack, page.url());
              throw state.drainError;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        };
        const closeContext = async () => {
          const state = contexts.get(context);
          try { await settle(); }
          finally {
            beginCleanup(state);
            await context.close();
            contexts.delete(context);
          }
        };
        const content = async (label) => {
          const visible = await hasVisibleContent(page);
          check('visible-root', visible ? 'passed' : 'failed', { viewport: viewportName, path: page.url(), label });
          if (!visible) add('blank', `No visible root text or media/controls in ${viewportName} viewport (${label}).`, page.url());
        };
        const visit = async (target, label) => {
          const start = errorCount;
          await settle();
          await page.goto(target, { waitUntil: 'domcontentloaded' });
          await settle();
          await content(label);
          check('navigation', errorCount === start ? 'passed' : 'failed', { viewport: viewportName, path: target, label });
        };
        const smokeStart = errorCount;
        try {
          await visit(url, 'startup');
          const anchors = await page.locator('a[href]').evaluateAll((links) => links.slice(0, 200).map((link) => ({
            href: link.href, download: link.hasAttribute('download'), text: link.textContent.trim().slice(0, 100)
          })));
          const routes = [];
          for (const anchor of anchors) {
            if (anchor.href.length > 4096) { skip(`${viewportName}: oversized anchor URL not followed.`); continue; }
            if (anchor.download || !internal(anchor.href) || !/^https?:/.test(anchor.href)) {
              skip(`${viewportName}: anchor ${anchor.href} (external, download or non-HTTP).`);
            } else if (!routes.includes(anchor.href) && anchor.href !== url) routes.push(anchor.href);
          }
          if (await page.locator('a[href]').count() > 200) skip(`${viewportName}: anchors beyond discovery limit 200.`);
          for (const target of routes.slice(0, maxRoutes)) {
            if (expired) break;
            const start = errorCount;
            try {
              await visit(target, 'anchor route');
              const hash = new URL(target).hash;
              if (hash && !hash.startsWith('#/') && hash !== '#') {
                const id = decodeURIComponent(hash.slice(1));
                const exists = await page.evaluate((value) => !!document.getElementById(value) ||
                  [...document.getElementsByName(value)].some((node) => node.tagName === 'A'), id);
                if (!exists) throw new Error(`Missing fragment target ${hash}`);
              }
              coverage.routes.push({ viewport: viewportName, path: target, status: errorCount === start ? 'passed' : 'failed' });
            } catch (error) {
              add('route', error.stack || String(error), target);
              coverage.routes.push({ viewport: viewportName, path: target, status: 'failed' });
            }
          }
          if (routes.length > maxRoutes) skip(`${viewportName}: ${routes.length - maxRoutes} routes beyond limit.`);
          await visit(url, 'interaction baseline');
          const selector = 'button,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="menuitem"],summary,input,textarea,select';
          const used = new Set();
          let actions = 0;
          while (actions < maxInteractions && !expired) {
            const candidates = page.locator(selector);
            const discovered = await candidates.count();
            if (discovered > 200) skip(`${viewportName}: controls beyond discovery limit 200.`);
            const count = Math.min(discovered, 200);
            let selected = null;
            for (let i = 0; i < count; i++) {
              const candidate = candidates.nth(i);
              const info = await candidate.evaluate((element) => ({ tag: element.tagName, type: element.type || '',
                role: (element.getAttribute('role') || '').slice(0, 100), id: element.id.slice(0, 100), name: (element.getAttribute('name') || '').slice(0, 100),
                text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 100) }));
              const key = JSON.stringify([i, info]);
              if (used.has(key) || !await candidate.isVisible() || !await candidate.isEnabled()) continue;
              used.add(key);
              if (['hidden', 'file', 'color', 'range', 'date', 'datetime-local', 'month', 'week', 'time'].includes(info.type) ||
                  (['INPUT', 'TEXTAREA'].includes(info.tag) && !await candidate.isEditable() && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(info.type))) {
                skip(`${viewportName}: unsupported/read-only control ${JSON.stringify(info)}.`);
                continue;
              }
              selected = { candidate, info };
              break;
            }
            if (!selected) break;
            actions++;
            const { candidate, info } = selected;
            let action = 'click';
            const start = errorCount;
            try {
              if (info.tag === 'SELECT') {
                action = 'select';
                const value = await candidate.evaluate((select) => [...select.options].find((option) =>
                  !option.disabled && !option.parentElement.disabled && option.value !== select.value)?.value);
                if (value === undefined) {
                  skip(`${viewportName}: select has no alternative enabled option.`);
                  continue;
                }
                await candidate.selectOption(value);
              } else if (info.tag === 'TEXTAREA' || (info.tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(info.type))) {
                action = 'fill';
                await candidate.fill(info.type === 'email' ? 'smoke@example.test' : info.type === 'number' ? '1' :
                  info.type === 'url' ? `${base.origin}/` : info.type === 'tel' ? '5550100' : 'smoke test');
                if (info.type === 'search') { action = 'search'; await candidate.press('Enter'); }
              } else {
                await candidate.click();
              }
              await settle();
              await content(`after ${action}`);
              const status = errorCount === start ? 'passed' : 'failed';
              coverage.interactions.push({ viewport: viewportName, action, control: info, status });
              check('interaction', status, { viewport: viewportName, action, control: info });
            } catch (error) {
              add('interaction', error.stack || String(error), page.url());
              coverage.interactions.push({ viewport: viewportName, action, control: info, status: 'failed' });
              check('interaction', 'failed', { viewport: viewportName, action, control: info });
              if (!page.isClosed()) await visit(url, 'interaction recovery');
            }
          }
          if (actions === maxInteractions) skip(`${viewportName}: interaction budget reached; remaining controls/state combinations not covered.`);
          skip(`${viewportName}: smoke fills/searches/selects and clicks submit controls, but does not enumerate all form values, hidden/disabled controls, gestures or authenticated states.`);
        } catch (error) {
          add('browser', error.stack || String(error), page.url());
        }
        check('smoke', errorCount === smokeStart ? 'passed' : 'failed', { viewport: viewportName });
        // Each explicit scenario starts with a fresh context to avoid smoke/localStorage state leakage.
        await settle().catch(() => {});
        for (const test of options.plan?.tests || []) {
          if (expired || (test.viewports && !test.viewports.includes(viewportName))) {
            skip(`${viewportName}: plan ${test.name} not run (deadline or viewport selection).`);
            continue;
          }
          await closeContext();
          context = await makeContext();
          page = await context.newPage();
          const start = errorCount;
          try {
            await visit(new URL(test.path || '/', base).href, `plan: ${test.name}`);
            for (const step of test.steps) {
              if (expired) throw new Error('Browser validation deadline exceeded.');
              let locator = page.locator(step.selector);
              if (step.targetText !== undefined) locator = locator.filter({ hasText: step.targetText });
              if (step.action === 'click') await locator.click();
              if (step.action === 'fill') await locator.fill(step.value);
              if (step.action === 'select') await locator.selectOption(step.value);
              if (step.action === 'check') await locator.setChecked(step.checked);
              if (step.action === 'assert') {
                const { expect } = require('playwright/test');
                if (step.visible !== undefined) {
                  if (step.visible) await expect(locator).toBeVisible({ timeout: actionTimeout });
                  else await expect(locator).toBeHidden({ timeout: actionTimeout });
                }
                if (step.text !== undefined) await expect(locator).toContainText(step.text, { timeout: actionTimeout });
                if (step.count !== undefined) await expect(locator).toHaveCount(step.count, { timeout: actionTimeout });
                if (step.style !== undefined) {
                  await expect(locator).toHaveCount(1, { timeout: actionTimeout });
                  await expect(locator).toHaveCSS(step.style.property, step.style.value, { timeout: actionTimeout });
                }
              }
              await settle();
            }
            await content(`plan: ${test.name}`);
          } catch (error) {
            add('plan', `${test.name}: ${error.stack || error}`, 'veave.validation.json');
          }
          const status = errorCount === start ? 'passed' : 'failed';
          check('plan', status, { viewport: viewportName, test: test.name });
          coverage.plannedTests.push({ viewport: viewportName, name: test.name, status });
        }
        await closeContext();
      }
    };
    await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error(`Browser validation exceeded ${timeoutMs}ms.`)); }, timeoutMs);
    })]);
  } catch (error) {
    if (expired) skip('Deadline reached; remaining viewports, routes, controls and planned scenarios were not validated.');
    add(options.plan !== undefined && !browser ? 'validation' : 'browser', error.stack || String(error));
  } finally {
    clearTimeout(timer);
    if (browser) {
      for (const state of contexts.values()) beginCleanup(state);
      let cleanupTimer;
      try {
        await Promise.race([browser.close(), new Promise((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error('Chromium cleanup exceeded 5000ms; discard the container.')), 5000);
        })]);
      } catch (error) { add('browser', error.stack || String(error)); }
      finally { clearTimeout(cleanupTimer); }
    }
  }
  check('browser', diagnostics.length ? 'failed' : 'passed');
  return result();
}

module.exports = { validateBrowser, validatePlan };
