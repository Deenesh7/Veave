/**
 * Automatic image discovery for NEW websites.
 *
 * When the prompt names a person, company, brand, organisation, product or place ("a conference website featuring Sundar
 * Pichai"), the generator should not invent stock-photo links. This module
 *   1. finds the named entities (a small model call, with a rule-based fallback),
 *   2. searches the web / Wikimedia for pictures whose title or page carries the WHOLE name (imageSearch.js),
 *   3. downloads and verifies each candidate (real image, big enough, not already taken, not a duplicate),
 *   4. tells the generator, section by section, which verified picture belongs where,
 *   5. later checks that the generated site really uses them.
 *
 * Nothing here ever substitutes another person's picture: an entity without a verified image is reported as such and the
 * generator is told to use a neutral monogram/illustration for it instead.
 */

const { createHash } = require('node:crypto');
const imageSearch = require('./imageSearch');
const remoteImageLocalizer = require('./remoteImageLocalizer');

const MAX_ENTITIES = Number.parseInt(process.env.ENTITY_IMAGES_MAX_ENTITIES, 10) || 5;
const MAX_IMAGES_PER_ENTITY = Number.parseInt(process.env.ENTITY_IMAGES_PER_ENTITY, 10) || 3;
const ENTITY_TYPES = new Set(['person', 'company', 'brand', 'organization', 'product', 'place', 'event']);

const NOT_ENTITIES = new Set(['create', 'build', 'make', 'design', 'generate', 'website', 'web', 'site', 'page', 'landing', 'portfolio', 'blog', 'store', 'shop', 'app', 'dashboard', 'modern', 'simple', 'beautiful', 'professional', 'responsive', 'dark', 'light', 'react', 'tailwind', 'javascript', 'html', 'css', 'node', 'mongodb', 'github', 'google fonts', 'home', 'about', 'contact', 'services', 'pricing', 'team', 'blog', 'faq', 'login', 'signup', 'ui', 'ux', 'seo', 'api', 'i', 'a', 'an', 'the']);

/* ---------------------------------------------------------------- identity evidence ---------------------------------------------------------------- */

const SOCIAL_HOST = /(?:^|\.)(?:facebook|instagram|pinterest|twitter|x|tiktok|linkedin|reddit|tumblr|quora|youtube|ytimg|fbcdn|cdninstagram)\.(?:com|net|co)$/i;
const AGGREGATOR_HOST = /(?:^|\.)(?:alamy|alamyimages|gettyimages|shutterstock|istockphoto|dreamstime|depositphotos|123rf|pngtree|pngwing|freepik|vecteezy|quotefancy|brainyquote|picsart|pikbest|wallpaperaccess|wallpapercave)\.[a-z.]+$/i;
const REFERENCE_HOST = /(?:^|\.)(?:wikipedia|wikimedia|wikidata|britannica)\.org$|(?:^|\.)britannica\.com$/i;
const NEWS_HOST = /(?:^|\.)(?:thehindu|indianexpress|timesofindia\.indiatimes|hindustantimes|ndtv|deccanherald|deccanchronicle|dtnext|newindianexpress|business-standard|economictimes\.indiatimes|livemint|thehindubusinessline|bbc|reuters|apnews|theguardian|nytimes|washingtonpost|cnn|forbes|bloomberg)\.[a-z.]+$/i;

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/** What kind of website the picture comes from, which is the main evidence of whose picture it is. */
function sourceTier(candidate, entityName) {
  const host = hostOf(candidate.pageUrl) || hostOf(candidate.imageUrl || candidate.url);
  if (!host) return { tier: 'unknown', host };
  if (SOCIAL_HOST.test(host)) return { tier: 'social', host };
  if (AGGREGATOR_HOST.test(host)) return { tier: 'aggregator', host };
  if (REFERENCE_HOST.test(host)) return { tier: 'reference', host };
  if (NEWS_HOST.test(host)) return { tier: 'news', host };
  const tokens = imageSearch.distinctiveTokens(entityName).filter((token) => token.length >= 4);
  if (/\.(?:edu|gov|ac)(?:\.[a-z]{2})?$|\.nic\.in$|\.gov\.[a-z]{2}$/.test(host) || tokens.some((token) => host.replace(/[^a-z0-9]/g, '').includes(token))) return { tier: 'official', host };
  return { tier: 'unknown', host };
}

