/**
 * RequirementExtractor: reads the WHOLE request and turns every explicit detail into a tracked requirement object, before anything is
 * retrieved, planned or written.
 *
 *   { id, label, description, category, contentKind, importance, expectedPage, expectedSection, requiredContent[],
 *     requiredAssets[{ type, subject, priority }], sectionIds[], status, evidence, note, source }
 *
 * contentKind says what "covered" means for the requirement:
 *   person        a named individual with a profile (and a portrait when one can be verified)
 *   catalogue     a list of real items (courses, products, departments, plans, features): the ITEMS must appear, not a heading
 *   timeline      dated history or milestones
 *   achievements  supported awards, rankings, accreditations
 *   facilities    places, services or infrastructure
 *   narrative     explanatory text (introduction, mission, story)
 *   contact       ways to reach the organisation
 *
 * A model reads the request when one is reachable; otherwise a rule-based reading of the same request produces the same shape. It
 * does not know any particular category of website: the categories above are about the KIND of content, not the industry.
 */
const { heuristicRequirements, terms } = require('../deep/deepPlanner');

const KINDS = ['person', 'catalogue', 'timeline', 'achievements', 'facilities', 'narrative', 'contact'];
const ASSET_TYPES = ['person_portrait', 'campus', 'historical', 'facility', 'product', 'team', 'none'];

const PERSON_ROLE = /\b(chancellor|vice[- ]chancellor|founder|co-?founder|ceo|cto|cfo|coo|chairman|chairperson|president|vice[- ]president|principal|director|dean|head|owner|chief|registrar|professor|doctor|dr\.?|proprietor|managing director|trustee|leader|leadership)\b/i;
const LIST_WORDS = /\b(all|every|each|complete|full|entire|list of|range of|catalogue|catalog)\b/i;
const CATALOGUE_NOUN = /\b(courses?|programmes?|programs?|degrees?|specialit(?:y|ies)|specialisations?|specializations?|departments?|products?|categories|services?|plans?|packages?|features?|integrations?|menus?|rooms?|doctors?|faculty|projects?|branches|locations|clubs|schemes?|batches)\b/i;
const HISTORY = /\b(legacy|history|heritage|story|journey|timeline|milestones?|founding|origins?|background)\b/i;
const ACHIEVE = /\b(achievements?|awards?|recognitions?|rankings?|accreditations?|honou?rs?|accolades|certifications?|rated|nirf|naac)\b/i;
const FACILITY = /\b(facilit(?:y|ies)|infrastructure|campus|hospital|laborator(?:y|ies)|library|hostels?|clinical|amenities|equipment)\b/i;
const CONTACT = /\b(contact|address|enquir(?:y|ies)|reach us|get in touch|location|support)\b/i;

/** The kind of content a requirement label asks for. */
function kindOf(label, { all = false } = {}) {
  const text = String(label || '');
  if (PERSON_ROLE.test(text) && !CATALOGUE_NOUN.test(text.replace(PERSON_ROLE, ''))) return 'person';
  if (CATALOGUE_NOUN.test(text) && (all || LIST_WORDS.test(text) || /\b(courses?|programmes?|programs?|departments?|products?|specialit|categories|plans|features|integrations|projects?|skills?|services?|pricing|packages?|menus?|rooms?|listings?|branches|locations)\b/i.test(text))) return 'catalogue';
  if (ACHIEVE.test(text)) return 'achievements';
  if (HISTORY.test(text)) return 'timeline';
  if (FACILITY.test(text)) return 'facilities';
  if (CONTACT.test(text)) return 'contact';
  return 'narrative';
}

const CATEGORY = { person: 'people', catalogue: 'catalogue', timeline: 'history', achievements: 'recognition', facilities: 'facilities', narrative: 'about', contact: 'contact' };
const PAGE_HINT = { person: 'Leadership', catalogue: '', timeline: 'About', achievements: 'Achievements', facilities: 'Facilities', narrative: 'About', contact: 'Contact' };

const CONTENT_NEEDS = {
  person: (label) => [`full name and role of the person behind "${label}"`, 'a biography written from sourced facts', 'a portrait only if it can be verified'],
  catalogue: (label) => [`the actual named items of "${label}" (every item, not a description of them)`, 'grouped into meaningful categories', 'duration, eligibility or price only where a source states it'],
  timeline: () => ['dated milestones in order', 'only dates a source states'],
  achievements: () => ['specific awards, rankings or accreditations with their year and awarding body', 'only supported facts'],
  facilities: () => ['named facilities or services with what each offers'],
  narrative: () => ['specific explanatory content, not generic marketing text'],
  contact: () => ['address, phone or email only where the request or a source gives them']
};

function assetsFor(kind, label, siteName) {
  if (kind === 'person') return [{ type: 'person_portrait', subject: label, priority: 'required' }];
  if (kind === 'timeline') return [{ type: 'historical', subject: `${siteName || 'the organisation'} history`, priority: 'recommended' }];
  if (kind === 'facilities') return [{ type: 'facility', subject: label, priority: 'recommended' }];
  if (kind === 'achievements') return [{ type: 'none', subject: '', priority: 'recommended' }];
  return [];
}

