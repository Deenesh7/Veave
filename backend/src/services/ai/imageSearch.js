/**
 * "Add NM Veeraiyan's image in that box" names a specific person or thing. Putting some other picture there is worse than
 * putting none, so the picture is looked up from sources that can be checked, in this order:
 *
 *   1. the project itself   an image whose file name, alt text or title carries the name
 *   2. web image search     Google Programmable Search, Brave, Serper or SerpAPI, whichever has a key in the environment; a hit
 *                           counts only when its title, snippet or page address carries the name
 *   3. Wikipedia / Wikimedia Commons   a page or file whose TITLE carries the name (free APIs, no key)
 *   4. nothing              the caller refuses and asks the user to attach the picture
 *
 * A result is accepted only when every distinctive word of the name appears in its title (small spelling differences allowed:
 * "Veeriyan" ~ "Veeraiyan"). Whatever a search engine considers "related" is not evidence.
 */

const GENERIC_WORDS = new Set(['a', 'an', 'the', 'some', 'any', 'this', 'that', 'these', 'those', 'new', 'good', 'nice', 'great', 'best', 'better', 'relevant', 'suitable', 'proper', 'correct', 'right', 'real', 'same', 'another', 'more', 'other', 'your', 'our', 'my', 'his', 'her', 'their', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'stock', 'random', 'different', 'beautiful', 'high', 'quality', 'big', 'small', 'large', 'little', 'few', 'many', 'it', 'them', 'here', 'there', 'box', 'section', 'page', 'slot', 'place', 'area', 'frame', 'card', 'side', 'top', 'bottom', 'left', 'right']);
// Scene / object words: a request about these is a stock-photo request, not a lookup of a particular person or place.
const COMMON_NOUNS = new Set(['hero', 'banner', 'background', 'building', 'buildings', 'campus', 'student', 'students', 'studying', 'team', 'people', 'person', 'persons', 'office', 'logo', 'icon', 'product', 'products', 'food', 'nature', 'city', 'landscape', 'technology', 'computer', 'laptop', 'classroom', 'school', 'college', 'university', 'teacher', 'teachers', 'doctor', 'doctors', 'family', 'children', 'child', 'kids', 'man', 'woman', 'men', 'women', 'boy', 'girl', 'business', 'meeting', 'travel', 'sports', 'sport', 'music', 'car', 'cars', 'house', 'home', 'garden', 'beach', 'mountain', 'sky', 'abstract', 'pattern', 'gradient', 'illustration', 'graphic', 'photo', 'picture', 'image', 'images', 'photos', 'pictures', 'library', 'lab', 'laboratory', 'hospital', 'restaurant', 'hotel', 'shop', 'store', 'market', 'park', 'road', 'street', 'bridge', 'airport', 'train', 'bus', 'flight']);

