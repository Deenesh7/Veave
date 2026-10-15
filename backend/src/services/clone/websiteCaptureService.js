const dns = require('node:dns').promises;
const net = require('node:net');
const { chromium } = require('playwright');
const { prepareLocalizedAssets, buildAssetPlacementQueue } = require('./assetLocalizationService');
const { launchChromium } = require('../browser/launchChromium');

const DEFAULT_DISCOVERY_BATCH = 500;
const ROUTE_HARD_CAP = Math.max(1, Number.parseInt(process.env.CLONE_ROUTE_HARD_CAP, 10) || 500);
const DEFAULT_MAX_ROUTES = Math.min(ROUTE_HARD_CAP, Math.max(1, Number.parseInt(process.env.CLONE_MAX_ROUTES, 10) || 100));

function resolveRouteLimit(requested) {
  const value = Number.parseInt(requested, 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, ROUTE_HARD_CAP) : DEFAULT_MAX_ROUTES;
}
const MAX_CRAWL_DURATION_MS = Math.max(30000, Number.parseInt(process.env.CLONE_MAX_CRAWL_DURATION_MS, 10) || 15 * 60 * 1000);
const configuredScrollHeight = Number.parseInt(process.env.CLONE_MAX_PAGE_SCROLL_HEIGHT, 10);
const MAX_PAGE_SCROLL_HEIGHT = Number.isFinite(configuredScrollHeight) && configuredScrollHeight > 0 ? configuredScrollHeight : null;
const MAX_PAGE_SCROLL_DURATION_MS = Math.max(5000, Number.parseInt(process.env.CLONE_MAX_PAGE_SCROLL_DURATION_MS, 10) || 120000);
const MAX_ASSETS = Infinity;
const MAX_ASSET_CANDIDATES = Infinity;
const MAX_ASSET_BYTES = Infinity;
const MAX_TOTAL_ASSET_BYTES = Infinity;
const MAX_PAGE_ASSET_BYTES = Infinity;
const MAX_CANDIDATE_BYTES = Infinity;

function isPrivateAddress(address) {
  if (!net.isIP(address)) return true;
  if (address.includes(':')) {
    const value = address.toLowerCase().split('%')[0];
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
      /^fe[89ab]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8:') ||
      value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.') ||
      /^::ffff:172\.(?:1[6-9]|2\d|3[01])\./.test(value);
  }
  const octets = address.split('.').map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0);
}

async function validatePublicUrl(value, lookup = dns.lookup) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Website URL must be a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Website URL must use HTTP or HTTPS.');
  if (url.username || url.password) throw new Error('Website URL must not contain credentials.');
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
    throw new Error('Local and private website addresses are not allowed.');
  }
  let records;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    if (['ENOTFOUND', 'ENODATA', 'EAI_AGAIN'].includes(error?.code)) {
      throw new Error(`Website hostname could not be resolved: ${url.hostname}`);
    }
    throw error;
  }
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('Website URL resolves to a private or reserved network address.');
  }
  url.hash = '';
  return url;
}

function normalizeRoute(url, origin) {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return null;
    if (/\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|webp|gif|svg|ico|avif|mp4|webm|mp3|wav)(?:$|\/)/i.test(parsed.pathname)) return null;
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    const uniqueParams = new URLSearchParams();
    const seenParams = new Set();
    for (const [key, value] of parsed.searchParams) {
      const identity = `${key}\u0000${value}`;
      if (!seenParams.has(identity)) uniqueParams.append(key, value);
      seenParams.add(identity);
    }
    parsed.search = uniqueParams.toString();
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.href;
  } catch { return null; }
}

function linkPriority(link = {}) {
  if (link.inNavigation) return link.inDropdown ? 1 : 0;
  if (link.isCta) return 2;
  if (link.inFooter) return 3;
  if (link.inBreadcrumb) return 4;
  if (link.inCard) return 5;
  if (link.inPagination) return 7;
  if (link.fromSitemap) return 8;
  return 6;
}

async function discoverSitemapLinks(page, origin, validateUrl = validatePublicUrl) {
  const fetchText = async (url) => {
    await validateUrl(url);
    return page.evaluate(async (target) => {
      const response = await fetch(target, { redirect: 'error', credentials: 'omit' });
      return response.ok ? response.text() : '';
    }, url);
  };
  const results = [];
  try {
    const queue = [{ url: new URL('/sitemap.xml', origin).href, depth: 0 }];
    // robots.txt may advertise sitemaps at non-default locations.
    try {
      const robots = await fetchText(new URL('/robots.txt', origin).href);
      for (const match of String(robots || '').matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push({ url: match[1], depth: 0 });
    } catch { /* robots.txt is optional */ }
    const seenSitemaps = new Set();
    while (queue.length && seenSitemaps.size < 40) {
      const { url, depth } = queue.shift();
      if (seenSitemaps.has(url)) continue;
      seenSitemaps.add(url);
      let body = '';
      try { body = await fetchText(url); } catch { continue; }
      if (!body || Buffer.byteLength(body, 'utf8') > 20 * 1024 * 1024) continue;
      const isIndex = /<sitemapindex[\s>]/i.test(body);
      for (const match of body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
        const href = match[1].replace(/&amp;/g, '&');
        // A sitemap index lists child sitemaps (same site only, two levels deep).
        if (isIndex || /\.xml(?:\?.*)?$/i.test(href)) {
          try { if (depth < 2 && new URL(href).origin === origin) queue.push({ url: href, depth: depth + 1 }); } catch { /* ignore */ }
          continue;
        }
        results.push({ href, text: 'Sitemap page', fromSitemap: true });
      }
    }
  } catch { /* sitemap discovery is best-effort */ }
  return results;
}
// Deep child pages (e.g. /mediacoverage/<article>) are capped per section so a
// large listing cannot crowd out the rest of the site within the page budget.
function sectionKey(normalizedUrl) {
  const parts = new URL(normalizedUrl).pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[0].toLowerCase() : null;
}
function sectionCap(limit) { return Math.max(5, Math.ceil(limit * 0.15)); }
function prioritizeDiscoveredRoutes(discovered = [], origin, maxRoutes = DEFAULT_DISCOVERY_BATCH) {
  const routeLimit = Math.max(1, maxRoutes);
  const excluded = /\b(?:logout|signout|delete|remove|cart|checkout)\b/i;
  const ordered = discovered.map((link, index) => ({ ...link, _index: index }))
    .sort((a, b) => linkPriority(a) - linkPriority(b) || a._index - b._index);
  const routes = [];
  const seen = new Set();
  const sectionCounts = new Map();
  for (const link of ordered) {
    if (routes.length >= routeLimit) break;
    const normalized = normalizeRoute(link.href, origin);
    if (!normalized) continue;
    const section = sectionKey(normalized);
    if (section && (sectionCounts.get(section) || 0) >= sectionCap(routeLimit)) continue;
    const parsed = new URL(normalized);
    const identity = `${parsed.pathname}${parsed.search}`;
    if (seen.has(identity) || excluded.test(`${link.text || ''} ${parsed.pathname}`)) continue;
    seen.add(identity);
    if (section) sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    routes.push(normalized);
  }
  return routes;
}

function buildSiteMap(pages = []) {
  const root = {};
  for (const page of pages) {
    if (page.captureStatus !== 'captured') continue;
    const parts = String(page.path || '/').split('?')[0].split('/').filter(Boolean);
    let node = root;
    if (!parts.length) {
      node.$page = { path: '/', title: page.title, pageType: page.pageType };
      continue;
    }
    for (const part of parts) {
      node[part] ||= {};
      node = node[part];
    }
    node.$page = { path: page.path, title: page.title, pageType: page.pageType };
  }
  return root;
}

function classifyPage({ path = '/', title = '', headings = [] } = {}) {
  const value = `${path} ${title} ${headings.map((item) => item.text || '').join(' ')}`.toLowerCase();
  if (path === '/' || /\bhome\b/.test(value)) return 'landing';
  if (/\b(?:about|history|leadership|team|mission|vision)\b/.test(value)) return 'about';
  if (/\b(?:services?|solutions?)\b/.test(value)) return 'service';
  if (/\b(?:products?|shop|catalog)\b/.test(value)) return 'product';
  if (/\b(?:pricing|plans?)\b/.test(value)) return 'pricing';
  if (/\b(?:contact|location|reach us)\b/.test(value)) return 'contact';
  if (/\b(?:login|signin|sign-in|signup|register)\b/.test(value)) return 'authentication';
  if (/\bdashboard\b/.test(value)) return 'dashboard';
  if (/\b(?:blog|news|media|article|press)\b/.test(value)) return /\b(?:article|post)\b/.test(value) ? 'blog-article' : 'blog-listing';
  if (/\b(?:portfolio|work|case stud)\b/.test(value)) return 'portfolio';
  if (/\b(?:faq|frequently asked)\b/.test(value)) return 'faq';
  if (/\b(?:docs|documentation|guide)\b/.test(value)) return 'documentation';
  if (/\b(?:categories|category|departments?|institutions?|programs?|courses?)\b/.test(value)) return 'category';
  if (/\bsearch\b/.test(value)) return 'search';
  return 'other';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function canonicalAssetIdentity(value) {
  if (String(value || '').startsWith('data:')) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:format|width|height|w|h|quality|q|dpr|fit|crop)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hash = '';
    return url.href;
  } catch {
    return value;
  }
}