/** Web addresses written in the request (the official site, a reference page). */
function urlsIn(prompt) {
  const found = new Set();
  for (const match of String(prompt || '').matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) found.add(match[0].replace(/[.,;]+$/, ''));
  for (const match of String(prompt || '').matchAll(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|ac\.in|edu\.in|in|co|io|ai|gov)(?:\/[^\s<>"')\]]*)?/gi)) {
    if (![...found].some((url) => url.includes(match[0]))) found.add(`https://${match[0].replace(/[.,;]+$/, '')}`);
  }
  return [...found].slice(0, 3);
}

const STOP_AFTER = /\b(?:taking|talking|covering|including|includes|with|about|that|which|having|featuring|containing|showing|where|and its|and their|focusing|describing|detailing|for its|its)\b/i;

/** The name of the organisation, person or product the site is for, read from the request ("website for the saveetha medical college talking about..."). */
function siteNameIn(prompt) {
  const text = String(prompt || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ');
  const match = /\b(?:website|site|web ?page|portal|app|platform|store|shop)\s+(?:for|of|about)\s+(?:the\s+)?(.+)/i.exec(text) || /\b(?:for|of)\s+(?:the\s+)?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)+)/.exec(text);
  if (!match) return '';
  const tail = match[1];
  const stop = STOP_AFTER.exec(tail);
  const name = (stop ? tail.slice(0, stop.index) : tail).replace(/[,.;:].*$/, '').trim();
  const words = name.split(' ').filter(Boolean).slice(0, 8);
  if (!words.length || words.length > 8) return '';
  return words.map((word) => (word === word.toLowerCase() && !/^(?:and|of|the|for|in|at|&)$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');
}

const SYSTEM = `You read a website request completely and turn EVERY detail into a tracked requirement. Reply with ONLY JSON, no prose:
{"site": {"name": string, "kind": string, "officialUrl": string}, "requirements": [{"label": string, "description": string, "category": string, "contentKind": "person"|"catalogue"|"timeline"|"achievements"|"facilities"|"narrative"|"contact", "importance": "core"|"supporting", "expectedPage": string, "expectedSection": string, "requiredContent": [string], "requiredAssets": [{"type": "person_portrait"|"campus"|"historical"|"facility"|"product"|"team"|"none", "subject": string, "priority": "required"|"recommended"}]}]}
RULES: "site.name" is the organisation, person or product the site is about (from the request; never invented); "officialUrl" only when the request gives a web address. Do NOT shorten the request to a description: every thing it names or clearly implies becomes its own requirement. Split broad asks into their parts: "all the courses" becomes separate catalogue requirements such as undergraduate programmes, postgraduate programmes, specialisations and departments (use the categories that fit THIS kind of organisation: for a store, product categories and product listings; for software, features, integrations and plans); "chancellor" becomes the person's profile, and the portrait is a required asset of that profile; "legacy" becomes the introduction/history and its milestones; "achievements" becomes supported awards and recognitions; "clinical facilities" or "campus" becomes the facilities requirement. A site introduction or identity requirement is always included. "label" is 2-6 words; "description" says exactly what must appear; "requiredContent" lists the concrete content (for a catalogue: "the actual item names", never "a description of the items"). "expectedPage" and "expectedSection" propose where it belongs. "core" = the request names it; "supporting" = implied. Do not invent requirements the request does not support.`;

function normalizeOne(raw, index, siteName) {
  const label = String(raw?.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!label) return null;
  const kind = KINDS.includes(raw?.contentKind) ? raw.contentKind : kindOf(`${label} ${raw?.description || ''}`);
  const assets = (Array.isArray(raw?.requiredAssets) ? raw.requiredAssets : []).filter((item) => ASSET_TYPES.includes(item?.type)).map((item) => ({ type: item.type, subject: String(item.subject || '').slice(0, 120), priority: item.priority === 'required' ? 'required' : 'recommended' })).filter((item) => item.type !== 'none');
  return {
    id: `r${index + 1}`, label, description: String(raw?.description || label).replace(/\s+/g, ' ').trim().slice(0, 300), category: String(raw?.category || CATEGORY[kind]).slice(0, 40), contentKind: kind,
    importance: raw?.importance === 'supporting' ? 'supporting' : 'core', expectedPage: String(raw?.expectedPage || PAGE_HINT[kind] || '').slice(0, 60), expectedSection: String(raw?.expectedSection || label).slice(0, 80),
    requiredContent: (Array.isArray(raw?.requiredContent) && raw.requiredContent.length ? raw.requiredContent : CONTENT_NEEDS[kind](label)).map((item) => String(item).slice(0, 200)).slice(0, 8),
    requiredAssets: assets.length ? assets : assetsFor(kind, label, siteName).filter((item) => item.type !== 'none'),
    sectionIds: [], status: 'pending', evidence: '', note: '', source: 'prompt', knowledgeIds: []
  };
}

/** The rule-based reading: the same output from the words of the request alone. */
function heuristicReading(prompt) {
  const name = siteNameIn(prompt);
  const all = LIST_WORDS.test(prompt);
  // Only the part of the request after "covering / about / including ..." lists topics; the part before it names the site.
  const lead = /\b(?:covering|covers|including|includes|talking about|taking about|talks about|that cover|featuring|containing|focusing on|about)\b\s*(.{8,})$/is.exec(String(prompt).replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' '));
  const labels = heuristicRequirements(lead ? lead[1] : prompt).map((item) => item.label.replace(/^(?:there|its|their|his|her|our)\s+/i, ''));
  const items = [];
  const seen = new Set();
  const add = (label, extra = {}) => { const key = label.toLowerCase(); if (!seen.has(key)) { seen.add(key); items.push({ label, ...extra }); } };
  if (name) add(`${name} introduction`, { description: `Who ${name} is and what it offers.`, contentKind: 'narrative', expectedPage: 'Home', expectedSection: 'Introduction' });
  for (const original of labels) {
    // "chancellor legacy": a role followed by a topic word names two things.
    const split = /^(.*?\b(?:chancellor|founder|ceo|chairman|president|principal|director|dean|owner))\s+(legacy|history|story|achievements?|awards?|journey|vision)$/i.exec(original);
    if (split) { add(split[1].replace(/^./, (c) => c.toUpperCase()), { contentKind: 'person' }); add(split[2].replace(/^./, (c) => c.toUpperCase()), { contentKind: kindOf(split[2]) }); continue; }
    const label = original;
    const kind = kindOf(label, { all });
    if (kind === 'catalogue' && all && /\bcourses?|programmes?|programs?\b/i.test(label)) {
      add(`Undergraduate ${label.replace(/^all\s+(?:the\s+)?/i, '')}`.replace(/\s+/g, ' '), { contentKind: 'catalogue', expectedPage: 'Academics' });
      add(`Postgraduate ${label.replace(/^all\s+(?:the\s+)?/i, '')}`.replace(/\s+/g, ' '), { contentKind: 'catalogue', expectedPage: 'Academics' });
      add(`Departments and specialisations`, { contentKind: 'catalogue', expectedPage: 'Academics' });
    } else add(label.replace(/^(?:all\s+)?(?:the\s+)?/i, '').replace(/^./, (c) => c.toUpperCase()), { contentKind: kind });
  }
  return { site: { name, kind: '', officialUrl: urlsIn(prompt)[0] || '' }, requirements: items };
}

/**
 * @param input { prompt, ask }  ask(system, user) -> text, or null
 * @returns {{ site: { name, kind, officialUrl }, requirements, urls, source: 'model'|'heuristic' }}
 */
async function extractRequirements({ prompt, ask = null } = {}) {
  let reading = null;
  let source = 'heuristic';
  if (ask) {
    try {
      const text = await ask(SYSTEM, `WEBSITE REQUEST (read all of it):\n${String(prompt || '').slice(0, 8000)}`);
      const json = (/\{[\s\S]*\}/.exec(String(text || '')) || [])[0];
      const parsed = json ? JSON.parse(json) : null;
      if (parsed && Array.isArray(parsed.requirements) && parsed.requirements.length) { reading = parsed; source = 'model'; }
    } catch { reading = null; }
  }
  if (!reading) reading = heuristicReading(prompt);
  const urls = urlsIn(prompt);
  const siteName = String(reading.site?.name || siteNameIn(prompt) || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const seen = new Set();
  const requirements = [];
  for (const raw of reading.requirements.slice(0, 40)) {
    const item = normalizeOne(raw, requirements.length, siteName);
    if (!item || seen.has(item.label.toLowerCase())) continue;
    seen.add(item.label.toLowerCase());
    requirements.push(item);
  }
  // The site's identity and introduction are always tracked, whatever the reading produced.
  if (siteName && !requirements.some((item) => item.contentKind === 'narrative' && terms(item.label).some((word) => terms(siteName).includes(word)))) {
    requirements.unshift(normalizeOne({ label: `${siteName} introduction`, description: `Who ${siteName} is and what it offers.`, contentKind: 'narrative', importance: 'core', expectedPage: 'Home', expectedSection: 'Introduction' }, 0, siteName));
    requirements.forEach((item, index) => { item.id = `r${index + 1}`; });
  }
  return { site: { name: siteName, kind: String(reading.site?.kind || '').slice(0, 60), officialUrl: String(reading.site?.officialUrl || urls[0] || '') }, requirements, urls, source };
}

module.exports = { extractRequirements, heuristicReading, kindOf, urlsIn, siteNameIn, normalizeOne, KINDS, SYSTEM };
