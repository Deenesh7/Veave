const dns = require('node:dns').promises;
const net = require('node:net');
const { chromium } = require('playwright');
const { prepareLocalizedAssets, buildAssetPlacementQueue } = require('./assetLocalizationService');
const { pageSnapshot } = require('./fidelityAudit');
const { launchChromium } = require('../browser/launchChromium');

const DEFAULT_DISCOVERY_BATCH = 500;

// Servers label fonts inconsistently (Typekit sends application/font-woff2; others application/x-font-woff or octet-stream).
// Anything that is really a web font is mapped to one standard type, otherwise the site's fonts are silently not captured.
const FONT_TYPE_ALIASES = {
  'font/woff2': 'font/woff2', 'application/font-woff2': 'font/woff2', 'application/x-font-woff2': 'font/woff2',
  'font/woff': 'font/woff', 'application/font-woff': 'font/woff', 'application/x-font-woff': 'font/woff',
  'font/ttf': 'font/ttf', 'application/x-font-ttf': 'font/ttf', 'application/x-font-truetype': 'font/ttf', 'application/font-sfnt': 'font/ttf', 'font/sfnt': 'font/ttf',
  'font/otf': 'font/otf', 'application/x-font-opentype': 'font/otf', 'application/font-otf': 'font/otf', 'application/x-font-otf': 'font/otf'
};
function normalizeAssetType(contentType, url = '') {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (FONT_TYPE_ALIASES[type]) return FONT_TYPE_ALIASES[type];
  if (!type || type === 'application/octet-stream' || type === 'binary/octet-stream') {
    const ext = (() => { try { return new URL(url).pathname.match(/\.(woff2?|ttf|otf)$/i)?.[1]?.toLowerCase(); } catch { return null; } })();
    if (ext) return { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[ext];
  }
  return type;
}
// A clone captures at most this many pages (12 by default; CLONE_ROUTE_LIMIT raises or lowers it). The crawl keeps going
// past pages that fail until this many pages were captured successfully, or the site has no more.
const CLONE_ROUTE_LIMIT = Math.max(1, Math.min(60, Number.parseInt(process.env.CLONE_ROUTE_LIMIT, 10) || 12));
const ROUTE_HARD_CAP = CLONE_ROUTE_LIMIT;
const DEFAULT_MAX_ROUTES = CLONE_ROUTE_LIMIT;
// Extra candidates queued beyond the limit so pages that fail (404, timeout, redirect off-site) can be replaced.
const RESERVE_ROUTES = 12;

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

const ROUTE_CAPTURE_TIMEOUT_MS = Math.max(20000, Number.parseInt(process.env.CLONE_ROUTE_TIMEOUT_MS, 10) || 120000);
const ROUTE_CAPTURE_ATTEMPTS = Math.max(1, Math.min(4, Number.parseInt(process.env.CLONE_ROUTE_ATTEMPTS, 10) || 2));

// Rejects if `promise` does not settle in time, so one hung page cannot stall the whole crawl.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(message), { name: 'TimeoutError' })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
      if (/^(?:utm_|fbclid|gclid|dclid|msclkid|yclid|srsltid|igshid|mc_cid|mc_eid|_ga|_gl|ref_src)/i.test(key)) parsed.searchParams.delete(key);
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
    // /a//b, /a/index.html and /a/ are the same page as /a/b and /a.
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/(?:index|default)\.(?:html?|php|aspx?)$/i, '/');
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
      const batch = [];
      while (queue.length && batch.length < 6 && seenSitemaps.size < 40) {
        const item = queue.shift();
        if (seenSitemaps.has(item.url)) continue;
        seenSitemaps.add(item.url);
        batch.push(item);
      }
      const bodies = await Promise.all(batch.map(async (item) => {
        try { return { ...item, body: await fetchText(item.url) }; }
        catch { return { ...item, body: '' }; }
      }));
      for (const { body, depth } of bodies) {
        if (!body || Buffer.byteLength(body, 'utf8') > 20 * 1024 * 1024) continue;
        const isIndex = /<sitemapindex[\s>]/i.test(body);
        for (const match of body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
          const href = match[1].replace(/&amp;/g, '&');
          if (isIndex || /\.xml(?:\?.*)?$/i.test(href)) {
            try { if (depth < 2 && new URL(href).origin === origin) queue.push({ url: href, depth: depth + 1 }); } catch { /* ignore */ }
            continue;
          }
          results.push({ href, text: 'Sitemap page', fromSitemap: true });
        }
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

    // Sites that size images with JavaScript (a container whose height comes from a script) collapse them to 0 px once the
    // scripts are gone. Record the height each image container really had (the image and three ancestors) so a rebuilt page
    // can give it back as a minimum height.
    const measured = [];
    document.querySelectorAll('img,video').forEach((element) => {
      let node = element;
      for (let level = 0; node && node !== document.body && level < 4; level += 1, node = node.parentElement) {
        if (node.hasAttribute('data-veave-h')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.height <= 5000) { node.setAttribute('data-veave-h', String(Math.round(rect.height))); measured.push(node); }
      }
    });
    const sourceRoot = document.documentElement || document.body;
    const clone = sourceRoot?.cloneNode(true) || document.createElement('html');
    measured.forEach((element) => element.removeAttribute('data-veave-h'));
    // The page may use relative URLs (src="img/logo.png", href="docs/intro"). The rebuilt page lives at other addresses and the
    // asset/route localisation matches absolute URLs, so every URL is resolved against the page's base now.
    const baseUrl = document.baseURI;
    const absolute = (value) => {
      const text = String(value || '').trim();
      if (!text || /^(?:#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(text)) return value;
      try { return new URL(text, baseUrl).href; } catch { return value; }
    };
    clone.querySelectorAll('[src],[poster],[data-src],[data-image],[data-bg],[href]').forEach((element) => {
      for (const name of ['src', 'poster', 'data-src', 'data-image', 'data-bg']) if (element.hasAttribute(name)) element.setAttribute(name, absolute(element.getAttribute(name)));
      if (element.hasAttribute('href') && /^(?:a|area)$/i.test(element.tagName)) element.setAttribute('href', absolute(element.getAttribute('href')));
    });
    clone.querySelectorAll('[srcset],[data-srcset]').forEach((element) => {
      for (const name of ['srcset', 'data-srcset']) {
        if (!element.hasAttribute(name)) continue;
        element.setAttribute(name, element.getAttribute(name).split(/,(?=\s)/).map((part) => { const [url, ...rest] = part.trim().split(/\s+/); return [absolute(url), ...rest].join(' '); }).join(', '));
      }
    });
    clone.querySelectorAll('[style*="url("]').forEach((element) => {
      element.setAttribute('style', element.getAttribute('style').replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, ref) => `url(${quote}${absolute(ref)}${quote})`));
    });
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
  // Documents are bundled only while they fit a small budget; the rest stay links to the original file on the source site
  // (a university's 158 PDFs were 116 MB). Override with CLONE_MAX_DOCUMENTS / _BYTES / CLONE_DOCUMENT_BUDGET_BYTES.
  const maxDocuments = Math.max(0, Number.parseInt(process.env.CLONE_MAX_DOCUMENTS, 10) || 40);
  const maxBytes = Math.max(1024, Number.parseInt(process.env.CLONE_MAX_DOCUMENT_BYTES, 10) || 2 * 1024 * 1024);
  const totalBudget = Math.max(maxBytes, Number.parseInt(process.env.CLONE_DOCUMENT_BUDGET_BYTES, 10) || 4 * 1024 * 1024);
  let documentBytes = 0;
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
  let nextDocIndex = 0;
  const docConcurrency = Math.min(8, ordered.length);
  await Promise.all(Array.from({ length: docConcurrency }, async () => {
    while (nextDocIndex < ordered.length && documents.length < maxDocuments) {
      const entry = ordered[nextDocIndex++];
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
          response = await context.request.get(url, { maxRedirects: 0, timeout: 15000, failOnStatusCode: false });
          const location = response.headers().location;
          if (response.status() >= 300 && response.status() < 400 && location) { url = new URL(location, url).href; continue; }
          break;
        }
        if (!response || !response.ok() || documents.length >= maxDocuments) continue;
        const mimeType = String(response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extension = DOCUMENT_TYPES[mimeType] || (mimeType === 'application/octet-stream' || !mimeType ? (new URL(url).pathname.match(DOCUMENT_EXTENSIONS)?.[1] || '').toLowerCase() : '');
        if (!extension) continue;
        const declared = Number.parseInt(response.headers()['content-length'], 10);
        if (Number.isFinite(declared) && declared > maxBytes) continue;
        const body = await response.body();
        if (!body.length || body.length > maxBytes || documents.length >= maxDocuments) continue;
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
        if (documentBytes + body.length > totalBudget) continue; // over budget: stays an external link
        documentBytes += body.length;
        seenHashes.set(hash, asset);
        documents.push(asset);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
  }));
  return documents;
}
async function prefetchDiscoveredAssets(page, references = []) {
  const urls = [...new Set(references
    .filter((item) => ['css-rule', 'html-attribute', 'html-link'].includes(item?.source))
    .map((item) => item.src)
    .filter((url) => /^https?:\/\//i.test(url)))]
    .slice(0, 5000);
  await page.evaluate(async (all) => {
    let next = 0;
    const worker = async () => {
      while (next < all.length) {
        const url = all[next++];
        await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'force-cache' }).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: 24 }, worker));
  }, urls).catch(() => {});
}

// `url(#a)` inside a stylesheet resolves to ".../styles.css#a" or ".../css/%23a": a fragment reference, not a file.
// Legacy .eot fonts (Internet Explorer only) are never needed: every browser uses the woff2/woff files next to them.
function isFragmentArtifact(url) {
  return /%23[\w-]*$/i.test(url) || /#[\w-]+$/.test(url) || /\.eot(?:[?#]|$)/i.test(url);
}

const FETCHABLE_ASSET_TYPE = /^(?:image\/(?:png|jpeg|webp|gif|svg\+xml|avif|x-icon|vnd\.microsoft\.icon)|font\/(?:woff2?|ttf|otf))$/;
const TYPE_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

/**
 * Downloads referenced images the page itself never requested (off-screen carousel slides, JS-swapped sources, hidden
 * tabs). Every hop is validated as a public address first. Returns assets in the same shape as the response listener.
 */
async function fetchReferencedAssets(requester, urls, { validate, referer, maxBytes = 25 * 1024 * 1024, concurrency = 12, budgetMs = 120000, signal } = {}) {
  const found = [];
  const deadline = Date.now() + budgetMs;
  let next = 0;
  const fetchOne = async (url) => {
    let current = url;
    for (let hop = 0; hop < 4; hop += 1) {
      await validate(current);
      const response = await requester.get(current, { maxRedirects: 0, timeout: 20000, failOnStatusCode: false, headers: referer ? { referer } : {} });
      const status = response.status();
      if (status >= 300 && status < 400 && response.headers().location) { current = new URL(response.headers().location, current).href; continue; }
      if (status !== 200) return;
      const body = await response.body();
      if (!body.length || body.length > maxBytes) return;
      const declared = normalizeAssetType(response.headers()['content-type'], current);
      const extension = (new URL(current).pathname.match(/\.(\w{2,5})$/) || [])[1]?.toLowerCase();
      const mimeType = FETCHABLE_ASSET_TYPE.test(declared) ? declared : (TYPE_BY_EXTENSION[extension] || null);
      if (!mimeType) return;
      found.push({ url, mimeType, byteLength: body.length, bodyBase64: body.toString('base64') });
      return;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (next < urls.length && Date.now() < deadline) {
      signal?.throwIfAborted();
      await fetchOne(urls[next++]).catch(() => {});
    }
  }));
  return found;
}

