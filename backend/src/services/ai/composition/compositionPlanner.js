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
    summary: clean(raw?.summary, 420), facts: (Array.isArray(raw?.facts) ? raw.facts : []).map((fact) => clean(fact, 220)).filter(Boolean).slice(0, 10), factIds: (Array.isArray(raw?.factIds) ? raw.factIds : []).map(Number).filter(Number.isInteger).slice(0, 12),
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
  const subject = entities.find((entity) => entity.type === 'person')?.name || entities[0]?.name || requirementsModule.promptSubject(prompt) || industry.subject;
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
        sec('hero', 'split-hero', `${subject} - welcome`, `Introduce ${subject} and what a visitor finds on this site, with one clear action.`, 'short', [person ? named(person, 'portrait') : need(industry.hero)]),
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
{"industry": string, "audience": string, "tone": string, "pages": [{"id": string, "name": string, "route": string, "purpose": string, "sections": [{"id": string, "purpose": string, "eyebrow": string, "heading": string, "summary": string, "factIds": [number], "words": "brief"|"short"|"medium"|"long", "layout": ${LAYOUT_IDS}, "images": [{"role": "portrait"|"photo"|"logo"|"document", "query": string, "alt": string, "entity": string, "fallbackQuery": string}]}]}]}
RULES: 3 to 7 pages, each with 2 to 7 sections in the order a visitor reads them. Every section has ONE purpose; never two sections that say the same thing. Choose the layout from what the content IS (a person -> profile; dated milestones -> timeline; awards -> achievement-grid; parallel offerings -> three-column-cards; a story with a supporting photograph -> editorial-image-left/right; headline numbers -> statistics) and vary layouts so the page has rhythm; the first section of Home is a hero, the first section of other pages is page-intro or a hero. "summary" says what the section tells the reader, using ONLY facts present in the request: never invent awards, dates, numbers, names or quotations; when the request gives little, plan fewer, shorter sections (words "brief"/"short") instead of padding. "factIds" lists the numbers of the researched facts (when the request includes a numbered list) that belong in that section; use a fact in ONE section only. "words" is how much text the section carries. "images": 0 to the layout's limit; "query" is a concrete 3-7 word stock-photography search for a REAL photograph (setting, subject, style); when a picture must show a NAMED person, institution, product or place from the request, put its exact name in "entity" and give a "fallbackQuery" for a relevant generic photograph that does NOT claim to be that named subject (for example a campus, a historical scene). "alt" is a meaningful sentence. Never use a logo or illustration as a content picture.`;

const factList = (dossier) => (dossier?.subjects || []).flatMap((subject) => subject.facts.map((fact) => ({ ...fact, subject: subject.name }))).map((fact, index) => ({ ...fact, n: index + 1 }));

async function buildCompositionPlan({ prompt, spec = null, ask = null, entities = [], dossier = null, cfg = imageConfig() } = {}) {
  const facts = factList(dossier);
  if (ask) {
    try {
      const entityLine = entities.length ? `\nNamed subjects in the request: ${entities.map((e) => `${e.name} (${e.type}${e.role ? `, ${e.role}` : ''})`).join('; ')}.` : '';
      const pagesLine = spec?.pages?.length ? `\nPlanned pages: ${spec.pages.map((p) => `${p.name} (${p.route}) ${p.purpose || ''}`).join('; ')}.` : '';
      const factLine = facts.length ? `\nResearched facts (numbered; use their numbers in "factIds"):\n${facts.slice(0, 48).map((fact) => `${fact.n}. [${fact.category}${fact.date ? `, ${fact.date}` : ''}] ${fact.text}`).join('\n')}` : '';
      const raw = await ask(PLAN_SYSTEM, `Website request:\n${String(prompt || '').slice(0, 4000)}${entityLine}${pagesLine}${factLine}`);
      const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
      const plan = normalizePlan(json ? JSON.parse(json) : null, { entities });
      if (plan && plan.pages.length >= 2) return finishPlan({ ...plan, source: 'model' }, { facts, entities });
    } catch { /* the deterministic plan is always available */ }
  }
  return finishPlan({ ...heuristicPlan({ prompt, spec, entities, cfg }), source: 'heuristic' }, { facts, entities });
}

