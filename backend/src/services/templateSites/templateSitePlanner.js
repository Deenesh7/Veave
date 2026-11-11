/**
 * The website plan: what the user's one-line description means, before any page is written.
 *
 *   createPlan  - asks the model to understand the website (category, purpose, audience, sitemap, navigation, terminology, what to
 *                 avoid) with the selected template described as a DESIGN FOUNDATION only, then validates and normalises the answer.
 *   applySitemap - makes the site's pages match the plan with the existing page operations (rename, add, delete, reorder), so
 *                 routes, navigation links and revisions stay correct.
 *
 * The plan is saved on the site and read by every page job, so the user's intent is never lost between pages.
 */
const BaseLLMProvider = require('../llm/baseProvider');
const TemplatePage = require('../../models/TemplatePage');
const pageService = require('./templatePageService');
const pageRequest = require('./templatePageRequest');
const logger = require('../../utils/logger');

class PlanError extends Error { constructor(message, code = 'PLAN_FAILED') { super(message); this.name = 'PlanError'; this.code = code; } }

const MAX_PLAN_PAGES = 12;
const MAX_NAV = 7;
const WORD = /[a-z0-9][a-z0-9&'-]*/gi;

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (value, max = 8, length = 120) => (Array.isArray(value) ? value : []).map((item) => clean(typeof item === 'string' ? item : item?.name || item?.title || '', length)).filter(Boolean).slice(0, max);

function normalizeRoute(value) {
  let route = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9/_-]+/g, '-').replace(/-+/g, '-').replace(/\/{2,}/g, '/');
  if (!route.startsWith('/')) route = `/${route}`;
  route = route.replace(/\/+$/, '') || '/';
  return route.length > 60 ? route.slice(0, 60) : route;
}

/** Planning needs a model: it is skipped (the site is written without a plan) only when no AI key is configured and no test stand-in is given. */
function isEnabled(deps = {}) {
  if (deps.callPlanner === null) return false;
  if (deps.callPlanner) return true;
  if (String(process.env.TEMPLATE_PLANNING || 'on').toLowerCase() === 'off') return false;
  const key = process.env.OPENROUTER_API_KEY;
  return Boolean(key && !/^your[_-]/i.test(key) && key !== 'undefined');
}

function defaultCallPlanner() {
  const openrouterService = require('../ai/openrouterService');
  const model = process.env.TEMPLATE_PLANNER_MODEL || process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const response = await openrouterService.generateCompletion(messages, {
      model, temperature: 0.3, max_tokens: 6000, timeout: Number.parseInt(process.env.OPENROUTER_GENERATION_TIMEOUT_MS, 10) || 300000,
      response_format: { type: 'json_object' }, reasoning: { effort: 'low', exclude: true }, signal
    });
    return { content: response?.content || '', usage: response?.usage || null };
  };
}

/* ------------------------------------------------ the visual theme asked for in the description ------------------------------------------------ */