// How much a placement tells the generator about where the asset belongs (the DOM-attribute pass records the
// selector, element and section; the plain pass only a position).
function placementRichness(item) {
  return (item.selector ? 4 : 0) + (item.section ? 2 : 0) + (item.element ? 2 : 0) + (item.style ? 1 : 0) + (item.alt ? 1 : 0) + (item.source === 'html-attribute' || item.source === 'css-rule' ? 1 : 0);
}

/**
 * One placement per asset per spot. The same image is often recorded twice (a plain <img> pass and a DOM-attribute
 * pass) at the same position, or the same element appears again with a slightly different rect; both would make the
 * generator place the image twice. Duplicates are merged into the most descriptive entry, at the first one's position
 * in the queue. Unavailable entries and entries without a position are kept (they have nothing to compare).
 */
function dedupePlacements(items = []) {
  const bySpot = new Map();
  const byElement = new Map();
  const flat = new Set();
  const result = [];
  for (const item of items) {
    if (!item.rect || item.status === 'unavailable' || !item.token) {
      // Nothing positional to compare: identical references (the same font declared by several @font-face rules, the same
      // missing image listed twice) are one entry.
      const identity = ['id', item.page, item.token, item.status, (item.sourceUrls || [])[0], item.source, item.selector, item.element?.tag, item.section?.tag, item.alt].join('|');
      if (!item.rect && !flat.has(identity)) { flat.add(identity); result.push(item); }
      else if (item.rect) result.push(item);
      continue;
    }
    const spot = [item.page, item.token, item.rect.x, item.rect.documentY, item.rect.width, item.rect.height].join('|');
    const element = item.selector ? [item.page, item.token, item.selector].join('|') : null;
    const existingIndex = bySpot.get(spot) ?? (element ? byElement.get(element) : undefined);
    if (existingIndex === undefined) {
      bySpot.set(spot, result.length);
      if (element) byElement.set(element, result.length);
      result.push(item);
    } else if (placementRichness(item) > placementRichness(result[existingIndex])) {
      result[existingIndex] = item; // keep the earlier position, with the better description
      if (element) byElement.set(element, existingIndex);
      bySpot.set(spot, existingIndex);
    }
  }
  return result;
}