/* ------------------------------------------------------------------ researched facts ------------------------------------------------------------------ */

const FACT_HOME = [
  [/timeline/, ['milestone', 'career', 'education', 'biography', 'award'], 8, true],
  [/achievement-grid/, ['award', 'milestone', 'contribution'], 6, false],
  [/profile|editorial|alternating|two-column|text-block|full-width-hero|split-hero/, ['biography', 'education', 'career', 'contribution', 'other'], 4, false],
  [/three-column-cards/, ['institution', 'contribution', 'career', 'award'], 4, false]
];
const yearOf = (fact) => Number(String(fact.date || '').match(/\d{4}/)?.[0]) || 9999;

/**
 * Gives each section the researched facts that belong in it (by what the section is for), once each, and removes or demotes sections
 * that need facts the research did not find. A page never gets a timeline with one entry or an achievements grid with nothing to show.
 */
function distributeFacts(plan, facts) {
  if (!facts.length) return plan;
  const free = new Set(facts.map((fact) => fact.n));
  const claim = (categories, limit, dated) => {
    const pool = facts.filter((fact) => free.has(fact.n) && categories.includes(fact.category) && (!dated || fact.date));
    pool.sort((a, b) => (dated ? yearOf(a) - yearOf(b) : categories.indexOf(a.category) - categories.indexOf(b.category)));
    const chosen = pool.slice(0, limit);
    chosen.forEach((fact) => free.delete(fact.n));
    return chosen;
  };
  for (const section of plan.pages.flatMap((page) => page.sections)) {
    for (const id of section.factIds || []) { const fact = facts.find((item) => item.n === id); if (fact && free.has(id)) { section.facts.push(fact.text); free.delete(id); } }
  }
  const kindOf = (page, section) => `${page.name} ${section.purpose} ${section.heading}`.toLowerCase();
  // The pages that exist for facts (achievements, biography, institutions) choose first; the home page takes a little of what is left.
  const priority = (page) => ({ achievements: 0, story: 1, about: 1, institutions: 2, team: 3, home: 9 }[pageKind(page.name)] ?? 5);
  for (const page of [...plan.pages].sort((a, b) => priority(a) - priority(b))) {
    const home = pageKind(page.name) === 'home';
    for (const section of page.sections) {
      if (section.facts.length >= 2 || /cta-band|contact-split|faq-list|gallery|page-intro/.test(section.layout)) continue;
      const rule = FACT_HOME.find(([pattern]) => pattern.test(section.layout));
      if (!rule) continue;
      let categories = rule[1];
      if (/achiev|award/.test(kindOf(page, section))) categories = ['award', 'milestone', 'contribution', 'career'];
      else if (/college|institution|campus/.test(kindOf(page, section))) categories = ['institution', 'milestone', 'contribution'];
      else if (/life|legacy|bio|story|about|who/.test(kindOf(page, section))) categories = ['biography', 'education', 'career', 'milestone'];
      const mine = claim(categories, home ? 2 : rule[2], rule[3]);
      section.facts.push(...mine.map((fact) => `${fact.date ? `${fact.date}: ` : ''}${fact.text}`));
    }
  }
  // Sections that exist to show facts and have none are dropped or demoted: never an empty timeline or award grid.
  for (const page of plan.pages) {
    page.sections = page.sections.filter((section) => {
      if (section.facts.length === 0 && /statistics|achievement-grid|timeline/.test(section.layout)) return false;
      if (section.layout === 'timeline' && section.facts.length < 3) section.layout = 'two-column';
      if (section.layout === 'achievement-grid' && section.facts.length < 2) section.layout = 'text-block';
      return true;
    });
    page.sections.forEach((section, index) => { section.order = index + 1; if (section.facts.length >= 6) section.words = 'long'; else if (section.facts.length >= 3 && section.words === 'brief') section.words = 'medium'; });
    page.sections = page.sections.map((section) => ({ ...section, density: estimateDensity(section) }));
  }
  plan.unusedFacts = facts.filter((fact) => free.has(fact.n)).length;
  return plan;
}