function isTrackingAssetUrl(value) {
  try {
    const url = new URL(value);
    return /(?:google-analytics\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|google\.[^/]+\/pagead|typekit\.net)$/i.test(url.hostname) ||
      /\/(?:collect|pagead|ads\/ga-audiences|1p-user-list|p\.gif)(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function selectCapturedAssets(candidates = [], visibleImages = []) {
  const visibleOrder = new Map();
  const visiblePages = new Map();
  const associationsByUrl = new Map();
  visibleImages.forEach((image, index) => {
    if (image?.src && !visibleOrder.has(image.src)) visibleOrder.set(image.src, { index, image });
    if (image?.src && image.pagePath) {
      if (!visiblePages.has(image.src)) visiblePages.set(image.src, new Set());
      visiblePages.get(image.src).add(image.pagePath);
    }
    if (image?.src) {
      if (!associationsByUrl.has(image.src)) associationsByUrl.set(image.src, []);
      associationsByUrl.get(image.src).push({
        page: image.pagePath || null,
        section: image.section || null,
        element: image.element || null,
        selector: image.selector || null,
        source: image.source || 'html',
        alt: image.alt || '',
        rect: image.rect || null,
        style: image.style || null
      });
    }
  });
  const ranked = [...candidates].sort((a, b) => {
    const aVisible = visibleOrder.get(a.url);
    const bVisible = visibleOrder.get(b.url);
    const score = (candidate, visible) => {
      const fontPriority = /^(?:font|application\/(?:font-woff|x-font-ttf))/.test(candidate.mimeType) ? 900000 : 0;
      const rasterPriority = /^image\/(?:png|jpeg)$/.test(candidate.mimeType) ? 100000 : 0;
      const visiblePriority = visible ? 1000000 - visible.index * 100 : 0;
      const area = visible?.image ? Math.min((visible.image.width || 0) * (visible.image.height || 0), 500000) : 0;
      return visiblePriority + fontPriority + rasterPriority + area;
    };
    return score(b, bVisible) - score(a, aVisible);
  });
  const selected = [];
  const selectedIdentities = new Set();
  const pageBytes = new Map();
  let totalBytes = 0;
  for (const candidate of ranked) {
    const identity = canonicalAssetIdentity(candidate.url);
    if (selectedIdentities.has(identity)) continue;
    if (selected.length >= MAX_ASSETS || candidate.byteLength > MAX_ASSET_BYTES || totalBytes + candidate.byteLength > MAX_TOTAL_ASSET_BYTES) continue;
    const metadata = visibleOrder.get(candidate.url)?.image || {};
    const pages = [...(visiblePages.get(candidate.url) || [])];
    if (pages.some((page) => (pageBytes.get(page) || 0) + candidate.byteLength > MAX_PAGE_ASSET_BYTES)) continue;
    selected.push({
      token: `__VEAVE_CLONE_ASSET_${selected.length}__`,
      url: candidate.url,
      mimeType: candidate.mimeType,
      dataUrl: candidate.dataUrl,
      bodyBase64: candidate.bodyBase64,
      byteLength: candidate.byteLength,
      sourceUrls: [...new Set(candidates.filter((item) => canonicalAssetIdentity(item.url) === identity).map((item) => item.url))],
      alt: metadata.alt || '',
      width: metadata.width || null,
      height: metadata.height || null,
      pages,
      associations: (associationsByUrl.get(candidate.url) || []).slice(0, 50)
    });
    selectedIdentities.add(identity);
    totalBytes += candidate.byteLength;
    for (const page of pages) pageBytes.set(page, (pageBytes.get(page) || 0) + candidate.byteLength);
  }
  return selected;
}

async function navigateForCapture(page, url, { navigationTimeout = 30000, contentTimeout = 10000, maxAttempts = 1 } = {}) {
  // Some sites commit usable HTML but never fire DOMContentLoaded because a
  // third-party script or resource hangs. Capture the committed document
  // instead of treating that as a failed clone.
  let lastError;
  const attempts = Math.max(1, Math.min(3, Number.parseInt(maxAttempts, 10) || 1));
  let response;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await page.goto(url, { waitUntil: 'commit', timeout: navigationTimeout });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const timedOut = error?.name === 'TimeoutError' || /timeout/i.test(String(error?.message || ''));
      if (!timedOut || attempt === attempts) throw error;
      await page.evaluate(() => window.stop()).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
    }
  }
  if (lastError) throw lastError;
  const domContentLoaded = await page.waitForLoadState('domcontentloaded', { timeout: contentTimeout })
    .then(() => true)
    .catch(() => false);
  if (!domContentLoaded) {
    await page.evaluate(() => window.stop()).catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  }
  return { url: page.url(), status: response?.status?.() ?? null, domContentLoaded };
}

async function captureViewportScreenshot(page, { quality = 82, optional = false } = {}) {
  try {
    return await page.screenshot({
      type: 'jpeg',
      quality,
      fullPage: false,
      animations: 'allow',
      timeout: 30000
    });
  } catch (screenshotError) {
    if (optional) return null;
    let session;
    try {
      session = await page.context().newCDPSession(page);
      const result = await session.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality,
        captureBeyondViewport: false,
        fromSurface: true
      });
      return Buffer.from(result.data, 'base64');
    } catch (protocolError) {
      protocolError.cause = screenshotError;
      throw protocolError;
    } finally {
      await session?.detach().catch(() => {});
    }
  }
}

