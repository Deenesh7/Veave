// Decides WHICH PAGE an edit is about. The page the user is looking at is the default; a page named explicitly in the
// request ("... on the contact page") wins; with neither, the home page. Every engine and the target search use the result.
const STOP = new Set(['this', 'that', 'the', 'current', 'whole', 'entire', 'same', 'next', 'new', 'each', 'every', 'a', 'an', 'my', 'our', 'your', 'one', 'first', 'last', 'full', 'main', 'web', 'whole']);
const HOME = new Set(['home', 'homepage', 'landing', 'index']);

function normalizeRoute(route) {
  if (!route || typeof route !== 'string') return null;
  const clean = route.split(/[?#]/)[0].trim();
  if (!clean) return null;
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  return withSlash.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

/** Pages the project knows: captured-site table, router table, static <Route> declarations. Always includes "/". */
function knownRoutesFor(files = [], provenance = null) {
  const routes = new Map([['/', { path: '/', title: 'home' }]]);
  const add = (path, title = '') => { const p = normalizeRoute(path); if (p && !routes.has(p)) routes.set(p, { path: p, title: String(title || '') }); };
  for (const route of provenance?.routes || []) add(route.path, route.title);
  for (const file of files) {
    if (!file || file.encoding === 'base64' || typeof file.content !== 'string' || !/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path || '')) continue;
    const table = file.content.match(/VEAVE_KNOWN_ROUTES\s*=\s*(\[[^\]]*\])/);
    if (table) { try { for (const path of JSON.parse(table[1])) add(path); } catch { /* malformed table: ignore */ } }
    for (const m of file.content.matchAll(/<Route\b[^>]*?\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`]/g)) if (/^\/[\w\-/]*$/.test(m[1])) add(m[1]);
  }
  return [...routes.values()];
}

/** The page the request names ("about page", "on the contact page"), as a known route; null when it names none. */
function routeNamedInRequest(prompt = '', routes = [], viewing = null) {
  const words = new Set();
  for (const m of String(prompt).toLowerCase().matchAll(/\b([a-z][\w-]{2,})\s+(?:page|screen)\b/g)) words.add(m[1]);
  for (const m of String(prompt).toLowerCase().matchAll(/\b(?:page|screen)\s+(?:called|named)?\s*["']?([a-z][\w-]{2,})/g)) words.add(m[1]);
  for (const word of words) {
    if (STOP.has(word)) continue;
    if (HOME.has(word)) return '/';
    const flat = word.replace(/-/g, '');
    const matches = routes.filter((route) => {
      const segment = route.path.split('/').filter(Boolean).pop()?.toLowerCase().replace(/[-_]/g, '') || '';
      const title = String(route.title || '').toLowerCase();
      return (segment && (segment === flat || segment.startsWith(flat) || (flat.length >= 4 && flat.startsWith(segment) && segment.length >= 4))) || new RegExp(`\\b${flat}\\b`).test(title);
    });
    if (!matches.length) continue;
    if (viewing && matches.some((route) => route.path === viewing)) return viewing;
    return matches.sort((a, b) => a.path.length - b.path.length)[0].path;
  }
  return null;
}

/**
 * @returns { route, source: 'named-in-request' | 'viewing' | 'default', viewing }
 */
function resolveEditRoute({ prompt = '', viewingRoute = null, files = [], provenance = null } = {}) {
  const viewing = normalizeRoute(viewingRoute);
  const routes = knownRoutesFor(files, provenance);
  const named = routeNamedInRequest(prompt, routes, viewing);
  if (named) return { route: named, source: 'named-in-request', viewing };
  if (viewing) return { route: viewing, source: 'viewing', viewing };
  return { route: '/', source: 'default', viewing: null };
}

module.exports = { resolveEditRoute, routeNamedInRequest, knownRoutesFor, normalizeRoute };