/** Picks the visual language for the subject (not one template for every site) and writes it as concrete instructions. */
const DIRECTIONS = {
  legacy: { name: 'editorial legacy', headings: 'a serif face (Tailwind font-serif) for H1/H2/H3 with tight tracking; sans-serif body', shape: 'square or slightly softened corners (rounded-none / rounded-sm / rounded-md), thin 1px rules and borders', palette: 'warm paper or off-white page, deep ink text, one restrained accent colour', rhythm: 'alternate the page background between the base and a subtly tinted band (bg-surface-2) every two sections, thin rules between related blocks', imagery: 'documentary photographs shown plainly with a caption, no overlays, tints or frames' },
  education: { name: 'academic editorial', headings: 'a serif face (font-serif) for headings, sans body', shape: 'rounded-md at most, 1px borders', palette: 'white or paper background with a deep institutional blue/green/maroon accent', rhythm: 'tinted bands to separate topics', imagery: 'real campus and event photographs in clean aspect-ratio frames' },
  healthcare: { name: 'calm and trustworthy', headings: 'clean sans-serif, medium weight', shape: 'rounded-lg, soft borders', palette: 'white and cool light tints with one teal/blue accent', rhythm: 'tinted bands for key information', imagery: 'bright, natural photographs of people and facilities' },
  technology: { name: 'precise product', headings: 'a modern sans-serif with strong weight contrast', shape: 'rounded-lg with fine borders, little decoration', palette: 'high-contrast neutral with one saturated accent; dark only when asked', rhythm: 'clear section separation by background and spacing', imagery: 'product and workplace photographs, UI screenshots only when real' },
  restaurant: { name: 'warm hospitality', headings: 'an expressive serif for headings, sans body', shape: 'soft rounded-lg images, generous radius only on images', palette: 'warm neutrals with a food-inspired accent', rhythm: 'full-bleed photograph bands between text sections', imagery: 'large, appetising close-ups' },
  fitness: { name: 'energetic and bold', headings: 'heavy condensed or bold sans-serif, uppercase for eyebrows', shape: 'sharp corners, strong contrast', palette: 'black/white with one vivid accent', rhythm: 'alternating dark and light bands', imagery: 'dynamic action photographs' },
  default: { name: 'clean professional', headings: 'a refined sans-serif; a serif only for large display headings', shape: 'rounded-md, 1px borders', palette: 'white with one accent colour from the brand or subject', rhythm: 'alternate base and tinted bands', imagery: 'real photographs in consistent aspect-ratio frames' }
};
function designDirectionFor(plan, entities = []) {
  const personal = entities.some((entity) => entity.type === 'person') && plan.pages.some((page) => /life|legacy|biograph|achiev|about/i.test(page.name));
  return DIRECTIONS[personal ? 'legacy' : plan.industry] || DIRECTIONS.default;
}

function finishPlan(plan, { facts, entities }) {
  distributeFacts(plan, facts);
  plan.design = designDirectionFor(plan, entities);
  return plan;
}

/**
 * Gives the verified pictures of named subjects their place in the plan: a portrait to the section that shows the person, the other
 * pictures to achievement, timeline and gallery sections; each picture to one section, the main portrait to at most two pages.
 */