async function analyzeRenderedPage(page, { maxVisualElements = 220 } = {}) {
  return page.evaluate(({ maximumVisualElements }) => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        documentY: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const styleOf = (element) => {
      const style = getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        textAlign: style.textAlign,
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage === 'none' ? '' : style.backgroundImage.slice(0, 500),
        border: style.border,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        opacity: style.opacity,
        display: style.display,
        position: style.position,
        flexDirection: style.flexDirection,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        gridTemplateColumns: style.gridTemplateColumns,
        gap: style.gap,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
        width: style.width,
        height: style.height,
        minHeight: style.minHeight,
        maxWidth: style.maxWidth,
        padding: style.padding,
        margin: style.margin,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition
      };
    };
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      classes: String(element.className || '').slice(0, 160),
      role: element.getAttribute('role') || '',
      text: (element.innerText || element.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 350),
      rect: rectOf(element),
      style: styleOf(element)
    });
    const rootElement = document.body || document.documentElement;
    const root = rootElement instanceof Element ? getComputedStyle(rootElement) : null;
    const majorElements = [...document.querySelectorAll('header,nav,main,section,article,aside,footer,form')]
      .filter(visible).slice(0, 60);
    const visualCandidates = [...document.querySelectorAll('header,nav,main,section,article,aside,footer,form,h1,h2,h3,h4,p,a,button,input,select,textarea,img,video')]
      .filter(visible);
    const visualElements = [];
    const seen = new Set();
    for (const element of visualCandidates) {
      if (seen.has(element) || visualElements.length >= maximumVisualElements) continue;
      seen.add(element);
      visualElements.push(describe(element));
    }
    // The link an element opens when clicked (e.g. a thumbnail that opens a PDF or another page).
    const linkOf = (element) => {
      const anchor = element.closest?.('a[href]');
      let href = anchor?.href || '';
      let kind = 'anchor';
      if (!href) {
        const holder = element.closest?.('[data-href],[data-url],[data-link],[data-fancybox-href],[onclick]');
        const raw = holder?.getAttribute('data-href') || holder?.getAttribute('data-url') || holder?.getAttribute('data-link') || holder?.getAttribute('data-fancybox-href')
          || (holder?.getAttribute('onclick') || '').match(/(?:location(?:\.href)?\s*=|window\.open\()\s*['"]([^'"]+)['"]/)?.[1] || '';
        if (raw) { try { href = new URL(raw, document.baseURI).href; kind = 'attribute'; } catch { href = ''; } }
      }
      if (!href || /^javascript:/i.test(href)) return null;
      return { href, kind, target: anchor?.target || '', download: anchor?.hasAttribute('download') || false, title: (anchor?.title || anchor?.getAttribute('aria-label') || '').slice(0, 160) };
    };
    const imageItems = [...document.images].filter(visible).slice(0, 5000).flatMap((img) => {
      const urls = [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src')];
      for (const value of [img.srcset, img.getAttribute('data-srcset'), ...[...img.closest('picture')?.querySelectorAll('source') || []].map((source) => source.srcset)]) {
        String(value || '').split(',').forEach((item) => urls.push(item.trim().split(/\s+/)[0]));
      }
      return [...new Set(urls.filter(Boolean).map((url) => new URL(url, document.baseURI).href))].map((src) => ({
        src,
        alt: img.alt || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        rect: rectOf(img),
        style: styleOf(img),
        link: linkOf(img)
      }));
    });
    const backgroundItems = [...document.querySelectorAll('body *')].filter(visible).slice(0, 6000).map((element) => {
      const background = getComputedStyle(element).backgroundImage;
      const match = background && background.match(/url\(["']?([^"')]+)["']?\)/i);
      if (!match) return null;
      const rect = rectOf(element);
      return { src: new URL(match[1], document.baseURI).href, alt: element.getAttribute('aria-label') || 'Background image', width: rect.width, height: rect.height, naturalWidth: null, naturalHeight: null, rect, style: styleOf(element), link: linkOf(element) };
    }).filter(Boolean).slice(0, 1500);
    const iconItems = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
      .map((link) => ({ src: link.href, alt: 'favicon', naturalWidth: null, naturalHeight: null }));
    const links = [...document.querySelectorAll('a[href]')].slice(0, 20000).map((anchor) => ({
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 160),
      inNavigation: Boolean(anchor.closest('nav,header,[role="navigation"]')),
      inDropdown: Boolean(anchor.closest('[role="menu"],.dropdown,.mega-menu,[class*="dropdown"],[class*="mega"]')),
      inFooter: Boolean(anchor.closest('footer')),
      isCta: Boolean(anchor.closest('button,[role="button"],.cta,[class*="button"],[class*="cta"]')),
      inCard: Boolean(anchor.closest('article,.card,[class*="card"]')),
      inBreadcrumb: Boolean(anchor.closest('[aria-label*="breadcrumb" i],.breadcrumb,[class*="breadcrumb"]')),
      inPagination: Boolean(anchor.closest('[aria-label*="pagination" i],.pagination,[class*="pagination"]'))
    }));
    const rootStyle = document.documentElement ? getComputedStyle(document.documentElement) : null;
    const cssVariables = {};
    if (rootStyle) {
      for (const property of rootStyle) {
        if (!property.startsWith('--') || Object.keys(cssVariables).length >= 150) continue;
        const value = rootStyle.getPropertyValue(property).trim();
        if (value) cssVariables[property] = value.slice(0, 300);
      }
    }
    const palette = [...new Set(visualElements.flatMap((item) => [item.style.color, item.style.backgroundColor, item.style.borderColor]).filter((value) => value && value !== 'rgba(0, 0, 0, 0)'))].slice(0, 80);
    const documentElement = document.documentElement;
    const body = document.body;
    const documentWidth = Math.max(body?.scrollWidth || 0, documentElement?.scrollWidth || 0, window.innerWidth || 0);
    const documentHeight = Math.max(body?.scrollHeight || 0, documentElement?.scrollHeight || 0, window.innerHeight || 0);
    const fontFaces = [];
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule) || fontFaces.length >= 80) continue;
        const source = rule.style.getPropertyValue('src');
        const base = sheet.href || document.baseURI;
        const urls = [...source.matchAll(/url\(["']?([^"')]+)["']?\)/gi)].map((match) => {
          try { return new URL(match[1], base).href; } catch { return match[1]; }
        });
        fontFaces.push({
          family: rule.style.getPropertyValue('font-family').trim(),
          weight: rule.style.getPropertyValue('font-weight').trim() || 'normal',
          style: rule.style.getPropertyValue('font-style').trim() || 'normal',
          display: rule.style.getPropertyValue('font-display').trim(),
          source,
          urls
        });
      }
    }
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      document: { width: documentWidth, height: documentHeight },
      headings: [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).slice(0, 1000).map((element) => ({ level: element.tagName, text: (element.innerText || '').trim().slice(0, 240), rect: rectOf(element), style: styleOf(element) })),
      sections: majorElements.map(describe),
      visualElements,
      controls: [...document.querySelectorAll('button,input,select,textarea,[role="button"],[role="tab"]')].filter(visible).slice(0, 1000).map((element) => ({ ...describe(element), type: element.type || element.getAttribute('role') || '', label: (element.innerText || element.getAttribute('aria-label') || element.placeholder || '').trim().slice(0, 160) })),
      images: [...imageItems, ...backgroundItems, ...iconItems],
      links,
      design: root ? {
        fontFamily: root.fontFamily,
        fontSize: root.fontSize,
        fontWeight: root.fontWeight,
        lineHeight: root.lineHeight,
        letterSpacing: root.letterSpacing,
        color: root.color,
        background: root.backgroundColor,
        palette,
        cssVariables,
        fontFaces,
        fonts: [...(document.fonts || [])].map((font) => ({ family: font.family, weight: font.weight, style: font.style, stretch: font.stretch, status: font.status })).filter((font, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(font)) === index).slice(0, 80)
      } : {}
    };
  }, { maximumVisualElements: maxVisualElements });
}

