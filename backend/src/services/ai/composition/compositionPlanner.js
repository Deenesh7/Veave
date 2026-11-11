/**
 * Page composition planning: runs BEFORE any JSX is written.
 *
 * It decides, for every page, which sections exist, what each one is for, how much it has to say, which layout presents that best,
 * which pictures belong in it (and, for named people and institutions, which verified picture or none), and how much space it takes.
 * The plan then (1) becomes the picture requirements for image discovery, (2) is written into the generation prompt as the
 * layout the model must follow, and (3) is what the rendered review measures the finished site against.
 *
 * The model is asked for the plan when one is available; otherwise a deterministic plan is built from the request, so planning
 * never depends on the model being reachable. Either way the plan is normalised and checked here.
 */
const { LAYOUTS, TOKENS, CONTENT_LENGTH } = require('./layoutCatalog');
const requirementsModule = require('../images/imageRequirements');
const { imageConfig } = require('../images/imageConfig');

const slug = requirementsModule.slug;
const clean = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const WORD_KEYS = Object.keys(CONTENT_LENGTH);
const SPACING_KEYS = ['hero', 'major', 'related', 'compact'];

/* ------------------------------------------------------------------ density ------------------------------------------------------------------ */

// How many words each layout holds comfortably (below: it looks empty; above: it looks crowded).
const CAPACITY = {
  'split-hero': [20, 70], 'full-width-hero': [20, 70], 'page-intro': [15, 80], 'editorial-image-right': [60, 220], 'editorial-image-left': [60, 220],
  'two-column': [60, 260], 'three-column-cards': [45, 210], timeline: [60, 300], statistics: [8, 40], 'achievement-grid': [45, 260], gallery: [10, 120],
  testimonial: [25, 130], profile: [60, 220], 'alternating-editorial': [150, 480], 'text-block': [60, 280], 'contact-split': [20, 120], 'cta-band': [10, 50], 'faq-list': [40, 400]
};

function estimateDensity(section) {
  const words = CONTENT_LENGTH[section.words] ?? 70;
  const [low, high] = CAPACITY[section.layout] || [40, 240];
  const images = (section.images || []).length;
  let state = 'balanced';
  if (words < low * 0.6) state = 'light';
  else if (words > high * 1.15) state = 'dense';
  if (images >= 3 && words < 60) state = state === 'dense' ? 'balanced' : 'image-heavy';
  if (words >= 200 && images === 0 && section.layout === 'text-block') state = 'text-heavy';
  return { words, capacity: [low, high], state };
}

/**
 * Adjusts a page's sections so none is too empty or too crowded: a light section drops to a compact layout and is merged with a
 * light neighbour; an over-long text block is turned into a structure (two columns / timeline) with sub-headings.
 */
function rebalance(page) {
  const notes = [];
  const sections = [];
  for (const section of page.sections) {
    const density = estimateDensity(section);
    let next = { ...section, density };
    if (density.state === 'light' && !/hero|intro|statistics|cta-band|contact|gallery/.test(next.layout) && next.images.length === 0) {
      next = { ...next, layout: 'text-block', spacing: 'compact' };
      notes.push(`${next.id}: very little to say, so it uses a compact text layout`);
    } else if (density.state === 'light' && /editorial|profile/.test(next.layout) && next.images.length) {
      next = { ...next, spacing: 'related' };
    }
    if (density.state === 'text-heavy' || (density.state === 'dense' && next.layout === 'text-block')) {
      next = { ...next, layout: next.layout === 'text-block' ? 'two-column' : next.layout, breakUp: true };
      notes.push(`${next.id}: long content is broken into sub-headings, lists or columns`);
    }
    const previous = sections[sections.length - 1];
    if (previous && previous.layout === 'text-block' && next.layout === 'text-block' && previous.density.state === 'light' && next.density.state === 'light') {
      previous.summary = `${previous.summary} ${next.summary}`.trim();
      previous.merged = [...(previous.merged || []), next.id];
      previous.words = 'short';
      notes.push(`${next.id}: merged into ${previous.id} (both are short)`);
      continue;
    }
    sections.push(next);
  }
  return { ...page, sections, balanceNotes: notes };
}

