/**
 * Research for the people and organisations a website request names.
 *
 * Before the site is written, the generator is given verified facts instead of being left to invent (or to write "details to be
 * added"). The process:
 *   1. search the web for each named subject, in the context of its institution (biography, achievements, profile),
 *   2. keep only credible results (official, reference and news sites; never social posts or stock aggregators),
 *   3. fetch those pages (public hosts only), and keep a page only when it really is about the named subject: the whole name and,
 *      when the request gives an institution, the institution appear in it,
 *   4. extract the facts (a model call when one is available, otherwise rule based) and CHECK every fact against the text of the
 *      pages it cites: years, numbers and key words must be there; a fact that cannot be traced is dropped,
 *   5. mark facts that two independent sites state as corroborated, and
 *   6. collect pictures from those pages whose alt text, title or file name names the subject (identity evidence for the image step).
 * Nothing is copied into the site verbatim; the dossier is material for natural prose.
 */
const imageSearch = require('../imageSearch');
const entityImages = require('../entityImages');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_PAGE_BYTES = 1_500_000;
const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

const strip = (html) => String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const timeout = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

/* ---------------------------------------------------------------- web search ---------------------------------------------------------------- */

async function getJson(url, { headers = {}, signal, method = 'GET', body } = {}) {
  const response = await fetch(url, { method, headers: { 'user-agent': UA, accept: 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: timeout(signal, 12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Brave's public results page (no key needed): the result blocks carry the address, the title and the description. */
function parseBraveHtml(html) {
  const results = [];
  for (const block of String(html).split('<div class="snippet ').slice(1)) {
    const url = (/<a href="(https?:\/\/[^"]+)"/.exec(block) || [])[1];
    if (!url || /brave\.com|imgs\.search/.test(url)) continue;
    const title = strip((/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block) || [])[1] || '');
    const snippet = strip((/class="(?:content|snippet-description)[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block) || [])[1] || '');
    results.push({ url: url.replace(/&amp;/g, '&'), title, snippet });
  }
  return results;
}

const PROVIDERS = [
  { id: 'serper', enabled: (env) => Boolean(env.SERPER_API_KEY), async run(query, { env, signal }) {
    const data = await getJson('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': env.SERPER_API_KEY, 'content-type': 'application/json' }, body: { q: query, num: 10 }, signal });
    return (data.organic || []).map((item) => ({ url: item.link, title: item.title || '', snippet: item.snippet || '' }));
  } },
  { id: 'brave-api', enabled: (env) => Boolean(env.BRAVE_SEARCH_API_KEY), async run(query, { env, signal }) {
    const data = await getJson(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: '10' })}`, { headers: { 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY }, signal });
    return (data.web?.results || []).map((item) => ({ url: item.url, title: item.title || '', snippet: strip(item.description || '') }));
  } },
  { id: 'google-cse', enabled: (env) => Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX), async run(query, { env, signal }) {
    const data = await getJson(`https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key: env.GOOGLE_CSE_API_KEY, cx: env.GOOGLE_CSE_CX, q: query, num: '10' })}`, { signal });
    return (data.items || []).map((item) => ({ url: item.link, title: item.title || '', snippet: item.snippet || '' }));
  } },
  { id: 'serpapi', enabled: (env) => Boolean(env.SERPAPI_KEY), async run(query, { env, signal }) {
    const data = await getJson(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google', q: query, api_key: env.SERPAPI_KEY })}`, { signal });
    return (data.organic_results || []).map((item) => ({ url: item.link, title: item.title || '', snippet: item.snippet || '' }));
  } },
  { id: 'brave-html', enabled: (env) => String(env.RESEARCH_KEYLESS ?? 'true').toLowerCase() !== 'false', async run(query, { signal }) {
    // Public results page: polite pace (one request at a time, a pause between them) and one retry when it asks us to slow down.
    return throttled(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`https://search.brave.com/search?${new URLSearchParams({ q: query, source: 'web' })}`, { headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'en' }, signal: timeout(signal, 12000) });
        if (response.status === 429 && attempt === 0) { await new Promise((resolve) => setTimeout(resolve, 2500)); continue; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseBraveHtml(await response.text());
      }
      return [];
    });
  } },
  // Last resort without any key: the pages that the picture search already found for the name (their address and title).
  { id: 'image-search-pages', enabled: (env) => String(env.RESEARCH_KEYLESS ?? 'true').toLowerCase() !== 'false' && Boolean(imageSearch.configuredImageSearch(env)), async run(query, { env, signal }) {
    const provider = imageSearch.configuredImageSearch(env);
    const results = await imageSearch.runImageSearch(provider, query.replace(/\b(biography|achievements|awards|profile|career)\b/gi, '').trim(), { signal, env });
    const seen = new Set();
    return results.filter((item) => item.pageUrl && !seen.has(item.pageUrl) && seen.add(item.pageUrl)).map((item) => ({ url: item.pageUrl, title: item.title || '', snippet: item.snippet || '' }));
  } }
];