function assignEntityAssets(plan, assets) {
  const used = new Map();
  const slotsFor = (matcher) => plan.pages.flatMap((page) => page.sections.filter((section) => matcher(page, section)).map((section) => ({ page, section })));
  const portraits = assets.filter((asset) => asset.pictureKind === 'portrait' || asset.category === 'team');
  const scenes = assets.filter((asset) => !portraits.includes(asset) && asset.pictureKind !== 'logo');
  const take = (asset, slot) => { asset.page = slot.page.name; asset.route = slot.page.route; asset.section = slot.section.heading || slot.section.id; asset.sectionId = slot.section.id; used.set(slot.section.id, (used.get(slot.section.id) || 0) + 1); };
  for (const asset of portraits) {
    const name = asset.entity.toLowerCase();
    const slots = [
      ...slotsFor((page, section) => section.images.some((need) => need.entity && need.entity.toLowerCase() === name && need.role === 'portrait')),
      ...slotsFor((page, section) => /split-hero|profile/.test(section.layout)),
      ...slotsFor((page, section) => /editorial/.test(section.layout))
    ].filter((slot) => !used.has(slot.section.id) && !portraits.some((other) => other !== asset && other.sectionId === slot.section.id));
    if (slots.length && !asset.sectionId) take(asset, slots[0]);
  }
  for (const asset of scenes) {
    const slots = [
      ...slotsFor((page, section) => /achievement-grid|timeline|gallery|alternating/.test(section.layout)),
      ...slotsFor((page, section) => /three-column-cards|editorial/.test(section.layout)),
      ...slotsFor((page, section) => section.images.some((need) => need.entity && need.entity.toLowerCase() === asset.entity.toLowerCase() && !/hero/.test(section.layout)))
    ].filter((slot) => (used.get(slot.section.id) || 0) < Math.max(1, LAYOUTS[slot.section.layout].images[1]));
    if (slots.length && !asset.sectionId) take(asset, slots[0]);
  }
  for (const asset of assets) if (!asset.sectionId) { const home = plan.pages[0]; asset.page = home.name; asset.route = home.route; asset.section = 'Gallery'; }
  return assets;
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
  const named = (entity) => [...entityAssets, ...assets.filter((asset) => asset.entity)].filter((asset) => String(asset.entity).toLowerCase() === String(entity).toLowerCase());
  const lines = ['PAGE COMPOSITION PLAN (decided before coding; build exactly this, and never print or mention the plan in the site). This plan OVERRIDES every section-count or word-count target elsewhere in this prompt: build these sections, write only what the facts of the request support, and never add filler, invented facts or repeated text to reach a length. The "brief" of a section is an instruction to YOU: never copy its wording into the page; write real, specific copy.'];
  if (plan.design) lines.push(`\nDESIGN DIRECTION (${plan.design.name}): headings: ${plan.design.headings}. Shapes: ${plan.design.shape}. Colour: ${plan.design.palette}. Rhythm: ${plan.design.rhythm}. Pictures: ${plan.design.imagery}. Do NOT use gradients, glassmorphism, blurred glass cards, neon glows, heavy drop shadows, pill-shaped everything or decorative blobs unless this direction asks for them; design decisions follow the subject, not a template.`);
  const used = new Set();
  for (const page of plan.pages) {
    lines.push(`\n${page.name} (${page.route})${page.purpose ? ` - ${page.purpose}` : ''}`);
    const extra = assets.filter((asset) => asset.route === page.route && !page.sections.some((section) => section.id === asset.sectionId));
    page.sections.forEach((section, index) => {
      used.add(section.layout);
      const mine = assets.filter((asset) => asset.sectionId === section.id && asset.route === page.route);
      const pictures = mine.map((asset) => (asset.entity
        ? `VERIFIED ${asset.pictureKind === 'portrait' ? 'portrait' : 'photograph'} of ${asset.entity}: ${asset.publicPath} alt="${asset.alt}" (identity ${asset.identity?.level || 'checked'}; shown here only)`
        : `${asset.publicPath} alt="${asset.alt}"${asset.generic ? ' (generic photograph: do not caption it as a named person or place)' : ''}`));
      const unmet = section.images.filter((need) => need.entity && !named(need.entity).length && !mine.some((asset) => asset.generic));
      const density = section.density && section.density.state !== 'balanced' ? `; density ${section.density.state}` : '';
      lines.push(`${index + 1}. [${section.id}] layout=${section.layout}; spacing=${section.spacing}; width=${section.width}; ~${CONTENT_LENGTH[section.words] ?? 70} words${density}`
        + `\n   brief (instruction, not copy): ${section.summary && section.summary !== section.purpose ? `${section.purpose} ${section.summary}` : section.purpose}${section.eyebrow ? `\n   eyebrow: "${section.eyebrow}"` : ''}${section.heading ? `\n   ${plan.source === 'heuristic' ? 'working title (write a real, specific heading)' : 'heading'}: "${section.heading}"` : ''}`
        + `${section.facts.length ? `\n   facts to write from (in your own words):\n     - ${section.facts.join('\n     - ')}` : ''}`
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
- Containers: wide "${TOKENS.container.wide}", standard "${TOKENS.container.standard}", narrow "${TOKENS.container.narrow}". Long paragraphs never wider than ${TOKENS.prose} (about 68 characters), but pictures, galleries and card grids use the wide container, so the page uses the screen width: put text beside a picture or in columns instead of one narrow column in the middle of an empty page.
- Section padding: ${Object.keys(TOKENS.section).map((key) => classesLine(key, TOKENS.section)).join('; ')}. The spacing value in the plan picks one. Two related sections use "related"; a new topic uses "major".
- Inside a section: eyebrow to heading ${TOKENS.stack.eyebrowToHeading}; heading to paragraph ${TOKENS.stack.headingToParagraph}; between paragraphs ${TOKENS.stack.paragraphs}; paragraph to the next block ${TOKENS.stack.paragraphToNext}; card padding ${TOKENS.stack.cardPadding}; grids ${TOKENS.stack.grid}.
- Type: ${Object.keys(TOKENS.type).map((key) => classesLine(key, TOKENS.type)).join('; ')}. One H1 per page; H2 per section; H3 inside cards and sub-sections. Do not mix other sizes or weights.
RULES:
- Section height comes from its content. Never use min-h-screen, h-screen, fixed pixel heights, 100vh, large arbitrary padding or empty spacer divs to make a section look bigger; a hero is content-sized. The only large space on a page is the space the spacing system gives. The page scrolls normally: no overflow-hidden or fixed height on html, body, #root or the app wrapper.
- Place text and its picture next to each other in the layout the plan names; do not stack a full-width picture between two paragraphs unless the layout is full-width-hero or a documented gallery.
- Pictures use an aspect-ratio frame (aspect-[4/3] and similar) with w-full object-cover, never a fixed height in pixels, and must be proportionate to the text beside them (a picture beside 40 words is small; it never fills the viewport).
- Use only facts from the request and the researched facts. Do not write filler to lengthen a page; a short section stays short. Do not repeat the same sentence or fact in two sections. Never write placeholder or instruction text ("to be added", "coming soon", "a record still to be detailed", "build the story from verified facts", "details to follow"); a section that has nothing to say is not built.
- A named person's portrait appears once on a page and on at most two pages of the site (the home page and the biography/about page); every other section uses its own different picture.
- Break long copy into paragraphs of 2-4 sentences; use bullet lists for 3+ parallel items; show dates and numbers as structure (timeline, statistics, cards), not as sentences buried in a paragraph.
- Mobile is designed on its own: single column, picture after the text unless the plan says otherwise, smaller headings, the same spacing tokens, no horizontal scrolling.`);
  return lines.join('\n');
}

module.exports = { assignEntityAssets, distributeFacts, designDirectionFor, factList, topUpRequirements, requestedPageNames, buildCompositionPlan, heuristicPlan, normalizePlan, estimateDensity, rebalance, requirementsFromComposition, buildPromptBlock, pageKind, ensureEntityCoverage, PLAN_SYSTEM };
