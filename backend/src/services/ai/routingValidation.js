/**
 * Multi-page routing validation.
 *
 * A clone (or any multi-page site) is only correct when every page has its own URL AND that URL shows that page. The
 * failures this catches are the ones a "does it render" smoke test accepts:
 *   - a route that renders a copy of the home page (not registered, or a lookup that falls back to Home),
 *   - two routes that show the same content,
 *   - an unknown / not-cloned link that shows the home page (or nothing) instead of a "not cloned" page,
 *   - a route that renders blank,
 *   - navigation links that lead nowhere useful.
 *
 * Rendering is injected (`render`), so it works with the project's existing preview renderer and is testable.
 */

const UNKNOWN_ROUTE = '/__veave_unknown_route__';
const FATAL = new Set(['navigation-does-not-work', 'route-render-failed', 'route-blank', 'route-shows-home', 'routes-identical', 'unknown-route-shows-home', 'unknown-route-blank']);

/* eslint-disable no-undef */
// Runs inside the rendered page.
function pageProbe() {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  // The page's own content: the site chrome (header, navigation, footer) is shared by every page and would make different
  // pages look alike, so it is hidden while the text is read and restored afterwards.
  const chrome = [...document.querySelectorAll('header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"]')];
  const saved = chrome.map((el) => el.style.display);
  chrome.forEach((el) => { el.style.setProperty('display', 'none', 'important'); });
  const text = clean(document.body.innerText);
  chrome.forEach((el, index) => { el.style.removeProperty('display'); if (saved[index]) el.style.display = saved[index]; });
  const main = document.querySelector('main') || document.body;
  const headingEl = main.querySelector('h1, h2') || document.querySelector('h1, h2');
  const links = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/') || href.startsWith('//') || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: clean(a.textContent).slice(0, 40), inNav: Boolean(a.closest('header, nav')) });
    if (links.length >= 200) break;
  }
  return {
    path: typeof window.__veavePathname === 'function' ? window.__veavePathname() : location.pathname,
    textLength: text.length,
    sample: text.slice(0, 4000),
    heading: clean(headingEl && headingEl.textContent).slice(0, 120),
    links,
    notCloned: /not part of the cloned|page not found|\b404\b|not found/i.test(text.slice(0, 600))
  };
}
/* eslint-enable no-undef */

/* eslint-disable no-undef */
// Navigation links that sit outside the visible width cannot be clicked, which feels exactly like "the page does not route".
function navReachability() {
  const links = [...document.querySelectorAll('header a[href], nav a[href]')].filter((a) => {
    const style = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !a.closest('[hidden]');
  });
  const off = links.filter((a) => { const r = a.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; });
  return { total: links.length, off: off.length, sample: off.slice(0, 5).map((a) => (a.textContent || '').trim().slice(0, 24)), width: window.innerWidth };
}
/* eslint-enable no-undef */

const normalize = (value = '') => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordsOf = (value = '') => normalize(value).split(' ').filter(Boolean).slice(0, 400);

