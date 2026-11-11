/**
 * Turns the website request into an image requirement manifest: which pictures the site needs, for which page and section,
 * what each must show, and how it will be framed. The model plan (when available) is preferred; a deterministic plan built
 * from the request's industry is the fallback, so discovery never depends on the model being reachable.
 */
const { imageConfig } = require('./imageConfig');

const INDUSTRIES = [
  { id: 'restaurant', match: /\b(restaurant|cafe|café|coffee|bistro|bakery|bar\b|pub\b|diner|catering|menu|chef|pizzeria|food)\b/i, subject: 'restaurant',
    hero: 'restaurant interior warm lighting', features: ['plated gourmet dish close up', 'chef cooking in professional kitchen', 'friendly dining experience guests table'],
    about: 'restaurant dining room interior', team: 'chefs team restaurant kitchen', service: ['pasta dish served', 'fresh dessert plated', 'cocktail drink bar'], gallery: ['fresh ingredients market', 'restaurant table setting', 'bakery bread fresh'] },
  { id: 'technology', match: /\b(software|saas|tech|technology|startup|ai\b|artificial intelligence|app\b|platform|cloud|cyber|it services|developer|data|analytics|digital agency|web agency)\b/i, subject: 'technology company',
    hero: 'modern technology office team laptops', features: ['developer coding on laptop', 'data analytics dashboard on monitor', 'team collaboration meeting office'],
    about: 'software team working together office', team: 'diverse tech team portrait office', service: ['cloud servers data center', 'mobile app development smartphone', 'cybersecurity digital technology'], gallery: ['startup workspace', 'engineers brainstorming whiteboard', 'modern computer workstation'] },
  { id: 'architecture', match: /\b(architect|architecture|interior design|interior designer|construction|real estate|property|realtor|builder|home design|renovation|furniture)\b/i, subject: 'architecture and interiors',
    hero: 'modern architecture residential building exterior', features: ['modern living room interior design', 'architect reviewing building plans', 'contemporary kitchen interior'],
    about: 'architecture studio team working', team: 'architects team portrait studio', service: ['modern house exterior', 'commercial building glass facade', 'bedroom interior design minimal'], gallery: ['staircase architecture detail', 'luxury home interior', 'urban skyline buildings'] },
  { id: 'education', match: /\b(school|college|university|education|academy|institute|course|learning|student|tuition|campus|training)\b/i, subject: 'education',
    hero: 'university campus students walking', features: ['students studying in library', 'classroom teacher lesson', 'graduation ceremony students'],
    about: 'school building campus', team: 'teachers faculty group portrait', service: ['science laboratory students', 'students group discussion', 'computer lab learning'], gallery: ['campus garden students', 'sports ground school', 'students reading books'] },
  { id: 'healthcare', match: /\b(clinic|hospital|health|medical|dental|dentist|doctor|pharmacy|therapy|wellness|care|physio|cardio)\b/i, subject: 'healthcare',
    hero: 'modern hospital doctor patient care', features: ['doctor consultation patient', 'medical team hospital corridor', 'dental clinic treatment room'],
    about: 'modern clinic reception interior', team: 'doctors team portrait hospital', service: ['physiotherapy session', 'laboratory medical tests', 'nurse caring for patient'], gallery: ['modern medical equipment', 'healthy lifestyle wellness', 'pharmacy shelves'] },
  { id: 'fitness', match: /\b(gym|fitness|yoga|pilates|crossfit|personal trainer|sports club|workout)\b/i, subject: 'fitness',
    hero: 'modern gym interior weights', features: ['personal trainer coaching client', 'group fitness class', 'yoga studio session'],
    about: 'fitness studio interior', team: 'fitness trainers team portrait', service: ['strength training barbell', 'cardio treadmill gym', 'stretching yoga mat'], gallery: ['gym equipment dumbbells', 'running outdoors athlete', 'healthy meal prep'] },
  { id: 'travel', match: /\b(travel|tour|tourism|hotel|resort|holiday|vacation|trip|hostel|villa|beach)\b/i, subject: 'travel and hospitality',
    hero: 'tropical beach resort sunset', features: ['luxury hotel room interior', 'tourists exploring old town', 'infinity pool resort'],
    about: 'hotel lobby interior', team: 'hotel staff reception smiling', service: ['scenic mountain landscape travel', 'city sightseeing tour', 'local food street market'], gallery: ['sunset ocean view', 'adventure hiking trail', 'cultural heritage landmark'] },
  { id: 'ecommerce', match: /\b(shop|store|ecommerce|e-commerce|fashion|clothing|boutique|jewel|retail|marketplace|products?\b|apparel|cosmetic|beauty)\b/i, subject: 'retail products',
    hero: 'fashion store clothing display', features: ['product photography minimal background', 'shopping customer boutique', 'packaged products shelf'],
    about: 'boutique store interior', team: 'retail team portrait store', service: ['clothing rack fashion', 'accessories flat lay', 'skincare products arranged'], gallery: ['shoes product display', 'handbag product photo', 'jewelry close up'] },
  { id: 'portfolio', match: /\b(portfolio|photographer|photography|designer|freelance|artist|creative studio|illustrator|videographer)\b/i, subject: 'creative portfolio',
    hero: 'creative workspace designer desk', features: ['photographer with camera', 'graphic design sketches desk', 'art studio creative process'],
    about: 'creative studio workspace', team: 'creative professional portrait', service: ['branding design mockup desk', 'photo shoot studio lighting', 'video production camera'], gallery: ['abstract art painting', 'urban street photography', 'design inspiration moodboard'] },
  { id: 'business', match: /\b(law|legal|lawyer|attorney|finance|financial|consult|consulting|accounting|insurance|bank|investment|corporate|business|agency|marketing|logistics)\b/i, subject: 'professional services',
    hero: 'professional business team office meeting', features: ['consultant presenting strategy', 'business handshake partnership', 'financial planning documents desk'],
    about: 'corporate office building', team: 'business executives team portrait', service: ['business meeting boardroom', 'laptop analytics report', 'client advisory discussion'], gallery: ['city business district', 'modern office workspace', 'team brainstorming'] },
  { id: 'nonprofit', match: /\b(ngo|charity|nonprofit|non-profit|foundation|donat|volunteer|community|church|temple|mosque)\b/i, subject: 'community and nonprofit',
    hero: 'volunteers helping community', features: ['volunteers packing food donations', 'children learning community center', 'community event gathering'],
    about: 'community center people', team: 'volunteers group portrait', service: ['clean water project', 'education support children', 'healthcare camp volunteers'], gallery: ['charity event', 'tree planting volunteers', 'community cleanup'] },
  { id: 'event', match: /\b(event|conference|summit|festival|wedding|concert|meetup|expo|seminar|workshop)\b/i, subject: 'events',
    hero: 'conference audience stage speaker', features: ['keynote speaker on stage', 'networking attendees conference', 'event hall seating'],
    about: 'event organizers team', team: 'speaker portrait professional', service: ['workshop session attendees', 'exhibition booth visitors', 'panel discussion stage'], gallery: ['festival crowd lights', 'wedding venue decoration', 'concert stage lights'] },
  { id: 'agriculture', match: /\b(farm|agriculture|organic|garden|nursery|plantation|dairy|harvest)\b/i, subject: 'agriculture',
    hero: 'green farm field sunrise', features: ['farmer harvesting vegetables', 'organic produce basket', 'greenhouse plants'],
    about: 'family farm landscape', team: 'farmers team portrait field', service: ['dairy cows pasture', 'fresh fruits harvest', 'tractor farm field'], gallery: ['vegetable market stall', 'orchard trees', 'seedlings plants'] },
  { id: 'automotive', match: /\b(car|cars|auto|automobile|automotive|garage|dealership|motor|vehicle|bike|motorcycle|ev\b|electric vehicle)\b/i, subject: 'automotive',
    hero: 'modern car showroom', features: ['mechanic repairing car engine', 'car dealership customers', 'electric vehicle charging'],
    about: 'auto garage workshop', team: 'mechanics team portrait garage', service: ['car detailing polish', 'tire service garage', 'vehicle inspection'], gallery: ['sports car road', 'car interior dashboard', 'motorcycle riding'] }
];
const DEFAULT_INDUSTRY = { id: 'general', subject: 'business',
  hero: 'modern professional workspace team', features: ['team collaboration office', 'professional working laptop desk', 'customer service meeting'],
  about: 'modern office interior', team: 'professional team portrait', service: ['business consultation meeting', 'office desk workspace', 'team planning whiteboard'], gallery: ['city skyline business', 'modern building architecture', 'coworking space'] };

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
const ASPECTS = { hero: '16/9', feature: '4/3', service: '4/3', about: '4/3', team: '4/5', gallery: '1/1', news: '16/9', product: '1/1', section: '4/3' };