/**
 * Is this search result evidence of the NAMED subject? A person is accepted only on strong evidence: the whole name in the
 * title and in the surrounding page text from an official, reference or news site (or in two independent fields from any other
 * ordinary site). Social posts and stock aggregators are never accepted for a person. A result that does not qualify is dropped, so
 * the section falls back to a generic relevant photograph that never claims to show that person.
 */
function assessIdentity(candidate, entity) {
  const { tier, host } = sourceTier(candidate, entity.name);
  if (tier === 'social' || tier === 'aggregator') return { ok: false, tier, host, reason: `${tier} source` };
  const inTitle = imageSearch.matchesSubject(candidate.title || '', entity.name);
  const pageSlug = (() => { try { return decodeURIComponent(new URL(candidate.pageUrl).pathname).replace(/[-_/.+]+/g, ' '); } catch { return ''; } })();
  const inContext = imageSearch.matchesSubject(`${candidate.snippet || ''} ${pageSlug}`, entity.name);
  const reasons = [inTitle ? 'name in title' : null, inContext ? 'name in page text' : null, tier !== 'unknown' ? `${tier} source` : null].filter(Boolean);
  if (entity.type === 'person') {
    const strong = ['official', 'reference', 'news'].includes(tier) && (inTitle || inContext);
    const corroborated = inTitle && inContext;
    if (!strong && !corroborated) return { ok: false, tier, host, reason: 'identity not established' };
    return { ok: true, level: strong && (inTitle || tier === 'reference') ? 'high' : 'medium', tier, host, via: reasons };
  }
  if (!inTitle && !inContext) return { ok: false, tier, host, reason: 'name not in title or page text' };
  return { ok: true, level: tier === 'unknown' ? 'medium' : 'high', tier, host, via: reasons };
}

const typeOf = (value) => (ENTITY_TYPES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'organization');

