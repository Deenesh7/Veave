/**
 * Understands what an owner's instruction MEANS (not which keywords it contains) and turns it into a validated, structured intent:
 * what kind of change, how far it reaches, which operations it contains, and what must be preserved. The generator, the validators and
 * the reviewer all work from that one object, so a misspelt or loosely worded instruction ("rewirte this page") is handled like a clear one.
 *
 * Order of work (cheapest first):
 *   1. a deterministic, typo-tolerant reading of the words (no model call);
 *   2. if that reading is not certain, ONE small structured model call with the page context and recent instructions;
 *   3. the answer is schema-validated; anything invalid, slow or failed falls back to the deterministic reading, so a job is never blocked.
 * Switched on with INTENT_ENGINE=on (off: nothing here is used and the previous behaviour is unchanged).
 */
const crypto = require('node:crypto');
const logger = require('../../utils/logger');

const INTENTS = ['full_rewrite', 'full_redesign', 'partial_redesign', 'targeted_edit', 'content_expansion', 'content_replacement', 'section_addition', 'section_removal', 'bug_fix', 'responsive_improvement', 'functionality_change', 'seo_improvement', 'website_wide_change', 'image_replacement', 'style_change', 'clone_website', 'new_website'];
const SCOPES = ['element', 'section', 'multiple_sections', 'entire_page', 'multiple_pages', 'entire_website'];
const OPERATIONS = ['replace_content', 'redesign_layout', 'edit_target', 'add_content', 'add_section', 'remove_section', 'remove_content', 'fix_bug', 'make_responsive', 'change_style', 'replace_image', 'change_functionality', 'improve_seo', 'apply_site_wide', 'revert_previous'];

const CONFIDENT = 0.5; // below this the engine does not change any rule: the previous behaviour applies
const FAST_PATH = 0.85; // at or above this the words alone are clear enough: no model call

const enabled = (deps = {}) => (deps.intentEngine !== undefined ? Boolean(deps.intentEngine) : String(process.env.INTENT_ENGINE || 'off').toLowerCase() === 'on');

/* ------------------------------------------------ typo-tolerant word reading ------------------------------------------------ */

// Damerau-Levenshtein distance (one swap of two neighbouring letters counts as one mistake: "rewirte" -> "rewrite").
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

// Words that carry meaning for the reading. Each group lists its canonical word; a misspelling within 1 (short words) or 2 (long words) mistakes of one of them counts.
const VOCAB = {
  rewrite: ['rewrite', 'rewriting', 'redo', 'recreate', 'rebuild', 'revamp', 'overhaul', 'reimagine', 'regenerate'],
  redesign: ['redesign', 'restyle', 'modernize', 'modernise', 'modern', 'professional', 'prettier', 'polish', 'beautiful', 'attractive', 'stylish', 'premium', 'cleaner'],
  change: ['change', 'changes', 'update', 'modify', 'edit', 'alter', 'adjust', 'different', 'replace', 'swap', 'new'],
  remove: ['remove', 'delete', 'erase', 'eliminate', 'drop', 'hide'],
  add: ['add', 'insert', 'include', 'append', 'create'],
  fix: ['fix', 'broken', 'bug', 'error', 'crash', 'repair', 'wrong'],
  responsive: ['responsive', 'mobile', 'tablet', 'phone', 'breakpoint'],
  whole: ['whole', 'entire', 'everything', 'completely', 'totally', 'fully', 'all', 'every'],
  only: ['only', 'just', 'but', 'except'],
  keep: ['keep', 'preserve', 'retain', 'same', 'unchanged'],
  undo: ['undo', 'revert', 'rollback'],
  text: ['text', 'wording', 'copy', 'words', 'content', 'heading', 'paragraph'],
  layout: ['layout', 'design', 'style', 'look', 'appearance', 'theme'],
  image: ['image', 'images', 'photo', 'photos', 'picture', 'pictures', 'logo', 'banner'],
  color: ['color', 'colour', 'background', 'font', 'bigger', 'larger', 'smaller', 'bold'],
  seo: ['seo', 'metadata', 'keywords'],
  site: ['website', 'site', 'pages'],
  page: ['page'],
  section: ['section', 'sections'],
  part: ['navbar', 'nav', 'navigation', 'menu', 'header', 'footer', 'hero', 'sidebar', 'banner', 'button', 'form', 'pricing', 'testimonials', 'contact', 'gallery', 'card', 'cards'],
  // The short misspellings are listed because words under six letters are not matched loosely.
  lookup: ['search', 'serch', 'seach', 'serach', 'searh', 'saerch', 'research', 'reserch', 'google', 'browse', 'lookup', 'find', 'look', 'fetch', 'collect', 'gather'],
  web: ['online', 'internet', 'web', 'google', 'net', 'website'],
  behaviour: ['submit', 'click', 'search', 'filter', 'sticky', 'animation', 'popup', 'modal', 'login', 'checkout', 'validation']
};
const LOOKUP = new Map();
for (const [group, list] of Object.entries(VOCAB)) for (const word of list) if (!LOOKUP.has(word)) LOOKUP.set(word, group);

