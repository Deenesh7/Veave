/**
 * WebsiteCrawler: a bounded, polite crawl of one organisation's website for the pages that matter to the request.
 *
 *   findOfficialSite   the organisation's own site: an address the request gives, otherwise the best web-search result whose host
 *                      carries the organisation's name (never a social, reference, news or aggregator site)
 *   crawlSite          breadth-first by relevance from that address: pages whose link text or path matches the requested topics are
 *                      fetched first; same site only; duplicates, files, log-in / cart / feed pages and anything robots.txt disallows
 *                      are skipped; pagination is followed; every limit is configurable and the crawl always ends
 *
 * Every page keeps its address and retrieval time. A page that cannot be fetched is reported (diagnostics.failed) and never invented.
 * Network access is injected (`fetchHtml`, `search`) so the crawl is testable without the web.
 */
const webResearch = require('../research/webResearch');
const { terms, overlap } = require('../deep/deepPlanner');

const int = (value, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) && n > 0 ? n : fallback; };

function crawlLimits(env = process.env, overrides = {}) {
  return {
    maxPages: int(env.KNOWLEDGE_MAX_PAGES, 24), maxDepth: int(env.KNOWLEDGE_MAX_DEPTH, 3), concurrency: int(env.KNOWLEDGE_CONCURRENCY, 3),
    pageTimeoutMs: int(env.KNOWLEDGE_PAGE_TIMEOUT_MS, 12000), totalTimeoutMs: int(env.KNOWLEDGE_TOTAL_TIMEOUT_MS, 90000), delayMs: int(env.KNOWLEDGE_DELAY_MS, 150),
    maxLinksPerPage: 400, ...overrides
  };
}