/* ------------------------------------------------------------------ normalisation ------------------------------------------------------------------ */

function normalizeImageNeeds(rawNeeds, layoutId) {
  const spec = LAYOUTS[layoutId];
  const [min, max] = spec.images;
  let needs = (Array.isArray(rawNeeds) ? rawNeeds : []).slice(0, Math.max(max, 0)).map((need) => ({
    role: ['portrait', 'photo', 'logo', 'document'].includes(need?.role) ? need.role : 'photo',
    query: clean(need?.query, 90), alt: clean(need?.alt, 160), entity: clean(need?.entity, 80), fallbackQuery: clean(need?.fallbackQuery, 90)
  })).filter((need) => need.query || need.entity);
  needs = needs.map((need) => ({ ...need, query: need.query || need.entity }));
  return { needs, short: Math.max(0, min - needs.length) };
}

function defaultLayout(index, total, pageKey) {
  if (index === 0) return /^home|landing|index$/.test(pageKey) ? 'split-hero' : 'page-intro';
  if (index === total - 1) return 'cta-band';
  return index % 2 ? 'editorial-image-right' : 'editorial-image-left';
}

function normalizeSection(raw, index, total, pageKey, used) {
  const layout = LAYOUTS[raw?.layout] ? raw.layout : defaultLayout(index, total, pageKey);
  let id = slug(raw?.id || raw?.heading || `${layout}-${index + 1}`);
  while (used.has(id)) id = `${id}-${index + 1}`;
  used.add(id);
  const { needs, short } = normalizeImageNeeds(raw?.images, layout);
  return {
    id, purpose: clean(raw?.purpose, 200) || `${layout} section`, eyebrow: clean(raw?.eyebrow, 40), heading: clean(raw?.heading, 100),
    summary: clean(raw?.summary, 420), facts: (Array.isArray(raw?.facts) ? raw.facts : []).map((fact) => clean(fact, 140)).filter(Boolean).slice(0, 8),
    words: WORD_KEYS.includes(raw?.words) ? raw.words : (LAYOUTS[layout].images[1] ? 'medium' : 'short'),
    layout, spacing: SPACING_KEYS.includes(raw?.spacing) ? raw.spacing : LAYOUTS[layout].spacing,
    width: LAYOUTS[layout].width, images: needs, imageShortfall: short, order: index + 1
  };
}

function normalizePlan(raw, { entities = [] } = {}) {
  if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) return null;
  const pages = [];
  const pageIds = new Set();
  for (const item of raw.pages.slice(0, 8)) {
    const name = clean(item?.name, 40);
    if (!name) continue;
    const key = slug(name);
    const route = clean(item.route, 60) || (/^home$/i.test(name) ? '/' : `/${key}`);
    let id = slug(item.id || name);
    while (pageIds.has(id)) id = `${id}-2`;
    pageIds.add(id);
    const list = (Array.isArray(item.sections) ? item.sections : []).slice(0, 8);
    if (list.length < 1) continue;
    const used = new Set();
    pages.push(rebalance({ id, name, route: route.startsWith('/') ? route : `/${route}`, purpose: clean(item.purpose, 200), sections: list.map((section, index) => normalizeSection(section, index, list.length, key, used)) }));
  }
  if (!pages.length) return null;
  const plan = { industry: clean(raw.industry, 40) || 'general', audience: clean(raw.audience, 100), tone: clean(raw.tone, 80), pages };
  return ensureEntityCoverage(plan, entities);
}