async function extractSourcePage(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const selectorOf = (element) => {
      if (!(element instanceof Element)) return '';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts = [];
      let current = element;
      while (current && current !== document.body && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const classes = [...current.classList].filter((name) => !/[0-9]{4,}/.test(name)).slice(0, 2);
        if (classes.length) part += classes.map((name) => `.${CSS.escape(name)}`).join('');
        const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), documentY: Math.round(rect.y + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const assetStyleOf = (element) => {
      const style = getComputedStyle(element);
      return { objectFit: style.objectFit, objectPosition: style.objectPosition, backgroundSize: style.backgroundSize, backgroundPosition: style.backgroundPosition, width: style.width, height: style.height, display: style.display, position: style.position };
    };
    const sectionOf = (element) => {
      const section = element.closest('header,nav,main > section,section,article,aside,footer,main');
      return section ? { selector: selectorOf(section), tag: section.tagName.toLowerCase(), id: section.id || '', classes: String(section.className || '').slice(0, 160), heading: (section.querySelector('h1,h2,h3,h4')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160) } : null;
    };
    const describeAsset = (element, source) => ({
      section: sectionOf(element),
      element: { tag: element.tagName.toLowerCase(), id: element.id || '', classes: String(element.className || '').slice(0, 160) },
      selector: selectorOf(element), source, rect: rectOf(element), style: assetStyleOf(element)
    });
    const assetReferences = [];
    for (const img of [...document.images].filter(visible).slice(0, 5000)) {
      const urls = [img.currentSrc, img.src, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original')];
      for (const value of [img.srcset, img.getAttribute('data-srcset'), ...[...(img.closest('picture')?.querySelectorAll('source') || [])].map((source) => source.srcset)]) {
        String(value || '').split(',').forEach((item) => urls.push(item.trim().split(/\s+/)[0]));
      }
      for (const src of [...new Set(urls.filter(Boolean).map((url) => new URL(url, document.baseURI).href))]) {
        assetReferences.push({ src, alt: img.alt || '', width: img.naturalWidth || null, height: img.naturalHeight || null, ...describeAsset(img, src === img.currentSrc ? 'currentSrc' : 'html-attribute') });
      }
    }
    for (const element of [...document.querySelectorAll('body *')].filter(visible).slice(0, 10000)) {
      for (const match of String(getComputedStyle(element).backgroundImage || '').matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
        const rect = rectOf(element);
        assetReferences.push({ src: new URL(match[1], document.baseURI).href, alt: element.getAttribute('aria-label') || 'Background image', width: rect.width, height: rect.height, ...describeAsset(element, 'css-background') });
      }
    }
    for (const link of document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')) {
      assetReferences.push({ src: link.href, alt: 'favicon', width: null, height: null, section: { tag: 'head', heading: '' }, element: { tag: 'link', id: link.id || '', classes: '' }, selector: `link[rel="${link.rel}"]`, source: 'html-link', rect: null, style: null });
    }
    for (const svg of [...document.querySelectorAll('svg')].filter(visible).slice(0, 1000)) {
      const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(svg));
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const rect = rectOf(svg);
      assetReferences.push({ src: `data:image/svg+xml;base64,${btoa(binary)}`, alt: svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || 'Inline icon', width: rect.width, height: rect.height, ...describeAsset(svg, 'inline-svg') });
    }

    const styleSheets = [];
    const responsiveRules = [];
    let cssCharacters = 0;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch {
        styleSheets.push({ href: sheet.href || null, accessible: false, rules: [] });
        continue;
      }
      const extractedRules = [];
      const visit = (items, media = '') => {
        for (const rule of items) {
          if (cssCharacters >= 300000) break;
          const cssText = String(rule.cssText || '').slice(0, 12000);
          extractedRules.push({ type: rule.constructor?.name || 'CSSRule', media, cssText });
          for (const match of cssText.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
            try {
              const src = new URL(match[1], sheet.href || document.baseURI).href;
              if (!src.startsWith('data:')) {
                assetReferences.push({
                  src,
                  alt: 'CSS asset',
                  width: null,
                  height: null,
                  section: media ? { tag: 'stylesheet', heading: media, selector: null } : { tag: 'stylesheet', heading: '', selector: null },
                  element: { tag: 'css-rule', id: '', classes: '' },
                  selector: rule.selectorText || null,
                  source: 'css-rule',
                  rect: null,
                  style: null
                });
              }
            } catch { /* Invalid CSS URLs are reported through missing references. */ }
          }
          cssCharacters += cssText.length;
          if (rule instanceof CSSMediaRule) {
            responsiveRules.push({ media: rule.conditionText, cssText });
            visit([...rule.cssRules], rule.conditionText);
          } else if (rule.cssRules) visit([...rule.cssRules], media);
        }
      };
      visit(rules);
      styleSheets.push({ href: sheet.href || null, accessible: true, rules: extractedRules });
    }

    const sourceRoot = document.documentElement || document.body;
    const clone = sourceRoot?.cloneNode(true) || document.createElement('html');
    clone.querySelectorAll('script,noscript,template').forEach((element) => element.remove());
    clone.querySelectorAll('*').forEach((element) => {
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    });
    const structuralElements = [...document.querySelectorAll('body,body header,body nav,body main,body main > *,body section,body article,body aside,body footer')].slice(0, 3000);
    const domHierarchy = structuralElements.map((element) => ({ tag: element.tagName.toLowerCase(), id: element.id || '', classes: String(element.className || '').slice(0, 160), selector: selectorOf(element), parent: selectorOf(element.parentElement), childCount: element.children.length, text: (element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 500), rect: rectOf(element) }));
    const sectionElements = [...document.querySelectorAll('header,nav,main,main > section,section,article,aside,footer')].filter(visible).slice(0, 2000);
    const htmlSections = sectionElements.map((element) => ({ selector: selectorOf(element), tag: element.tagName.toLowerCase(), heading: (element.querySelector('h1,h2,h3,h4')?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160), html: element.outerHTML.slice(0, 150000) }));
    return {
      extraction: { mode: 'browser-rendered-dom', html: clone.outerHTML.slice(0, 2000000), domHierarchy, htmlSections },
      styles: { styleSheets, responsiveRules: responsiveRules.slice(0, 200) },
      assetReferences: assetReferences.slice(0, 10000)
    };
  });
}

