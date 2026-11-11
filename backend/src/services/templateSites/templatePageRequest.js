/**
 * How many pages the owner asked for, and which. The owner's words are a hard limit: the planner may not invent more pages than were
 * asked for. Without any request the website keeps as many pages as the template has (what the template was designed for).
 */
const STOP = new Set(['the', 'following', 'these', 'those', 'all', 'some', 'multiple', 'several', 'required', 'needed', 'etc', 'other', 'more', 'few', 'any', 'web', 'website', 'site', 'my', 'our', 'a', 'an']);
const HOME = /^(home|homepage|home page|landing|landing page|index|main)$/i;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const title = (text) => text.split(/\s+/).map((word) => (word.length > 3 || /^[a-z]+$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');

function splitNames(text) {
  return String(text).split(/,|;|\n|\band\b|&|\/|\bplus\b|\bthen\b/i)
    .map((part) => part.replace(/^[\s\-*•\d.)(]+/, '').replace(/\bpages?\b/ig, '').replace(/[^\p{L}\p{N}\s'&-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part && part.length <= 40 && !STOP.has(part.toLowerCase()) && part.split(/\s+/).length <= 4);
}

/** Returns { names: [..] (titled, in the order asked, no duplicates), count: number|null }. */
function parsePageRequest(brief = '') {
  const text = String(brief || '');
  const names = [];
  const add = (list) => { for (const name of splitNames(list)) if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(title(name)); };

  // "Pages: Home, About, Contact"  /  "with pages for X and Y"  /  "pages such as ..."
  const labelled = text.match(/\bpages?\s*(?::|-|–|—|are|should be|should include|include|including|such as|like|=)\s*([^\n.;]+)/i);
  if (labelled) add(labelled[1]);
  // Bullet or numbered list under a line that mentions pages.
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /\bpages?\b/i.test(line) && /[:：]\s*$/.test(line.trim()));
  if (at >= 0) for (const line of lines.slice(at + 1)) { if (!/^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)) break; add(line); }
  // "Home, About Us, Admissions and Contact pages"
  if (!names.length) {
    const direct = text.match(/((?:[A-Z][A-Za-z&'-]*(?:\s+[A-Z][A-Za-z&'-]*){0,2})(?:\s*(?:,|and|&)\s*(?:[A-Z][A-Za-z&'-]*(?:\s+[A-Z][A-Za-z&'-]*){0,2}))+)\s+pages?\b/);
    if (direct) add(direct[1]);
  }
  let count = null;
  const digits = text.match(/\b(\d{1,2})[\s-]*(?:pages?|page website|page site)\b/i);
  const worded = text.match(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})[\\s-]*(?:pages?|page website)\\b`, 'i'));
  if (digits) count = Number(digits[1]); else if (worded) count = NUMBER_WORDS[worded[1].toLowerCase()];
  if (count !== null && (count < 1 || count > 12)) count = null;
  return { names: names.slice(0, 12), count };
}

/** The most pages the website may have, and why. */
function pageLimit(request, templatePageCount) {
  if (request.names.length) {
    const hasHome = request.names.some((name) => HOME.test(name));
    return { max: Math.min(12, request.names.length + (hasHome ? 0 : 1)), reason: 'listed' };
  }
  if (request.count) return { max: request.count, reason: 'count' };
  return { max: Math.max(2, templatePageCount || 4), reason: 'template' };
}

const tokens = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !['and', 'our', 'the', 'page', 'pages', 'about'].includes(word) || word === 'about') || [];
const similarity = (a, b) => { const x = new Set(tokens(a)); const y = tokens(b); if (!x.size || !y.length) return 0; return y.filter((word) => x.has(word)).length / Math.max(x.size, y.length); };

const routeFromName = (name) => `/${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page'}`;

/**
 * Cuts the planned pages down to what was asked for. When the owner listed pages, those pages (their names, in their order) are exactly
 * what is kept: a planned page that matches one keeps its route, purpose and sections; one that matches none is dropped; a listed page the
 * planner left out is added. The home page is always present (a website needs "/").
 */
function limitPages(planned, request, limit) {
  if (!request.names.length) {
    const home = planned.filter((page) => page.route === '/');
    const rest = planned.filter((page) => page.route !== '/');
    return [...home, ...rest].slice(0, limit.max);
  }
  const pool = [...planned];
  const result = [];
  const take = (name) => {
    let best = -1; let score = 0;
    pool.forEach((page, index) => { const value = Math.max(similarity(name, page.name), HOME.test(name) && page.route === '/' ? 1 : 0, page.name.toLowerCase().includes(name.toLowerCase()) ? 0.8 : 0); if (value > score) { score = value; best = index; } });
    return score >= 0.34 ? pool.splice(best, 1)[0] : null;
  };
  if (!request.names.some((name) => HOME.test(name))) { const home = planned.find((page) => page.route === '/'); if (home) { pool.splice(pool.indexOf(home), 1); result.push(home); } }
  for (const name of request.names) {
    const match = take(name);
    if (match) result.push({ ...match, name, ...(HOME.test(name) ? { route: '/' } : {}) });
    else result.push({ name, route: HOME.test(name) ? '/' : routeFromName(name), purpose: `The ${name} page of the website.`, sections: [], reuse: null, contentNeeds: '', imageNeeds: '' });
  }
  const seen = new Set();
  return result.filter((page) => { if (seen.has(page.route)) return false; seen.add(page.route); return true; }).slice(0, limit.max);
}

module.exports = { parsePageRequest, pageLimit, limitPages, HOME };
