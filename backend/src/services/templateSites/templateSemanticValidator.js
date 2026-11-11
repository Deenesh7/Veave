/**
 * Semantic checks of a generated page: not "does it compile" but "is this the right content for THIS website".
 *
 * Deterministic checks (no model): words and names that belong to the template's original website, the template's own pictures,
 * facts nobody provided, links to pages the plan does not have, and the planned sections of the page. Then one short judgement by
 * the model about whether the page serves its purpose for this kind of website. Problems come back in the same shape as the other
 * page checks, so the existing targeted repair loop fixes them. Nothing here regenerates anything.
 */
const BaseLLMProvider = require('../llm/baseProvider');
const { issue } = require('./templateValidationService');
const logger = require('../../utils/logger');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STOP = new Set(['the', 'and', 'for', 'with', 'our', 'your', 'from', 'that', 'this', 'are', 'you', 'all', 'about', 'page', 'section']);

/** The words a visitor can read in a source file: JSX text, text-like attributes and the strings of data objects (class names are not text). */
function visibleText(source) {
  const text = String(source || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/^import .*$/gm, '');
  const out = [];
  for (const match of text.matchAll(/>([^<>{}]{2,})</g)) out.push(match[1]);
  for (const match of text.matchAll(/\b(?:alt|title|placeholder|aria-label|label|description|eyebrow|heading|subtitle|text|cta|content)\s*=\s*(?:"([^"]+)"|\{['"`]([^'"`]+)['"`]\})/g)) out.push(match[1] || match[2]);
  for (const match of text.matchAll(/\b(?:title|label|name|summary|description|text|heading|question|answer|category|role|quote|eyebrow|tagline|alt)\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g)) out.push(match[1] || match[2] || match[3]);
  for (const match of text.matchAll(/\{\s*['"`]([^'"`{}]{3,})['"`]\s*\}/g)) out.push(match[1]);
  return out.map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** Which of `terms` appear in `text` as whole words (plural allowed). */
function findAvoided(text, terms = []) {
  const found = [];
  for (const term of terms) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(String(term).trim())}(?:s|es)?(?![A-Za-z0-9])`, 'i');
    if (term && pattern.test(text)) found.push(term);
  }
  return found;
}

const STAT = /\b\d[\d,.]*\s?(?:\+|%)(?![\w])|\b\d[\d,]*\+?\s+(?:students?|faculty|alumni|graduates|recruiters|companies|patents|publications|beds|doctors|clients|customers|users|employees|countries|awards|acres|programs?|courses?)\b/gi;
const CLAIM = /\b(?:ranked|ranking\s*#?\d|top\s+\d+|NAAC|NBA|NIRF|AICTE|UGC|accredited|award[- ]winning|best in|No\.\s?1|#1|ISO\s*\d{4,5}|NABH|Joint Commission)\b/gi;

/** Statistics, rankings and accreditation claims that the owner did not write (anything inside [brackets] is a placeholder and fine). */
function unprovidedFacts(text, brief) {
  const stripped = String(text);
  const given = String(brief || '').toLowerCase();
  const found = new Set();
  for (const match of stripped.matchAll(STAT)) if (!given.includes(match[0].trim().toLowerCase())) found.add(match[0].trim());
  for (const match of stripped.matchAll(CLAIM)) if (!given.includes(match[0].trim().toLowerCase())) found.add(match[0].trim());
  return [...found].slice(0, 6);
}

// Text that is a stand-in for content instead of content: [bracket placeholders], lorem ipsum, {{tokens}}, "insert X here".
const PLACEHOLDER = /\[[^\]\n]{2,60}\]|\blorem ipsum\b|\bdolor sit amet\b|\{\{[^}\n]{1,60}\}\}|\b(?:insert|add|enter|your)\s+[a-z ]{2,30}\s+here\b|\bTBD\b/gi;
function placeholders(text) {
  return [...new Set([...String(text || '').matchAll(PLACEHOLDER)].map((match) => match[0].trim()))].slice(0, 6);
}

const words = (text) => (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length >= 4 && !STOP.has(word));

/** Problems found without asking a model. `files` are the candidate files; `scope.ownedList` says which of them this page owns. */
function deterministicProblems({ plan, page, files, scope, brief }) {
  const problems = [];
  const owned = scope.ownedList.map((path) => files.find((file) => file.path === path)).filter(Boolean);
  const source = owned.map((file) => String(file.content || '')).join('\n');
  const text = owned.map((file) => visibleText(file.content)).join('\n');
  const entry = plan.pages.find((item) => item.route === page.route) || null;

  const leaked = findAvoided(text, plan.avoidTerms);
  if (leaked.length) {
    const map = plan.terminology.filter((item) => leaked.some((term) => term.toLowerCase() === item.from.toLowerCase())).map((item) => `${item.from} -> ${item.to}`);
    problems.push(issue('semantic', `The page still contains content from the template's original website: ${leaked.slice(0, 8).map((term) => `"${term}"`).join(', ')}.`, { path: page.componentPath, route: page.route, cause: `The template was made for a different kind of website; this one is ${plan.identity.category}.`, action: `Rewrite those headings, sentences, labels and captions for the ${plan.identity.category} website${map.length ? ` (${map.join('; ')})` : ''}. Do not just swap one word.` }));
  }
  if (!plan.matchesTemplate && /\/images\/(?:hero|card-\d)\.svg/.test(source)) {
    problems.push(issue('semantic', 'The page still uses the template\'s own pictures, which show a different kind of website.', { path: page.componentPath, route: page.route, cause: 'The template\'s illustrations are not about this website.', action: 'Use the owner\'s uploaded photos if listed, otherwise the neutral photo slots /images/slot-hero.svg, /images/slot-1.svg, /images/slot-2.svg, /images/slot-3.svg.' }));
  }
  // Pictures made for this page must really be on it, and the grey photo slot must not be shown where a real picture exists.
  // Only the page and its own components count here (sample-record data files are written by the identity step, not by the page).
  const markup = owned.filter((file) => !file.path.startsWith('src/data/')).map((file) => String(file.content || '')).join('\n');
  const madeForPage = require('./templateSiteImages').picturesForPage(plan, page.route);
  const unused = madeForPage.filter((picture) => !markup.includes(picture.path));
  if (unused.length) problems.push(issue('semantic', `The picture${unused.length === 1 ? '' : 's'} made for this page ${unused.length === 1 ? 'is' : 'are'} not placed on it: ${unused.map((picture) => picture.path).join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Each planned picture belongs on its page.', action: `Place ${unused.map((picture) => `<img src="${picture.path}" alt="${picture.alt}" className="w-full h-full object-cover">`).join(' and ')} in a fixed-aspect frame (${unused[0].aspect === '16:9' ? 'aspect-video' : unused[0].aspect === '1:1' ? 'aspect-square' : 'aspect-[4/3]'}) in the section where it fits best.` }));
  if (madeForPage.length && /\/images\/slot-[a-z0-9]+\.svg/.test(markup)) problems.push(issue('semantic', 'The page still shows a grey "Add your photo here" slot although a real picture was made for it.', { path: page.componentPath, route: page.route, cause: 'The neutral slots are only for pages without a picture.', action: 'Replace the slot image with the picture made for this page.' }));
  const foreign = [...source.matchAll(/\/images\/gen-([a-z0-9-]+)\.jpg/g)].map((match) => (plan.images || []).find((item) => item.key === match[1])).filter((item) => item && item.page && item.page !== page.route);
  if (foreign.length) problems.push(issue('semantic', `The page uses a picture that was made for another page: ${[...new Set(foreign.map((item) => `/images/gen-${item.key}.jpg`))].join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Each page gets only its own pictures.', action: 'Use only the pictures listed for this page, or a neutral photo slot.' }));
  const holes = placeholders(text);
  if (holes.length) problems.push(issue('semantic', `The page contains placeholder text instead of real content: ${holes.map((item) => `"${item}"`).join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Every section must be complete, meaningful content for this website.', action: 'Write the real wording (general and truthful where a detail is unknown). Never use square brackets, lorem ipsum or "insert ... here".' }));
  const facts = unprovidedFacts(text, brief);
  if (facts.length) {
    problems.push(issue('semantic', `The page states facts that were not provided: ${facts.map((fact) => `"${fact}"`).join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Statistics, rankings and accreditation must come from the owner.', action: 'Remove the claim or replace the value with a clear placeholder such as [Add number]; describe things in general terms.' }));
  }
  const routes = new Set(plan.pages.map((item) => item.route));
  const badLinks = new Set();
  for (const match of source.matchAll(/\b(?:to|href)=["'](\/[^"'#?\s]*)["']/g)) {
    const target = match[1].replace(/\/+$/, '') || '/';
    if (!/\.[a-z0-9]{2,5}$/i.test(target) && !routes.has(target)) badLinks.add(target);
  }
  if (badLinks.size) problems.push(issue('semantic', `The page links to ${[...badLinks].map((link) => `"${link}"`).join(', ')}, which ${badLinks.size === 1 ? 'is not a page' : 'are not pages'} of this website.`, { path: page.componentPath, route: page.route, cause: 'Links must point at planned pages.', action: `Link only to: ${[...routes].join(', ')}.` }));
  if (entry?.sections?.length) {
    const lower = text.toLowerCase();
    const present = entry.sections.filter((section) => { const tokens = words(section); return !tokens.length || tokens.some((token) => lower.includes(token)); });
    if (present.length === 0) problems.push(issue('semantic', `None of the planned sections of the ${page.name} page are on it (${entry.sections.slice(0, 6).join(', ')}).`, { path: page.componentPath, route: page.route, cause: 'The page does not serve its purpose in the website plan.', action: `Build the page around these sections: ${entry.sections.join(', ')}. Purpose: ${entry.purpose}` }));
  }
  return problems;
}

function defaultJudge() {
  const openrouterService = require('../ai/openrouterService');
  const model = process.env.TEMPLATE_JUDGE_MODEL || process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const response = await openrouterService.generateCompletion(messages, { model, temperature: 0, max_tokens: 800, timeout: 120000, response_format: { type: 'json_object' }, reasoning: { effort: 'minimal', exclude: true }, signal });
    return { content: response?.content || '', usage: response?.usage || null };
  };
}

const judgeEnabled = (deps = {}) => {
  if (deps.judgePage === null) return false;
  if (deps.judgePage) return true;
  if (String(process.env.TEMPLATE_SEMANTIC_JUDGE || 'on').toLowerCase() === 'off') return false;
  const key = process.env.OPENROUTER_API_KEY;
  return Boolean(key && !/^your[_-]/i.test(key) && key !== 'undefined');
};

/** One short judgement: does this page serve its purpose for this kind of website? Never blocks on its own failure. */
async function judge({ plan, page, files, scope, deps = {}, signal }) {
  if (!judgeEnabled(deps)) return { problems: [], usage: null };
  const owned = scope.ownedList.map((path) => files.find((file) => file.path === path)).filter(Boolean);
  const text = owned.map((file) => visibleText(file.content)).join('\n').slice(0, 6000);
  const entry = plan.pages.find((item) => item.route === page.route);
  const messages = [
    { role: 'system', content: 'You review ONE page of a generated website for RELEVANCE only. Answer with JSON only: {"ok": boolean, "problems": [{"where": string, "reason": string, "fix": string}]}. Report ONLY: text, headings, calls to action or sections that belong to a different kind of website than the one described; or a page whose content mostly has nothing to do with its stated purpose. Do NOT report: bracketed placeholders such as [Add address] (they are required, because the owner has not supplied those facts); general or introductory wording; missing detail; wording or style. If the page is about the right subject for its purpose, answer {"ok": true, "problems": []}.' },
    { role: 'user', content: `WEBSITE: ${plan.identity.name} — a ${plan.identity.category} (${plan.identity.organizationType}). Purpose: ${plan.identity.purpose}. Audience: ${plan.identity.audience.join(', ')}.\nPAGE: ${page.name} (${page.route}). Purpose: ${entry?.purpose || page.description || ''}. Planned sections: ${(entry?.sections || []).join(', ')}.\nTERMS THAT BELONG TO A DIFFERENT WEBSITE (must not appear): ${plan.avoidTerms.join(', ') || 'none'}.\n\nTHE TEXT ON THE PAGE:\n${text}` }
  ];
  try {
    const answer = await (deps.judgePage || defaultJudge())(messages, { signal });
    const parsed = typeof answer?.content === 'object' && answer.content ? answer.content : BaseLLMProvider.safeParseJson(answer?.content);
    const problems = (Array.isArray(parsed?.problems) ? parsed.problems : []).filter((item) => item?.reason).slice(0, 5).map((item) => issue('semantic-review', `${String(item.where || 'The page').slice(0, 80)}: ${String(item.reason).slice(0, 220)}`, { path: page.componentPath, route: page.route, cause: 'The content does not fit this website.', action: String(item.fix || 'Rewrite it for this website.').slice(0, 220) }));
    return { problems: parsed?.ok === false || problems.length ? problems : [], usage: answer?.usage || null };
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    logger.warn(`Semantic review of ${page.name} was skipped: ${error.message}`);
    return { problems: [], usage: null };
  }
}

/** All semantic problems of a candidate page: deterministic first, the judge only when those pass (it is the expensive one). */
async function semanticProblems({ plan, page, files, scope, brief, deps, signal }) {
  const found = deterministicProblems({ plan, page, files, scope, brief: brief || plan.brief });
  if (found.length) return { problems: found, usage: null };
  return judge({ plan, page, files, scope, deps, signal });
}

/** The title and meta description of index.html (visibleText only reads JSX and data files). */
const htmlText = (source) => [...String(source || '').matchAll(/<title>([^<]*)<\/title>|<meta[^>]*\bcontent="([^"]*)"/gi)].map((match) => match[1] || match[2]).filter(Boolean).join('\n');

const DETERMINERS = new Set(['the', 'our', 'this', 'that', 'your', 'a', 'an', 'at', 'in', 'of', 'for', 'with', 'and', 'every', 'each', 'welcome', 'explore', 'join', 'apply', 'visit', 'about', 'why', 'choose', 'contact', 'discover', 'see', 'meet', 'find', 'learn', 'study', 'to', 'from', 'by', 'on', 'as', 'all', 'any', 'new', 'best', 'top', 'my', 'we', 'you', 'it', 'is', 'are']);

/** Names of OTHER organisations of the same kind written on a page ("Foo College" where the website is "Your College"). */
function foreignBrands(text, plan, brief = '') {
  // Only the kind of organisation itself counts ("college" in "Engineering college", "hospital" in "Hospital"), not its adjectives.
  const head = (text) => words(text).slice(-1);
  const orgWords = new Set([...head(plan.identity.organizationType), ...head(plan.identity.category)]);
  if (!orgWords.size) return [];
  const own = String(plan.identity.name || '').toLowerCase();
  const given = String(brief || '').toLowerCase();
  // Words the plan itself uses (page names, sections, menu, buttons) are headings, not another organisation's name.
  const vocabulary = new Set([...(plan.pages || []).flatMap((page) => [page.name, ...(page.sections || [])]), ...(plan.navigation || []).map((item) => item.label), plan.cta?.label].flatMap((text) => words(text)));
  const found = new Set();
  const pattern = new RegExp(`((?:\\b[A-Z][\\p{L}&'-]*\\s+){1,4})(${[...orgWords].map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join('|')})\\b`, 'gu');
  for (const match of String(text).matchAll(pattern)) {
    const proper = match[1].trim().split(/\s+/).filter((word) => !DETERMINERS.has(word.toLowerCase()) && !orgWords.has(word.toLowerCase()));
    if (!proper.length || proper.every((word) => vocabulary.has(word.toLowerCase()))) continue;
    const name = `${proper.join(' ')} ${match[2]}`;
    if (own.includes(proper.join(' ').toLowerCase()) || given.includes(proper.join(' ').toLowerCase())) continue;
    found.add(name);
  }
  return [...found].slice(0, 4);
}

/**
 * Checks of the finished website as a whole (after every page is written): template wording left in SHARED files (menu, footer, sample
 * records, title, components), placeholders anywhere, other organisations' names, menu links to missing pages, and pages that are still the
 * template's own. Returns [{ pageId|null, message }]; null means "shared" (the caller attaches it to the home page).
 */
function siteWideProblems({ plan, files, pages, originalFiles = [], brief = '' }) {
  const out = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const original = new Map(originalFiles.map((file) => [file.path, file.content]));
  const shared = files.filter((file) => file.encoding !== 'base64' && (/^src\/(?:components|data)\//.test(file.path) || file.path === 'index.html' || file.path === 'src/App.jsx'));
  for (const file of shared) {
    const text = file.path === 'index.html' ? htmlText(file.content) : visibleText(file.content);
    const leaked = plan.matchesTemplate ? [] : findAvoided(text, plan.avoidTerms || []);
    if (leaked.length) out.push({ pageId: null, message: `${file.path} still has wording of the template's original website: ${leaked.slice(0, 5).join(', ')}.` });
    const holes = placeholders(text);
    if (holes.length) out.push({ pageId: null, message: `${file.path} contains placeholder text: ${holes.slice(0, 4).join(', ')}.` });
  }
  const site = byPath.get('src/data/site.js');
  const routes = new Set(pages.map((page) => page.route));
  for (const match of String(site?.content || '').matchAll(/\bto:\s*['"](\/[^'"#?]*)['"]/g)) {
    const target = match[1].replace(/\/+$/, '') || '/';
    if (!routes.has(target)) out.push({ pageId: null, message: `The menu or footer links to ${target}, which is not a page of this website.` });
  }
  for (const page of pages) {
    const file = byPath.get(page.componentPath);
    if (!file) continue;
    const text = visibleText(file.content);
    if (!plan.matchesTemplate && original.get(page.componentPath) === file.content) out.push({ pageId: String(page._id), message: `This page is still the template's original page; it was not written for this website.` });
    const holes = placeholders(text);
    if (holes.length) out.push({ pageId: String(page._id), message: `Placeholder text remains: ${holes.slice(0, 4).join(', ')}.` });
    const others = foreignBrands(text, plan, brief);
    if (others.length) out.push({ pageId: String(page._id), message: `The page names another organisation than "${plan.identity.name}": ${others.join(', ')}. Every page must use the same website name.` });
  }
  return out;
}

module.exports = { placeholders, foreignBrands, siteWideProblems, visibleText, findAvoided, unprovidedFacts, deterministicProblems, semanticProblems, judge, judgeEnabled };