// Structured, non-visual page data: everything a human or search engine could read
// that the style/geometry capture does not record (text incl. hidden tabs, meta,
// schema.org, tables, forms, media, documents, contact details and outbound links).
async function extractStructuredData(page) {
  return page.evaluate(() => {
    const clean = (value, max = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const abs = (value) => { try { return new URL(value, document.baseURI).href; } catch { return ''; } };
    const meta = {};
    for (const element of document.querySelectorAll('meta[name],meta[property],meta[http-equiv]')) {
      const key = element.getAttribute('name') || element.getAttribute('property') || element.getAttribute('http-equiv');
      if (key && element.content) meta[key] = clean(element.content, 1000);
    }
    const jsonLd = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { jsonLd.push(JSON.parse(script.textContent)); } catch { /* ignore invalid JSON-LD */ }
    }
    const textRoot = document.body ? document.body.cloneNode(true) : null;
    textRoot?.querySelectorAll('script,style,noscript,template,svg').forEach((element) => element.remove());
    const fullText = textRoot ? textRoot.textContent.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() : '';
    const tables = [...document.querySelectorAll('table')].slice(0, 200).map((table) => ({
      caption: clean(table.querySelector('caption')?.textContent, 300),
      rows: [...table.querySelectorAll('tr')].slice(0, 1000).map((row) => [...row.querySelectorAll('th,td')].map((cell) => clean(cell.textContent, 500)))
    })).filter((table) => table.rows.length);
    const forms = [...document.querySelectorAll('form')].slice(0, 100).map((form) => ({
      action: abs(form.getAttribute('action') || ''),
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      fields: [...form.querySelectorAll('input,select,textarea,button')].slice(0, 100).map((field) => ({
        tag: field.tagName.toLowerCase(), type: field.type || '', name: field.name || '', id: field.id || '',
        label: clean(field.labels?.[0]?.textContent || field.getAttribute('aria-label') || field.placeholder || field.innerText, 200),
        required: Boolean(field.required),
        options: field.tagName === 'SELECT' ? [...field.options].slice(0, 200).map((option) => clean(option.textContent, 120)) : undefined
      }))
    }));
    const media = [];
    for (const element of document.querySelectorAll('video,audio,iframe,embed,object,source[src],track[src]')) {
      const src = element.currentSrc || element.src || element.getAttribute('data') || element.getAttribute('src') || '';
      if (src) media.push({ tag: element.tagName.toLowerCase(), src: abs(src), title: clean(element.title || element.getAttribute('aria-label'), 200), poster: element.poster ? abs(element.poster) : '' });
    }
    const documents = [];
    const external = [];
    const social = [];
    const emails = new Set();
    const phones = new Set();
    const docPattern = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt)(?:$|[?#])/i;
    const socialPattern = /(?:facebook|twitter|x|instagram|linkedin|youtube|youtu\.be|whatsapp|t\.me|telegram|pinterest|threads)\.(?:com|be|me|net)/i;
    for (const anchor of document.querySelectorAll('a[href]')) {
      const raw = anchor.getAttribute('href') || '';
      const text = clean(anchor.innerText || anchor.getAttribute('aria-label') || anchor.title, 200);
      if (/^mailto:/i.test(raw)) { emails.add(raw.replace(/^mailto:/i, '').split('?')[0]); continue; }
      if (/^tel:/i.test(raw)) { phones.add(raw.replace(/^tel:/i, '')); continue; }
      const href = abs(raw);
      if (!/^https?:/i.test(href)) continue;
      if (docPattern.test(new URL(href).pathname)) documents.push({ href, text });
      else if (new URL(href).origin !== location.origin) (socialPattern.test(new URL(href).hostname) ? social : external).push({ href, text });
    }
    const textBlob = fullText.slice(0, 500000);
    for (const match of textBlob.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) emails.add(match[0]);
    for (const match of textBlob.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)\d{3,5}[\s-]?\d{3,5}/g)) { if (match[0].replace(/\D/g, '').length >= 8) phones.add(match[0].trim()); }
    const dedupe = (items) => [...new Map(items.map((item) => [item.href, item])).values()].slice(0, 2000);
    const lists = [...document.querySelectorAll('ul,ol,dl')].filter((list) => !list.closest('nav,header,footer')).slice(0, 300)
      .map((list) => [...list.children].slice(0, 300).map((item) => clean(item.textContent, 400))).filter((items) => items.length > 1);
    return {
      language: document.documentElement.lang || '',
      canonical: abs(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''),
      alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => ({ hreflang: link.hreflang, href: abs(link.getAttribute('href')) })),
      relNext: abs(document.querySelector('link[rel="next"],a[rel="next"]')?.getAttribute('href') || ''),
      meta,
      jsonLd,
      fullText,
      textLength: fullText.length,
      tables,
      forms,
      media: [...new Map(media.map((item) => [item.src, item])).values()].slice(0, 1000),
      documents: dedupe(documents),
      externalLinks: dedupe(external),
      socialLinks: dedupe(social),
      emails: [...emails].slice(0, 200),
      phones: [...phones].slice(0, 200),
      lists
    };
  }).catch(() => null);
}
const DOCUMENT_TYPES = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'text/csv': 'csv',
  // Full-size images opened by clicking a thumbnail (lightbox-style links).
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|png|jpe?g|webp|gif)(?:$|[?#])/i;

// Downloads the files that the source site links to (PDFs, Office files, archives...), including
// files opened by clicking an image, so the clone can link to local copies instead of dead links.
async function captureLinkedDocuments(context, pages = [], { startIndex = 0, validateUrl = validatePublicUrl, signal } = {}) {
  const maxDocuments = Math.max(0, Number.parseInt(process.env.CLONE_MAX_DOCUMENTS, 10) || 300);
  const maxBytes = Math.max(1024, Number.parseInt(process.env.CLONE_MAX_DOCUMENT_BYTES, 10) || 50 * 1024 * 1024);
  const crawled = new Set(pages.map((page) => page.url));
  const candidates = new Map();
  const add = (href, info) => {
    if (!/^https?:\/\//i.test(href || '')) return;
    const key = href.split('#')[0];
    const entry = candidates.get(key) || { url: key, pages: new Set(), images: [], texts: new Set(), imageWrapped: false, byExtension: false };
    entry.pages.add(info.page);
    if (info.text) entry.texts.add(info.text);
    if (info.image) { entry.images.push(info.image); entry.imageWrapped = true; }
    if (DOCUMENT_EXTENSIONS.test(new URL(key).pathname)) entry.byExtension = true;
    candidates.set(key, entry);
  };
  for (const page of pages) {
    if (page.captureStatus !== 'captured') continue;
    for (const doc of page.data?.documents || []) add(doc.href, { page: page.path, text: doc.text });
    for (const image of page.images || []) {
      if (image?.link?.href) add(image.link.href, { page: page.path, text: image.alt || image.link.title, image: { src: image.src, selector: image.selector || null } });
    }
  }
  const documents = [];
  const seenHashes = new Map();
  // Extension-based documents first; extensionless image links are probed only for non-HTML responses.
  const ordered = [...candidates.values()].filter((entry) => !crawled.has(entry.url)).sort((a, b) => Number(b.byExtension) - Number(a.byExtension));
  let probes = 0;
  for (const entry of ordered) {
    if (documents.length >= maxDocuments) break;
    signal?.throwIfAborted();
    if (!entry.byExtension) {
      if (!entry.imageWrapped || probes >= 150) continue;
      probes += 1;
    }
    try {
      let url = entry.url;
      let response = null;
      for (let hop = 0; hop < 5; hop += 1) {
        await validateUrl(url);
        response = await context.request.get(url, { maxRedirects: 0, timeout: 60000, failOnStatusCode: false });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location) { url = new URL(location, url).href; continue; }
        break;
      }
      if (!response || !response.ok()) continue;
      const mimeType = String(response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extension = DOCUMENT_TYPES[mimeType] || (mimeType === 'application/octet-stream' || !mimeType ? (new URL(url).pathname.match(DOCUMENT_EXTENSIONS)?.[1] || '').toLowerCase() : '');
      if (!extension) continue;
      const declared = Number.parseInt(response.headers()['content-length'], 10);
      if (Number.isFinite(declared) && declared > maxBytes) continue;
      const body = await response.body();
      if (!body.length || body.length > maxBytes) continue;
      if (extension === 'pdf' && body.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
      const hash = require('node:crypto').createHash('sha256').update(body).digest('hex');
      const sourceUrls = [...new Set([entry.url, url])];
      const existing = seenHashes.get(hash);
      if (existing) {
        existing.sourceUrls = [...new Set([...existing.sourceUrls, ...sourceUrls])];
        existing.sourcePaths = existing.sourceUrls.map((value) => { const parsed = new URL(value); return `${parsed.pathname}${parsed.search}`; });
        existing.pages = [...new Set([...existing.pages, ...entry.pages])];
        existing.linkedFrom.push(...entry.images.map((image) => ({ ...image, text: [...entry.texts][0] || '' })));
        continue;
      }
      const baseName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'document').replace(/\.[a-z0-9]+$/i, '');
      const safeName = baseName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 48) || 'document';
      const localPath = `public/assets/documents/${safeName}-${hash.slice(0, 10)}.${extension}`;
      const asset = {
        token: `__VEAVE_CLONE_ASSET_${startIndex + documents.length}__`,
        url: entry.url,
        sourceUrls,
        sourcePaths: sourceUrls.map((value) => { const parsed = new URL(value); return `${parsed.pathname}${parsed.search}`; }),
        mimeType: mimeType && mimeType !== 'application/octet-stream' ? mimeType : `application/${extension}`,
        byteLength: body.length,
        hash,
        localPath,
        publicPath: `/${localPath.slice('public/'.length)}`,
        content: body.toString('base64'),
        encoding: 'base64',
        alt: [...entry.texts][0] || '',
        width: null,
        height: null,
        pages: [...entry.pages],
        associations: [],
        isDocument: true,
        linkedFrom: entry.images.map((image) => ({ ...image, text: [...entry.texts][0] || '' }))
      };
      seenHashes.set(hash, asset);
      documents.push(asset);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }
  return documents;
}
async function prefetchDiscoveredAssets(page, references = []) {
  const urls = [...new Set(references
    .filter((item) => ['css-rule', 'html-attribute', 'html-link'].includes(item?.source))
    .map((item) => item.src)
    .filter((url) => /^https?:\/\//i.test(url)))]
    .slice(0, 5000);
  for (let index = 0; index < urls.length; index += 12) {
    await page.evaluate(async (batch) => {
      await Promise.allSettled(batch.map((url) => fetch(url, {
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'force-cache'
      })));
    }, urls.slice(index, index + 12)).catch(() => {});
  }
}

async function captureWebsite(sourceUrl, { signal, maxRoutes } = {}) {
  const entryUrl = await validatePublicUrl(sourceUrl);
  const crawlLimit = resolveRouteLimit(maxRoutes);
  const crawlStartedAt = Date.now();
  signal?.throwIfAborted();
  const browser = await launchChromium({ browserType: chromium });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    acceptDownloads: false,
    // Capture public sites with expired, self-signed, or mismatched certificates.
    // Request routing below still blocks private and reserved network addresses.
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  const validatedHosts = new Map();
  const capturedAssets = [];
  const capturedAssetUrls = new Set();
  const pendingAssetCaptures = new Set();
  let totalAssetBytes = 0;

  const validateRequestUrl = async (requestUrl) => {
    const parsed = new URL(requestUrl);
    if (['data:', 'blob:', 'about:'].includes(parsed.protocol)) return;
    const cached = validatedHosts.get(parsed.hostname);
    if (cached === true) return;
    await validatePublicUrl(parsed.href);
    validatedHosts.set(parsed.hostname, true);
  };

  await context.route('**/*', async (route) => {
    try {
      await validateRequestUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });

  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  page.on('download', (download) => download.cancel().catch(() => {}));
  page.on('response', (response) => {
    const capture = (async () => {
      if (capturedAssets.length >= MAX_ASSET_CANDIDATES || capturedAssetUrls.has(response.url())) return;
      if (isTrackingAssetUrl(response.url())) return;
      const type = String(response.headers()['content-type'] || '').split(';')[0].toLowerCase();
       if (!/^(?:image\/(?:png|jpeg|webp|gif|svg\+xml|avif|x-icon|vnd\.microsoft\.icon)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf))$/.test(type)) return;
      try {
        const body = await response.body();
        if (!body.length || body.length > MAX_ASSET_BYTES || totalAssetBytes + body.length > MAX_CANDIDATE_BYTES) return;
        capturedAssetUrls.add(response.url());
        totalAssetBytes += body.length;
        capturedAssets.push({ url: response.url(), mimeType: type, byteLength: body.length, bodyBase64: body.toString('base64') });
      } catch { /* Some opaque/cached responses do not expose a body. */ }
    })();
    pendingAssetCaptures.add(capture);
    capture.finally(() => pendingAssetCaptures.delete(capture));
  });

  const abort = () => browser.close().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const initialNavigationTimeout = Math.max(30000, Number.parseInt(process.env.CLONE_INITIAL_NAVIGATION_TIMEOUT_MS, 10) || 45000);
    const initialNavigation = await navigateForCapture(page, entryUrl.href, { navigationTimeout: initialNavigationTimeout, contentTimeout: 10000, maxAttempts: 2 });
    if (initialNavigation.status === 404 && entryUrl.hostname.startsWith('www.')) {
      const apexUrl = new URL(entryUrl.href);
      apexUrl.hostname = apexUrl.hostname.slice(4);
      try {
        await validatePublicUrl(apexUrl.href);
        const apexNavigation = await navigateForCapture(page, apexUrl.href, { navigationTimeout: initialNavigationTimeout, contentTimeout: 10000, maxAttempts: 2 });
        if (apexNavigation.status !== null && apexNavigation.status >= 400) {
          await navigateForCapture(page, entryUrl.href, { navigationTimeout: initialNavigationTimeout, contentTimeout: 10000, maxAttempts: 1 });
        }
      } catch {
        await navigateForCapture(page, entryUrl.href, { navigationTimeout: initialNavigationTimeout, contentTimeout: 10000, maxAttempts: 1 });
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const canonicalUrl = new URL(page.url());
    await validatePublicUrl(canonicalUrl.href);
    const origin = canonicalUrl.origin;

    const desktop = await captureViewportScreenshot(page, { quality: 86, optional: true });
    const discovered = await page.locator('a[href]').evaluateAll((anchors) => anchors.slice(0, 20000).map((anchor) => ({
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim(),
      inNavigation: Boolean(anchor.closest('nav,header,[role="navigation"]')),
      inDropdown: Boolean(anchor.closest('[role="menu"],.dropdown,.mega-menu,[class*="dropdown"],[class*="mega"]')),
      inFooter: Boolean(anchor.closest('footer')),
      isCta: Boolean(anchor.closest('button,[role="button"],.cta,[class*="button"], [class*="cta"]')),
      inCard: Boolean(anchor.closest('article,.card,[class*="card"]')),
      inBreadcrumb: Boolean(anchor.closest('[aria-label*="breadcrumb" i],.breadcrumb,[class*="breadcrumb"]')),
      inPagination: Boolean(anchor.closest('[aria-label*="pagination" i],.pagination,[class*="pagination"]'))
    })));
    const sitemapLinks = await discoverSitemapLinks(page, origin);
    const allInitialLinks = [...discovered, ...sitemapLinks];
    const discoveredRoutes = prioritizeDiscoveredRoutes(allInitialLinks, origin, crawlLimit);
    const routeQueue = [normalizeRoute(canonicalUrl.href, origin), ...discoveredRoutes.filter((route) => route !== normalizeRoute(canonicalUrl.href, origin))].slice(0, crawlLimit);
    const queuedRoutes = new Set(routeQueue);
    const visitedRoutes = new Set();
    const failedRoutes = new Set();
    const discoveryMetadata = new Map([[routeQueue[0], { source: 'entry', priority: -1 }]]);
    for (const link of allInitialLinks) {
      const normalized = normalizeRoute(link.href, origin);
      if (normalized && !discoveryMetadata.has(normalized)) discoveryMetadata.set(normalized, { source: 'homepage', priority: linkPriority(link), text: link.text });
    }

    const pages = [];
    const routeScreenshots = [];
    for (let routeIndex = 0; routeIndex < routeQueue.length && routeIndex < crawlLimit; routeIndex += 1) {
      if (Date.now() - crawlStartedAt > MAX_CRAWL_DURATION_MS) break;
      const route = routeQueue[routeIndex];
      visitedRoutes.add(route);
      signal?.throwIfAborted();
      if (page.url() !== route) {
        let navigationFailed = false;
        let navigationError = null;
        await navigateForCapture(page, route, { navigationTimeout: 20000, contentTimeout: 7000, maxAttempts: 2 })
          .catch((error) => { navigationFailed = true; navigationError = error; });
        if (navigationFailed && normalizeRoute(page.url(), origin) !== route) {
          const unavailable = new URL(route);
          pages.push({
            url: route,
            path: `${unavailable.pathname}${unavailable.search}`,
            title: unavailable.pathname.split('/').filter(Boolean).at(-1)?.replace(/[-_]+/g, ' ') || 'Home',
            description: '',
            headings: [],
            sections: [],
            controls: [],
            images: [],
            design: {},
            captureStatus: 'navigation-timeout',
            failure: { stage: 'navigation', message: String(navigationError?.message || 'Navigation timed out').slice(0, 1000) },
            pageType: classifyPage({ path: `${unavailable.pathname}${unavailable.search}`, title: unavailable.pathname }),
            discoveredFrom: discoveryMetadata.get(route) || null
          });
          failedRoutes.add(route);
          continue;
        }
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      }
      if (new URL(page.url()).origin !== origin) {
        const unavailable = new URL(route);
        pages.push({
          url: route,
          path: `${unavailable.pathname}${unavailable.search}`,
          title: unavailable.pathname.split('/').filter(Boolean).at(-1)?.replace(/[-_]+/g, ' ') || 'Home',
          description: '', headings: [], sections: [], controls: [], images: [], design: {},
          captureStatus: 'external-redirect',
          pageType: classifyPage({ path: unavailable.pathname, title: unavailable.pathname }),
          discoveredFrom: discoveryMetadata.get(route) || null
        });
        failedRoutes.add(route);
        continue;
      }
      const scrollResult = await page.evaluate(async ({ maximumScrollHeight, maximumDurationMs }) => {
        const startedAt = performance.now();
        // Force lazy media to load: eager loading + common data-src conventions.
        document.querySelectorAll('img,iframe,source,video').forEach((element) => {
          if (element.getAttribute('loading') === 'lazy') element.setAttribute('loading', 'eager');
          for (const [lazy, real] of [['data-src', 'src'], ['data-lazy-src', 'src'], ['data-original', 'src'], ['data-srcset', 'srcset'], ['data-lazy-srcset', 'srcset']]) {
            const value = element.getAttribute(lazy);
            if (value && (!element.getAttribute(real) || /^data:/i.test(element.getAttribute(real) || ''))) element.setAttribute(real, value);
          }
        });
        const pageHeight = () => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, window.innerHeight || 0);
        const step = Math.max(400, window.innerHeight * 0.7);
        let y = 0;
        let stableBottomPasses = 0;
        let lastHeight = 0;
        let iterations = 0;
        let reachedBottom = false;
        let cappedByHeight = false;
        while (performance.now() - startedAt < maximumDurationMs && iterations < 1000) {
          const documentHeight = pageHeight();
          const limit = maximumScrollHeight ? Math.min(documentHeight, maximumScrollHeight) : documentHeight;
          cappedByHeight = Boolean(maximumScrollHeight && documentHeight > maximumScrollHeight);
          y = Math.min(y + step, Math.max(0, limit - window.innerHeight));
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 150));
          iterations += 1;
          const updatedHeight = pageHeight();
          const atBottom = y + window.innerHeight >= Math.min(updatedHeight, maximumScrollHeight || updatedHeight) - 2;
          if (atBottom) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            const settledHeight = pageHeight();
            if (settledHeight === lastHeight || settledHeight === updatedHeight) stableBottomPasses += 1;
            else stableBottomPasses = 0;
            lastHeight = settledHeight;
            if (stableBottomPasses >= 2) {
              reachedBottom = !cappedByHeight;
              break;
            }
          } else {
            stableBottomPasses = 0;
            lastHeight = updatedHeight;
          }
        }
        window.scrollTo(0, 0);
        return {
          reachedBottom,
          cappedByHeight,
          timedOut: !reachedBottom && !cappedByHeight && performance.now() - startedAt >= maximumDurationMs,
          finalHeight: pageHeight(),
          iterations
        };
      }, { maximumScrollHeight: MAX_PAGE_SCROLL_HEIGHT, maximumDurationMs: MAX_PAGE_SCROLL_DURATION_MS }).catch(() => ({ reachedBottom: false, timedOut: true, cappedByHeight: false, finalHeight: null, iterations: 0 }));
      // Reveal content hidden behind "load more" buttons and closed <details>, then scroll again so
      // anything those expansions (or lazy observers) added is rendered before extraction.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const urlBeforeExpansion = page.url();
      for (let round = 0; round < 15; round += 1) {
        const clicked = await page.evaluate(() => {
          document.querySelectorAll('details:not([open])').forEach((element) => element.setAttribute('open', ''));
          const pattern = /^\s*(load|show|view|see|read)\s+(more|all)\b/i;
          const target = [...document.querySelectorAll('button,[role="button"]')].find((element) => !element.disabled
            && !element.closest('a[href]')
            && pattern.test((element.innerText || element.getAttribute('aria-label') || '').trim())
            && element.getBoundingClientRect().height > 0);
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        }).catch(() => false);
        if (!clicked) break;
        await page.waitForTimeout(700);
      }
      if (page.url() !== urlBeforeExpansion) await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.evaluate(async () => {
        const started = performance.now();
        const height = () => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        for (let y = 0; y < height() && performance.now() - started < 45000; y += Math.max(400, window.innerHeight * 0.7)) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        window.scrollTo(0, 0);
      }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(300);
      // Open collapsed accordions and cycle through tabs so their panels are rendered in the DOM.
      await page.evaluate(async () => {
        const toggles = [...document.querySelectorAll('[aria-expanded="false"],[role="tab"][aria-selected="false"],[data-bs-toggle="collapse"],[data-bs-toggle="tab"],[data-toggle="tab"],[data-toggle="collapse"]')]
          .filter((element) => !element.disabled && !element.closest('a[href]:not([href^="#"])') && !element.closest('nav,header') && element.getBoundingClientRect().height > 0).slice(0, 80);
        for (const element of toggles) {
          try { element.scrollIntoView({ block: 'center' }); element.click(); } catch { /* ignore */ }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        window.scrollTo(0, 0);
      }).catch(() => {});
      if (page.url() !== urlBeforeExpansion) await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const [analysis, sourceExtraction, structuredData] = await Promise.all([analyzeRenderedPage(page), extractSourcePage(page), extractStructuredData(page)]);
      await prefetchDiscoveredAssets(page, sourceExtraction.assetReferences);
      analysis.extraction = sourceExtraction.extraction;
      analysis.styles = sourceExtraction.styles;
      analysis.images = [...(analysis.images || []), ...(sourceExtraction.assetReferences || [])];
      const routePath = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
      const pageType = classifyPage({ path: routePath, title: analysis.title, headings: analysis.headings });
      pages.push({ url: page.url(), path: routePath, pageType, captureStatus: 'captured', discoveredFrom: discoveryMetadata.get(route) || null, scrollStatus: scrollResult, ...analysis, data: structuredData, links: undefined });
      const newlyDiscovered = analysis.links.map((link, index) => ({ ...link, _index: index }))
        .sort((a, b) => linkPriority(a) - linkPriority(b) || a._index - b._index);
      for (const link of newlyDiscovered) {
        if (routeQueue.length >= crawlLimit) break;
        const normalized = normalizeRoute(link.href, origin);
        const section = normalized ? sectionKey(normalized) : null;
        if (section && routeQueue.filter((queued) => sectionKey(queued) === section).length >= sectionCap(crawlLimit)) continue;
        if (!normalized || queuedRoutes.has(normalized) || /\b(?:logout|signout|delete|remove|cart|checkout)\b/i.test(`${link.text} ${normalized}`)) continue;
        queuedRoutes.add(normalized);
        routeQueue.push(normalized);
        discoveryMetadata.set(normalized, { source: routePath, priority: linkPriority(link), text: link.text });
      }
      const routeScreenshot = await captureViewportScreenshot(page, { quality: 72, optional: true });
      if (routeScreenshot) routeScreenshots.push({ path: routePath, title: analysis.title, dataUrl: `data:image/jpeg;base64,${routeScreenshot.toString('base64')}` });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await navigateForCapture(page, canonicalUrl.href, { navigationTimeout: 25000, contentTimeout: 7000 }).catch(() => {});
     await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
     await page.evaluate(() => document.fonts?.ready).catch(() => {});
     const mobileAnalysis = await analyzeRenderedPage(page, { maxVisualElements: 140 }).catch(() => null);
     const homePage = pages.find((capturedPage) => capturedPage.path === `${canonicalUrl.pathname}${canonicalUrl.search}`);
     if (homePage && mobileAnalysis) {
       homePage.responsive = {
         mobile: {
           viewport: mobileAnalysis.viewport,
           document: mobileAnalysis.document,
           headings: mobileAnalysis.headings,
           sections: mobileAnalysis.sections,
           visualElements: mobileAnalysis.visualElements,
           controls: mobileAnalysis.controls,
           design: mobileAnalysis.design
         }
       };
     }
      const mobile = await captureViewportScreenshot(page, { quality: 82, optional: true });
      const desktopData = desktop ? `data:image/jpeg;base64,${desktop.toString('base64')}` : null;
      const mobileData = mobile ? `data:image/jpeg;base64,${mobile.toString('base64')}` : null;
     const visibleRouteScreenshots = routeScreenshots.slice(0, 500);
     const rows = Math.max(1, Math.ceil(visibleRouteScreenshots.length / 5));
     const visionHeight = Math.min(5000, 630 + rows * 190);
     const routeCards = visibleRouteScreenshots.map((reference) => `<figure style="margin:0;width:280px"><img src="${reference.dataUrl}" style="display:block;width:280px;height:155px;object-fit:cover;object-position:top;border:1px solid #ddd"><figcaption style="height:25px;padding:4px 6px;font:11px Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#fff;color:#111">${escapeHtml(reference.path)} — ${escapeHtml(reference.title)}</figcaption></figure>`).join('');
      let visionReference = desktop || null;
      try {
        if (!desktopData || !mobileData) throw new Error('Optional screenshots unavailable');
       await page.setViewportSize({ width: 1440, height: visionHeight });
       await page.setContent(`<main style="margin:0;width:1440px;min-height:${visionHeight}px;overflow:hidden;background:#eee"><section style="height:610px;display:flex;gap:12px;padding:0 12px 10px;background:#fff"><img src="${desktopData}" style="width:960px;height:600px;object-fit:cover;object-position:top" alt="Desktop home reference"><img src="${mobileData}" style="width:278px;height:600px;object-fit:cover;object-position:top" alt="Mobile home reference"></section><section style="display:grid;grid-template-columns:repeat(5,280px);gap:8px;padding:8px">${routeCards}</section></main>`, { waitUntil: 'domcontentloaded', timeout: 15000 });
       await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 10000 }).catch(() => {});
       visionReference = await captureViewportScreenshot(page, { quality: 86 });
     } catch { /* The clone data is still usable without the combined vision reference. */ }

    const visibleImages = pages.flatMap((route) => (route.images || []).map((image) => ({ ...image, pagePath: route.path })));
    await Promise.allSettled([...pendingAssetCaptures]);
    for (const image of visibleImages) {
      if (!image.src?.startsWith('data:image/') || capturedAssetUrls.has(image.src)) continue;
      const match = image.src.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|avif));base64,([a-z0-9+/=]+)$/i);
      if (!match) continue;
      const byteLength = Buffer.byteLength(match[2], 'base64');
      if (byteLength > 0 && byteLength <= MAX_ASSET_BYTES) {
        capturedAssetUrls.add(image.src);
        capturedAssets.push({ url: image.src, mimeType: match[1].toLowerCase(), byteLength, dataUrl: image.src });
      }
    }
    const selectedAssets = selectCapturedAssets(capturedAssets, visibleImages);
    const assets = prepareLocalizedAssets(selectedAssets);
    const documentAssets = await captureLinkedDocuments(context, pages, { startIndex: assets.length, validateUrl: validatePublicUrl, signal }).catch(() => []);
    assets.push(...documentAssets);
    const missingReferences = visibleImages.filter((image) => !assets.some((asset) => asset.sourceUrls?.includes(image.src)));
    const unavailableQueue = missingReferences.map((image, index) => ({
      id: `unavailable:${index}`,
      order: 0,
      status: 'unavailable',
      token: null,
      publicPath: null,
      sourceUrls: [image.src],
      sourcePaths: (() => { try { const url = new URL(image.src); return [`${url.pathname}${url.search}`]; } catch { return []; } })(),
      mimeType: null,
      alt: image.alt || '',
      width: image.width || null,
      height: image.height || null,
      page: image.pagePath || null,
      section: image.section || null,
      element: image.element || null,
      selector: image.selector || null,
      source: image.source || null,
      rect: image.rect || null,
      style: image.style || null
    }));
    const pageOrder = new Map(pages.map((capturedPage, index) => [capturedPage.path, index]));
    const assetQueue = [...buildAssetPlacementQueue(assets.filter((asset) => !asset.isDocument), pages), ...unavailableQueue]
      .sort((a, b) => {
        const pageDifference = (pageOrder.get(a.page) ?? Number.MAX_SAFE_INTEGER) - (pageOrder.get(b.page) ?? Number.MAX_SAFE_INTEGER);
        if (pageDifference) return pageDifference;
        return (a.rect?.documentY ?? Number.MAX_SAFE_INTEGER) - (b.rect?.documentY ?? Number.MAX_SAFE_INTEGER);
      })
      .map((item, index) => ({ ...item, order: index }));
    for (const capturedPage of pages) {
      capturedPage.assetQueue = assetQueue.filter((item) => item.page === capturedPage.path);
    }
    return {
      sourceUrl: entryUrl.href,
      canonicalUrl: canonicalUrl.href,
      capturedAt: new Date().toISOString(),
       screenshots: {
         desktop: desktopData,
         mobile: mobileData,
          vision: visionReference ? `data:image/jpeg;base64,${visionReference.toString('base64')}` : null,
         routes: routeScreenshots
      },
      pages,
      assets,
      assetQueue,
      coverage: {
        discoveredInternalPages: queuedRoutes.size,
        attemptedPages: pages.length,
        capturedPages: pages.filter((item) => item.captureStatus === 'captured').length,
        unavailablePages: pages.filter((item) => item.captureStatus !== 'captured').length,
        pagesReachedBottom: pages.filter((item) => item.scrollStatus?.reachedBottom).length,
        pagesScrollTimedOut: pages.filter((item) => item.scrollStatus?.timedOut).length,
        pagesScrollHeightCapped: pages.filter((item) => item.scrollStatus?.cappedByHeight).length,
        stoppedByPageBudget: Number.isFinite(crawlLimit) && routeQueue.length >= crawlLimit,
        stoppedByTimeBudget: Date.now() - crawlStartedAt > MAX_CRAWL_DURATION_MS,
        crawlLimit: Number.isFinite(crawlLimit) ? crawlLimit : null,
        durationMs: Date.now() - crawlStartedAt
      },
      siteMap: buildSiteMap(pages),
      urlRegistry: {
        discoveredURLs: [...queuedRoutes],
        queuedURLs: routeQueue.slice(visitedRoutes.size),
        visitedURLs: [...visitedRoutes],
        clonedURLs: pages.filter((item) => item.captureStatus === 'captured').map((item) => item.url),
        failedURLs: [...failedRoutes]
      },
      assetDiscovery: {
        discoveredReferences: visibleImages.length,
        capturedResponses: capturedAssets.length,
        selectedResponses: selectedAssets.length,
        localizedAssets: assets.length,
        documentsDownloaded: documentAssets.length,
        missingReferences: missingReferences.map((image) => ({ page: image.pagePath, url: image.src, selector: image.selector, source: image.source })).slice(0, 250)
      }
    };
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close().catch(() => {});
  }
}

module.exports = { captureLinkedDocuments, extractStructuredData, resolveRouteLimit, captureWebsite, captureViewportScreenshot, analyzeRenderedPage, extractSourcePage, prefetchDiscoveredAssets, validatePublicUrl, isPrivateAddress, normalizeRoute, prioritizeDiscoveredRoutes, selectCapturedAssets, navigateForCapture, classifyPage, linkPriority, canonicalAssetIdentity, isTrackingAssetUrl, buildSiteMap, discoverSitemapLinks };