function detectIndustry(prompt = '', spec = null) {
  const text = `${prompt} ${(spec?.pages || []).map((page) => `${page.name || ''} ${page.purpose || ''}`).join(' ')}`;
  return INDUSTRIES.find((industry) => industry.match.test(text)) || DEFAULT_INDUSTRY;
}

/** Subject words from the request itself ("a bakery in Chennai" -> "bakery"): they make every query specific to this site. */
function promptSubject(prompt = '') {
  const m = /\b(?:for|of|about)\s+(?:an?\s+|the\s+|my\s+|our\s+)?([a-z][a-z' -]{2,40}?)(?=\s+(?:website|web site|site|landing|page|company|business|in|with|called|named|that|which)\b|[.,;:!?]|$)/i.exec(String(prompt));
  return m ? m[1].trim() : '';
}

function pagesFor(prompt, spec, industry) {
  if (Array.isArray(spec?.pages) && spec.pages.length) {
    return spec.pages.filter((page) => page?.route).slice(0, 8).map((page) => ({ name: page.name || page.route, route: page.route, purpose: page.purpose || '' }));
  }
  const asked = [...String(prompt).matchAll(/\b(home|about|services?|menu|products?|gallery|portfolio|projects?|team|blog|news|pricing|contact|programs?|courses?|doctors?|rooms?|events?|shop)\b/gi)].map((m) => m[1].toLowerCase());
  const names = [...new Set(['home', 'about', ...asked, 'services'])].slice(0, 6).filter((name) => name !== 'contact');
  return names.map((name) => ({ name: name[0].toUpperCase() + name.slice(1), route: name === 'home' ? '/' : `/${name}`, purpose: '' }));
}

function baseSlot(page, id, category, query, extra = {}) {
  const prefix = slug(page.name);
  return { slot: id.startsWith(`${prefix}-`) ? id : `${prefix}-${id}`, page: page.name, route: page.route, section: extra.section || category, category, query, alternates: extra.alternates || [],
    aspect: ASPECTS[category] || '4/3', hero: category === 'hero', orientation: category === 'team' ? 'portrait' : (category === 'gallery' ? 'any' : 'landscape'), altHint: extra.altHint || query };
}

/** Deterministic plan: what a site of this kind needs on each page. */
function heuristicRequirements({ prompt, spec, cfg = imageConfig() }) {
  const industry = detectIndustry(prompt, spec);
  const topic = promptSubject(prompt);
  const withTopic = (query) => (topic && !query.toLowerCase().includes(topic.toLowerCase().split(' ')[0]) && topic.length < 28 ? `${query} ${topic}` : query);
  const pages = pagesFor(prompt, spec, industry);
  const requirements = [];
  const seenQueries = new Set();
  const slot = (page, id, category, query, extra = {}) => {
    let q = query;
    if (seenQueries.has(q)) q = `${query} ${page.name.toLowerCase()}`; // two pages never search for exactly the same picture
    seenQueries.add(q);
    return baseSlot(page, id, category, q, extra);
  };
  for (const page of pages) {
    const key = slug(page.name);
    const isHome = page.route === '/' || /^home|landing|main$/.test(key);
    if (isHome) {
      requirements.push(slot(page, 'hero', 'hero', industry.hero, { section: 'Hero', alternates: [withTopic(industry.hero), `${industry.subject} professional photography`] }));
      industry.features.forEach((query, i) => requirements.push(slot(page, `feature-0${i + 1}`, 'feature', query, { section: `Feature ${i + 1}`, alternates: [withTopic(query)] })));
    } else if (/about|story|company|who/.test(key)) {
      requirements.push(slot(page, 'about-01', 'about', industry.about, { section: 'About', alternates: [withTopic(industry.about)] }));
      requirements.push(slot(page, 'team-01', 'team', industry.team, { section: 'Team', alternates: [withTopic(industry.team)] }));
    } else if (/gallery|portfolio|work|project/.test(key)) {
      industry.gallery.forEach((query, i) => requirements.push(slot(page, `gallery-0${i + 1}`, 'gallery', query, { section: 'Gallery', alternates: [withTopic(query)] })));
    } else if (/team|doctor|staff|people/.test(key)) {
      requirements.push(slot(page, 'team-01', 'team', industry.team, { section: 'Team', alternates: [withTopic(industry.team)] }));
      requirements.push(slot(page, 'team-02', 'team', `${industry.subject} staff portrait`, { section: 'Team' }));
    } else if (/contact/.test(key)) {
      continue;
    } else {
      industry.service.slice(0, 3).forEach((query, i) => requirements.push(slot(page, `${/menu|product|shop|course|program|room|event/.test(key) ? 'item' : 'service'}-0${i + 1}`, /product|shop|menu/.test(key) ? 'product' : 'service', query, { section: page.name, alternates: [withTopic(query)] })));
    }
  }
  // Guarantee the validation floor with room to spare: extra gallery-style images on the pages that exist.
  let extra = 0;
  while (requirements.length < cfg.minSite + 2 && extra < industry.gallery.length) {
    const page = pages[Math.min(pages.length - 1, 1 + (extra % Math.max(1, pages.length - 1)))] || pages[0];
    requirements.push(slot(page, `extra-0${extra + 1}`, 'gallery', industry.gallery[extra], { section: 'Gallery' }));
    extra += 1;
  }
  return { industry: industry.id, subject: topic || industry.subject, pages, requirements: requirements.slice(0, cfg.maxAssets) };
}

const clean = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Accepts the model's plan only when it is well formed; anything else falls back to the deterministic plan. */
function normalizeModelPlan(raw, { cfg = imageConfig() } = {}) {
  if (!raw || !Array.isArray(raw.pages)) return null;
  const pages = [];
  const requirements = [];
  const used = new Set();
  for (const item of raw.pages.slice(0, 8)) {
    const name = clean(item?.name, 40);
    if (!name) continue;
    const route = clean(item.route, 60) || (/^home$/i.test(name) ? '/' : `/${slug(name)}`);
    const page = { name, route: route.startsWith('/') ? route : `/${route}`, purpose: clean(item.purpose, 160) };
    pages.push(page);
    for (const image of Array.isArray(item.images) ? item.images.slice(0, 5) : []) {
      const query = clean(image?.query, 90);
      if (query.split(' ').length < 2) continue;
      const category = Object.keys(ASPECTS).includes(String(image.category)) ? String(image.category) : (requirements.some((r) => r.page === name) ? 'feature' : 'hero');
      let id = `${category}-01`; let n = 1;
      while (used.has(`${slug(name)}-${id}`)) { n += 1; id = `${category}-0${n}`; }
      used.add(`${slug(name)}-${id}`);
      requirements.push(baseSlot(page, id, category, query, { section: clean(image.section, 40) || category, altHint: clean(image.alt, 140) || query, alternates: (Array.isArray(image.alternates) ? image.alternates : []).map((q) => clean(q, 90)).filter(Boolean).slice(0, 2) }));
    }
  }
  if (!pages.length || requirements.length < 3) return null;
  return { industry: clean(raw.industry, 40) || 'general', subject: clean(raw.subject, 60) || 'website', pages, requirements: requirements.slice(0, cfg.maxAssets) };
}

const PLAN_SYSTEM = 'You plan the photographs a website needs. Reply with ONLY JSON, no prose: {"industry": string, "subject": string, "pages": [{"name": string, "route": string, "purpose": string, "images": [{"section": string, "category": "hero"|"feature"|"service"|"about"|"team"|"gallery"|"news"|"product", "query": string, "alt": string, "alternates": [string]}]}]}. Rules: 3 to 7 pages; the home page has a hero image and 2-3 feature images; every content page has 1-3 images that show what that page is about; "query" is a concrete 3-7 word stock-photography search for REAL photographs (subject, setting, style) - never a brand name, never "logo", never an illustration; "alt" is a meaningful sentence describing the picture; at most 14 images in total.';

/**
 * @param ask async (system, user) => string; optional (the model plan is an improvement, not a dependency)
 */
async function buildRequirements({ prompt, spec = null, ask = null, cfg = imageConfig() } = {}) {
  if (ask) {
    try {
      const raw = await ask(PLAN_SYSTEM, `Website request:\n${String(prompt || '').slice(0, 3000)}${spec?.pages?.length ? `\n\nPlanned pages: ${spec.pages.map((p) => `${p.name} (${p.route}) ${p.purpose || ''}`).join('; ')}` : ''}`);
      const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
      const plan = normalizeModelPlan(json ? JSON.parse(json) : null, { cfg });
      if (plan) return { ...plan, source: 'model' };
    } catch { /* the deterministic plan below is always available */ }
  }
  return { ...heuristicRequirements({ prompt, spec, cfg }), source: 'heuristic' };
}

module.exports = { buildRequirements, heuristicRequirements, normalizeModelPlan, detectIndustry, ASPECTS, slug };