let lastRequest = 0;
let chain = Promise.resolve();
function throttled(task, gap = 1200) {
  const run = chain.then(async () => { const wait = Math.max(0, lastRequest + gap - Date.now()); if (wait) await new Promise((resolve) => setTimeout(resolve, wait)); lastRequest = Date.now(); return task(); });
  chain = run.catch(() => {});
  return run;
}

/** One query against the first search provider that answers. */
async function searchWeb(query, { env = process.env, signal, providers = PROVIDERS } = {}) {
  const errors = [];
  for (const provider of providers) {
    if (!provider.enabled(env)) continue;
    try {
      const found = (await provider.run(query, { env, signal })).filter((item) => /^https?:\/\//i.test(item.url || ''));
      if (found.length) return found.map((item, rank) => ({ ...item, host: hostOf(item.url), rank, provider: provider.id }));
    } catch (error) { if (signal?.aborted) throw error; errors.push(`${provider.id}: ${error.message}`); }
  }
  return [];
}

/* ---------------------------------------------------------------- page fetch ---------------------------------------------------------------- */

/** A public page, reduced to what research needs. Public hosts only, redirects re-validated, size and time limited. */
async function fetchPage(url, { signal } = {}) {
  const { validatePublicUrl } = require('../../clone/websiteCaptureService');
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    await validatePublicUrl(current);
    const response = await fetch(current, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }, signal: timeout(signal, 12000) });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { current = new URL(response.headers.get('location'), current).href; continue; }
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    if (!/html|xml|text/i.test(response.headers.get('content-type') || 'text/html')) throw new Error('not a web page');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PAGE_BYTES) throw new Error('page too large');
    return parsePage(buffer.toString('utf8'), current);
  }
  throw new Error('too many redirects');
}

