/**
 * Where topical photographs come from. Every provider is normalised to the same candidate shape:
 *   { url, title, description, tags[], creator, license, licenseUrl, pageUrl, width, height, provider, rank }
 *
 * Order: licensed photo APIs (Pexels, Unsplash, Pixabay; used when their key is set), Openverse and Wikimedia Commons (no key,
 * Creative-Commons / public-domain licences with attribution data), and finally the open web search already used for named
 * entities, which carries no licence information and is therefore opt-in (IMAGE_ALLOW_UNLICENSED_WEB=true).
 * A provider that is down, rate limited or not configured is reported in `diagnostics` and the next one is tried.
 */
const { imageConfig } = require('./imageConfig');

class ProviderError extends Error {
  constructor(message, { status = null, transient = false, code = 'provider_error' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.transient = transient;
    this.code = code;
  }
}

const USER_AGENT = 'VeaveImageDiscovery/1.0 (website builder; contact: support@veave.net)';

async function getJson(url, { headers = {}, signal, timeoutMs = 12000 } = {}) {
  let response;
  try {
    response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ProviderError(`network error: ${error.name === 'TimeoutError' ? 'timed out' : error.message}`, { transient: true, code: error.name === 'TimeoutError' ? 'provider_timeout' : 'provider_unreachable' });
  }
  if (response.status === 429) throw new ProviderError('rate limited', { status: 429, transient: true, code: 'provider_rate_limited' });
  if (response.status >= 500) throw new ProviderError(`HTTP ${response.status}`, { status: response.status, transient: true, code: 'provider_unavailable' });
  if (!response.ok) throw new ProviderError(`HTTP ${response.status}`, { status: response.status, code: response.status === 401 || response.status === 403 ? 'provider_auth' : 'provider_error' });
  try { return await response.json(); } catch { throw new ProviderError('the answer was not JSON', { code: 'provider_error' }); }
}

const qs = (base, params) => { const url = new URL(base); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); return url.href; };
const orientationOf = (requirement) => (requirement?.orientation === 'portrait' ? 'portrait' : requirement?.orientation === 'any' ? undefined : 'landscape');