const hexOf = (value) => {
  const text = String(value || '').trim();
  const short = text.match(/^#([0-9a-f]{3})$/i);
  if (short) return `#${short[1].split('').map((char) => char + char).join('').toLowerCase()}`;
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null;
};
const rgbOf = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
const luminance = (hex) => { const [r, g, b] = rgbOf(hex).map((value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const mix = (a, b, amount) => `#${rgbOf(a).map((value, index) => Math.round(value * (1 - amount) + rgbOf(b)[index] * amount).toString(16).padStart(2, '0')).join('')}`;
const readableOn = (background) => (contrast('#ffffff', background) >= contrast('#111111', background) ? '#ffffff' : '#111111');

/** The palette the description asked for, made readable. Anything unusable means "keep the template's own design" (null). */
function normalizeTheme(raw) {
  if (!raw || typeof raw !== 'object' || !raw.colors || typeof raw.colors !== 'object') return null;
  const c = Object.fromEntries(Object.entries(raw.colors).map(([key, value]) => [key, hexOf(value)]));
  if (!c.bg || !c.brand) return null;
  const colors = { bg: c.bg, brand: c.brand };
  colors.fg = c.fg && contrast(c.fg, c.bg) >= 4.5 ? c.fg : readableOn(c.bg);
  colors.surface = c.surface || mix(c.bg, luminance(c.bg) > 0.5 ? '#ffffff' : '#000000', 0.5);
  colors.surface2 = c.surface2 || mix(c.bg, colors.fg, 0.07);
  colors.line = c.line || mix(c.bg, colors.fg, 0.15);
  colors.muted = c.muted && contrast(c.muted, c.bg) >= 3.2 ? c.muted : mix(colors.fg, c.bg, 0.35);
  colors.onBrand = c.onBrand && contrast(c.onBrand, c.brand) >= 4 ? c.onBrand : readableOn(c.brand);
  colors.accent = c.accent || c.brand;
  // The brand colour is used for buttons and links on the page background: it must stand out from it.
  if (contrast(colors.brand, colors.bg) < 2.2) return null;
  return {
    mood: clean(raw.mood, 60), colors, headingFont: raw.headingFont === 'sans' ? 'sans' : 'serif',
    radius: ['0px', '2px', '4px', '8px', '12px', '16px'].includes(raw.radius) ? raw.radius : null
  };
}

/* ------------------------------------------------ what the template is (as a design foundation) ------------------------------------------------ */

/** Words that belong to the template's own sample website (its brand and the titles of its sample records). */
function templateSampleTerms(files = []) {
  const found = new Set();
  const site = files.find((file) => file.path === 'src/data/site.js');
  const brand = site?.content?.match(/\bname:\s*['"]([^'"]{2,60})['"]/)?.[1];
  if (brand) found.add(brand);
  for (const file of files.filter((item) => /^src\/data\/.+\.js$/.test(item.path) && item.path !== 'src/data/site.js')) {
    for (const match of String(file.content || '').matchAll(/\b(?:title|name)\s*:\s*['"]([^'"]{3,60})['"]/g)) found.add(match[1]);
  }
  return [...found].slice(0, 20);
}

/** The template as it was shipped: the sample brand and records it carries (not what the site has become). */
const originalFiles = (template) => { try { return require('../templates/templateService').instantiateFiles(template); } catch { return []; } };

/** The name the owner gave the site, unless it is just the template's own sample name. */
function ownerNameFor(siteName, template) {
  const name = clean(siteName, 60);
  if (!name) return '';
  const samples = new Set([clean(template.name, 60), ...templateSampleTerms(originalFiles(template)).slice(0, 1)].map((item) => item.toLowerCase()));
  return samples.has(name.toLowerCase()) ? '' : name;
}

function templateSummary(template, pages, files) {
  return [
    `Template: ${template.name} (${template.category || 'general'}). ${template.description || ''}`,
    `Template tags (its original industry): ${(template.tags || []).join(', ')}`,
    `Design: ${template.designTokens?.mood || ''}; ${template.layout?.summary || ''}`,
    `Its pages:\n${pages.map((page) => `- ${page.name} (${page.route})${page.description ? `: ${page.description}` : ''}${(template.pages || []).find((item) => item.path === page.route)?.sections?.length ? ` — sections: ${(template.pages || []).find((item) => item.path === page.route).sections.join(', ')}` : ''}`).join('\n')}`,
    `Its sample brand and sample records: ${templateSampleTerms(originalFiles(template)).join('; ') || 'none'}`
  ].join('\n');
}

const SYSTEM_TEMPLATE = `You are the planner of a website builder. A user chose an existing template and described the website they want in a sentence or two. The template is only a DESIGN FOUNDATION (layout, components, colours, typography). Its words, sections, sample data and pictures belong to a different website and are NOT the user's content.

Understand what the user really wants and answer with ONE JSON object, nothing else:
{
  "matchesTemplate": boolean,            // true ONLY if the requested website is the same kind of website the template was made for
  "identity": { "category": string, "organizationType": string, "name": string, "namePlaceholder": boolean, "tagline": string, "purpose": string, "audience": [string], "primaryActions": [string], "tone": string, "designDirection": string },
  "pages": [ { "name": string, "route": string, "purpose": string, "sections": [string], "reuse": string|null, "contentNeeds": string, "imageNeeds": string } ],
  "navigation": [ { "label": string, "route": string } ],
  "cta": { "label": string, "route": string },
  "footerGroups": [ { "title": string, "links": [ { "label": string, "route": string } ] } ],
  "theme": null | { "mood": string, "colors": { "bg": "#RRGGBB", "surface": "#RRGGBB", "surface2": "#RRGGBB", "line": "#RRGGBB", "fg": "#RRGGBB", "muted": "#RRGGBB", "brand": "#RRGGBB", "onBrand": "#RRGGBB", "accent": "#RRGGBB" }, "headingFont": "serif"|"sans", "radius": "0px"|"2px"|"4px"|"8px"|"12px"|"16px" },
  "images": [ { "key": string, "page": string|null, "subject": string, "alt": string, "aspect": "16:9"|"4:3"|"1:1" } ],
  "terminology": [ { "from": string, "to": string } ],
  "avoidTerms": [string],
  "requirements": [string]
}

RULES
- Infer category, organisation type, purpose, audience and the main actions visitors take from the description. The user will not list pages or sections: you decide them, the way a professional designer would for this kind of website.
- "pages" is the full sitemap (at most ${MAX_PLAN_PAGES}, home first with route "/"). Reuse a template page when its purpose fits by setting "reuse" to that template page's route and giving it a new name and purpose; reuse each template page at most once. Add pages the website needs. Template pages that do not fit are dropped by simply not reusing them. Do not force a fixed structure: a hospital, a college and a SaaS product need different pages.
- Each page lists the sections it needs for ITS purpose (an admissions page needs eligibility, process, programs, an enquiry form; not a gallery of projects).
- Routes are short lowercase paths like "/admissions". Navigation has at most ${MAX_NAV} items and only uses planned routes; "cta" is the single main action and uses a planned route.
- "name": a word that follows "theme", "style", "colours", "look" or "design" (for example "theme inti") describes the LOOK, never the organisation's name; do not use it as the name or as a brand. Use the organisation's name only if the description clearly says it is the name (for example "called X", "named X", "X College"). Use the organisation's name if the description gives one; otherwise "Your " followed by the organisation type (for example "Your College", "Your Hospital") with namePlaceholder true, the same name on every page. NEVER invent a real-sounding institution name.
- NEVER invent facts: no rankings, accreditation, statistics, fees, dates, people, achievements or contact details. Write what the site needs to say in general terms and mark facts the owner must supply as placeholders.
- "theme" is null UNLESS the description asks for colours, a mood or a visual style (for example "navy and white", "dark mode", "playful and bright", "formal"). Then give a complete palette that really matches what was asked, with readable contrast (text on background, text on the brand colour). If the description says nothing about the look, answer null so the template's own design is kept.
- "images" are the photographs the website needs (at most __MAX__): one 16:9 hero for the home page, then one 4:3 picture for each other page that benefits from a picture, and up to three 4:3 or 1:1 pictures with "page": null for the sample cards (programs, services, departments) if the template has such a list. "subject" describes a real photograph of a place, a space, an object or an activity that fits THIS website (for example a campus building, a laboratory, a clinic reception, a team around a table). Never ask for text, logos, signs, certificates, seals, screenshots or identifiable people, and avoid subjects built around printed or written material (brochures, posters, whiteboards, notice boards, screens): image models draw those as gibberish. Prefer places, buildings, spaces, equipment and activities. "key" is a short slug like "home-hero".
- "terminology" maps the template's words to the words for this website (for example Projects -> Programs). "avoidTerms" lists words and phrases from the template's original industry, its sample brand and sample records that must NOT appear on the new website (empty if matchesTemplate is true).
- "requirements" are functional needs (for example an admissions enquiry form, a course list, an appointment form) for the pages to include.
- Write all text in the language of the description.`;
const SYSTEM = SYSTEM_TEMPLATE.replace('__MAX__', String(require('./templateImageGenerator').maxImages()));

/* ------------------------------------------------ normalising the model's answer ------------------------------------------------ */

function normalizePlan(raw, { template, pages, brief, files, ownerName = '' }) {
  if (!raw || typeof raw !== 'object') throw new PlanError('The planner did not return a usable plan.', 'PLAN_UNUSABLE');
  const identityRaw = raw.identity || {};
  const category = clean(identityRaw.category, 60);
  if (!category) throw new PlanError('The planner could not tell what kind of website this is. Describe the website in a little more detail.', 'PLAN_UNUSABLE');
  const existing = new Map(pages.map((page) => [page.route, page]));
  const usedReuse = new Set();
  const used = new Set();
  const planned = [];
  for (const entry of Array.isArray(raw.pages) ? raw.pages : []) {
    const name = clean(entry?.name, 60);
    if (!name) continue;
    let route = normalizeRoute(entry?.route || name);
    if (used.has(route)) continue;
    let reuse = entry?.reuse ? normalizeRoute(entry.reuse) : null;
    if (reuse && (!existing.has(reuse) || usedReuse.has(reuse))) reuse = null;
    if (route === '/' && reuse !== '/') reuse = existing.has('/') && !usedReuse.has('/') ? '/' : null;
    if (reuse === '/' && route !== '/') route = '/';
    if (reuse) usedReuse.add(reuse);
    used.add(route);
    planned.push({ name, route, purpose: clean(entry?.purpose, 300), sections: list(entry?.sections, 8, 80), reuse, contentNeeds: clean(entry?.contentNeeds, 300), imageNeeds: clean(entry?.imageNeeds, 200) });
    if (planned.length >= MAX_PLAN_PAGES) break;
  }
  if (!planned.some((page) => page.route === '/')) {
    const home = existing.get('/');
    planned.unshift({ name: 'Home', route: '/', purpose: clean(identityRaw.purpose, 300) || 'Introduce the website and send visitors to what they need.', sections: [], reuse: home && !usedReuse.has('/') ? '/' : null, contentNeeds: '', imageNeeds: '' });
  }
  planned.sort((a, b) => (a.route === '/' ? -1 : b.route === '/' ? 1 : 0));
  // The owner's words are a hard limit: never more pages than were asked for (or, with no request, than the template has).
  const request = pageRequest.parsePageRequest(brief);
  const limit = pageLimitFor(request, template, pages);
  const kept = pageRequest.limitPages(planned, request, limit);
  const keptReuse = new Set(kept.map((page) => page.reuse).filter(Boolean));
  for (const page of kept) if (page.reuse && !keptReuse.has(page.reuse)) page.reuse = null;
  planned.splice(0, planned.length, ...kept);
  if (planned.length < 2) throw new PlanError('The planner produced too few pages.', 'PLAN_UNUSABLE');
  const routes = new Set(planned.map((page) => page.route));

  let navigation = (Array.isArray(raw.navigation) ? raw.navigation : []).map((item) => ({ label: clean(item?.label, 30), route: normalizeRoute(item?.route) })).filter((item) => item.label && routes.has(item.route));
  navigation = navigation.filter((item, index) => navigation.findIndex((other) => other.route === item.route) === index).slice(0, MAX_NAV);
  if (navigation.length < 2) navigation = planned.slice(0, MAX_NAV).map((page) => ({ label: page.name.slice(0, 30), route: page.route }));
  const ctaRoute = normalizeRoute(raw.cta?.route);
  const cta = { label: clean(raw.cta?.label, 30) || 'Contact us', route: routes.has(ctaRoute) ? ctaRoute : (planned.find((page) => /contact|enquir|admission|appoint|book|apply/.test(page.route))?.route || planned[planned.length - 1].route) };
  const footerGroups = (Array.isArray(raw.footerGroups) ? raw.footerGroups : []).map((group) => ({
    title: clean(group?.title, 30),
    links: (Array.isArray(group?.links) ? group.links : []).map((link) => ({ label: clean(link?.label, 30), route: normalizeRoute(link?.route) })).filter((link) => link.label && routes.has(link.route)).slice(0, 8)
  })).filter((group) => group.title && group.links.length).slice(0, 4);

  const matchesTemplate = raw.matchesTemplate === true;
  const briefText = String(brief || '').toLowerCase();
  const planVocabulary = new Set([...planned.flatMap((page) => [page.name, ...page.sections]), ...navigation.map((item) => item.label), cta.label, ...(Array.isArray(raw.terminology) ? raw.terminology.map((item) => item?.to) : [])].flatMap((text) => String(text || '').toLowerCase().match(WORD) || []));
  const terminology = matchesTemplate ? [] : (Array.isArray(raw.terminology) ? raw.terminology : []).map((item) => ({ from: clean(item?.from, 40), to: clean(item?.to, 40) })).filter((item) => item.from && item.to).slice(0, 20);

  // What must not leak from the template: the model's list plus the template's own sample brand and record titles (deterministic).
  const candidates = matchesTemplate ? [] : [...list(raw.avoidTerms, 40, 40), ...templateSampleTerms(originalFiles(template))];
  const avoidTerms = [];
  for (const term of candidates) {
    const lower = term.toLowerCase().trim();
    if (lower.length < 3 || lower.length > 40 || avoidTerms.some((item) => item.toLowerCase() === lower)) continue;
    if (briefText.includes(lower) || (ownerName && ownerName.toLowerCase().includes(lower))) continue; // the user asked for it / it is the owner's own name
    if (lower.split(/\s+/).every((word) => planVocabulary.has(word))) continue; // the new website uses it too
    avoidTerms.push(term);
  }

  const imageLimit = require('./templateImageGenerator').maxImages();
  const hasRecords = files.some((file) => /^src\/data\/[A-Za-z0-9_-]+\.js$/.test(file.path) && file.path !== 'src/data/site.js');
  const images = [];
  const keys = new Set();
  const addImage = (entry) => {
    const subject = clean(entry?.subject, 220);
    if (!subject || images.length >= imageLimit) return;
    let key = String(entry?.key || subject).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `image-${images.length + 1}`;
    for (let n = 2; keys.has(key); n += 1) key = `${key.slice(0, 26)}-${n}`;
    keys.add(key);
    const route = entry?.page ? normalizeRoute(entry.page) : null;
    images.push({ key, page: route && routes.has(route) ? route : null, subject, alt: clean(entry?.alt, 140) || subject.slice(0, 140), aspect: ['16:9', '4:3', '1:1'].includes(entry?.aspect) ? entry.aspect : '4:3' });
  };
  for (const entry of Array.isArray(raw.images) ? raw.images : []) addImage(entry);
  if (imageLimit > 0 && !images.some((item) => item.page === '/' && item.aspect === '16:9')) {
    images.splice(0, images.length, ...[{ key: 'home-hero', page: '/', subject: `${identityRaw.purpose || category}: a welcoming, realistic scene that shows what a ${category} is about`, alt: `${category}`, aspect: '16:9' }, ...images].slice(0, imageLimit));
    keys.add('home-hero');
  }
  if (!matchesTemplate && !images.some((item) => item.page === null) && hasRecords) {
    for (const n of [1, 2, 3]) addImage({ key: `card-${n}`, page: null, subject: `a realistic photograph that illustrates one of the main offerings of a ${category}`, alt: `${category} ${n}`, aspect: '4:3' });
  }
  const needsTemporaryName = !ownerName && (identityRaw.namePlaceholder === true || !clean(identityRaw.name, 60));
  const type = clean(identityRaw.organizationType, 40) || category;
  // One consistent temporary name for the whole website when nobody gave one (never a made-up institution, never the template's brand).
  const name = ownerName || (needsTemporaryName ? `Your ${type.replace(/\b\w/g, (char) => char.toUpperCase())}` : clean(identityRaw.name, 60)) || clean(template.name, 60);
  return {
    version: 1, templateId: template.id, brief: clean(brief, 4000), matchesTemplate,
    identity: {
      category, organizationType: clean(identityRaw.organizationType, 80), name, namePlaceholder: ownerName ? false : (identityRaw.namePlaceholder === true || !clean(identityRaw.name, 60)),
      tagline: clean(identityRaw.tagline, 160), purpose: clean(identityRaw.purpose, 400), audience: list(identityRaw.audience, 6, 80), primaryActions: list(identityRaw.primaryActions, 6, 80),
      tone: clean(identityRaw.tone, 120), designDirection: clean(identityRaw.designDirection, 200)
    },
    pages: planned, pageLimit: { ...limit, requested: request.names }, theme: normalizeTheme(raw.theme), navigation, cta, footerGroups, images, terminology, avoidTerms: avoidTerms.slice(0, 40), requirements: list(raw.requirements, 10, 160)
  };
}

/** A blank website has one page, so its limit is a generous sitemap, not the template's page count. */
const pageLimitFor = (request, template, pages) => pageRequest.pageLimit(request, template.blank ? 8 : ((template.pages && template.pages.length) || pages.length));

function pageRulesText(brief, template, pages) {
  const request = pageRequest.parsePageRequest(brief);
  const limit = pageLimitFor(request, template, pages);
  if (template.blank && limit.reason === 'template') return `the owner did not list pages and this is a blank website with only a Home page, so design the complete sitemap a professional designer would build for this kind of website: between 4 and ${limit.max} pages, home first. Every page except Home is new (set "reuse" to null; Home reuses "/").`;
  if (limit.reason === 'listed') return `the owner listed exactly these pages: ${request.names.join(', ')}. Create exactly these pages and no others (the home page "/" is always one of them).`;
  if (limit.reason === 'count') return `the owner wants ${limit.max} pages in total, including the home page. Do not create more.`;
  return `the owner did not list pages, so the website has AT MOST ${limit.max} pages (the number this template was designed with). Reuse and transform the template's pages; do not add pages beyond ${limit.max}.`;
}

/** Understands the description and returns the validated plan, plus the model usage. Throws PlanError when it cannot. */
async function createPlan({ template, pages, files, brief, ownerName = '', deps = {}, signal }) {
  const call = deps.callPlanner || defaultCallPlanner();
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `THE USER'S DESCRIPTION OF THE WEBSITE THEY WANT:\n${String(brief).trim()}\n\nPAGE RULES (strict): ${pageRulesText(brief, template, pages)}${ownerName ? `\n\nThe owner named this website "${ownerName}": use exactly that as the organisation's name.` : ''}\n\nTHE SELECTED TEMPLATE (a design foundation only${template.blank ? '; it is a BLANK starter with no content, so nothing in it belongs to any website and there is nothing to avoid' : ''}):\n${templateSummary(template, pages, files)}\n\nReturn the JSON plan.` }
  ];
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    let answer;
    try { answer = await call(messages, { signal }); }
    catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; throw error; }
    const raw = typeof answer?.content === 'object' && answer.content ? answer.content : BaseLLMProvider.safeParseJson(answer?.content);
    try { return { plan: normalizePlan(raw, { template, pages, brief, files, ownerName }), usage: answer?.usage || null }; }
    catch (error) {
      lastError = error;
      logger.warn(`Website plan attempt ${attempt + 1} rejected: ${error.message}`);
      messages.push({ role: 'assistant', content: typeof answer?.content === 'string' ? answer.content.slice(0, 4000) : '' }, { role: 'user', content: `That plan was rejected: ${error.message} Return the corrected JSON plan.` });
    }
  }
  throw lastError instanceof PlanError ? lastError : new PlanError('The website could not be planned.');
}

/* ------------------------------------------------ making the pages match the plan ------------------------------------------------ */

/**
 * Renames, adds, deletes and reorders pages so the site has exactly the planned pages, in order. Uses the existing page operations
 * (they keep App.jsx, navigation and links consistent and record revisions). `exceptJobId` lets them run inside the job that asked.
 */
async function applySitemap({ user, site, plan, exceptJobId }) {
  const base = { user, siteId: site._id, exceptJobId };
  let current = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
  const reuseRoutes = new Set(plan.pages.map((page) => page.reuse).filter(Boolean));
  // 1. Template pages that do not fit are removed (their routes are then free).
  for (const page of current) {
    if (page.route === '/' || reuseRoutes.has(page.route)) continue;
    await pageService.deletePage({ ...base, pageId: page._id });
  }
  current = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
  const byRoute = new Map(current.map((page) => [page.route, page]));
  const result = new Map();
  // 2. Reused pages get their new name, purpose and address (through a temporary address when two pages swap addresses).
  for (const planned of plan.pages.filter((page) => page.reuse)) {
    const page = byRoute.get(planned.reuse);
    if (!page) continue;
    let moved = page;
    if (planned.route !== page.route) {
      const taken = current.some((other) => other.route === planned.route && String(other._id) !== String(page._id));
      if (taken) await pageService.renamePage({ ...base, pageId: page._id, route: `/tmp-${String(page._id).slice(-6)}` });
      moved = (await pageService.renamePage({ ...base, pageId: page._id, name: planned.name, description: planned.purpose, route: planned.route })).page;
    } else {
      moved = (await pageService.renamePage({ ...base, pageId: page._id, name: planned.name, description: planned.purpose })).page;
    }
    result.set(planned.route, moved);
    current = await TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
  }
  // 3. New pages.
  for (const planned of plan.pages.filter((page) => !page.reuse)) {
    const { page } = await pageService.addPage({ ...base, name: planned.name, description: planned.purpose, route: planned.route });
    result.set(planned.route, page);
  }
  // 4. Order.
  const ordered = plan.pages.map((page) => result.get(page.route)).filter(Boolean).map((page) => page._id);
  const all = await TemplatePage.find({ siteId: site._id });
  const rest = all.filter((page) => !ordered.some((id) => String(id) === String(page._id))).map((page) => page._id);
  await pageService.reorderPages({ ...base, pageIds: [...ordered, ...rest].map(String) });
  return TemplatePage.find({ siteId: site._id }).sort({ order: 1 });
}

/**
 * One-page transformation: the plan the planner made for the whole website is cut down to the pages the site really has, so nothing is
 * added, deleted or moved. Each existing page keeps its route; a page the planner reused gets the planner's name, purpose and sections;
 * the pictures kept are those for the page being rewritten and the shared sample cards. Navigation and footer use the existing routes.
 */
function restrictToExisting(plan, pages, current) {
  const planned = plan.pages || [];
  const forPage = (page) => planned.find((item) => item.reuse === page.route) || (page.route === '/' ? planned.find((item) => item.route === '/') : null);
  const entries = pages.map((page) => {
    const match = forPage(page);
    return { name: match?.name || page.name, route: page.route, purpose: match?.purpose || page.description || '', sections: match?.sections || [], reuse: page.route, contentNeeds: match?.contentNeeds || '', imageNeeds: match?.imageNeeds || '', plannedRoute: match?.route || null };
  });
  const navigation = entries.slice(0, MAX_NAV).map((entry) => ({ label: entry.name.slice(0, 30), route: entry.route }));
  const routes = new Set(entries.map((entry) => entry.route));
  const ctaEntry = entries.find((entry) => entry.plannedRoute && entry.plannedRoute === plan.cta?.route) || entries.find((entry) => /contact|enquir|admission|appoint|book|apply/.test(entry.route)) || entries[entries.length - 1];
  const mine = entries.find((entry) => entry.route === current.route);
  const images = (plan.images || []).filter((image) => image.page === null || image.page === (mine?.plannedRoute || current.route)).map((image) => ({ ...image, page: image.page === null ? null : current.route }));
  return {
    ...plan,
    pages: entries.map(({ plannedRoute, ...entry }) => entry),
    navigation: navigation.filter((item) => routes.has(item.route)),
    cta: { label: plan.cta?.label || 'Contact us', route: ctaEntry.route },
    footerGroups: [{ title: 'Explore', links: navigation.slice(0, 6) }],
    images, theme: null, pageLimit: { max: entries.length, reason: 'existing', requested: [] }, scope: 'page'
  };
}

module.exports = { restrictToExisting, normalizeTheme, ownerNameFor, PlanError, isEnabled, createPlan, normalizePlan, applySitemap, templateSampleTerms, normalizeRoute, MAX_PLAN_PAGES };