const norm = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function editDistance(a, b) {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** The words of a name that must all be found: initials ("n", "m", "nm") are not distinctive and are ignored. */
const isInitialsToken = (token) => token.length <= 2 || (token.length === 3 && !/[aeiouy]/.test(token));

function distinctiveTokens(subject) {
  return norm(subject).split(' ').filter((token) => token.length >= 3 && !isInitialsToken(token) && !GENERIC_WORDS.has(token));
}

function tokenFound(token, words) {
  const allowed = token.length >= 8 ? 2 : (token.length >= 5 ? 1 : 0);
  return words.some((word) => word === token || (allowed > 0 && Math.abs(word.length - token.length) <= allowed && editDistance(word, token) <= allowed));
}

/** True when the initials of the name ("NM" / "N. M.") appear in the text, as one word or as consecutive single letters. */
function initialsFound(subject, words) {
  const initials = norm(subject).split(' ').filter((token) => isInitialsToken(token) && !GENERIC_WORDS.has(token));
  if (!initials.length) return true;
  if (words.includes(initials.join(''))) return true;
  let letters = initials.join('').split('');
  // "NMV Veeraiyan": the V is the surname's own first letter, so the page only needs to carry N. M.
  const surnameInitials = new Set(distinctiveTokens(subject).map((token) => token[0]));
  while (letters.length > 1 && surnameInitials.has(letters[letters.length - 1])) letters = letters.slice(0, -1);
  for (let start = 0; start + letters.length <= words.length; start += 1) {
    if (letters.every((letter, offset) => words[start + offset] === letter)) return true;
  }
  return false;
}

/**
 * True when the text carries the WHOLE name: every distinctive word (spelling-tolerant) and the initials. A surname alone is
 * not enough: "Veeraiyan" is somebody else's photo until the initials say it is N. M. Veeraiyan.
 */
function matchesSubject(text, subject) {
  const tokens = distinctiveTokens(subject);
  if (!tokens.length) return false;
  const words = norm(text).split(' ').filter(Boolean);
  return tokens.every((token) => tokenFound(token, words)) && initialsFound(subject, words);
}

/**
 * The particular thing a request wants a picture of: "add nm veeraiyan image in that box" -> "nm veeraiyan".
 * Returns null for stock-photo requests ("add a nice hero image", "add an image of students studying").
 */
function extractImageSubject(prompt = '') {
  const text = String(prompt || '').replace(/^\s*\[<[a-z][a-z0-9-]*>(?:\s"[\s\S]*?")?\]\s*/i, '').trim();
  const noun = '(?:images?|photos?|pictures?|photographs?|pics?)';
  const patterns = [
    new RegExp(`\\b${noun}\\s+of\\s+(?:the\\s+)?["\u201c']?([^,.;:!?\\n"\u201d]{3,60}?)["\u201d']?(?=\\s+(?:in|on|into|inside|at|to|for|here|there|and|with|as|from)\\b|[,.;:!?]|$)`, 'i'),
    new RegExp(`\\b(?:add|put|insert|place|use|show|set|replace(?:\\s+with)?)\\s+(?:the\\s+|an?\\s+)?([a-z][\\w .'\\-]{2,50}?)(?:'s)?\\s+${noun}\\b`, 'i')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const subject = match[1].replace(/\s+/g, ' ').trim();
    const tokens = norm(subject).split(' ').filter(Boolean);
    const meaningful = tokens.filter((token) => !GENERIC_WORDS.has(token) && !/^\d+$/.test(token));
    if (!meaningful.length) continue;
    const hasCapital = /(?:^|\s)[A-Z]/.test(subject.slice(1)) || /[A-Z]{2,}/.test(subject);
    // All-lowercase subjects made only of everyday words are scenes ("students studying"), not a named person or place.
    if (!hasCapital && meaningful.every((token) => COMMON_NOUNS.has(token))) continue;
    if (!distinctiveTokens(subject).length) continue;
    return subject;
  }
  return null;
}

/** Images already in the project whose file name, alt text or title carries the name. */
function findProjectImages(subject, files = []) {
  const found = [];
  const seen = new Set();
  const add = (candidate) => { if (candidate.publicPath && !seen.has(candidate.publicPath)) { seen.add(candidate.publicPath); found.push(candidate); } };
  const binaryByPublicPath = new Map(files
    .filter((file) => file && file.path?.startsWith('public/') && /\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(file.path))
    .map((file) => [`/${file.path.slice('public/'.length)}`, file]));
  for (const [publicPath, file] of binaryByPublicPath) {
    if (matchesSubject(publicPath.split('/').pop().replace(/\.[a-z0-9]+$/i, ''), subject)) add({ publicPath, file, via: 'file name' });
  }
  for (const file of files) {
    if (!file || file.encoding === 'base64' || typeof file.content !== 'string') continue;
    for (const tag of file.content.matchAll(/<img\b[^>]*>/gi)) {
      const alt = (/\balt\s*=\s*(?:\{\s*)?["'`]([^"'`]*)["'`]/i.exec(tag[0]) || [])[1] || '';
      const title = (/\btitle\s*=\s*["'`]([^"'`]*)["'`]/i.exec(tag[0]) || [])[1] || '';
      const src = (/\bsrc\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/i.exec(tag[0]) || [])[1] || '';
      if (src.startsWith('/') && binaryByPublicPath.has(src) && (matchesSubject(alt, subject) || matchesSubject(title, subject))) add({ publicPath: src, file: binaryByPublicPath.get(src), via: 'alt text' });
    }
    if (file.path === 'src/assets/asset-map.json') {
      try {
        for (const asset of JSON.parse(file.content).assets || []) {
          const alts = (asset.associations || []).map((item) => item.alt).concat(asset.alt || []);
          if (asset.publicPath && binaryByPublicPath.has(asset.publicPath) && alts.some((alt) => matchesSubject(alt, subject))) add({ publicPath: asset.publicPath, file: binaryByPublicPath.get(asset.publicPath), via: 'captured alt text' });
        }
      } catch { /* an unreadable manifest is simply not evidence */ }
    }
  }
  return found;
}

const USER_AGENT = 'VeaveImageSearch/1.0 (website builder; image lookup by name)';

async function defaultFetchJson(url, { signal, method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
    ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function queryUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries({ format: 'json', ...params })) url.searchParams.set(key, String(value));
  return url.href;
}

/** Pages / files of Wikipedia and Wikimedia Commons whose TITLE carries the whole name. */
async function searchWikimedia(subject, { fetchJson = defaultFetchJson, signal } = {}) {
  const variants = [...new Set([subject, subject.replace(/\b([a-z])([a-z])\b(?=\s)/gi, (_, a, b) => `${a.toUpperCase()}. ${b.toUpperCase()}.`), distinctiveTokens(subject).join(' ')])].filter(Boolean);
  const results = [];
  for (const query of variants) {
    const jobs = [
      fetchJson(queryUrl('https://en.wikipedia.org/w/api.php', { action: 'query', generator: 'search', gsrsearch: query, gsrlimit: 8, prop: 'pageimages', piprop: 'original', redirects: 1 }), { signal })
        .then((data) => Object.values(data?.query?.pages || {}).map((page) => ({ source: 'Wikipedia', title: page.title, url: page.original?.source, pageUrl: `https://en.wikipedia.org/?curid=${page.pageid}` }))),
      fetchJson(queryUrl('https://commons.wikimedia.org/w/api.php', { action: 'query', generator: 'search', gsrnamespace: 6, gsrsearch: query, gsrlimit: 8, prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: 1200 }), { signal })
        .then((data) => Object.values(data?.query?.pages || {}).map((page) => ({ source: 'Wikimedia Commons', title: String(page.title || '').replace(/^File:/i, ''), url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url, mime: page.imageinfo?.[0]?.mime, pageUrl: page.imageinfo?.[0]?.descriptionurl || null })))
    ];
    for (const settled of await Promise.allSettled(jobs)) if (settled.status === 'fulfilled') results.push(...settled.value);
  }
  const seen = new Set();
  return results.filter((item) => item.url && matchesSubject(item.title, subject) && (!item.mime || /^image\/(?:jpeg|png|webp|gif)/.test(item.mime)) && !seen.has(item.url) && seen.add(item.url));
}

/** Which web image search is configured (the first with a key), or null. */
async function duckDuckGoImages(query, { signal } = {}) {
  const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const timeout = () => (signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000));
  const page = await fetch(`https://duckduckgo.com/?${new URLSearchParams({ q: query, iax: 'images', ia: 'images' })}`, { headers: { 'user-agent': agent }, signal: timeout() });
  const vqd = (/vqd=["']?([\d-]+)/.exec(await page.text()) || [])[1];
  if (!vqd) throw new Error('no search token');
  const response = await fetch(`https://duckduckgo.com/i.js?${new URLSearchParams({ l: 'us-en', o: 'json', q: query, vqd, f: ',,,,,', p: '1' })}`, { headers: { 'user-agent': agent, referer: 'https://duckduckgo.com/', accept: 'application/json' }, signal: timeout() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data.results || []).map((item) => ({ title: item.title, imageUrl: item.image, pageUrl: item.url, snippet: item.source, width: item.width, height: item.height, source: 'DuckDuckGo' }));
}

function configuredImageSearch(env = process.env) {
  if (env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX) return 'google';
  if (env.BRAVE_SEARCH_API_KEY) return 'brave';
  if (env.SERPER_API_KEY) return 'serper';
  if (env.SERPAPI_KEY) return 'serpapi';
  // No key needed: the public DuckDuckGo image search. Opt in with IMAGE_SEARCH_KEYLESS=true (set in backend/.env).
  if (String(env.IMAGE_SEARCH_KEYLESS || '').toLowerCase() === 'true') return 'duckduckgo';
  return null;
}

const SEARCH_KEYS_HINT = 'GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX, BRAVE_SEARCH_API_KEY, SERPER_API_KEY or SERPAPI_KEY';

/** One query against the configured provider, normalised to { title, imageUrl, pageUrl, snippet, width, height, source }. */
async function runImageSearch(provider, query, { fetchJson = defaultFetchJson, signal, env = process.env } = {}) {
  if (provider === 'duckduckgo') return duckDuckGoImages(query, { signal });
  if (provider === 'google') {
    const data = await fetchJson(queryUrl('https://www.googleapis.com/customsearch/v1', { key: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX, q: query, searchType: 'image', num: 10, safe: 'active' }), { signal });
    return (data.items || []).map((item) => ({ title: item.title, imageUrl: item.link, pageUrl: item.image?.contextLink, snippet: item.snippet, width: item.image?.width, height: item.image?.height, source: 'Google' }));
  }
  if (provider === 'brave') {
    const data = await fetchJson(queryUrl('https://api.search.brave.com/res/v1/images/search', { q: query, count: 20, safesearch: 'strict' }), { signal, headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY } });
    return (data.results || []).map((item) => ({ title: item.title, imageUrl: item.properties?.url, pageUrl: item.url, snippet: item.source, width: item.properties?.width, height: item.properties?.height, source: 'Brave' }));
  }
  if (provider === 'serper') {
    const data = await fetchJson('https://google.serper.dev/images', { signal, method: 'POST', headers: { 'X-API-KEY': env.SERPER_API_KEY, 'content-type': 'application/json' }, body: { q: query, num: 10 } });
    return (data.images || []).map((item) => ({ title: item.title, imageUrl: item.imageUrl, pageUrl: item.link, snippet: item.source, width: item.imageWidth, height: item.imageHeight, source: 'Google (Serper)' }));
  }
  if (provider === 'serpapi') {
    const data = await fetchJson(queryUrl('https://serpapi.com/search.json', { engine: 'google_images', q: query, api_key: env.SERPAPI_KEY, safe: 'active' }), { signal });
    return (data.images_results || []).map((item) => ({ title: item.title, imageUrl: item.original, pageUrl: item.link, snippet: item.source, width: item.original_width, height: item.original_height, source: 'Google (SerpAPI)' }));
  }
  return [];
}

/** A picture OF a person is usually near-square or portrait; banners, posters, logos and greeting graphics are not. */
function portraitScore(item) {
  let score = 0;
  const ratio = Number(item.width) && Number(item.height) ? Number(item.width) / Number(item.height) : null;
  if (ratio !== null) score += ratio <= 1.25 ? 2 : (ratio > 1.8 ? -2 : 0);
  if (/\b(?:logo|banner|poster|birthday|wishes|greeting|brochure|flyer|event|day|notice|announcement|scholarship|admission|news|featured|circular|signature|certificate)\b/i.test(`${item.title || ''} ${item.imageUrl || ''}`)) score -= 3;
  if (/\b(?:portrait|profile|chancellor|founder|president|director|dr|photo)\b/i.test(item.title || '')) score += 1;
  return score;
}

const pageSlug = (url) => { try { return decodeURIComponent(new URL(url).pathname).replace(/[-_/.+]+/g, ' '); } catch { return ''; } };

/**
 * Web image search for the subject. A hit is accepted only when its title, snippet or page address carries the whole name, so a
 * result the engine merely considers "related" is dropped. Results from the website the project was made from rank first.
 */
async function searchWebImages(subject, { fetchJson, signal, env = process.env, siteHost = null, queries: queryOverride = null } = {}) {
  const provider = configuredImageSearch(env);
  if (!provider) return { provider: null, results: [] };
  const queries = queryOverride || [...new Set([siteHost ? `"${subject}" site:${siteHost}` : null, `"${subject}"`, subject].filter(Boolean))];
  const collected = [];
  for (const query of queries) {
    try { collected.push(...await runImageSearch(provider, query, { fetchJson, signal, env })); } catch (error) { if (signal?.aborted) throw error; }
    if (collected.some((item) => item.imageUrl && matchesSubject(`${item.title} ${item.snippet || ''} ${pageSlug(item.pageUrl)}`, subject))) break;
  }
  const seen = new Set();
  const results = collected
    .filter((item) => /^https?:\/\//i.test(item.imageUrl || '') && matchesSubject(`${item.title || ''} ${item.snippet || ''} ${pageSlug(item.pageUrl)}`, subject)
      && !(Number(item.width) && Number(item.height) && Math.min(Number(item.width), Number(item.height)) < 150) && !seen.has(item.imageUrl) && seen.add(item.imageUrl))
    .map((item) => ({ ...item, fromSite: Boolean(siteHost) && String(item.pageUrl || item.imageUrl).includes(siteHost) }))
    .sort((a, b) => Number(b.fromSite) - Number(a.fromSite) || portraitScore(b) - portraitScore(a));
  return { provider, results };
}

/**
 * @returns {Promise<{status:'found', source:string, via?:string, title?:string, pageUrl?:string, publicPath?:string, file?:object, url?:string}|{status:'none', tried:string[]}>}
 */
async function resolveSubjectImage({ subject, files = [], fetchJson, signal, env = process.env, siteHost = null } = {}) {
  const tried = [];
  const fromProject = findProjectImages(subject, files);
  tried.push(`the project's own images (${fromProject.length} match)`);
  if (fromProject.length) return { status: 'found', source: 'project', via: fromProject[0].via, publicPath: fromProject[0].publicPath, file: fromProject[0].file, candidates: [] };

  try {
    const web = await searchWebImages(subject, { fetchJson, signal, env, siteHost });
    if (!web.provider) tried.push(`web image search (not set up: add ${SEARCH_KEYS_HINT} to the backend settings)`);
    else {
      tried.push(`web image search via ${web.results[0]?.source || web.provider} (${web.results.length} result(s) whose title or page carries the name)`);
      if (web.results.length) return { status: 'found', source: web.results[0].source, title: web.results[0].title, pageUrl: web.results[0].pageUrl, url: web.results[0].imageUrl, candidates: web.results.slice(0, 10).map((item) => ({ url: item.imageUrl, title: item.title, pageUrl: item.pageUrl, source: item.source })) };
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    tried.push(`web image search (unavailable: ${String(error.message).slice(0, 80)})`);
  }

  try {
    const wiki = await searchWikimedia(subject, { fetchJson, signal });
    tried.push(`Wikipedia and Wikimedia Commons (${wiki.length} page(s) or file(s) whose title carries the name)`);
    if (wiki.length) return { status: 'found', source: wiki[0].source, title: wiki[0].title, pageUrl: wiki[0].pageUrl, url: wiki[0].url, candidates: wiki.slice(0, 5).map((item) => ({ url: item.url, title: item.title, pageUrl: item.pageUrl, source: item.source })) };
  } catch (error) {
    if (signal?.aborted) throw error;
    tried.push(`Wikipedia and Wikimedia Commons (unavailable: ${String(error.message).slice(0, 80)})`);
  }
  return { status: 'none', tried, searchConfigured: Boolean(configuredImageSearch(env)) };
}

module.exports = { extractImageSubject, matchesSubject, distinctiveTokens, findProjectImages, searchWikimedia, searchWebImages, configuredImageSearch, runImageSearch, resolveSubjectImage, SEARCH_KEYS_HINT };