/** Jaccard similarity of the word sets of two page samples (1 = the same page). */
function similarity(a = '', b = '') {
  const wa = new Set(wordsOf(a));
  const wb = new Set(wordsOf(b));
  if (!wa.size || !wb.size) return wa.size === wb.size ? 1 : 0;
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

/** How the app picks a page: a router library, or its own reading of window.location (works in a browser, not in sandboxed previews). */
function routingMechanism(files = []) {
  const source = files.filter((file) => file && file.encoding !== 'base64' && /^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) && typeof file.content === 'string').map((file) => file.content).join('\n');
  if (/from\s+['"]react-router(?:-dom)?['"]/.test(source)) return 'react-router';
  if (/\b(?:window\.)?location\.pathname\b/.test(source)) return 'window.location';
  return 'unknown';
}

const normalizePath = (value = '') => String(value).split(/[?#]/)[0].replace(/\/+$/, '') || '/';

/**
 * @param {object} p
 * @param {Array}  p.files
 * @param {Array}  p.routes        [{ path, expectedHeading? }]  the pages that must exist
 * @param {Function} p.render      async (files, { routePath, viewport, inspect }) => probe
 * @param {Function} [p.clickThrough] async (files, links) => [{ href, landedOn, sample, error? }]  real link clicks from the home page
 */
async function validateRouting({ files, routes = [], render, clickThrough = null, signal = null, maxRoutes = 14 }) {
  const wanted = [...new Map([{ path: '/' }, ...routes].map((route) => [normalizePath(route.path), { ...route, path: normalizePath(route.path) }])).values()].slice(0, maxRoutes);
  const issues = [];
  const probes = new Map();
  const add = (severity, kind, route, detail, extra = {}) => issues.push({ severity, kind, route, detail, ...extra });

  for (const route of wanted) {
    signal?.throwIfAborted();
    try {
      probes.set(route.path, await render(files, { routePath: route.path, viewport: { width: 1440, height: 900 }, inspect: pageProbe }));
    } catch (error) {
      if (signal?.aborted) throw error;
      add('fatal', 'route-render-failed', route.path, String(error.message).slice(0, 240));
    }
  }
  const home = probes.get('/');
  let unknown = null;
  try { unknown = await render(files, { routePath: UNKNOWN_ROUTE, viewport: { width: 1440, height: 900 }, inspect: pageProbe }); }
  catch (error) { if (signal?.aborted) throw error; add('fatal', 'unknown-route-blank', UNKNOWN_ROUTE, `a link to a page that does not exist crashes the app: ${String(error.message).slice(0, 160)}`); }

  // Each page must exist and be its own page.
  const compared = [];
  for (const route of wanted) {
    const probe = probes.get(route.path);
    if (!probe) continue;
    // A page whose real content is mostly pictures (a few words of text) only needs those words; others need real text.
    // (Same threshold as the clone's own blank-page rule: a source page under 600 characters is never "blank".)
    const minimumText = route.expectedTextLength === undefined || route.expectedTextLength >= 600 ? 40 : 10;
    if (probe.textLength < minimumText) { add('fatal', 'route-blank', route.path, `the page renders ${probe.textLength} characters of text${probe.sample ? ` ("${probe.sample.slice(0, 80)}")` : ''}`, { sample: probe.sample.slice(0, 200) }); continue; }
    if (route.path !== '/' && home) {
      const likeHome = similarity(probe.sample, home.sample);
      const headingDiffers = route.expectedHeading && normalize(route.expectedHeading) !== normalize(home.heading) && !normalize(home.sample).includes(normalize(route.expectedHeading).slice(0, 40));
      if (likeHome >= 0.9 && (headingDiffers || !route.expectedHeading)) {
        add('fatal', 'route-shows-home', route.path, `${route.path} shows the home page's content (${Math.round(likeHome * 100)}% the same). The route is not registered or the router falls back to Home.`, { similarity: Math.round(likeHome * 100) });
        continue;
      }
    }
    for (const earlier of compared) {
      if (route.path === '/' || earlier.path === '/') continue;
      const alike = similarity(probe.sample, earlier.probe.sample);
      if (alike >= 0.95 && probe.textLength > 200) { add('fatal', 'routes-identical', route.path, `${route.path} and ${earlier.path} show the same content (${Math.round(alike * 100)}% the same).`, { with: earlier.path }); break; }
    }
    compared.push({ path: route.path, probe });
    if (route.expectedHeading && !normalize(probe.sample).includes(normalize(route.expectedHeading).slice(0, 60))) {
      add('warning', 'wrong-heading', route.path, `the page does not show its expected heading "${String(route.expectedHeading).slice(0, 60)}"`);
    }
  }

  // Links to pages that do not exist (not cloned) must land on a "not cloned" page, never on a copy of Home or on nothing.
  if (unknown) {
    if (unknown.textLength < 40) add('fatal', 'unknown-route-blank', UNKNOWN_ROUTE, 'a link to a page that does not exist renders an empty screen');
    else if (home && similarity(unknown.sample, home.sample) >= 0.9) add('fatal', 'unknown-route-shows-home', UNKNOWN_ROUTE, 'a link to a page that does not exist shows a copy of the home page instead of a "not cloned" page');
  }

  // Navigation: every internal navigation link must point at a page the site has, or at the not-cloned page.
  const known = new Set(wanted.map((route) => route.path));
  const navLinks = (home?.links || []).filter((link) => link.inNav);
  const toKnown = navLinks.filter((link) => known.has(normalizePath(link.href)));
  const toUncloned = navLinks.filter((link) => !known.has(normalizePath(link.href)));
  const reachable = new Set(navLinks.map((link) => normalizePath(link.href)).concat((home?.links || []).map((link) => normalizePath(link.href))));
  for (const route of wanted) if (route.path !== '/' && probes.has(route.path) && !reachable.has(route.path)) add('warning', 'route-unreachable', route.path, `no link on the home page leads to ${route.path}`);

  const mechanism = routingMechanism(files);
  let navigation = { attempted: 0, passed: 0, results: [] };
  if (clickThrough && toKnown.length) {
    try {
      const targets = [...new Map(toKnown.filter((link) => normalizePath(link.href) !== '/').map((link) => [normalizePath(link.href), link])).values()].slice(0, 8);
      const results = await clickThrough(files, targets);
      for (const result of results) {
        const route = normalizePath(result.href);
        const expected = probes.get(route);
        const ok = !result.error && expected && similarity(result.sample || '', expected.sample) >= 0.8;
        navigation.attempted += 1;
        if (ok) navigation.passed += 1;
        navigation.results.push({ href: result.href, ok, landedOn: result.landedOn || null, error: result.error || null });
        if (!ok) {
          const shim = !result.error && mechanism === 'window.location';
          add('warning', shim ? 'click-needs-real-page-load' : 'click-does-not-navigate', route, result.error
            ? `clicking the link failed: ${String(result.error).slice(0, 120)}`
            : shim ? `the app picks its page from window.location, so a click only works with a real page load (published site and built preview); the sandboxed live preview does not follow it. Use a router (react-router-dom) for in-page navigation.`
              : `clicking the link to ${route} does not show that page`);
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      navigation = { attempted: 0, passed: 0, results: [], skipped: String(error.message).slice(0, 160) };
    }
  }

  // Every link was really clicked (nothing errored) and none showed its page: navigation as a whole does not work.
  if (navigation.attempted >= 3 && navigation.passed === 0 && navigation.results.every((result) => !result.error)) {
    add('fatal', 'navigation-does-not-work', '/', `clicking ${navigation.attempted} navigation links did not show any of their pages`, { clicked: navigation.results.map((result) => result.href).slice(0, 8) });
  }

  // At laptop width every visible navigation link must be inside the screen.
  try {
    const laptop = await render(files, { routePath: '/', viewport: { width: 1024, height: 768 }, inspect: navReachability });
    if (laptop && laptop.off > 0) add('warning', 'nav-links-offscreen', '/', `${laptop.off} of ${laptop.total} navigation links are outside the screen at ${laptop.width}px wide (${laptop.sample.join(', ')}), so they cannot be clicked`);
  } catch (error) { if (signal?.aborted) throw error; }

  const fatal = issues.filter((issue) => issue.severity === 'fatal');
  return {
    ok: fatal.length === 0,
    status: fatal.length ? 'failed' : issues.length ? 'passed-with-warnings' : 'passed',
    mechanism,
    routesChecked: wanted.length,
    routesRendered: probes.size,
    unknownRoute: unknown ? { rendersNotClonedPage: Boolean(unknown.notCloned), textLength: unknown.textLength } : null,
    navigation: { links: navLinks.length, toKnownPages: toKnown.length, toUnclonedPages: toUncloned.length, unclonedSample: toUncloned.slice(0, 8).map((link) => link.href), click: navigation },
    issues,
    fatal
  };
}

/**
 * Real link clicks from the home page: for each link the page is loaded fresh, the link is clicked and the page that
 * results is read, so a link that does not lead to its page is caught as a user would see it.
 * `inspectRenderedPreview` is the existing preview renderer.
 */
function makeClickThrough(inspectRenderedPreview, { signal = null } = {}) {
  return async (files, links) => {
    const results = [];
    await inspectRenderedPreview(files, {
      signal, routePath: '/', inspect: () => null,
      onPage: async (page) => {
        for (const link of links) {
          try {
            await page.goto('http://preview.local/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() => ((document.querySelector('#root') || document.body).innerText || '').trim().length > 20, null, { timeout: 15000 });
            // The preview starts in selection mode; a user browsing the site (like the studio's Preview) has it switched off.
            await page.evaluate(() => window.postMessage({ type: 'toggle-inspect-mode', enabled: false }, '*'));
            await page.waitForTimeout(100);
            await page.locator(`header a[href="${link.href}"], nav a[href="${link.href}"]`).first().click({ timeout: 5000 });
            await page.waitForTimeout(800);
            const probe = await page.evaluate(pageProbe);
            results.push({ href: link.href, landedOn: probe.path, sample: probe.sample });
          } catch (error) {
            results.push({ href: link.href, error: String(error.message).split('\n')[0] });
          }
        }
      }
    });
    return results;
  };
}

module.exports = { navReachability, routingMechanism, makeClickThrough, UNKNOWN_ROUTE, FATAL, pageProbe, similarity, validateRouting, normalizePath };