const PROVIDERS = [
  {
    id: 'pexels', curated: true, enabled: (env) => Boolean(env.PEXELS_API_KEY),
    async search(query, { env, requirement, getJson: get, signal, timeoutMs }) {
      const data = await get(qs('https://api.pexels.com/v1/search', { query, per_page: 15, orientation: orientationOf(requirement), size: 'large' }), { headers: { Authorization: env.PEXELS_API_KEY }, signal, timeoutMs });
      return (data.photos || []).map((p, rank) => ({ url: p.src?.large2x || p.src?.large || p.src?.original, title: p.alt || '', description: p.alt || '', tags: [], creator: p.photographer, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', pageUrl: p.url, width: p.width, height: p.height, provider: 'Pexels', rank }));
    }
  },
  {
    id: 'unsplash', curated: true, enabled: (env) => Boolean(env.UNSPLASH_ACCESS_KEY),
    async search(query, { env, requirement, getJson: get, signal, timeoutMs }) {
      const data = await get(qs('https://api.unsplash.com/search/photos', { query, per_page: 15, orientation: orientationOf(requirement) === 'portrait' ? 'portrait' : orientationOf(requirement) === 'landscape' ? 'landscape' : undefined, content_filter: 'high' }), { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` }, signal, timeoutMs });
      return (data.results || []).map((p, rank) => ({ url: p.urls?.raw ? `${p.urls.raw}${p.urls.raw.includes('?') ? '&' : '?'}w=1800&q=80&fm=jpg&fit=max` : p.urls?.regular, title: p.alt_description || p.description || '', description: [p.description, p.alt_description].filter(Boolean).join(' '), tags: (p.tags || []).map((t) => t.title).filter(Boolean), creator: p.user?.name, license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license', pageUrl: p.links?.html, width: p.width, height: p.height, provider: 'Unsplash', rank }));
    }
  },
  {
    id: 'pixabay', curated: true, enabled: (env) => Boolean(env.PIXABAY_API_KEY),
    async search(query, { env, requirement, getJson: get, signal, timeoutMs }) {
      const data = await get(qs('https://pixabay.com/api/', { key: env.PIXABAY_API_KEY, q: query, image_type: 'photo', orientation: requirement?.orientation === 'portrait' ? 'vertical' : requirement?.orientation === 'any' ? 'all' : 'horizontal', per_page: 15, safesearch: 'true', min_width: 900 }), { signal, timeoutMs });
      return (data.hits || []).map((p, rank) => ({ url: p.largeImageURL || p.webformatURL, title: p.tags || '', description: '', tags: String(p.tags || '').split(',').map((t) => t.trim()).filter(Boolean), creator: p.user, license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', pageUrl: p.pageURL, width: p.imageWidth, height: p.imageHeight, provider: 'Pixabay', rank }));
    }
  },
  {
    id: 'openverse', curated: false, enabled: (env) => String(env.IMAGE_OPENVERSE || 'true') !== 'false',
    async search(query, { requirement, getJson: get, signal, timeoutMs }) {
      const base = { q: query, page_size: 20, license_type: 'commercial', mature: 'false', category: 'photograph' };
      let data = await get(qs('https://api.openverse.org/v1/images/', { ...base, aspect_ratio: requirement?.orientation === 'portrait' ? 'tall' : requirement?.orientation === 'any' ? undefined : 'wide', size: 'large' }), { signal, timeoutMs });
      if (!(data.results || []).length) data = await get(qs('https://api.openverse.org/v1/images/', base), { signal, timeoutMs }); // the shape filters can rule everything out
      return (data.results || []).map((p, rank) => ({ url: p.url, title: p.title || '', description: '', tags: (p.tags || []).map((t) => t.name).filter(Boolean), creator: p.creator, license: `${String(p.license || '').toUpperCase()} ${p.license_version || ''}`.trim(), licenseUrl: p.license_url, pageUrl: p.foreign_landing_url, width: p.width, height: p.height, provider: `Openverse/${p.source || p.provider || 'cc'}`, rank, filetype: p.filetype }));
    }
  },
  {
    id: 'wikimedia', curated: false, enabled: (env) => String(env.IMAGE_WIKIMEDIA || 'true') !== 'false',
    async search(query, { getJson: get, signal, timeoutMs }) {
      const data = await get(qs('https://commons.wikimedia.org/w/api.php', { action: 'query', format: 'json', generator: 'search', gsrnamespace: 6, gsrsearch: `${query} filetype:bitmap`, gsrlimit: 20, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: 1800 }), { signal, timeoutMs });
      const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return Object.values(data?.query?.pages || {}).map((page, rank) => {
        const info = page.imageinfo?.[0];
        const meta = info?.extmetadata || {};
        return { url: info?.thumburl || info?.url, title: String(page.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, ''), description: strip(meta.ImageDescription?.value), tags: strip(meta.Categories?.value).split('|').filter(Boolean), creator: strip(meta.Artist?.value), license: strip(meta.LicenseShortName?.value), licenseUrl: meta.LicenseUrl?.value, pageUrl: info?.descriptionurl, width: info?.thumbwidth || info?.width, height: info?.thumbheight || info?.height, provider: 'Wikimedia Commons', rank, mime: info?.mime };
      }).filter((item) => item.url && /^image\/(jpeg|png|webp)$/.test(item.mime || '') && item.license);
    }
  },
  {
    id: 'web', curated: false, enabled: (env) => String(env.IMAGE_ALLOW_UNLICENSED_WEB || '').toLowerCase() === 'true' && Boolean(require('../imageSearch').configuredImageSearch(env)),
    async search(query, { env, signal }) {
      const imageSearch = require('../imageSearch');
      const provider = imageSearch.configuredImageSearch(env);
      const results = await imageSearch.runImageSearch(provider, query, { signal, env });
      return results.map((r, rank) => ({ url: r.imageUrl, title: r.title || '', description: r.snippet || '', tags: [], creator: '', license: 'unknown', licenseUrl: '', pageUrl: r.pageUrl, width: r.width, height: r.height, provider: r.source || 'web', rank }));
    }
  }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One query against every enabled provider, in order, until `want` candidates were collected.
 * @returns {{ candidates: Array, diagnostics: Array<{provider, status, count?, code?, error?}> }}
 */
async function searchTopic(query, { requirement = null, env = process.env, signal, cfg = imageConfig(env), want = 30, providers = PROVIDERS, get = getJson } = {}) {
  const candidates = [];
  const diagnostics = [];
  for (const provider of providers) {
    if (candidates.length >= want) break;
    if (!provider.enabled(env)) { diagnostics.push({ provider: provider.id, status: 'skipped', code: 'not_configured' }); continue; }
    let lastError = null;
    for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
      try {
        const found = (await provider.search(query, { env, requirement, getJson: get, signal, timeoutMs: cfg.requestTimeoutMs })).filter((item) => item && /^https:\/\//i.test(item.url || ''));
        diagnostics.push({ provider: provider.id, status: 'ok', count: found.length });
        candidates.push(...found.map((item) => ({ ...item, curated: provider.curated, providerId: provider.id })));
        lastError = null;
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if (!error.transient || error.code === 'provider_rate_limited') break; // a rate limit is not retried: the next provider is tried instead
        await sleep(300 * (attempt + 1));
      }
    }
    if (lastError) diagnostics.push({ provider: provider.id, status: 'error', code: lastError.code || 'provider_error', error: String(lastError.message).slice(0, 120) });
  }
  return { candidates, diagnostics };
}

const configuredProviders = (env = process.env) => PROVIDERS.filter((provider) => provider.enabled(env)).map((provider) => provider.id);

module.exports = { searchTopic, configuredProviders, PROVIDERS, ProviderError, getJson };