/** Every named person / institution of the request appears in at least one section's picture needs. */
function ensureEntityCoverage(plan, entities) {
  for (const entity of entities.slice(0, 6)) {
    const name = entity.name;
    const covered = plan.pages.some((page) => page.sections.some((section) => section.images.some((need) => need.entity && need.entity.toLowerCase() === name.toLowerCase())));
    if (covered) continue;
    const person = entity.type === 'person';
    const wanted = person ? /profile|editorial|hero|intro/ : /cards|editorial|alternating|achievement|gallery/;
    const pagePool = plan.pages.filter((page) => (person ? /home|about|life|legacy|biograph|founder|story/i.test(page.name) : /college|institution|campus|school|about|home|achiev/i.test(page.name)));
    for (const page of [...pagePool, ...plan.pages]) {
      const section = page.sections.find((candidate) => wanted.test(candidate.layout) && candidate.images.length < LAYOUTS[candidate.layout].images[1]);
      if (section) { section.images.push({ role: person ? 'portrait' : 'photo', query: name, alt: '', entity: name, fallbackQuery: '' }); break; }
    }
  }
  return plan;
}

/* ------------------------------------------------------------------ deterministic plan ------------------------------------------------------------------ */

function pageKind(name) {
  const key = String(name || '').toLowerCase();
  if (/^home|landing|main$/.test(key)) return 'home';
  if (/achiev|award|recogni|honou?r|milestone/.test(key)) return 'achievements';
  if (/life|legacy|biograph|journey|story|history/.test(key)) return 'story';
  if (/about|who we|company|mission/.test(key)) return 'about';
  if (/college|institution|campus|school|universit|branch|centre|center/.test(key)) return 'institutions';
  if (/gallery|photo|portfolio|work|project/.test(key)) return 'gallery';
  if (/service|menu|product|program|course|room|shop|offer|solution|feature|pricing/.test(key)) return 'services';
  if (/team|doctor|staff|people|faculty|leadership/.test(key)) return 'team';
  if (/contact|reach|visit|location/.test(key)) return 'contact';
  if (/blog|news|article|event/.test(key)) return 'news';
  return 'generic';
}