/** Capitalised name-like phrases ("Sundar Pichai", "Tata Motors") when no model is available to ask. */
function heuristicEntities(prompt = '') {
  const text = String(prompt || '');
  const found = new Map();
  const add = (name, type) => {
    const clean = name.replace(/\s+/g, ' ').replace(/['’]s$/i, '').trim();
    const key = clean.toLowerCase();
    if (clean.length < 3 || NOT_ENTITIES.has(key) || key.split(' ').every((word) => NOT_ENTITIES.has(word))) return;
    if (!found.has(key)) found.set(key, { name: clean, type });
  };
  for (const match of text.matchAll(/["\u201c]([A-Z][^"\u201d]{2,50})["\u201d]/g)) add(match[1], 'organization');
  for (const match of text.matchAll(/\b(?:[A-Z][a-zA-Z.'\-]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-zA-Z.'\-]+|[A-Z]{2,})){0,3}\b/g)) {
    // A phrase at the very start of the prompt is usually just the first word of the sentence ("Create ...").
    const words = match[0].split(' ');
    const phrase = (match.index === 0 || /[.!?]\s*$/.test(text.slice(0, match.index))) && words.length === 1 ? '' : match[0];
    if (!phrase) continue;
    const stripped = phrase.split(' ').filter((word) => !NOT_ENTITIES.has(word.toLowerCase())).join(' ');
    if (stripped) add(stripped, stripped.split(' ').length >= 2 && stripped.split(' ').length <= 3 ? 'person' : 'organization');
  }
  const subject = imageSearch.extractImageSubject(prompt);
  if (subject) add(subject, 'person');
  return [...found.values()].slice(0, MAX_ENTITIES);
}

/** @param ask async (system, user) => string, optional */
async function extractEntities(prompt, { ask = null } = {}) {
  if (ask) {
    try {
      const raw = await ask(
        'You extract named real-world entities from a website request. Reply with ONLY a JSON array, no prose. Each item: {"name": exact name as it should be searched, "type": "person"|"company"|"brand"|"organization"|"product"|"place"|"event", "role": one short phrase for how it appears on the website (e.g. "speaker", "founder", "the company the site is for", "team member")}. Include only specific, identifiable real people, companies, brands, organisations, products, places or events that the website is ABOUT or FEATURES. Do not include generic words, technologies (React, Tailwind), page names, or the invented name of a brand-new business with no public presence. Return [] when there are none. Maximum 5 items.',
        String(prompt || '').slice(0, 4000)
      );
      const json = (/\[[\s\S]*\]/.exec(String(raw || '')) || [])[0];
      const parsed = json ? JSON.parse(json) : null;
      if (Array.isArray(parsed)) {
        const seen = new Set();
        return parsed
          .filter((item) => item && typeof item.name === 'string' && item.name.trim().length >= 2)
          .map((item) => ({ name: item.name.replace(/\s+/g, ' ').trim().slice(0, 80), type: typeOf(item.type), role: String(item.role || '').slice(0, 60) }))
          .filter((item) => !NOT_ENTITIES.has(item.name.toLowerCase()) && !seen.has(item.name.toLowerCase()) && seen.add(item.name.toLowerCase()))
          .slice(0, MAX_ENTITIES);
      }
    } catch { /* fall through to the rule-based extraction */ }
  }
  return heuristicEntities(prompt).map((item) => ({ ...item, role: '' }));
}

/** The searches that give an entity the pictures a website needs for it. */
function searchPlan(entity) {
  const name = entity.name;
  if (entity.type === 'person') return [{ role: 'portrait', queries: [`"${name}"`, `"${name}" portrait`] }, { role: 'scene', queries: [`"${name}" speaking`, `"${name}" event`] }];
  if (entity.type === 'product') return [{ role: 'product', queries: [`"${name}"`, `"${name}" product`] }];
  if (entity.type === 'place') return [{ role: 'scene', queries: [`"${name}"`, `"${name}" view`] }];
  if (entity.type === 'event') return [{ role: 'scene', queries: [`"${name}"`] }];
  // company, brand, organisation
  return [{ role: 'scene', queries: [`"${name}" headquarters`, `"${name}" office building`, `"${name}"`] }, { role: 'logo', queries: [`"${name}" logo`] }];
}

async function measure(buffer, sniffed) {
  if (sniffed.mime === 'image/svg+xml') return { width: 0, height: 0, vector: true };
  try {
    const meta = await require('sharp')(buffer).metadata();
    return { width: meta.width || 0, height: meta.height || 0, vector: false };
  } catch { return null; }
}

function kindFor(role, dims, title = '', entityType = '') {
  if (role === 'logo' || /\blogo\b/i.test(title)) return 'logo';
  if (!dims.width || !dims.height) return 'general';
  const ratio = dims.width / dims.height;
  if (ratio >= 1.45) return 'wide';
  if (ratio <= 1.25) return (role === 'portrait' || entityType === 'person') ? 'portrait' : 'square';
  return 'general';
}

/**
 * Finds, downloads and verifies pictures for every entity.
 * @returns {{entities: Array, assets: Array, missing: Array}} assets carry no buffers; they are primed into the downloader cache.
 */
async function discoverEntityImages({ prompt, ask = null, signal, env = process.env, fetchJson, download = remoteImageLocalizer.downloadPublicImage, onNote = null } = {}) {
  const entities = await extractEntities(prompt, { ask });
  const assets = [];
  const missing = [];
  const usedHashes = new Set();
  const usedUrls = new Set();
  const rejectedIdentity = [];

  for (const entity of entities) {
    if (signal?.aborted) break;
    const mine = [];
    for (const step of searchPlan(entity)) {
      if (mine.length >= MAX_IMAGES_PER_ENTITY) break;
      let results = [];
      for (const query of step.queries) {
        try {
          const web = await imageSearch.searchWebImages(entity.name, { fetchJson, signal, env, queries: [query] });
          results = results.concat(web.results);
        } catch (error) { if (signal?.aborted) throw error; }
        if (results.length >= 6) break;
      }
      if (!results.length && step.role !== 'logo') {
        try { results = (await imageSearch.searchWikimedia(entity.name, { fetchJson, signal })).map((item) => ({ imageUrl: item.url, title: item.title, pageUrl: item.pageUrl, source: item.source })); } catch (error) { if (signal?.aborted) throw error; }
      }
      let taken = 0;
      for (const candidate of results) {
        if (taken >= (step.role === 'logo' ? 1 : 2) || mine.length >= MAX_IMAGES_PER_ENTITY) break;
        if (!candidate.imageUrl || usedUrls.has(candidate.imageUrl)) continue;
        usedUrls.add(candidate.imageUrl);
        const identity = step.role === 'logo' ? { ok: true, level: 'medium', tier: sourceTier(candidate, entity.name).tier, host: sourceTier(candidate, entity.name).host, via: ['logo search'] } : assessIdentity(candidate, entity);
        if (!identity.ok) { rejectedIdentity.push({ entity: entity.name, url: candidate.imageUrl, reason: identity.reason, host: identity.host }); continue; }
        try {
          const buffer = await download(candidate.imageUrl, { signal });
          const sniffed = remoteImageLocalizer.sniffImage(buffer);
          if (!sniffed) continue;
          const dims = await measure(buffer, sniffed);
          if (!dims) continue;
          const shortSide = Math.min(dims.width, dims.height);
          if (dims.vector && step.role !== 'logo') continue; // a vector with no known size is only trusted as a logo
          if (!dims.vector && shortSide < (step.role === 'logo' ? 80 : 220)) continue;
          const hash = createHash('sha256').update(buffer).digest('hex');
          if (usedHashes.has(hash)) continue;
          usedHashes.add(hash);
          remoteImageLocalizer.primeImageCache(candidate.imageUrl, buffer);
          mine.push({
            entity: entity.name, entityType: entity.type, entityRole: entity.role || '', kind: kindFor(step.role, dims, candidate.title, entity.type),
            url: candidate.imageUrl, title: String(candidate.title || '').slice(0, 140), pageUrl: candidate.pageUrl || null, source: candidate.source || 'web',
            width: dims.width, height: dims.height, mime: sniffed.mime, extension: sniffed.extension, hash10: hash.slice(0, 10),
            identity: { level: identity.level, tier: identity.tier, host: identity.host, via: identity.via }
          });
          taken += 1;
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
    }
    if (mine.length) assets.push(...mine);
    else missing.push(entity);
    if (onNote) onNote(`${entity.name}: ${mine.length ? `${mine.length} verified image(s)` : 'no verified image'}`);
  }
  return { entities, assets, missing, rejectedIdentity };
}

const SECTION_GUIDE = {
  portrait: 'a person: hero (if the site is about them), About, Team / Speakers / Testimonial card. Use a fixed square or 4:5 frame with `object-cover object-top`.',
  wide: 'a wide scene: hero banner or full-width background (with a dark overlay for text), or a gallery/feature banner. Use `aspect-video` or `aspect-[21/9]` with `object-cover`.',
  scene: 'a scene: hero, About or gallery.',
  square: 'a square picture: card, About, gallery tile, product or team card with `aspect-square object-cover`.',
  logo: 'a logo: navbar and footer brand mark, partner/"featured by" strip. Use `object-contain` with a fixed height; never stretch it and never use it as a photo.',
  product: 'a product picture: product section or card with `object-contain` or `object-cover` in a fixed-aspect frame.',
  general: 'a general picture: About, feature card or gallery.'
};

/** The block appended to the generation prompt. Empty when there is nothing to say. */
function buildPromptBlock({ assets = [], missing = [] } = {}) {
  if (!assets.length && !missing.length) return '';
  const lines = ['VERIFIED IMAGES FOR NAMED ENTITIES (found on the web and already downloaded and checked; these are the ONLY correct pictures of these names):'];
  const byEntity = new Map();
  for (const asset of assets) byEntity.set(asset.entity, [...(byEntity.get(asset.entity) || []), asset]);
  for (const [entity, list] of byEntity) {
    const first = list[0];
    lines.push(`\n${entity} (${first.entityType}${first.entityRole ? `, ${first.entityRole}` : ''}):`);
    for (const asset of list) {
      const evidence = asset.identity ? ` identity: ${asset.identity.level} confidence (${(asset.identity.via || []).join(', ') || 'source'}; ${asset.identity.host || 'unknown source'})` : '';
      lines.push(`- ${asset.url}  [${asset.kind}, ${asset.width}x${asset.height}${asset.title ? `, "${asset.title}"` : ''}]${evidence} best for ${SECTION_GUIDE[asset.kind] || SECTION_GUIDE.general}${asset.pageUrl ? ` (source: ${asset.pageUrl})` : ''}`);
    }
  }
  if (missing.length) {
    lines.push(`\nNo verified picture could be found for: ${missing.map((item) => item.name).join(', ')}. For these, never use another person's or brand's photo and never invent a stock-photo link: use a clean monogram/initials avatar (a styled div with the initials) for people, or the name set as a wordmark for companies and brands, and a tasteful CSS/SVG illustration for places and products.`);
  }
  lines.push(`
RULES FOR THESE IMAGES:
- Use them as <img src="EXACT URL above"> (the build downloads them into the project). Copy each URL exactly; never edit, shorten or "fix" it.
- Put every verified image in the section where it belongs: the hero gets the strongest wide scene or main portrait; the About section gets the person/company picture; Team and Speaker sections get each person's OWN portrait next to that person's name; product and gallery sections get matching pictures; a logo only goes in the navbar/footer/partner strip.
- Never put one named person's picture under a different name, and never use these pictures for unrelated people. Use each image at most once, except a logo (navbar + footer).
- Every <img> needs a fixed-aspect frame (aspect-square, aspect-[4/5], aspect-video ...) with \`w-full h-full object-cover\` (portraits also \`object-top\`; logos \`object-contain\`), meaningful alt text containing the name (only for a picture whose identity line says so), and loading="lazy" below the fold. No stretching, no empty boxes, no broken-image icons.
- Add a small "Image credits" line in the footer that names each picture's source site.
- For all other images on the site (generic features, services, gallery tiles that are NOT about the named entities) follow the normal image rules; do not reuse the pictures above for them.`);
  return lines.join('\n');
}

/**
 * Checks (after the images were saved into the project) that every entity's primary verified picture is on the site.
 * Returns issue messages phrased as instructions for the repair model.
 */
function findUnusedAssets(files = [], assets = []) {
  const sources = files.filter((file) => file && file.encoding !== 'base64' && typeof file.content === 'string' && /\.(?:jsx?|tsx?|css|html)$/i.test(file.path || '')).map((file) => file.content).join('\n');
  const seen = new Set();
  const unused = [];
  for (const asset of assets) {
    if (seen.has(asset.entity)) continue; // only each entity's primary picture is mandatory
    seen.add(asset.entity);
    const saved = `added-${asset.hash10}`;
    if (!sources.includes(saved) && !sources.includes(asset.url)) unused.push({ ...asset, savedPath: `/assets/images/${saved}.${asset.extension}` });
  }
  return unused;
}

/** The unused verified images (any entity) that can replace a broken link. */
function spareAssets(files = [], assets = []) {
  const sources = files.filter((file) => file && file.encoding !== 'base64' && typeof file.content === 'string').map((file) => file.content).join('\n');
  return assets.filter((asset) => !sources.includes(`added-${asset.hash10}`) && !sources.includes(asset.url));
}

module.exports = { assessIdentity, sourceTier, extractEntities, heuristicEntities, discoverEntityImages, buildPromptBlock, findUnusedAssets, spareAssets, searchPlan, kindFor };