/** Group of a word, tolerating typos ("chnage" -> change, "rewirte" -> rewrite). Words under six letters must match exactly. */
function groupOf(word) {
  const direct = LOOKUP.get(word);
  if (direct) return { group: direct, exact: true };
  // Only longer words are matched loosely: "table" is one letter from "tablet" but is not a command.
  if (word.length < 6) return null;
  const allowed = word.length >= 9 ? 2 : 1;
  let best = null;
  for (const [known, group] of LOOKUP) {
    if (Math.abs(known.length - word.length) > allowed || known.length < 5) continue;
    const d = distance(word, known);
    if (d <= allowed && (!best || d < best.d)) best = { group, exact: false, d };
  }
  return best;
}

const ownerPart = (instruction) => String(instruction || '').split(/\n\n(?:PAGE CONTEXT|SECTION CONTENT|\(The owner|\(A previous try)/)[0].trim();

function readWords(text) {
  const words = String(text || '').toLowerCase().match(/[a-z']+/g) || [];
  const found = {};
  let typos = 0;
  words.forEach((word, index) => {
    const hit = groupOf(word);
    if (!hit) return;
    (found[hit.group] = found[hit.group] || []).push(index);
    if (!hit.exact) typos += 1;
  });
  return { words, found, typos, has: (group) => Boolean(found[group]?.length) };
}

/* ------------------------------------------------ the structured intent ------------------------------------------------ */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const str = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Checks and normalises an intent (from the model or from the rules). Returns null when it cannot be trusted. */
function validateIntent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const intent = str(raw.intent, 40);
  if (!INTENTS.includes(intent)) return null;
  const scope = SCOPES.includes(str(raw.scope, 40)) ? str(raw.scope, 40) : null;
  if (!scope) return null;
  const operations = (Array.isArray(raw.operations) ? raw.operations : []).slice(0, 8)
    .map((op) => ({ type: str(op?.type, 40), target: str(op?.target, 120) || 'entire_page' }))
    .filter((op) => OPERATIONS.includes(op.type));
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const rewriteRequired = bool(raw.rewrite_required, intent === 'full_rewrite');
  return {
    intent, scope,
    target: (Array.isArray(raw.target) ? raw.target : []).slice(0, 10).map((item) => str(item, 120)).filter(Boolean),
    operations: operations.length ? operations : [{ type: defaultOperation(intent), target: scope === 'entire_page' ? 'entire_page' : str(raw.target?.[0], 120) || scope }],
    design_change: bool(raw.design_change, false),
    content_change: bool(raw.content_change, false),
    preserve_existing_content: bool(raw.preserve_existing_content, !rewriteRequired),
    preserve_existing_layout: bool(raw.preserve_existing_layout, !rewriteRequired),
    preserve_functionality: bool(raw.preserve_functionality, true),
    rewrite_required: rewriteRequired,
    confidence: clamp01(raw.confidence),
    subject: str(raw.subject, 120) || null,
    web_research: typeof raw.web_research === 'boolean' ? raw.web_research : false,
    reasoning_summary: str(raw.reasoning_summary, 300),
    clarification: str(raw.clarification, 240) || null
  };
}

function defaultOperation(intent) {
  return ({ full_rewrite: 'replace_content', full_redesign: 'redesign_layout', partial_redesign: 'redesign_layout', targeted_edit: 'edit_target', content_expansion: 'add_content', content_replacement: 'replace_content', section_addition: 'add_section', section_removal: 'remove_section', bug_fix: 'fix_bug', responsive_improvement: 'make_responsive', functionality_change: 'change_functionality', seo_improvement: 'improve_seo', website_wide_change: 'apply_site_wide', image_replacement: 'replace_image', style_change: 'change_style' })[intent] || 'edit_target';
}

/* ------------------------------------------------ deterministic reading (fallback and fast path) ------------------------------------------------ */

const SPLIT = /\s*(?:[;,]|\band then\b|\bthen\b|\band\b|\balso\b|\bplus\b)\s+(?=(?:\w+\s+){0,2}(?:add|remove|delete|change|chnage|make|replace|fix|redesign|rewrite|update|insert|keep|undo)\b)/i;

/** Reads ONE clause of an instruction. */
function readClause(text, ctx) {
  const r = readWords(text);
  const lower = String(text).toLowerCase();
  const has = r.has;
  const selected = (ctx.selectedSections || []).length > 0;
  const named = r.found.part ? r.words.filter((word) => LOOKUP.get(word) === 'part' || (groupOf(word) || {}).group === 'part') : [];
  const wholeWord = has('whole') || /\bevery ?thing\b/.test(lower);
  const siteWord = /\b(?:whole|entire|every|all|across|throughout)\b[\s\S]{0,30}\b(?:web)?sites?\b|\b(?:web)?site-?wide\b|\bevery page\b|\ball (?:the )?pages\b|\bacross\b[\s\S]{0,20}\bpages?\b|\bwhole (?:web)?site\b|\bother pages\b/.test(lower);
  const pageWord = has('page') || /\bthis (?:design|layout|look)\b/.test(lower);
  let scope = siteWord ? 'entire_website' : selected ? ((ctx.selectedSections || []).length > 1 ? 'multiple_sections' : 'section') : named.length || has('section') ? 'section' : 'entire_page';
  if (!siteWord && !selected && !named.length && /\b(?:button|link|heading|title|this|that|it)\b/.test(lower) && ctx.selectedElement) scope = 'element';
  const target = [...new Set(named)].slice(0, 6);

  const clause = { text, scope, target, design_change: false, content_change: false, preserveContent: null, preserveLayout: null, score: 0.7 };
  const set = (intent, op, score, extra = {}) => Object.assign(clause, { intent, op, score }, extra);

  const negatedLayout = /\b(?:do not|don't|dont|without|never)\b[\s\S]{0,25}\b(?:change|touch|alter|modify)\b[\s\S]{0,25}\b(?:layout|design|style|look)\b/.test(lower) || (has('keep') && has('layout') && has('text') && has('change'));
  const keepRest = has('only') && (has('keep') || /\beverything else\b|\bremaining\b|\brest\b|\bonly\b/.test(lower)) || /\bkeep (?:everything|the rest|the remaining)\b|\beverything else\b/.test(lower);

  if (has('undo')) return set('targeted_edit', 'revert_previous', 0.9, { scope: 'entire_page', target: [], preserveContent: true, preserveLayout: true });
  if (negatedLayout) return set('content_replacement', 'replace_content', 0.88, { content_change: true, preserveLayout: true, preserveContent: false });
  if (has('rewrite') && !has('only')) {
    if (siteWord) return set('website_wide_change', 'apply_site_wide', 0.82, { design_change: true, content_change: true, preserveContent: false, preserveLayout: false });
    if (scope === 'entire_page' || wholeWord || pageWord) return set('full_rewrite', 'replace_content', r.typos ? 0.8 : 0.93, { scope: 'entire_page', design_change: true, content_change: true, preserveContent: false, preserveLayout: false });
    return set('content_replacement', 'replace_content', 0.8, { content_change: true, preserveContent: false });
  }
  if (has('remove') && has('add')) return set('section_addition', 'add_section', 0.6);
  if (has('remove')) return set(has('section') || named.length || selected ? 'section_removal' : 'targeted_edit', has('section') || named.length || selected ? 'remove_section' : 'remove_content', 0.82, { content_change: true });
  if (has('fix')) return set('bug_fix', 'fix_bug', 0.85, { preserveContent: true, preserveLayout: true });
  if (has('responsive')) return set('responsive_improvement', 'make_responsive', 0.9, { design_change: true, preserveContent: true });
  if (has('seo')) return set('seo_improvement', 'improve_seo', 0.88, { preserveContent: true, preserveLayout: true });
  if (has('add') && (has('section') || /\b(?:pricing|testimonials?|faq|footer|team|gallery)\b/.test(lower))) return set('section_addition', 'add_section', 0.86, { content_change: true, preserveContent: true });
  if (has('add') && /\b(?:more|extra|additional)\b/.test(lower)) return set('content_expansion', 'add_content', 0.84, { content_change: true, preserveContent: true });
  if (has('add') && has('text')) return set('content_expansion', 'add_content', 0.8, { content_change: true, preserveContent: true });
  if (has('add') && has('image')) return set('image_replacement', 'replace_image', 0.8, { content_change: true, preserveContent: true });
  if (has('image') && has('change')) return set('image_replacement', 'replace_image', 0.8, { preserveContent: true });
  if (has('behaviour') && !has('layout')) return set('functionality_change', 'change_functionality', 0.7, { preserveContent: true });
  if (has('change') && wholeWord && !keepRest) {
    if (siteWord) return set('website_wide_change', 'apply_site_wide', 0.8, { design_change: true, content_change: true, preserveContent: false, preserveLayout: false });
    return set('full_rewrite', 'replace_content', r.typos ? 0.72 : 0.84, { scope: 'entire_page', design_change: true, content_change: true, preserveContent: false, preserveLayout: false });
  }
  if (has('redesign') || has('layout')) {
    if (keepRest) return set('targeted_edit', 'edit_target', 0.7, { design_change: true, preserveContent: true });
    if (siteWord) return set('website_wide_change', 'apply_site_wide', 0.78, { design_change: true, preserveContent: true });
    if (selected || named.length) return set('partial_redesign', 'redesign_layout', 0.72, { design_change: true, preserveContent: true });
    return set('full_redesign', 'redesign_layout', r.typos ? 0.62 : 0.74, { scope: 'entire_page', design_change: true, preserveContent: true, preserveLayout: false });
  }
  if (has('color')) return set('style_change', 'change_style', keepRest ? 0.85 : 0.78, { design_change: true, preserveContent: true, preserveLayout: true });
  if (has('change') || has('text')) return set('targeted_edit', 'edit_target', keepRest || named.length ? 0.8 : 0.55, { content_change: has('text') || !named.length, preserveContent: keepRest || named.length > 0 });
  if (siteWord) return set('website_wide_change', 'apply_site_wide', 0.65, { design_change: true, preserveContent: true });
  if (/\b(?:dont|don't|do not)\b[\s\S]{0,12}\blike\b|\bbetter\b|\bbad\b|\bugly\b|\bboring\b/.test(lower)) return set('full_redesign', 'redesign_layout', 0.55, { scope: 'entire_page', design_change: true, preserveContent: true, preserveLayout: false });
  return set('targeted_edit', 'edit_target', 0.35);
}

// Higher = reaches further. The overall intent of a multi-part instruction is its widest part.
const REACH = { new_website: 15, clone_website: 15, full_rewrite: 14, website_wide_change: 13, full_redesign: 12, partial_redesign: 10, content_replacement: 9, section_addition: 8, section_removal: 8, functionality_change: 7, content_expansion: 6, responsive_improvement: 6, image_replacement: 5, style_change: 5, seo_improvement: 4, bug_fix: 4, targeted_edit: 3 };

const SUBJECT_INTENTS = new Set(['full_rewrite', 'full_redesign', 'website_wide_change', 'content_replacement']);
const NOT_A_SUBJECT = /^(?:this|that|these|those|the|a|an|my|our|it|its|every|each|all|any|me|you|us|now|mobile|tablet|desktop|phones?|screens?|everyone|example|better|clarity|consistency|speed|seo|accessibility|users?|visitors?|(?:the )?(?:page|section|site|website|web site|design|layout|header|footer|navbar|menu))(?:\s+(?:page|section|site|website|web site|design|layout|one|part|time))?$/i;
/**
 * Does the owner ask for facts from the web ("search online to find the programmes and their fees", "serch the web for ...")? A search verb
 * close to a word for the web; typos are tolerated. "Website" alone is not the web: "add a search box to my website" is not asking for research.
 */
function asksForWebResearch(text) {
  const read = readWords(ownerPart(text));
  const verbs = read.found.lookup || [];
  const web = (read.found.web || []).filter((index) => read.words[index] !== 'website' && read.words[index] !== 'net');
  if (/\b(?:search|look up|find|get|fetch|collect|gather|research)\b[^.\n]{0,30}\b(?:from|on|in|using|via)\s+(?:the\s+)?(?:web|internet|google|online)\b/i.test(String(text))) return true;
  return verbs.some((verb) => web.some((index) => index > verb && index - verb <= 4));
}

/** "...for Saveetha Medical College": the new subject, when the instruction names one. */
function namedSubject(text) {
  const match = String(text || '').replace(/\s+/g, ' ').match(/\b(?:for|about|into|as)\s+(?:the\s+|a\s+|an\s+|my\s+|our\s+)?([^,.;:!?]{3,90})/i);
  if (!match) return null;
  const subject = match[1].split(/\s+(?:and|then|but|also|remove|delete|add|keep|with|without|please|plz|pls|so|because|using|use)\b/i)[0].replace(/\s+(?:website|web site|site|page)$/i, '').trim();
  if (subject.length < 3 || subject.split(/\s+/).length > 8 || NOT_A_SUBJECT.test(subject)) return null;
  return subject;
}

/** Typo-tolerant, no-model reading of an instruction. Always returns a valid intent. */
function heuristicIntent(instruction, ctx = {}) {
  const text = ownerPart(instruction);
  // "Do not change the layout, just update the text" is ONE instruction: a negation is not split from what follows it.
  const clauses = /\b(?:do not|don't|dont|without)\b[\s\S]{0,25}\b(?:change|touch|alter|modify)\b/i.test(text) ? [text] : text.split(SPLIT).map((part) => part.trim()).filter((part) => part.split(/\s+/).length >= 1 && part.length > 1);
  const read = (clauses.length ? clauses : [text]).map((part) => readClause(part, ctx));
  const main = read.slice().sort((a, b) => (REACH[b.intent] || 0) - (REACH[a.intent] || 0))[0];
  const contentChange = read.some((c) => c.content_change);
  const keepsContent = read.every((c) => c.preserveContent !== false);
  const confidence = clamp01(Math.min(...read.map((c) => c.score)) + (read.length > 1 ? -0.05 : 0));
  return validateIntent({
    intent: main.intent, scope: main.scope, target: [...new Set(read.flatMap((c) => c.target))],
    operations: read.map((c) => ({ type: c.op, target: c.target[0] || (c.scope === 'entire_page' ? 'entire_page' : c.scope) })),
    design_change: read.some((c) => c.design_change), content_change: contentChange,
    preserve_existing_content: keepsContent, preserve_existing_layout: read.every((c) => c.preserveLayout !== false) && !read.some((c) => c.design_change),
    preserve_functionality: true, rewrite_required: read.some((c) => c.intent === 'full_rewrite'), confidence,
    subject: SUBJECT_INTENTS.has(main.intent) ? namedSubject(text) : null,
    web_research: asksForWebResearch(text),
    reasoning_summary: `Read from the wording${read.length > 1 ? ` (${read.length} parts)` : ''}.`
  });
}

/* ------------------------------------------------ model reading ------------------------------------------------ */

const SYSTEM = `You classify ONE instruction an owner typed for a page of their website, by what it MEANS. Ignore spelling and grammar mistakes ("rewirte", "chnage" are rewrite and change). Informal, short or vague wording is fine.

Use the context: "this" or "it" means the SELECTED SECTIONS when there are any, otherwise the whole current page. Never assume "this" is the whole page when something is selected. Use RECENT INSTRUCTIONS for "again", "the same", "previous", "undo".

Answer JSON only:
{"intent":one of ${INTENTS.join('|')},
 "scope":one of ${SCOPES.join('|')},
 "target":[names of the parts named or selected],
 "operations":[{"type":one of ${OPERATIONS.join('|')},"target":"entire_page or a part name"}],
 "design_change":boolean,"content_change":boolean,
 "preserve_existing_content":boolean,"preserve_existing_layout":boolean,"preserve_functionality":boolean,
 "rewrite_required":boolean,"confidence":0..1,"reasoning_summary":"one short sentence",
 "web_research":true only when the owner asks you to search the web / find real information online (for example "search online for the programmes and fees"); false for a normal edit or a feature such as a search box,
 "subject":"" or what the page or website should now be ABOUT, only when the instruction names it (for example "Saveetha Medical College"); never a device, a style or the word page",
 "clarification":"" or ONE question, only when the instruction cannot be acted on at all}

Meanings: full_rewrite = new content AND new layout for the whole page. full_redesign = new look and layout, content kept. partial_redesign = redesign of named parts. content_replacement = new wording, layout kept. targeted_edit = a small named change. A request with several parts gets one operation per part; intent is the widest part. rewrite_required is true only when the existing content may be thrown away. Never ask for clarification when a reasonable reading exists.`;

function defaultAsk() {
  const openrouter = require('./openrouterService');
  const model = process.env.TEMPLATE_PLANNER_MODEL || process.env.TEMPLATE_OPENROUTER_MODEL || process.env.INCREMENTAL_OPENROUTER_MODEL || process.env.CLONE_OPENROUTER_MODEL || undefined;
  return async (messages, { signal } = {}) => {
    const result = await openrouter.generateCompletion(messages, { model, temperature: 0, max_tokens: 700, response_format: false, reasoning: { effort: 'minimal', exclude: true }, timeout: Number.parseInt(process.env.INTENT_TIMEOUT_MS, 10) || 25000, signal });
    return { content: String(result?.content || ''), usage: result?.usage || null };
  };
}

function parseJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw.startsWith('{') ? raw : (raw.match(/\{[\s\S]*\}/) || [''])[0]); } catch { return null; }
}

function contextBlock(instruction, ctx) {
  const lines = [];
  if (ctx.page) lines.push(`CURRENT PAGE: ${ctx.page.name} (route ${ctx.page.route})`);
  if (ctx.category) lines.push(`WEBSITE: ${ctx.category}`);
  if (ctx.sections?.length) lines.push(`SECTIONS OF THIS PAGE, in order: ${ctx.sections.slice(0, 20).map((name, i) => `${String(i + 1).padStart(2, '0')} ${name}`).join('; ')}`);
  lines.push(`SELECTED SECTIONS: ${ctx.selectedSections?.length ? ctx.selectedSections.join('; ') : '(none)'}`);
  if (ctx.selectedElement) lines.push(`SELECTED ELEMENT: ${str(ctx.selectedElement.role || ctx.selectedElement.tagName, 40)} "${str(ctx.selectedElement.text, 80)}"`);
  if (ctx.otherPages?.length) lines.push(`OTHER PAGES: ${ctx.otherPages.slice(0, 12).join(', ')}`);
  if (ctx.history?.length) lines.push(`RECENT INSTRUCTIONS ON THIS PAGE (newest first):\n${ctx.history.slice(0, 3).map((item) => `- "${str(item.instruction, 160)}"${item.changedPaths?.length ? ` (changed ${item.changedPaths.slice(0, 3).join(', ')})` : ''}`).join('\n')}`);
  return `${lines.join('\n')}\n\nINSTRUCTION:\n${ownerPart(instruction).slice(0, 1500)}`;
}

/* ------------------------------------------------ the entry point ------------------------------------------------ */

const cache = new Map();
const CACHE_MAX = 200;
const cacheKey = (instruction, ctx) => crypto.createHash('sha1').update(JSON.stringify([ownerPart(instruction), ctx.page?.route, ctx.sections, ctx.selectedSections, ctx.history?.[0]?.instruction])).digest('hex');

/**
 * @returns {Promise<{ intent: object, source: 'rules'|'model'|'cache'|'rules-fallback', usage: object|null, error?: string }>}
 */
async function understand({ instruction, context = {}, deps = {}, signal } = {}) {
  const rules = heuristicIntent(instruction, context);
  if (rules && rules.confidence >= FAST_PATH && !deps.alwaysAsk) return { intent: rules, source: 'rules', usage: null };
  const key = cacheKey(instruction, context);
  if (cache.has(key) && !deps.noCache) return { intent: cache.get(key), source: 'cache', usage: null };
  const ask = deps.askIntentUnderstanding || (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY !== 'your_openrouter_api_key' ? defaultAsk() : null);
  if (!ask) return { intent: rules, source: 'rules-fallback', usage: null, error: 'No model is configured.' };
  try {
    const answer = await ask([{ role: 'system', content: SYSTEM }, { role: 'user', content: contextBlock(instruction, context) }], { signal });
    const modelIntent = validateIntent(parseJson(answer.content));
    if (!modelIntent) throw new Error('The answer was not a valid intent.');
    // A model that is unsure while the words were clear keeps the words' reading.
    const chosen = modelIntent.confidence < CONFIDENT && rules && rules.confidence > modelIntent.confidence ? rules : modelIntent;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, chosen);
    return { intent: chosen, source: chosen === modelIntent ? 'model' : 'rules-fallback', usage: answer.usage || null };
  } catch (error) {
    if (signal?.aborted) throw error;
    logger.warn(`Intent understanding fell back to the wording: ${error.message}`);
    return { intent: rules, source: 'rules-fallback', usage: null, error: error.message };
  }
}

/* ------------------------------------------------ what an intent allows ------------------------------------------------ */

// Share of the page's existing wording that must survive. null = may be replaced entirely; undefined = leave the existing rule in charge.
const KEEP = { full_rewrite: null, content_replacement: 0.5, full_redesign: 0.6, partial_redesign: 0.7, website_wide_change: 0.5, targeted_edit: undefined, content_expansion: 0.5, section_addition: 0.5, section_removal: 0.25, bug_fix: 0.92, responsive_improvement: 0.9, functionality_change: 0.8, seo_improvement: 0.9, image_replacement: 0.9, style_change: 0.9 };

const hasOp = (intent, types) => Boolean(intent?.operations?.some((op) => types.includes(op.type)));

/**
 * The execution policy of an intent: what the validators and the prompt must do. Below the confidence floor the policy is empty, so the
 * existing rules decide (the engine never makes a guess stricter or looser than before).
 */
function policyFor(intent, { refinement = false } = {}) {
  if (!intent || intent.confidence < CONFIDENT) return null;
  let keepRatio;
  if (intent.rewrite_required && intent.scope === 'entire_page') keepRatio = null;
  else {
    const ratios = intent.operations.map((op) => KEEP[intentOfOperation(op.type, intent)]).concat(KEEP[intent.intent]);
    const defined = ratios.filter((value) => value !== undefined);
    if (ratios.includes(null)) keepRatio = null;
    else keepRatio = defined.length ? Math.min(...defined) : undefined;
    if (keepRatio !== undefined && keepRatio !== null && intent.preserve_existing_content && !intent.content_change && !['content_expansion', 'section_addition'].includes(intent.intent) && !hasOp(intent, ['remove_section', 'remove_content'])) keepRatio = Math.max(keepRatio, 0.85);
  }
  const rewrite = intent.rewrite_required && intent.scope === 'entire_page';
  return {
    // The page was already rewritten by an earlier job: what is left to do is what the instruction still names, not another full replacement.
    rewrite: Boolean(rewrite),
    refinement: Boolean(rewrite && refinement),
    keepRatio,
    // A full rewrite must really replace the wording: a page whose words are almost all still there was not rewritten.
    maxKeep: rewrite && !refinement ? 0.85 : undefined,
    wholeFile: rewrite || intent.intent === 'full_redesign',
    targeted: keepRatio !== null && keepRatio !== undefined && keepRatio >= 0.7,
    removal: hasOp(intent, ['remove_section', 'remove_content']),
    pictureOnly: intent.intent === 'image_replacement' && !intent.content_change,
    siteWide: intent.scope === 'entire_website' || intent.scope === 'multiple_pages' || intent.intent === 'website_wide_change',
    revert: hasOp(intent, ['revert_previous']) && intent.operations.length === 1
  };
}

function intentOfOperation(type, intent) {
  return ({ replace_content: 'content_replacement', redesign_layout: 'partial_redesign', add_content: 'content_expansion', add_section: 'section_addition', remove_section: 'section_removal', remove_content: 'section_removal', fix_bug: 'bug_fix', make_responsive: 'responsive_improvement', change_style: 'style_change', replace_image: 'image_replacement', change_functionality: 'functionality_change', improve_seo: 'seo_improvement', apply_site_wide: 'website_wide_change' })[type] || 'targeted_edit';
}

/** The plan the generator must follow, as text for the prompt (kept short: it is paid for on every call). */
function planBlock(intent, policy) {
  if (!intent || !policy) return '';
  const ops = intent.operations.map((op, i) => `${i + 1}. ${op.type.replace(/_/g, ' ')} -> ${op.target}`).join('\n');
  const lines = [
    `EXECUTION PLAN (what the owner's instruction means; follow it):`,
    `- Intent: ${intent.intent.replace(/_/g, ' ')}; reaches: ${intent.scope.replace(/_/g, ' ')}${intent.target.length ? ` (${intent.target.join(', ')})` : ''}`,
    `- Operations:\n${ops}`,
    `- Content: ${intent.preserve_existing_content ? 'keep the existing content unless an operation changes it' : 'the existing content may be replaced'}. Layout: ${intent.preserve_existing_layout ? 'keep it' : 'may change'}. Working behaviour (links, buttons, forms, routes): keep it.`
  ];
  if (policy.refinement) lines.push('- This page was already rewritten earlier in this session. Do NOT rewrite what already fits this website again for the sake of it: keep every heading, paragraph and label that already fits, but DO rewrite any file under FILES YOU MAY CHANGE that still speaks about the old subject (cards, badges, sample records), and change what the instruction still asks for (for example a new subject or name, something to remove). Return complete files with operation "modify" for the files you change.');
  else if (policy.maxKeep) lines.push('- OVERRIDES RULES 1 AND 7: this is a rewrite. Do NOT keep the old wording and do NOT limit yourself to small patches. Return the COMPLETE page file with operation "modify", and do the same for EVERY other file under FILES YOU MAY CHANGE that holds visible text (the own sections and components of the page, and the shared components and sample data it displays, such as cards, badges and records: their headings, labels, placeholders, filter options, buttons and sample records; keep export names, props, field names, the number of records and image paths so the other pages still build), so no wording of the old subject is left anywhere on the page. Write new, specific, real content for this website and a clearly improved composition (hierarchy, spacing, typography, imagery) inside the existing design system; no empty boxes, no repeated sections, no generic filler. Keep the default export, imports that exist, routes, links and working behaviour.');
  else if (policy.wholeFile) lines.push('- OVERRIDES RULE 7: this is a redesign. Do not limit yourself to small patches: return the COMPLETE page file with operation "modify" and clearly improve the composition (hierarchy, spacing, typography, imagery, section layout) inside the existing design system. Keep the existing headings, paragraphs, labels and links word for word unless an operation above changes them. Keep the default export, imports that exist, routes and working behaviour; no empty boxes or repeated sections.');
  else if (policy.targeted) lines.push('- This is a targeted change: touch only what the operations name; everything else stays as it is.');
  else lines.push('- Change what the operations name and what they need; keep the rest of the page.');
  return lines.join('\n');
}

/** Does the instruction change WHAT the website is about (a new subject), not just how the page looks? */
const changesSubject = (intent) => Boolean(intent && intent.subject && intent.confidence >= CONFIDENT && SUBJECT_INTENTS.has(intent.intent));

const summarize = (result, policy) => result && ({
  intent: result.intent.intent, subject: result.intent.subject, scope: result.intent.scope, target: result.intent.target, operations: result.intent.operations, confidence: result.intent.confidence,
  rewriteRequired: result.intent.rewrite_required, preserveContent: result.intent.preserve_existing_content, reasoning: result.intent.reasoning_summary, source: result.source,
  policy: policy ? { keepRatio: policy.keepRatio === undefined ? 'default' : policy.keepRatio, maxKeep: policy.maxKeep ?? null, wholeFile: policy.wholeFile, siteWide: policy.siteWide } : null
});

module.exports = { enabled, changesSubject, namedSubject, asksForWebResearch, understand, heuristicIntent, validateIntent, policyFor, planBlock, summarize, readWords, groupOf, distance, ownerPart, INTENTS, SCOPES, OPERATIONS, CONFIDENT, FAST_PATH, SYSTEM };