/** Safety net after the crawl: two captured entries with the same final URL are one page; later ones become duplicates. */
function markDuplicatePages(pages, origin) {
  const seen = new Set();
  return pages.map((page) => {
    if (page.captureStatus !== 'captured') return page;
    const key = normalizeRoute(page.url, origin) || page.url;
    if (seen.has(key)) return { ...page, captureStatus: 'duplicate-route', duplicateOf: key };
    seen.add(key);
    return page;
  });
}

/**
 * Runs `crawlOne(holder, index)` over `queue` with several workers until `limit` pages were CAPTURED, the queue has no
 * candidate left, or time ran out. Pages that fail do not count; their slot goes to the next queued candidate. Pages in
 * flight count towards the limit so workers never overshoot, but idle workers wait for them in case one fails.
 * Returns the index of the first candidate that was never tried.
 */
async function crawlUntilCaptured({ holders, queue, startIndex, limit, capturedCount, crawlOne, expired = () => false, signal, pollMs = 150 }) {
  let next = startIndex;
  let inFlight = 0;
  await Promise.all(holders.map(async (holder) => {
    for (;;) {
      signal?.throwIfAborted();
      if (expired()) break;
      const captured = capturedCount();
      if (captured >= limit) break;
      if (captured + inFlight < limit && next < queue.length) {
        const index = next++;
        inFlight += 1;
        try { await crawlOne(holder, index); } finally { inFlight -= 1; }
      } else if (inFlight > 0) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      } else break; // nothing in flight and nothing left to try
    }
  }));
  return next;
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

  // Linked stylesheets from other origins cannot be read from the page; fetch them (public hosts only, every redirect hop
  // validated, size-capped).
  const fetchSheetText = async (href) => {
    let current = href;
    for (let hop = 0; hop < 4; hop += 1) {
      if (!/^https?:\/\//i.test(current)) return null;
      await validateRequestUrl(current);
      const response = await context.request.get(current, { maxRedirects: 0, timeout: 15000, failOnStatusCode: false });
      const status = response.status();
      if (status >= 300 && status < 400 && response.headers().location) { current = new URL(response.headers().location, current).href; continue; }
      if (status !== 200) return null;
      const body = await response.body();
      return body.length && body.length <= 1.5 * 1024 * 1024 ? body.toString('utf8') : null;
    }
    return null;
  };

  await context.route('**/*', async (route) => {
    try {
      await validateRequestUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });

  const crashedPages = new WeakSet();
  const pageUsable = (targetPage) => !targetPage.isClosed() && !crashedPages.has(targetPage);
  const attachCaptureListeners = (targetPage) => {
    targetPage.on('crash', () => crashedPages.add(targetPage));
    // Links that open a new tab/popup are discarded; the target URL is still found through link discovery.
    targetPage.on('popup', (popup) => popup.close().catch(() => {}));
    targetPage.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    targetPage.on('download', (download) => download.cancel().catch(() => {}));
    targetPage.on('response', (response) => {
      const capture = (async () => {
        if (capturedAssets.length >= MAX_ASSET_CANDIDATES || capturedAssetUrls.has(response.url())) return;
        if (isTrackingAssetUrl(response.url())) return;
        const type = normalizeAssetType(response.headers()['content-type'], response.url());
        if (!/^(?:image\/(?:png|jpeg|webp|gif|svg\+xml|avif|x-icon|vnd\.microsoft\.icon)|font\/(?:woff2?|ttf|otf))$/.test(type)) return;
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
    return targetPage;
  };
  let page = attachCaptureListeners(await context.newPage());

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
    const queueCapacity = crawlLimit + RESERVE_ROUTES;
    const discoveredRoutes = prioritizeDiscoveredRoutes(allInitialLinks, origin, queueCapacity);
    const routeQueue = [normalizeRoute(canonicalUrl.href, origin), ...discoveredRoutes.filter((route) => route !== normalizeRoute(canonicalUrl.href, origin))].slice(0, queueCapacity);
    const queuedRoutes = new Set(routeQueue);
    const visitedRoutes = new Set();
    const failedRoutes = new Set();
    const discoveryMetadata = new Map([[routeQueue[0], { source: 'entry', priority: -1 }]]);
    for (const link of allInitialLinks) {
      const normalized = normalizeRoute(link.href, origin);
      if (normalized && !discoveryMetadata.has(normalized)) discoveryMetadata.set(normalized, { source: 'homepage', priority: linkPriority(link), text: link.text });
    }

    const pagesByIndex = [];
    const screenshotsByIndex = [];
    // final (post-redirect) route -> index of the queue entry that owns it
    const claimedFinalRoutes = new Map();
    const crawlSingleRoute = async (workerPage, routeIndex) => {
      if (Date.now() - crawlStartedAt > MAX_CRAWL_DURATION_MS) return;
      const route = routeQueue[routeIndex];
      visitedRoutes.add(route);
      signal?.throwIfAborted();
      if (workerPage.url() !== route) {
        let navigationFailed = false;
        let navigationError = null;
        await navigateForCapture(workerPage, route, { navigationTimeout: 20000, contentTimeout: 7000, maxAttempts: 2 })
          .catch((error) => { navigationFailed = true; navigationError = error; });
        if (navigationFailed && normalizeRoute(workerPage.url(), origin) !== route) {
          const unavailable = new URL(route);
          pagesByIndex[routeIndex] = {
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
          };
          failedRoutes.add(route);
          return;
        }
        await workerPage.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
      }
      // Two different links can lead to one page (redirects, /shop -> /store). The page is cloned once; the second
      // route is recorded as a duplicate and its slot goes to the next candidate.
      const finalRoute = normalizeRoute(workerPage.url(), origin) || route;
      if (claimedFinalRoutes.has(finalRoute) && claimedFinalRoutes.get(finalRoute) !== routeIndex) {
        const duplicate = new URL(route);
        pagesByIndex[routeIndex] = {
          url: route, path: `${duplicate.pathname}${duplicate.search}`, title: '', description: '', headings: [], sections: [], controls: [], images: [], design: {},
          captureStatus: 'duplicate-route', duplicateOf: finalRoute,
          pageType: classifyPage({ path: duplicate.pathname, title: duplicate.pathname }),
          discoveredFrom: discoveryMetadata.get(route) || null
        };
        return;
      }
      claimedFinalRoutes.set(finalRoute, routeIndex);
      if (new URL(workerPage.url()).origin !== origin) {
        const unavailable = new URL(route);
        pagesByIndex[routeIndex] = {
          url: route,
          path: `${unavailable.pathname}${unavailable.search}`,
          title: unavailable.pathname.split('/').filter(Boolean).at(-1)?.replace(/[-_]+/g, ' ') || 'Home',
          description: '', headings: [], sections: [], controls: [], images: [], design: {},
          captureStatus: 'external-redirect',
          pageType: classifyPage({ path: unavailable.pathname, title: unavailable.pathname }),
          discoveredFrom: discoveryMetadata.get(route) || null
        };
        failedRoutes.add(route);
        return;
      }
      const scrollResult = await workerPage.evaluate(async ({ maximumScrollHeight, maximumDurationMs }) => {
        const startedAt = performance.now();
        // Dismiss cookie/consent banners so they do not cover content or get cloned as page content.
        for (const button of document.querySelectorAll('button,[role="button"],a[role="button"]')) {
          const label = (button.innerText || button.getAttribute('aria-label') || '').trim();
          if (!/^(accept( all)?( cookies)?|allow( all)?( cookies)?|agree|i agree|got it|ok(ay)?)$/i.test(label)) continue;
          const holder = button.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[aria-label*="cookie" i],[role="dialog"]');
          if (holder && !button.closest('a[href]:not([href^="#"])')) { try { button.click(); } catch { /* ignore */ } break; }
        }
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
          await new Promise((resolve) => setTimeout(resolve, 80));
          iterations += 1;
          const updatedHeight = pageHeight();
          const atBottom = y + window.innerHeight >= Math.min(updatedHeight, maximumScrollHeight || updatedHeight) - 2;
          if (atBottom) {
            await new Promise((resolve) => setTimeout(resolve, 150));
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
      }, { maximumScrollHeight: MAX_PAGE_SCROLL_HEIGHT, maximumDurationMs: Math.min(MAX_PAGE_SCROLL_DURATION_MS, 25000) }).catch(() => ({ reachedBottom: false, timedOut: true, cappedByHeight: false, finalHeight: null, iterations: 0 }));

      // Reveal content hidden behind "load more" buttons and closed <details>; only re-scroll if anything expanded.
      const urlBeforeExpansion = workerPage.url();
      let expandedAny = false;
      for (let round = 0; round < 6; round += 1) {
        const expanded = await workerPage.evaluate(() => {
          const details = [...document.querySelectorAll('details:not([open])')];
          details.forEach((element) => element.setAttribute('open', ''));
          const pattern = /^\s*(load|show|view|see|read)\s+(more|all)\b/i;
          const target = [...document.querySelectorAll('button,[role="button"]')].find((element) => !element.disabled
            && !element.closest('a[href]')
            && pattern.test((element.innerText || element.getAttribute('aria-label') || '').trim())
            && element.getBoundingClientRect().height > 0);
          if (!target) return { clicked: false, openedDetails: details.length > 0 };
          target.scrollIntoView({ block: 'center' });
          target.click();
          return { clicked: true, openedDetails: details.length > 0 };
        }).catch(() => ({ clicked: false, openedDetails: false }));
        if (expanded.openedDetails || expanded.clicked) expandedAny = true;
        if (!expanded.clicked) break;
        await workerPage.waitForTimeout(350);
      }
      if (workerPage.url() !== urlBeforeExpansion) await workerPage.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      if (expandedAny) {
        await workerPage.evaluate(async () => {
          const started = performance.now();
          const height = () => Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
          for (let y = 0; y < height() && performance.now() - started < 15000; y += Math.max(400, window.innerHeight * 0.7)) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 75));
          }
          window.scrollTo(0, 0);
        }).catch(() => {});
        await workerPage.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
      }
      // Open collapsed accordions and cycle through tabs so their panels are rendered in the DOM.
      await workerPage.evaluate(async () => {
        const toggles = [...document.querySelectorAll('[aria-expanded="false"],[role="tab"][aria-selected="false"],[data-bs-toggle="collapse"],[data-bs-toggle="tab"],[data-toggle="tab"],[data-toggle="collapse"]')]
          .filter((element) => !element.disabled && !element.closest('a[href]:not([href^="#"])') && !element.closest('nav,header') && element.getBoundingClientRect().height > 0).slice(0, 24);
        for (const element of toggles) {
          try { element.scrollIntoView({ block: 'center' }); element.click(); } catch { /* ignore */ }
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (toggles.length) window.scrollTo(0, 0);
      }).catch(() => {});
      if (workerPage.url() !== urlBeforeExpansion) await workerPage.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const [analysis, sourceExtraction, structuredData] = await Promise.all([analyzeRenderedPage(workerPage), extractSourcePage(workerPage), extractStructuredData(workerPage)]);
      await prefetchDiscoveredAssets(workerPage, sourceExtraction.assetReferences);
      analysis.extraction = sourceExtraction.extraction;
      analysis.styles = sourceExtraction.styles;
      analysis.images = [...(analysis.images || []), ...(sourceExtraction.assetReferences || [])];
      const routePath = `${new URL(workerPage.url()).pathname}${new URL(workerPage.url()).search}`;
      const pageType = classifyPage({ path: routePath, title: analysis.title, headings: analysis.headings });
      const stylesheets = await require('./capturedCss').collectPageStylesheets(workerPage, fetchSheetText).catch(() => []);
      pagesByIndex[routeIndex] = { url: workerPage.url(), path: routePath, pageType, captureStatus: 'captured', discoveredFrom: discoveryMetadata.get(route) || null, scrollStatus: scrollResult, ...analysis, data: structuredData, links: undefined, stylesheets };
      // Links that are not plain <a href>: data-href attributes, onclick navigation, rel=next/prev pagination.
      const scriptedLinks = await workerPage.evaluate(() => {
        const found = [];
        const add = (value, text, extra = {}) => {
          try { const href = new URL(value, location.href).href; if (/^https?:/i.test(href)) found.push({ href, text: String(text || '').trim().slice(0, 120), ...extra }); } catch { /* ignore */ }
        };
        document.querySelectorAll('[data-href],[data-url],[data-link],[data-to],[data-navigate]').forEach((element) => {
          add(element.getAttribute('data-href') || element.getAttribute('data-url') || element.getAttribute('data-link') || element.getAttribute('data-to') || element.getAttribute('data-navigate'), element.innerText || element.getAttribute('aria-label'), { inNavigation: Boolean(element.closest('nav,header')), inFooter: Boolean(element.closest('footer')) });
        });
        document.querySelectorAll('[onclick]').forEach((element) => {
          const match = (element.getAttribute('onclick') || '').match(/(?:location(?:\.href)?\s*=|location\.(?:assign|replace)\s*\(|window\.open\s*\()\s*['"]([^'"]+)['"]/);
          if (match) add(match[1], element.innerText || element.getAttribute('aria-label'));
        });
        document.querySelectorAll('link[rel~="next"],link[rel~="prev"],link[rel~="alternate"][hreflang]').forEach((element) => add(element.getAttribute('href'), 'Pagination', { inPagination: true }));
        return found.slice(0, 1000);
      }).catch(() => []);
      const newlyDiscovered = [...analysis.links, ...scriptedLinks].map((link, index) => ({ ...link, _index: index }))
        .sort((a, b) => linkPriority(a) - linkPriority(b) || a._index - b._index);
      for (const link of newlyDiscovered) {
        if (routeQueue.length >= queueCapacity) break;
        const normalized = normalizeRoute(link.href, origin);
        const section = normalized ? sectionKey(normalized) : null;
        if (section && routeQueue.filter((queued) => sectionKey(queued) === section).length >= sectionCap(queueCapacity)) continue;
        if (!normalized || queuedRoutes.has(normalized) || /\b(?:logout|signout|delete|remove|cart|checkout)\b/i.test(`${link.text} ${normalized}`)) continue;
        queuedRoutes.add(normalized);
        routeQueue.push(normalized);
        discoveryMetadata.set(normalized, { source: routePath, priority: linkPriority(link), text: link.text });
      }
      const routeScreenshot = await captureViewportScreenshot(workerPage, { quality: 72, optional: true });
      if (routeScreenshot) screenshotsByIndex[routeIndex] = { path: routePath, title: analysis.title, dataUrl: `data:image/jpeg;base64,${routeScreenshot.toString('base64')}` };
    };

    // Each route is captured with a timeout and retries on a fresh page, so one crashed, hung or
    // blocked page is recorded as a failed route instead of aborting the whole clone.
    const replacePage = async (holder) => {
      await holder.page.close().catch(() => {});
      holder.page = attachCaptureListeners(await context.newPage());
    };
    const crawlRouteSafely = async (holder, routeIndex) => {
      const route = routeQueue[routeIndex];
      let lastError = null;
      for (let attempt = 1; attempt <= ROUTE_CAPTURE_ATTEMPTS; attempt += 1) {
        signal?.throwIfAborted();
        if (!pageUsable(holder.page)) await replacePage(holder);
        try {
          await withTimeout(crawlSingleRoute(holder.page, routeIndex), ROUTE_CAPTURE_TIMEOUT_MS, `Capturing ${route} timed out`);
          if (pagesByIndex[routeIndex]?.captureStatus !== 'navigation-timeout' || attempt === ROUTE_CAPTURE_ATTEMPTS) {
            // Page-by-page: this page's HTML, CSS, assets and paths are checked (and the missing ones fetched) before the next page.
            const check = await verifyPageScrape(pagesByIndex[routeIndex]);
            if (check.ok || attempt === ROUTE_CAPTURE_ATTEMPTS) return;
            console.warn(`[clone] ${route} scrape incomplete (${check.problems.join('; ')}); capturing it again`);
            failedRoutes.delete(route);
            pagesByIndex[routeIndex] = undefined;
            continue;
          }
          failedRoutes.delete(route);
          pagesByIndex[routeIndex] = undefined;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw error;
          lastError = error;
          await replacePage(holder).catch(() => {});
        }
      }
      if (!pagesByIndex[routeIndex]) {
        const unavailable = new URL(route);
        const routePath = `${unavailable.pathname}${unavailable.search}`;
        pagesByIndex[routeIndex] = {
          url: route, path: routePath,
          title: unavailable.pathname.split('/').filter(Boolean).at(-1)?.replace(/[-_]+/g, ' ') || 'Home',
          description: '', headings: [], sections: [], controls: [], images: [], design: {},
          captureStatus: 'capture-error',
          failure: { stage: 'capture', message: String(lastError?.message || 'Capture failed').slice(0, 1000) },
          pageType: classifyPage({ path: routePath, title: unavailable.pathname }),
          discoveredFrom: discoveryMetadata.get(route) || null
        };
        failedRoutes.add(route);
      }
    };

    // A scraped page must be complete before the crawl moves on: markup present, styles present, every referenced image
    // downloaded (missing ones are fetched now) and every local path resolvable. Returns the problems that need a re-scrape.
    async function verifyPageScrape(captured) {
      if (!captured || captured.captureStatus !== 'captured') return { ok: true, problems: [] };
      const problems = [];
      await Promise.allSettled([...pendingAssetCaptures]);
      const html = String(captured.extraction?.html || '');
      if (html.length < 200 && String(captured.data?.fullText || '').length < 40) problems.push('no HTML/text extracted');
      const hasCss = (captured.stylesheets || []).length > 0 || Boolean(captured.styles && Object.keys(captured.styles).length) || /<style[\s>]|style="/i.test(html);
      if (!hasCss) problems.push('no CSS extracted');
      const wanted = [...new Set((captured.images || []).map((image) => image.src))]
        .filter((src) => /^https?:\/\//i.test(src || '') && !capturedAssetUrls.has(src) && !isFragmentArtifact(src) && !isTrackingAssetUrl(src));
      if (wanted.length) {
        const fetched = await fetchReferencedAssets(context.request, wanted, { validate: validateRequestUrl, referer: `${origin}/`, signal, budgetMs: 30000 }).catch(() => []);
        for (const asset of fetched) {
          if (capturedAssetUrls.has(asset.url)) continue;
          capturedAssetUrls.add(asset.url);
          capturedAssets.push(asset);
        }
        const stillMissing = wanted.filter((src) => !capturedAssetUrls.has(src));
        if (stillMissing.length && stillMissing.length > wanted.length * 0.5) problems.push(`${stillMissing.length}/${wanted.length} assets not downloaded`);
      }
      if (!captured.path || !captured.path.startsWith('/')) problems.push('invalid route path');
      return { ok: problems.length === 0, problems };
    }

    const mainHolder = { page };
    if (routeQueue.length > 0 && crawlLimit > 0) {
      await crawlRouteSafely(mainHolder, 0);
    }
    let nextRouteIndex = 1;
    const capturedCount = () => pagesByIndex.filter((item) => item?.captureStatus === 'captured').length;
    const crawlConcurrency = Math.max(1, Number.parseInt(process.env.CLONE_CRAWL_CONCURRENCY, 10) || 1);
    const workerCount = Math.min(crawlConcurrency, Math.max(0, Math.min(routeQueue.length, queueCapacity) - 1));
    if (workerCount > 0) {
      const extraHolders = await Promise.all(
        Array.from({ length: Math.max(0, workerCount - 1) }, async () => ({ page: attachCaptureListeners(await context.newPage()) }))
      );
      try {
        // Keep crawling until `crawlLimit` pages were CAPTURED (failed pages do not count and are replaced from the
        // reserve) or the site has nothing left to try. In-flight pages count towards the limit so workers never
        // overshoot, but a worker waits for them: if one fails, its slot is handed to the next candidate.
        nextRouteIndex = await crawlUntilCaptured({
          holders: [mainHolder, ...extraHolders],
          queue: routeQueue,
          startIndex: nextRouteIndex,
          limit: crawlLimit,
          capturedCount,
          crawlOne: crawlRouteSafely,
          expired: () => Date.now() - crawlStartedAt > MAX_CRAWL_DURATION_MS,
          signal
        });
      } finally {
        await Promise.allSettled(extraHolders.map((holder) => holder.page.close()));
      }
    }
    page = mainHolder.page;
    if (!pageUsable(page)) page = attachCaptureListeners(await context.newPage());
    const pages = markDuplicatePages(pagesByIndex.filter(Boolean), origin);
    const routeScreenshots = screenshotsByIndex.filter(Boolean);

    await page.setViewportSize({ width: 390, height: 844 }).catch(() => {});
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
      // Percent-encoded (non-base64) inline images, typically SVG icons: decode them to bytes like any other asset.
      const inline = image.src.match(/^data:(image\/svg\+xml)(?:;charset=[^;,]+)?,(.+)$/is);
      if (inline && !/;base64,/i.test(image.src)) {
        let decoded = null;
        try { decoded = Buffer.from(decodeURIComponent(inline[2]), 'utf8'); } catch { /* malformed escape: leave unavailable */ }
        if (decoded?.length && decoded.length <= MAX_ASSET_BYTES) {
          capturedAssetUrls.add(image.src);
          capturedAssets.push({ url: image.src, mimeType: 'image/svg+xml', byteLength: decoded.length, bodyBase64: decoded.toString('base64') });
        }
        continue;
      }
      const match = image.src.match(/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|avif));base64,([a-z0-9+/=]+)$/i);
      if (!match) continue;
      const byteLength = Buffer.byteLength(match[2], 'base64');
      if (byteLength > 0 && byteLength <= MAX_ASSET_BYTES) {
        capturedAssetUrls.add(image.src);
        capturedAssets.push({ url: image.src, mimeType: match[1].toLowerCase(), byteLength, dataUrl: image.src });
      }
    }
    // Anything a page references that the browser never downloaded (off-screen carousel slides, lazily swapped
    // sources) is fetched now, so no referenced image is left as "unavailable" when it can be downloaded.
    const referencedButMissing = [...new Set(visibleImages.map((image) => image.src))]
      .filter((src) => /^https?:\/\//i.test(src || '') && !capturedAssetUrls.has(src) && !isFragmentArtifact(src) && !isTrackingAssetUrl(src));
    if (referencedButMissing.length) {
      const fetched = await fetchReferencedAssets(context.request, referencedButMissing, { validate: validateRequestUrl, referer: `${origin}/`, signal }).catch(() => []);
      for (const asset of fetched) {
        if (capturedAssetUrls.has(asset.url)) continue;
        capturedAssetUrls.add(asset.url);
        capturedAssets.push(asset);
      }
    }
    const selectedAssets = selectCapturedAssets(capturedAssets, visibleImages);
    // Shrink and budget the assets (priority order is already the capture's ranking) before they become project files.
    const budgeted = await require('./assetBudget').budgetAssets(selectedAssets, { pageOrder: pages.filter((item) => item.captureStatus === 'captured').map((item) => item.path) });
    const assets = prepareLocalizedAssets(budgeted.assets);
    const documentAssets = await captureLinkedDocuments(context, pages, { startIndex: assets.length, validateUrl: validatePublicUrl, signal }).catch(() => []);
    assets.push(...documentAssets);
    const missingReferences = visibleImages.filter((image) => !isFragmentArtifact(image.src || '') && !assets.some((asset) => asset.sourceUrls?.includes(image.src)));
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
    const assetQueue = dedupePlacements([...buildAssetPlacementQueue(assets.filter((asset) => !asset.isDocument), pages), ...unavailableQueue]
      .sort((a, b) => {
        const pageDifference = (pageOrder.get(a.page) ?? Number.MAX_SAFE_INTEGER) - (pageOrder.get(b.page) ?? Number.MAX_SAFE_INTEGER);
        if (pageDifference) return pageDifference;
        return (a.rect?.documentY ?? Number.MAX_SAFE_INTEGER) - (b.rect?.documentY ?? Number.MAX_SAFE_INTEGER);
      }))
      .map((item, index) => ({ ...item, order: index }));
    for (const capturedPage of pages) {
      capturedPage.assetQueue = assetQueue.filter((item) => item.page === capturedPage.path);
    }
    const raw = {
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
        stoppedByPageBudget: pages.filter((item) => item.captureStatus === 'captured').length >= crawlLimit,
        siteExhausted: pages.filter((item) => item.captureStatus === 'captured').length < crawlLimit && nextRouteIndex >= routeQueue.length,
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
        budget: { ...budgeted.stats, dropped: budgeted.dropped.slice(0, 100).map(({ url, reason, bytes }) => ({ url: String(url).slice(0, 200), reason, bytes })) },
        missingReferences: missingReferences.map((image) => ({ page: image.pagePath, url: image.src, selector: image.selector, source: image.source })).slice(0, 250)
      }
    };

    // STRICT duplicate check. Whatever was collected twice (pages, asset files, asset paths, queue placements) is merged
    // and listed in `duplicateAudit`; the result is then verified and the capture is refused if anything is left.
    const guard = require('./duplicateGuard');
    const guardOptions = { normalizeRoute, dedupePlacements, origin };
    const { capture: cleaned, report: duplicateAudit } = guard.enforceUniqueCapture(raw, guardOptions);
    guard.assertNoCaptureDuplicates(cleaned, guardOptions);
    const finalPages = cleaned.pages;
    const capturedFinal = finalPages.filter((item) => item.captureStatus === 'captured');
    cleaned.coverage = {
      ...raw.coverage,
      attemptedPages: finalPages.length,
      capturedPages: capturedFinal.length,
      unavailablePages: finalPages.length - capturedFinal.length,
      pagesReachedBottom: finalPages.filter((item) => item.scrollStatus?.reachedBottom).length,
      pagesScrollTimedOut: finalPages.filter((item) => item.scrollStatus?.timedOut).length,
      pagesScrollHeightCapped: finalPages.filter((item) => item.scrollStatus?.cappedByHeight).length,
      stoppedByPageBudget: capturedFinal.length >= crawlLimit,
      siteExhausted: capturedFinal.length < crawlLimit && nextRouteIndex >= routeQueue.length
    };
    cleaned.siteMap = buildSiteMap(finalPages);
    cleaned.urlRegistry = { ...raw.urlRegistry, clonedURLs: capturedFinal.map((item) => item.url) };
    cleaned.assetDiscovery = { ...raw.assetDiscovery, localizedAssets: cleaned.assets.length };
    cleaned.duplicateAudit = duplicateAudit;
    // The site's own CSS, once per distinct stylesheet (pages share most of it), kept apart from the per-page records.
    const sheetByKey = new Map();
    let sheetBytes = 0;
    for (const page of cleaned.pages) {
      page.stylesheetKeys = [];
      for (const sheet of page.stylesheets || []) {
        if (!sheetByKey.has(sheet.key) && sheetBytes + sheet.text.length <= 6 * 1024 * 1024) { sheetByKey.set(sheet.key, sheet); sheetBytes += sheet.text.length; }
        if (sheetByKey.has(sheet.key)) page.stylesheetKeys.push(sheet.key);
      }
      delete page.stylesheets;
    }
    cleaned.stylesheets = [...sheetByKey.values()];
    return cleaned;
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser.close().catch(() => {});
  }
}

/**
 * A clean, dedicated load of ONE live page for measuring it (colours behind text, fonts, image positions). The snapshot taken
 * while crawling is not reliable (many tabs, scripted state), so audits use this: the page is opened on its own, scrolled
 * through so lazy and reveal-on-scroll content is painted, then measured. Same network safety rules as the crawler.
 */
async function snapshotLivePage(sourceUrl, { signal, timeoutMs = 60000 } = {}) {
  const url = await validatePublicUrl(sourceUrl);
  signal?.throwIfAborted();
  const browser = await launchChromium({ browserType: chromium });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false, ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    });
    const validatedHosts = new Set();
    await context.route('**/*', async (route) => {
      try {
        const parsed = new URL(route.request().url());
        if (!['data:', 'blob:', 'about:'].includes(parsed.protocol) && !validatedHosts.has(parsed.hostname)) {
          await validatePublicUrl(parsed.href);
          validatedHosts.add(parsed.hostname);
        }
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });
    const page = await context.newPage();
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight && y < 60000; y += step) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((resolve) => setTimeout(resolve, 80)); }
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(800);
    return await page.evaluate(pageSnapshot, { maxTexts: 2500, maxImages: 1500 });
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { normalizeAssetType, markDuplicatePages, dedupePlacements, fetchReferencedAssets, isFragmentArtifact, crawlUntilCaptured, CLONE_ROUTE_LIMIT, snapshotLivePage, captureLinkedDocuments, extractStructuredData, resolveRouteLimit, captureWebsite, captureViewportScreenshot, analyzeRenderedPage, extractSourcePage, prefetchDiscoveredAssets, validatePublicUrl, isPrivateAddress, normalizeRoute, prioritizeDiscoveredRoutes, selectCapturedAssets, navigateForCapture, classifyPage, linkPriority, canonicalAssetIdentity, isTrackingAssetUrl, buildSiteMap, discoverSitemapLinks };