function parsePage(html, url) {
  const meta = (name) => (new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html) || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i').exec(html) || [])[1] || '';
  const abs = (value) => { try { return new URL(value, url).href; } catch { return ''; } };
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|aside|form|template)[\s\S]*?<\/\1>/gi, ' ');
  const blocks = [...body.matchAll(/<(h[1-4]|p|li|blockquote|td|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), text: strip(m[2]) })).filter((item) => item.text.length >= (item.tag.startsWith('h') ? 3 : 40));
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => {
    const tag = m[0];
    const attr = (name) => (new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag) || [])[1] || '';
    return { src: abs(attr('data-src') || attr('src')), alt: strip(attr('alt')), title: strip(attr('title')) };
  }).filter((item) => /^https?:/.test(item.src) && !/\.(?:svg|gif|ico)(?:[?#]|$)/i.test(item.src) && !/logo|icon|sprite|avatar-default|placeholder|pixel/i.test(item.src));
  return { url, host: hostOf(url), title: strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '') || meta('og:title'), description: meta('og:description') || meta('description'), ogImage: abs(meta('og:image')), blocks, images };
}

/* ---------------------------------------------------------------- relevance ---------------------------------------------------------------- */

const norm = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokensOf = (text) => norm(text).split(' ').filter((token) => token.length >= 4);
const mentions = (text, name) => imageSearch.matchesSubject(text, name);

/** The affiliation words of a subject that a page must also carry ("Saveetha" in "Saveetha Medical and Educational Trust"). */
const affiliationTokens = (affiliation) => tokensOf(affiliation).filter((token) => !['institute', 'university', 'college', 'trust', 'educational', 'medical', 'school', 'group', 'foundation', 'limited', 'private', 'society', 'department'].includes(token));
const carriesAffiliation = (text, affiliation) => { const tokens = affiliationTokens(affiliation); if (!tokens.length) return true; const words = new Set(norm(text).split(' ')); return tokens.some((token) => words.has(token) || [...words].some((word) => word.length >= 5 && Math.abs(word.length - token.length) <= 1 && (word.startsWith(token.slice(0, 5))))); };

/** The paragraphs of a page that talk about the subject (and their neighbours), capped, as the evidence the facts are checked against. */
function excerptFor(page, subject, limit = 3600) {
  const picked = [];
  page.blocks.forEach((block, index) => {
    if (mentions(block.text, subject.name)) for (const at of [index - 1, index, index + 1]) if (at >= 0 && page.blocks[at] && !picked.includes(at)) picked.push(at);
  });
  const text = picked.sort((a, b) => a - b).map((at) => page.blocks[at].text).join('\n');
  return text.slice(0, limit);
}

/* ---------------------------------------------------------------- facts ---------------------------------------------------------------- */

const CATEGORIES = ['biography', 'education', 'career', 'award', 'institution', 'milestone', 'contribution', 'other'];
const categoryOf = (text) => {
  if (/\b(award|honou?r|recogni[sz]|prize|medal|fellowship|felicitat)/i.test(text)) return 'award';
  if (/\b(born|early life|family|grew up|native)\b/i.test(text)) return 'biography';
  if (/\b(graduat|degree|ph\.?d|msc|bds|mds|mbbs|diploma|educated|studied)\b/i.test(text)) return 'education';
  if (/\b(founded|established|inaugurat|launched|opened)\b/i.test(text)) return 'milestone';
  if (/\b(vice[- ]chancellor|director|chairman|president|dean|principal|professor|trustee|secretary|head of)\b/i.test(text)) return 'career';
  if (/\b(college|university|hospital|institute|campus|school)\b/i.test(text)) return 'institution';
  return 'other';
};
const yearsIn = (text) => [...String(text).matchAll(/\b(1[89]\d{2}|20\d{2})\b/g)].map((m) => m[1]);

/**
 * A fact stays only when the sources it cites actually say it: every year and number in it appears in a cited excerpt, and most of its
 * significant words do too. This is what stops a model from adding a plausible-sounding date or award.
 */
function checkFact(fact, sources) {
  const cited = (fact.sources || []).map((id) => sources.find((source) => source.id === id)).filter(Boolean);
  if (!cited.length) return { ok: false, reason: 'no source' };
  const evidence = norm(cited.map((source) => `${source.title} ${source.excerpt}`).join(' '));
  for (const year of yearsIn(fact.text)) if (!evidence.includes(year)) return { ok: false, reason: `year ${year} not in the cited text` };
  for (const number of [...String(fact.text).matchAll(/\b\d[\d,]*\b/g)].map((m) => m[0].replace(/,/g, '')).filter((n) => n.length >= 3)) if (!evidence.replace(/,/g, '').includes(number)) return { ok: false, reason: `number ${number} not in the cited text` };
  const words = [...new Set(tokensOf(fact.text).filter((token) => token.length >= 5))];
  if (words.length >= 4) { const hit = words.filter((token) => evidence.includes(token)).length; if (hit / words.length < 0.6) return { ok: false, reason: 'wording not found in the cited text' }; }
  return { ok: true, hosts: new Set(cited.map((source) => source.host)).size };
}

const FACT_SYSTEM = 'You extract facts from web page excerpts for a website about a named person or organisation. Use ONLY what the excerpts state. Reply with ONLY JSON: {"role": string, "affiliation": string, "summary": string, "facts": [{"category": "biography"|"education"|"career"|"award"|"institution"|"milestone"|"contribution"|"other", "text": string, "date": string, "sources": [number]}]}. Rules: a fact is one self-contained sentence in plain words (no copying of long passages); give the source numbers that state it; include dates, positions, qualifications, institutions and contributions that the excerpts state; never add anything that is not in the excerpts; never mix up different people with similar names: skip any excerpt that is about someone else; at most 24 facts, most important first.';

function heuristicFacts(subject, sources) {
  const facts = [];
  for (const source of sources) {
    for (const sentence of source.excerpt.split(/(?<=[.!?])\s+|\n/).map((item) => item.trim()).filter((item) => item.length >= 50 && item.length <= 320)) {
      if (!mentions(sentence, subject.name) && !/\b(he|she|his|her|dr\.?)\b/i.test(sentence)) continue;
      if (!/\b(1[89]\d{2}|20\d{2})\b|\b(founded|chairman|director|dean|professor|award|degree|born|graduat|appointed|serves|head)\b/i.test(sentence)) continue;
      facts.push({ category: categoryOf(sentence), text: sentence, date: yearsIn(sentence)[0] || '', sources: [source.id] });
      if (facts.length >= 24) return facts;
    }
  }
  return facts;
}

/* ---------------------------------------------------------------- orchestration ---------------------------------------------------------------- */

async function wikipediaSource(subject, { signal }) {
  if (imageSearch.distinctiveTokens(subject.name).length < 2) return null; // a one-word name matches too many different pages
  const query = `${subject.name} ${subject.affiliation || ''}`.trim();
  try {
    const found = await getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', list: 'search', srsearch: query, srlimit: '4' })}`, { signal });
    const hit = (found?.query?.search || []).find((item) => mentions(item.title, subject.name));
    if (!hit) return null;
    const page = await getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', prop: 'extracts|pageimages', explaintext: '1', exlimit: '1', piprop: 'original', pageids: String(hit.pageid) })}`, { signal });
    const entry = Object.values(page?.query?.pages || {})[0];
    if (!entry?.extract || !carriesAffiliation(entry.extract, subject.affiliation) || !mentions(entry.extract.slice(0, 1500), subject.name)) return null;
    return { url: `https://en.wikipedia.org/?curid=${hit.pageid}`, host: 'en.wikipedia.org', tier: 'reference', title: entry.title, excerpt: entry.extract.slice(0, 5000), image: entry.original?.source || null };
  } catch (error) { if (signal?.aborted) throw error; return null; }
}

/**
 * @param entities   [{ name, type, role, affiliation }]  (people first)
 * @returns {{ subjects: [{ name, type, role, affiliation, summary, facts }], sources, imageCandidates, diagnostics } | null}
 */
async function researchSubjects({ prompt = '', entities = [], ask = null, signal, env = process.env, search = searchWeb, fetchPageImpl = fetchPage, maxPages = Number.parseInt(env.RESEARCH_MAX_PAGES, 10) || 6 } = {}) {
  // An organisation that is only the institution another subject belongs to ("Saveetha" for "Deepak Nallasamy of Saveetha") is context
  // for that subject, not a subject of its own: searching the bare institution name finds unrelated namesakes.
  const asContext = (entity) => entities.some((other) => other !== entity && other.affiliation && norm(other.affiliation) === norm(entity.name));
  const subjects = entities.filter((entity) => ['person', 'organization', 'company', 'brand'].includes(entity.type) && !asContext(entity)).sort((a, b) => Number(b.type === 'person') - Number(a.type === 'person')).slice(0, 3);
  if (!subjects.length) return null;
  const cacheKey = JSON.stringify(subjects.map((s) => [s.name, s.affiliation || '']));
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const diagnostics = { searched: 0, pages: 0, rejectedPages: [], droppedFacts: [] };
  const dossier = { subjects: [], sources: [], imageCandidates: [], diagnostics };
  let nextId = 1;

  for (const subject of subjects) {
    const aff = subject.affiliation || '';
    const queries = [...new Set([`"${subject.name}" ${aff} biography`, `"${subject.name}" ${aff} achievements awards`, `"${subject.name}" ${aff} profile career`].map((q) => q.replace(/\s+/g, ' ').trim()))];
    const seen = new Map();
    for (const query of queries) {
      if (signal?.aborted) break;
      diagnostics.searched += 1;
      for (const result of await search(query, { env, signal })) {
        if (seen.has(result.url)) continue;
        const { tier } = entityImages.sourceTier({ pageUrl: result.url }, subject.name, aff);
        if (tier === 'social' || tier === 'aggregator' || /youtube|scholar\.google|easyleadz|zoominfo|rocketreach/.test(result.host)) continue;
        const about = mentions(`${result.title} ${result.snippet}`, subject.name) || mentions(result.url.replace(/[-_/.+]+/g, ' '), subject.name);
        if (!about && tier !== 'official') continue;
        seen.set(result.url, { ...result, tier, score: ({ official: 4, reference: 4, news: 3, unknown: 1 }[tier] || 1) * 10 + (about ? 5 : 0) - result.rank * 0.4 });
      }
    }
    const candidates = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, maxPages);
    const sources = [];
    const wiki = await wikipediaSource(subject, { signal });
    if (wiki) sources.push({ ...wiki, id: nextId++ });
    const pages = await Promise.all(candidates.map(async (candidate) => { try { return { candidate, page: await fetchPageImpl(candidate.url, { signal }) }; } catch (error) { if (signal?.aborted) throw error; diagnostics.rejectedPages.push({ url: candidate.url, reason: String(error.message).slice(0, 80) }); return null; } }));
    for (const item of pages.filter(Boolean)) {
      const { candidate, page } = item;
      const fullText = page.blocks.map((block) => block.text).join(' ');
      // The page must really be about this subject: the whole name, and the institution when the request gives one.
      if (!mentions(`${page.title} ${fullText}`, subject.name)) { diagnostics.rejectedPages.push({ url: page.url, reason: 'the name is not on the page' }); continue; }
      if (!carriesAffiliation(`${page.title} ${fullText} ${page.host}`, aff) && candidate.tier !== 'reference') { diagnostics.rejectedPages.push({ url: page.url, reason: 'the institution is not on the page (possibly a different person)' }); continue; }
      const excerpt = excerptFor(page, subject);
      if (excerpt.length < 80) { diagnostics.rejectedPages.push({ url: page.url, reason: 'too little about the subject' }); continue; }
      diagnostics.pages += 1;
      const id = nextId++;
      sources.push({ id, url: page.url, host: page.host, tier: candidate.tier, title: page.title, excerpt });
      // Pictures on a page that is about the subject: the file name, alt text or title must name them.
      const photos = [...(page.ogImage && mentions(`${page.title} ${page.description}`, subject.name) ? [{ src: page.ogImage, alt: page.title }] : []), ...page.images.filter((image) => mentions(`${image.alt} ${image.title} ${decodeURIComponent(image.src.split('/').pop() || '').replace(/[-_.]+/g, ' ')}`, subject.name))];
      for (const photo of photos.slice(0, 3)) dossier.imageCandidates.push({ entity: subject.name, imageUrl: photo.src, title: photo.alt || page.title, pageUrl: page.url, snippet: page.description || '', source: page.host });
    }
    if (wiki?.image) dossier.imageCandidates.push({ entity: subject.name, imageUrl: wiki.image, title: wiki.title, pageUrl: wiki.url, snippet: '', source: 'Wikipedia' });

    // Facts: a model reads the excerpts when one is available; the rule-based extraction is the fallback.
    let extracted = null;
    if (ask && sources.length) {
      try {
        const raw = await ask(FACT_SYSTEM, `Subject: ${subject.name}${aff ? ` (${aff})` : ''}${subject.role ? `, ${subject.role}` : ''}\n\nExcerpts:\n${sources.map((source) => `[${source.id}] ${source.host} - ${source.title}\n${source.excerpt.slice(0, 2600)}`).join('\n\n')}`);
        const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
        extracted = json ? JSON.parse(json) : null;
      } catch { extracted = null; }
    }
    const rawFacts = (Array.isArray(extracted?.facts) && extracted.facts.length ? extracted.facts : heuristicFacts(subject, sources)).slice(0, 30);
    const facts = [];
    const seenText = new Set();
    for (const fact of rawFacts) {
      const text = String(fact?.text || '').replace(/\s+/g, ' ').trim();
      if (text.length < 20 || seenText.has(text.toLowerCase())) continue;
      const entry = { category: CATEGORIES.includes(fact.category) ? fact.category : categoryOf(text), text, date: String(fact.date || yearsIn(text)[0] || ''), sources: (Array.isArray(fact.sources) ? fact.sources : []).map(Number).filter((n) => sources.some((source) => source.id === n)) };
      const verdict = checkFact(entry, sources);
      if (!verdict.ok) { diagnostics.droppedFacts.push({ text: text.slice(0, 100), reason: verdict.reason }); continue; }
      seenText.add(text.toLowerCase());
      facts.push({ ...entry, corroborated: verdict.hosts >= 2, sourceHosts: [...new Set(entry.sources.map((id) => sources.find((s) => s.id === id)?.host))] });
    }
    dossier.subjects.push({ name: subject.name, type: subject.type, role: String(extracted?.role || subject.role || '').slice(0, 100), affiliation: String(extracted?.affiliation || aff || '').slice(0, 100), summary: String(extracted?.summary || '').slice(0, 500), facts });
    dossier.sources.push(...sources.map(({ id, url, host, tier, title }) => ({ id, url, host, tier, title })));
  }
  cache.set(cacheKey, { at: Date.now(), value: dossier });
  return dossier;
}