/** "with home, life and legacy, achievements, colleges, about and contact pages" -> the page names the request lists. */
function requestedPageNames(prompt = '') {
  const match = /\b(?:with|including|containing|featuring|pages?\s*(?:for|:)?)\s+((?:[a-z&' -]{2,30}?,\s*){1,9}[a-z&' -]{2,30}?)\s+pages?\b/i.exec(String(prompt).replace(/\s+/g, ' '));
  if (!match) return [];
  const parts = match[1].split(',').map((part) => part.trim()).filter(Boolean);
  const last = parts.pop() || '';
  const tail = /^(.*?)\s+and\s+(.*)$/i.exec(last);
  const names = tail ? [...parts, tail[1], tail[2]] : [...parts, last];
  return [...new Set(names.map((name) => name.replace(/^and\s+/i, '').replace(/\s+/g, ' ').trim()).filter((name) => name && name.length <= 28))].slice(0, 8);
}

function heuristicPlan({ prompt, spec = null, entities = [], cfg = imageConfig() }) {
  const industry = requirementsModule.detectIndustry(prompt, spec);
  const listed = requestedPageNames(prompt);
  const pages = listed.length >= 2
    ? listed.map((name) => { const title = name.split(' ').map((word, i) => (i > 0 && /^(and|of|the|&)$/i.test(word) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(' '); return { name: title, route: /^home$/i.test(name) ? '/' : `/${slug(name)}`, purpose: '' }; })
    : requirementsModule.pagesFor(prompt, spec, industry);
  const subject = requirementsModule.promptSubject(prompt) || industry.subject;
  const need = (query, extra = {}) => ({ role: 'photo', query, alt: '', entity: '', fallbackQuery: '', ...extra });
  const person = entities.find((entity) => entity.type === 'person');
  const orgs = entities.filter((entity) => entity.type !== 'person');
  const sec = (id, layout, heading, summary, words, images = [], extra = {}) => ({ id, layout, heading, summary, words, images, purpose: extra.purpose || summary, eyebrow: extra.eyebrow || '', facts: extra.facts || [] });
  const plan = { industry: industry.id, audience: '', tone: '', pages: pages.map((page) => {
    const kind = pageKind(page.name);
    const named = (entity, role = 'photo') => need(entity.name, { entity: entity.name, role, fallbackQuery: role === 'portrait' ? `${industry.subject} founder portrait historical` : `${industry.subject} campus building` });
    let sections;
    if (kind === 'home') {
      sections = [
        sec('hero', 'split-hero', `${subject} - welcome`, `Who ${subject} is and what a visitor can do here, with one clear action.`, 'short', [person ? named(person, 'portrait') : need(industry.hero)]),
        sec('highlights', 'three-column-cards', 'What we offer', 'Three to four parallel highlights with a short line each.', 'medium', industry.features.slice(0, 3).map((query) => need(query))),
        sec('story', 'editorial-image-right', 'Our story', 'A short introduction to the organisation or person and why it matters.', 'medium', [orgs[0] ? named(orgs[0]) : need(industry.about)]),
        ...((String(prompt).match(/\d+/g) || []).length >= 2 ? [sec('numbers', 'statistics', 'In numbers', 'Three or four headline facts taken from the request only.', 'brief')] : []),
        sec('cta', 'cta-band', 'Get in touch', 'One sentence inviting the visitor to act.', 'brief')
      ];
    } else if (kind === 'story') {
      sections = [
        sec('intro', 'page-intro', page.name, 'A short opening that frames the story.', 'short'),
        sec('origin', 'editorial-image-right', 'Where it began', 'Early life and background, as far as the request states it.', 'medium', [person ? named(person, 'portrait') : need(industry.about)]),
        sec('milestones', 'timeline', 'Milestones', 'Dated milestones in order, one or two sentences each.', 'long', [need(industry.gallery[0])]),
        sec('values', 'two-column', 'Guiding values', 'What this person or organisation stands for.', 'medium'),
        sec('cta', 'cta-band', 'Continue', 'Point to the next page.', 'brief')
      ];
    } else if (kind === 'achievements') {
      sections = [
        sec('intro', 'page-intro', page.name, 'A short overview of what has been achieved.', 'short'),
        sec('awards', 'achievement-grid', 'Awards and recognitions', 'Documented awards and honours with year and awarding body.', 'medium', [need(`${industry.subject} award ceremony`)]),
        sec('timeline', 'timeline', 'Along the way', 'Key institutional contributions in order.', 'long'),
        sec('photos', 'gallery', 'In pictures', 'Photographs that document these moments.', 'brief', industry.gallery.slice(0, 3).map((query) => need(query)))
      ];
    } else if (kind === 'institutions') {
      sections = [
        sec('intro', 'page-intro', page.name, 'What these institutions are and how they relate.', 'short'),
        sec('institutions', 'three-column-cards', 'Our institutions', 'One card per institution: name, what it offers, where it is.', 'medium', (orgs.length ? orgs.slice(0, 4).map((entity) => named(entity)) : industry.features.slice(0, 3).map((query) => need(query)))),
        sec('campus', 'editorial-image-left', 'Campus life', 'What studying or visiting there is like.', 'medium', [need(industry.about)])
      ];
    } else if (kind === 'about') {
      sections = [
        sec('intro', 'page-intro', page.name, 'A short statement of who we are.', 'short'),
        sec('who', 'editorial-image-left', 'Who we are', 'Background, mission and what makes this different.', 'medium', [need(industry.about)]),
        sec('values', 'three-column-cards', 'What we stand for', 'Three values with one sentence each.', 'short'),
        sec('people', 'profile', person ? person.name : 'The people behind it', 'A short profile of the key person or team.', 'medium', [person ? named(person, 'portrait') : need(industry.team, { role: 'portrait' })])
      ];
    } else if (kind === 'gallery') {
      sections = [sec('intro', 'page-intro', page.name, 'One sentence about what the gallery shows.', 'brief'), sec('grid', 'gallery', 'Gallery', 'A grid of photographs with short captions.', 'brief', industry.gallery.concat(industry.features).slice(0, 6).map((query) => need(query)))];
    } else if (kind === 'services') {
      sections = [
        sec('intro', 'page-intro', page.name, 'What is offered and for whom.', 'short'),
        sec('offer', 'three-column-cards', page.name, 'The main offerings, one card each.', 'medium', industry.service.slice(0, 3).map((query) => need(query))),
        sec('detail', 'two-column', 'How it works', 'The process or what is included, in plain steps.', 'medium'),
        sec('cta', 'cta-band', 'Ready to start?', 'One sentence and a button.', 'brief')
      ];
    } else if (kind === 'team') {
      sections = [sec('intro', 'page-intro', page.name, 'Who the people are.', 'brief'), sec('people', 'three-column-cards', 'Meet the team', 'One card per person: name, role, a line.', 'medium', [need(industry.team, { role: 'portrait' })])];
    } else if (kind === 'contact') {
      sections = [sec('intro', 'page-intro', page.name, 'How to reach us.', 'brief'), sec('contact', 'contact-split', 'Send a message', 'A form beside the address, phone, email and hours.', 'short')];
    } else if (kind === 'news') {
      sections = [sec('intro', 'page-intro', page.name, 'Latest updates.', 'brief'), sec('posts', 'three-column-cards', 'Latest', 'Cards for the newest items.', 'medium', industry.features.slice(0, 3).map((query) => need(query)))];
    } else {
      sections = [sec('intro', 'page-intro', page.name, 'What this page covers.', 'short'), sec('main', 'editorial-image-right', page.name, page.purpose || 'The main content of this page.', 'medium', [need(industry.about)]), sec('cta', 'cta-band', 'Next step', 'One sentence and a button.', 'brief')];
    }
    return { id: slug(page.name), name: page.name, route: page.route, purpose: page.purpose || '', sections };
  }) };
  // The deterministic plan only stands where the request names the content: never invent a statistics row from nothing.
  return normalizePlan(plan, { entities }) || { industry: industry.id, audience: '', tone: '', pages: [] };
}

/* ------------------------------------------------------------------ model plan ------------------------------------------------------------------ */

const LAYOUT_IDS = Object.keys(LAYOUTS).join(' | ');
const PLAN_SYSTEM = `You are a senior UI/UX designer and information architect. Plan a website BEFORE it is built. Reply with ONLY JSON, no prose:
{"industry": string, "audience": string, "tone": string, "pages": [{"id": string, "name": string, "route": string, "purpose": string, "sections": [{"id": string, "purpose": string, "eyebrow": string, "heading": string, "summary": string, "facts": [string], "words": "brief"|"short"|"medium"|"long", "layout": ${LAYOUT_IDS}, "images": [{"role": "portrait"|"photo"|"logo"|"document", "query": string, "alt": string, "entity": string, "fallbackQuery": string}]}]}]}
RULES: 3 to 7 pages, each with 2 to 7 sections in the order a visitor reads them. Every section has ONE purpose; never two sections that say the same thing. Choose the layout from what the content IS (a person -> profile; dated milestones -> timeline; awards -> achievement-grid; parallel offerings -> three-column-cards; a story with a supporting photograph -> editorial-image-left/right; headline numbers -> statistics) and vary layouts so the page has rhythm; the first section of Home is a hero, the first section of other pages is page-intro or a hero. "summary" says what the section tells the reader, using ONLY facts present in the request: never invent awards, dates, numbers, names or quotations; when the request gives little, plan fewer, shorter sections (words "brief"/"short") instead of padding. "facts" lists the concrete facts from the request that belong in that section. "words" is how much text the section carries. "images": 0 to the layout's limit; "query" is a concrete 3-7 word stock-photography search for a REAL photograph (setting, subject, style); when a picture must show a NAMED person, institution, product or place from the request, put its exact name in "entity" and give a "fallbackQuery" for a relevant generic photograph that does NOT claim to be that named subject (for example a campus, a historical scene). "alt" is a meaningful sentence. Never use a logo or illustration as a content picture.`;

async function buildCompositionPlan({ prompt, spec = null, ask = null, entities = [], cfg = imageConfig() } = {}) {
  if (ask) {
    try {
      const entityLine = entities.length ? `\nNamed subjects in the request: ${entities.map((e) => `${e.name} (${e.type}${e.role ? `, ${e.role}` : ''})`).join('; ')}.` : '';
      const pagesLine = spec?.pages?.length ? `\nPlanned pages: ${spec.pages.map((p) => `${p.name} (${p.route}) ${p.purpose || ''}`).join('; ')}.` : '';
      const raw = await ask(PLAN_SYSTEM, `Website request:\n${String(prompt || '').slice(0, 4000)}${entityLine}${pagesLine}`);
      const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
      const plan = normalizePlan(json ? JSON.parse(json) : null, { entities });
      if (plan && plan.pages.length >= 2) return { ...plan, source: 'model' };
    } catch { /* the deterministic plan is always available */ }
  }
  return { ...heuristicPlan({ prompt, spec, entities, cfg }), source: 'heuristic' };
}

/* ------------------------------------------------------------------ plan -> image requirements ------------------------------------------------------------------ */

const CATEGORY_FOR_LAYOUT = { 'split-hero': 'hero', 'full-width-hero': 'hero', 'page-intro': 'about', 'editorial-image-right': 'about', 'editorial-image-left': 'about', 'alternating-editorial': 'about', 'three-column-cards': 'feature', 'achievement-grid': 'feature', timeline: 'feature', gallery: 'gallery', profile: 'team', testimonial: 'team', 'contact-split': 'about' };
const ASPECT_FOR_LAYOUT = { 'split-hero': '4/3', 'full-width-hero': '21/9', 'page-intro': '16/9', 'editorial-image-right': '4/3', 'editorial-image-left': '4/3', 'alternating-editorial': '4/3', 'three-column-cards': '4/3', 'achievement-grid': '4/3', timeline: '4/3', gallery: '1/1', profile: '4/5', testimonial: '1/1' };

const nameTokens = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
const withoutName = (text, name) => {
  let out = String(text || '');
  for (const token of String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) out = out.replace(new RegExp(`\\b${token}\\b\\.?`, 'ig'), ' ');
  return out.replace(/\s+/g, ' ').replace(/\b(of|for|with|by|from|and)\s*[.,]?\s*$/i, '').trim();
};

/**
 * One picture requirement per section picture need. A need that names a person or institution is NOT searched as a stock photo:
 * when verified pictures of that name exist they are used (and listed in the prompt); when none exist a generic relevant photograph
 * is searched with a query and alt text that never claim to show the named subject.
 */
function requirementsFromComposition(plan, { entityAssets = [], cfg = imageConfig() } = {}) {
  const requirements = [];
  for (const page of plan.pages) {
    page.sections.forEach((section) => {
      section.images.forEach((need, index) => {
        const named = need.entity && entityAssets.some((asset) => String(asset.entity).toLowerCase() === need.entity.toLowerCase());
        if (named) { need.verified = true; return; }
        const generic = Boolean(need.entity);
        const query = generic ? (need.fallbackQuery || withoutName(need.query, need.entity) || `${plan.industry} photograph`) : need.query;
        if (!query || query.split(' ').length < 2) return;
        const category = need.role === 'portrait' ? 'team' : (index === 0 ? (CATEGORY_FOR_LAYOUT[section.layout] || 'feature') : (CATEGORY_FOR_LAYOUT[section.layout] === 'hero' ? 'feature' : (CATEGORY_FOR_LAYOUT[section.layout] || 'feature')));
        let alt = generic ? withoutName(need.alt || query, need.entity) : (need.alt || query);
        if (generic && alt.length < 14) alt = `${query[0].toUpperCase()}${query.slice(1)}`;
        const req = requirementsModule.baseSlot({ name: page.name, route: page.route }, `${section.id}-0${index + 1}`, category, query, { section: section.heading || section.id, altHint: alt, alternates: [] });
        requirements.push({ ...req, aspect: (ASPECT_FOR_LAYOUT[section.layout] || req.aspect), orientation: need.role === 'portrait' || section.layout === 'profile' ? 'portrait' : (section.layout === 'gallery' ? 'any' : 'landscape'), hero: section.layout === 'split-hero' && index === 0, sectionId: section.id, layout: section.layout, generic, entity: need.entity || '' });
        need.slot = req.slot;
      });
    });
  }
  // The validation floor still holds: a plan that would leave the site short of pictures gets more slots from the industry list.
  return requirements.slice(0, cfg.maxAssets);
}

/** Keeps the picture floor: when the plan alone would leave fewer pictures than the site needs, relevant extras are added for the pages that have none. */
function topUpRequirements(requirements, { prompt, spec = null, plan = null, cfg = imageConfig() } = {}) {
  const need = cfg.minSite + 2 - requirements.length;
  if (need <= 0) return requirements;
  const have = new Set(requirements.map((item) => item.query));
  const pool = requirementsModule.heuristicRequirements({ prompt, spec, cfg }).requirements.filter((item) => !have.has(item.query));
  const pages = plan?.pages?.length ? plan.pages : [];
  const extras = pool.slice(0, need).map((item, index) => {
    const page = pages.length ? pages[(index + 1) % pages.length] : null;
    return { ...item, slot: `${page ? slug(page.name) : slug(item.page)}-extra-0${index + 1}`, page: page ? page.name : item.page, route: page ? page.route : item.route, sectionId: null, section: 'Gallery', category: 'gallery', orientation: 'landscape' };
  });
  return [...requirements, ...extras].slice(0, cfg.maxAssets + 2);
}

/* ------------------------------------------------------------------ prompt ------------------------------------------------------------------ */

const classesLine = (key, group) => `${key}: ${group[key]}`;

function buildPromptBlock(plan, { assets = [], entityAssets = [] } = {}) {
  if (!plan?.pages?.length) return '';
  const lines = ['PAGE COMPOSITION PLAN (decided before coding; build exactly this, and never print or mention the plan in the site). This plan OVERRIDES every section-count or word-count target elsewhere in this prompt: build these sections, write only what the facts of the request support, and never add filler, invented facts or repeated text to reach a length.'];
  const used = new Set();
  for (const page of plan.pages) {
    lines.push(`\n${page.name} (${page.route})${page.purpose ? ` - ${page.purpose}` : ''}`);
    const extra = assets.filter((asset) => asset.route === page.route && !page.sections.some((section) => section.id === asset.sectionId));
    page.sections.forEach((section, index) => {
      used.add(section.layout);
      const mine = assets.filter((asset) => asset.sectionId === section.id && asset.route === page.route);
      const pictures = [];
      for (const need of section.images) {
        if (need.entity) {
          const verified = entityAssets.filter((asset) => String(asset.entity).toLowerCase() === need.entity.toLowerCase());
          if (verified.length) pictures.push(`VERIFIED picture of ${need.entity}: ${verified[0].url} (use only this one for this name)`);
        }
      }
      for (const asset of mine) pictures.push(`${asset.publicPath} alt="${asset.alt}"${asset.generic ? ' (generic photograph: do not caption it as a named person or place)' : ''}`);
      const unmet = section.images.filter((need) => need.entity && !entityAssets.some((asset) => String(asset.entity).toLowerCase() === need.entity.toLowerCase()) && !mine.some((asset) => asset.generic));
      const density = section.density ? `; density ${section.density.state}` : '';
      lines.push(`${index + 1}. [${section.id}] layout=${section.layout}; spacing=${section.spacing}; width=${section.width}; ~${CONTENT_LENGTH[section.words] ?? 70} words${density}`
        + `\n   purpose: ${section.purpose}${section.eyebrow ? `\n   eyebrow: "${section.eyebrow}"` : ''}${section.heading ? `\n   ${plan.source === 'heuristic' ? 'working title (write a real, specific heading from the request)' : 'heading'}: "${section.heading}"` : ''}`
        + `${section.summary ? `\n   says: ${section.summary}` : ''}${section.facts.length ? `\n   facts to use: ${section.facts.join(' | ')}` : ''}`
        + `${pictures.length ? `\n   pictures: ${pictures.join(' ; ')}` : (section.images.length ? '\n   pictures: none could be verified; lay the section out without a picture slot' : '')}`
        + `${unmet.length ? `\n   no verified picture of ${unmet.map((need) => need.entity).join(', ')} exists: never show anyone else's face under that name` : ''}`
        + `${section.breakUp ? '\n   long content: break it into short sub-headed paragraphs, a list or columns' : ''}`);
    });
    if (extra.length) lines.push(`   additional pictures for this page (use in a gallery or card row where they fit): ${extra.map((asset) => `${asset.publicPath} alt="${asset.alt}"`).join(' ; ')}`);
  }
  lines.push('\nLAYOUT PATTERNS USED:');
  for (const id of used) lines.push(`- ${id}: ${LAYOUTS[id].build} (mobile: ${LAYOUTS[id].mobile})`);
  lines.push(`
SPACING AND TYPE SYSTEM (use these exact Tailwind classes; do not invent other section spacing):
- Containers: wide "${TOKENS.container.wide}", standard "${TOKENS.container.standard}", narrow "${TOKENS.container.narrow}". Prose text never wider than ${TOKENS.prose} (about 68 characters).
- Section padding: ${Object.keys(TOKENS.section).map((key) => classesLine(key, TOKENS.section)).join('; ')}. The spacing value in the plan picks one. Two related sections use "related"; a new topic uses "major".
- Inside a section: eyebrow to heading ${TOKENS.stack.eyebrowToHeading}; heading to paragraph ${TOKENS.stack.headingToParagraph}; between paragraphs ${TOKENS.stack.paragraphs}; paragraph to the next block ${TOKENS.stack.paragraphToNext}; card padding ${TOKENS.stack.cardPadding}; grids ${TOKENS.stack.grid}.
- Type: ${Object.keys(TOKENS.type).map((key) => classesLine(key, TOKENS.type)).join('; ')}. One H1 per page; H2 per section; H3 inside cards and sub-sections. Do not mix other sizes or weights.
RULES:
- Section height comes from its content. Never use min-h-screen, h-screen, fixed pixel heights, 100vh, large arbitrary padding or empty spacer divs to make a section look bigger; a hero is content-sized. The only large space on a page is the space the spacing system gives.
- Place text and its picture next to each other in the layout the plan names; do not stack a full-width picture between two paragraphs unless the layout is full-width-hero or a documented gallery.
- Pictures use an aspect-ratio frame (aspect-[4/3] and similar) with w-full object-cover, never a fixed height in pixels, and must be proportionate to the text beside them (a picture beside 40 words is small; it never fills the viewport).
- Use only facts from the request. Do not write filler to lengthen a page; a short section stays short. Do not repeat the same sentence or fact in two sections.
- Break long copy into paragraphs of 2-4 sentences; use bullet lists for 3+ parallel items; show dates and numbers as structure (timeline, statistics, cards), not as sentences buried in a paragraph.
- Mobile is designed on its own: single column, picture after the text unless the plan says otherwise, smaller headings, the same spacing tokens, no horizontal scrolling.`);
  return lines.join('\n');
}

module.exports = { topUpRequirements, requestedPageNames, buildCompositionPlan, heuristicPlan, normalizePlan, estimateDensity, rebalance, requirementsFromComposition, buildPromptBlock, pageKind, ensureEntityCoverage, PLAN_SYSTEM };