const SECOND_LEVEL = new Set(['co', 'ac', 'edu', 'gov', 'org', 'com', 'net', 'nic', 'res']);
/** "www.saveetha.com" and "admissions.saveetha.com" share a site; "saveetha.ac.in" keeps three labels. */
function siteKey(host) {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const keep = SECOND_LEVEL.has(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 3 : 2;
  return labels.slice(-keep).join('.');
}
const sameSite = (a, b) => { try { return siteKey(new URL(a).hostname) === siteKey(new URL(b).hostname); } catch { return false; } };

const FILE_EXT = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|svg|ico|mp4|mp3|avi|mov|css|js|json|xml|txt|csv|apk|exe)(?:[?#]|$)/i;
const SKIP_PATH = /\/(?:login|log-in|signin|sign-in|signup|register|account|cart|checkout|wp-admin|wp-login|wp-json|feed|rss|tag|author|search|print|calendar|cdn-cgi|logout)(?:\/|$|\?)|[?&](?:s|q|replytocom|share|print|format|action|add-to-cart)=/i;
const TRACKING = /^(?:utm_|fbclid|gclid|mc_|ref$|source$|session|phpsessid)/i;

/** One address per page: no fragment, no tracking, a stable query order, no trailing slash. */
function normalizeUrl(href, base) {
  let url;
  try { url = new URL(href, base); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();

/** Links of a page: address, link text, whether it is a "next page" link. */
function extractLinks(html, base, { max = 400 } = {}) {
  const links = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/\bhref\s*=\s*["']([^"'#][^"']*|#[^"']+)["']/i.exec(match[1]) || [])[1];
    if (!href || /^(?:mailto|tel|javascript|data):/i.test(href)) continue;
    const url = normalizeUrl(href, base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const text = strip(match[2]).slice(0, 120) || (/\btitle\s*=\s*["']([^"']*)["']/i.exec(match[1]) || [])[1] || '';
    const rel = (/\brel\s*=\s*["']([^"']*)["']/i.exec(match[1]) || [])[1] || '';
    links.push({ url, text, next: /\bnext\b/i.test(rel) || /^(?:next|next page|older|more|»|›|>>|>)$/i.test(text.trim()) || /[?&]page=\d+/i.test(url) });
    if (links.length >= max) break;
  }
  return links;
}

/** Disallow rules of "User-agent: *" in a robots.txt. */
function parseRobots(text) {
  const rules = [];
  let applies = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(key)) applies = value === '*';
    else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
    else if (applies && /^allow$/i.test(key) && value) rules.push(`!${value}`);
  }
  return (path) => {
    let blocked = false; let best = -1;
    for (const rule of rules) {
      const allow = rule.startsWith('!');
      const pattern = allow ? rule.slice(1) : rule;
      const plain = pattern.replace(/\*.*$/, '').replace(/\$$/, '');
      if (path.startsWith(plain) && plain.length > best) { best = plain.length; blocked = !allow; }
    }
    return blocked;
  };
}

/** How promising a link is for the topics: its text and path words against the requested terms. */
function linkScore(link, topicTerms) {
  if (!topicTerms.length) return 0;
  let path = '';
  try { path = decodeURIComponent(new URL(link.url).pathname).replace(/[-_/.+]+/g, ' '); } catch { path = ''; }
  const want = new Set(topicTerms);
  const have = new Set([...terms(link.text), ...terms(path)]);
  let hit = 0;
  for (const word of want) if (have.has(word)) hit += 1;
  return hit / Math.max(1, Math.min(want.size, 4));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param input { startUrl, topics: string[], limits?, signal?, fetchHtml?, onPage? }
 * @returns {{ pages, diagnostics: { fetched, failed: [{url, reason}], skipped, truncated, stoppedBy } }}
 */
async function crawlSite({ startUrl, topics = [], limits = crawlLimits(), signal = null, fetchHtml = webResearch.fetchHtml, onPage = null } = {}) {
  const start = normalizeUrl(startUrl);
  const out = { pages: [], diagnostics: { fetched: 0, failed: [], skipped: 0, truncated: false, stoppedBy: 'exhausted' } };
  if (!start) { out.diagnostics.failed.push({ url: String(startUrl), reason: 'not a web address' }); return out; }
  const topicTerms = [...new Set(topics.flatMap((topic) => terms(topic)))];
  const deadline = Date.now() + limits.totalTimeoutMs;
  const queued = new Map([[start, { url: start, text: '', depth: 0, score: 10, next: false }]]);
  const visited = new Set();
  let allowed = () => true;
  try {
    const robots = await fetchHtml(new URL('/robots.txt', start).href, { signal, timeoutMs: limits.pageTimeoutMs });
    const blocked = parseRobots(String(robots.html).replace(/<[^>]+>/g, ''));
    allowed = (path) => !blocked(path);
  } catch { allowed = () => true; }
  const queue = () => [...queued.values()].filter((item) => !visited.has(item.url)).sort((a, b) => b.score - a.score || a.depth - b.depth);

  const visit = async (item) => {
    visited.add(item.url);
    try {
      const fetched = await fetchHtml(item.url, { signal, timeoutMs: limits.pageTimeoutMs });
      const finalUrl = normalizeUrl(fetched.url) || item.url;
      if (!sameSite(finalUrl, start)) { out.diagnostics.skipped += 1; return; }
      if (finalUrl !== item.url) { if (visited.has(finalUrl)) { out.diagnostics.skipped += 1; return; } visited.add(finalUrl); }
      // List items are kept even when short: a course or product name is a few characters long.
      const page = webResearch.parsePage(fetched.html, finalUrl, { listMin: 3 });
      const links = extractLinks(fetched.html, finalUrl, { max: limits.maxLinksPerPage });
      const record = { url: finalUrl, title: page.title, description: page.description, depth: item.depth, blocks: page.blocks, images: page.images, ogImage: page.ogImage, retrievedAt: new Date().toISOString(), relevance: Math.max(item.score, overlap(topics.join(' '), `${page.title} ${page.blocks.slice(0, 40).map((block) => block.text).join(' ')}`)), links: links.length };
      out.pages.push(record);
      out.diagnostics.fetched += 1;
      if (onPage) onPage(record);
      for (const link of links) {
        if (!sameSite(link.url, start) || FILE_EXT.test(link.url) || SKIP_PATH.test(link.url)) { out.diagnostics.skipped += 1; continue; }
        let path = '/';
        try { path = new URL(link.url).pathname; } catch { /* keep */ }
        if (!allowed(path)) { out.diagnostics.skipped += 1; continue; }
        if (queued.has(link.url) || visited.has(link.url)) continue;
        // A "next page" link continues the same listing: it costs no depth.
        const depth = link.next ? item.depth : item.depth + 1;
        if (depth > limits.maxDepth) continue;
        queued.set(link.url, { url: link.url, text: link.text, depth, next: link.next, score: linkScore(link, topicTerms) + (link.next ? 0.5 : 0) - depth * 0.15 });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      out.diagnostics.failed.push({ url: item.url, reason: String(error.message).slice(0, 120) });
    }
  };

  while (true) {
    if (signal?.aborted) throw signal.reason || new Error('cancelled');
    if (Date.now() >= deadline) { out.diagnostics.stoppedBy = 'time limit'; out.diagnostics.truncated = true; break; }
    const remaining = limits.maxPages - visited.size;
    if (remaining <= 0) { out.diagnostics.stoppedBy = 'page limit'; out.diagnostics.truncated = queue().length > 0; break; }
    const batch = queue().slice(0, Math.min(limits.concurrency, remaining));
    if (!batch.length) break;
    await Promise.all(batch.map(visit));
    if (limits.delayMs) await sleep(limits.delayMs);
  }
  out.pages.sort((a, b) => b.relevance - a.relevance);
  return out;
}

const NOT_OFFICIAL = /(?:^|\.)(?:wikipedia|wikimedia|wikidata|britannica|facebook|instagram|twitter|x|linkedin|youtube|pinterest|reddit|quora|tiktok|justdial|shiksha|collegedunia|careers360|getmyuni|yellowpages|indeed|glassdoor|crunchbase|amazon|flipkart)\.(?:org|com|net|co|in)$/i;

/** The organisation's own website: the best search result whose host carries the name. */
async function findOfficialSite({ name, search = webResearch.searchWeb, signal = null } = {}) {
  const nameTerms = terms(name).filter((word) => !['college', 'university', 'institute', 'school', 'company', 'limited', 'private', 'medical', 'official'].includes(word) || terms(name).length <= 2);
  if (!nameTerms.length) return null;
  const candidates = [];
  for (const query of [`${name} official website`, `${name}`]) {
    let results = [];
    try { results = await search(query, { signal }); } catch (error) { if (signal?.aborted) throw error; }
    for (const item of results) {
      const host = String(item.host || '').replace(/^www\./, '') || (() => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
      if (!host || NOT_OFFICIAL.test(host)) continue;
      const hostWords = host.replace(/\.[a-z.]+$/, '').replace(/[-_]/g, ' ').toLowerCase();
      const hits = nameTerms.filter((word) => hostWords.includes(word.slice(0, Math.max(4, word.length - 2)))).length;
      if (!hits) continue;
      const root = normalizeUrl(new URL(item.url).origin);
      candidates.push({ url: root, host: new URL(item.url).hostname, score: hits / nameTerms.length + (item.rank === 0 ? 0.2 : 0) + (/\.(?:edu|ac\.in|edu\.in|gov|org)$/.test(host) ? 0.1 : 0) });
    }
    if (candidates.length) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

module.exports = { crawlSite, findOfficialSite, crawlLimits, extractLinks, normalizeUrl, siteKey, sameSite, parseRobots, linkScore, FILE_EXT };