/** The part of the generation prompt that carries the researched facts. */
function buildResearchBlock(dossier) {
  if (!dossier || !dossier.subjects.some((subject) => subject.facts.length)) return '';
  const lines = ['RESEARCHED FACTS (checked against the public sources they come from; this is the ONLY factual material about these subjects):'];
  for (const subject of dossier.subjects) {
    if (!subject.facts.length) continue;
    lines.push(`\n${subject.name}${subject.role ? `, ${subject.role}` : ''}${subject.affiliation ? ` (${subject.affiliation})` : ''}:`);
    if (subject.summary) lines.push(`Summary: ${subject.summary}`);
    for (const fact of subject.facts) lines.push(`- [${fact.category}${fact.date ? `, ${fact.date}` : ''}${fact.corroborated ? ', corroborated' : ''}] ${fact.text}`);
  }
  lines.push(`
HOW TO USE THEM:
- Write the pages as natural, informative prose in your own words, from these facts: a biography reads like a biography, achievements like a record of achievements, a timeline has the dated facts in order. Group related facts; do not list them as a dump and do not repeat one fact in several places.
- Use only these facts about the named subjects. Do not add awards, qualifications, positions, dates or numbers that are not listed. When a section has fewer facts, make it shorter; never write "to be added", "a record still to be detailed", "coming soon", "details to follow", "build the story from verified facts" or any other placeholder or instruction text, and never explain what is missing.
- Do not show source numbers or the words "researched" or "verified" on the site. Add one footer line, "Sources: ${[...new Set(dossier.sources.map((source) => source.host))].slice(0, 5).join(', ')}".`);
  return lines.join('\n');
}

const clearCache = () => cache.clear();

module.exports = { searchWeb, fetchPage, parsePage, parseBraveHtml, researchSubjects, buildResearchBlock, checkFact, excerptFor, carriesAffiliation, affiliationTokens, categoryOf, heuristicFacts, clearCache, PROVIDERS };
