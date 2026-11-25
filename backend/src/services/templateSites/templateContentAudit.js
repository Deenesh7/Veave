/**
 * Content audit of a page that is being moved from the template's original kind of website to another one (real estate -> medical college).
 *
 * The semantic validator used to read every file a page MAY change and reject any word of the old website it found, including route strings
 * ("/listings" is a real route of the site), and files the new page no longer renders. That made some pages impossible to pass. This module
 * answers the narrower question "what does a visitor of THIS page see that still belongs to the old website, and where in the code is it":
 *
 *   visible   - wording in the page file itself
 *   section   - a heading in the page file (the whole section is about the old website)
 *   component - wording inside a component the page renders, or an old-industry component that is imported and never used
 *   data      - wording inside a data file whose records the page renders
 *
 * Identifiers, import paths, routes, urls, ids, slugs and class names are never wording. Build and behaviour errors are not judged here
 * (they are the build gate's job). Nothing here calls a model.
 */
const pageDistinctness = require('../ai/pageDistinctness');

const SOURCE = /\.(?:jsx?|tsx?)$/i;
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A string literal that a visitor never reads: a route, path, url, id, slug, identifier or class list. */
function isCodeString(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (/^(?:\/|\.{1,2}\/|#|https?:|mailto:|tel:|data:|@\/)/i.test(text)) return true;
  if (/^[\w$.:-]+$/.test(text) && (/[-_./:]/.test(text) || /[a-z][A-Z]/.test(text) || /^[a-z0-9]+$/.test(text) && !/^[a-z]{4,}$/.test(text))) return true;
  // A class list ("mt-4 text-sm font-bold") is code; an ordinary sentence is not.
  const tokens = text.split(/\s+/);
  if (tokens.length > 1 && tokens.every((token) => /^[\w\-:\/\[\]\.%!#@,]+$/.test(token)) && tokens.filter((token) => /[-:\[\]\/]/.test(token)).length >= Math.ceil(tokens.length / 2) && !/^[A-Z]/.test(text)) return true;
  return false;
}

// Attributes whose value is never read by a visitor (a link target, an image path, a key, a class list).
const CODE_ATTRIBUTE = /\b(?:className|class|to|href|src|srcSet|key|id|type|ref|style|rel|target|htmlFor|name|value|method|action|loading|width|height|viewBox|d|fill|stroke|path|slug|route|as|data-[\w-]+)\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\}|\{(?:"[^"]*"|'[^']*')\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g;
const HEADING_TAG = /^h[1-4]$/i;
const HEADING_ATTRIBUTE = /^(?:title|heading|eyebrow)$/;

/** Removes comments and import lines, keeping the offsets of everything else (line numbers stay right). */
function stripCode(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');
  return String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)))
    .replace(/^\s*(?:import|export)\b[^\n]*\bfrom\s+['"][^'"]+['"];?/gm, blank)
    .replace(/^\s*import\s+['"][^'"]+['"];?/gm, blank)
    .replace(CODE_ATTRIBUTE, blank);
}

const lineAt = (source, index) => String(source).slice(0, index).split('\n').length;

/** The name of the element a text between tags belongs to (the last tag opened before it). */
function enclosingTag(code, index) {
  const before = code.slice(Math.max(0, index - 400), index + 1);
  const match = [...before.matchAll(/<([A-Za-z][\w.]*)\b[^<>]*>/g)].pop();
  return match ? match[1] : '';
}

/**
 * The texts a visitor can read in a source file, each with its line and whether it is a heading.
 * JSX text, text-like attributes, the strings of data objects and string expressions in JSX; code strings are left out.
 */
function visibleSnippets(source) {
  const raw = String(source || '');
  const code = stripCode(raw);
  const out = [];
  const add = (text, index, heading) => {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || isCodeString(value) || !/[A-Za-z]{2,}/.test(value)) return;
    out.push({ text: value, line: lineAt(raw, index), heading: Boolean(heading) });
  };
  // Text between tags. A run that holds code (statements, calls, string arrays) sits between two tags but is not read by anyone.
  // Text with an expression inside ("No active listings in {n.name}.") is read without the expression.
  for (const match of code.matchAll(/(?<![=!-])>((?:[^<>{}]|\{[^{}<>]*\})+)</g)) {
    const words = match[1].replace(/\{[^{}]*\}/g, ' ');
    if (!/[A-Za-z]{2,}/.test(words) || /;|=>|&&|\|\||\w\s*\(|[\[,]\s*['"`]|['"`]\s*[\],]/.test(words)) continue;
    add(words, match.index + 1, HEADING_TAG.test(enclosingTag(code, match.index)));
  }
  for (const match of code.matchAll(/\b(alt|title|placeholder|aria-label|label|description|eyebrow|heading|subtitle|text|cta|content)\s*=\s*(?:"([^"]+)"|\{['"`]([^'"`]+)['"`]\})/g)) add(match[2] || match[3], match.index, HEADING_ATTRIBUTE.test(match[1]));
  for (const match of code.matchAll(/\b(title|label|name|summary|description|text|heading|question|answer|category|role|quote|eyebrow|tagline|alt|blurb|bio|excerpt|caption|subtitle|cta)\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`$]+)`)/g)) add(match[2] || match[3] || match[4], match.index, HEADING_ATTRIBUTE.test(match[1]));
  // String expressions in JSX ({'See listings'}); a route in braces ({'/listings'}) is code and is left out by add().
  for (const match of code.matchAll(/\{\s*['"`]([^'"`{}$]{3,})['"`]\s*\}/g)) add(match[1], match.index, false);
  // Template literals of titles (title={`Homes in ${n.name}`}): the fixed words are read by the visitor.
  for (const match of code.matchAll(/\b(title|heading|eyebrow|label|alt|placeholder|aria-label)\s*=\s*\{`([^`]+)`\}/g)) add(match[2].replace(/\$\{[^}]*\}/g, ' '), match.index, HEADING_ATTRIBUTE.test(match[1]));
  return out;
}

const visibleText = (source) => visibleSnippets(source).map((item) => item.text).join('\n');

/** Which of `terms` appear in `text` as whole words (plural allowed). */
function findTerms(text, terms = []) {
  const found = [];
  for (const term of terms) {
    const value = String(term || '').trim();
    if (!value) continue;
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(value)}(?:s|es)?(?![A-Za-z0-9])`, 'i');
    if (pattern.test(text)) found.push(term);
  }
  return found;
}

const singular = (word) => String(word).toLowerCase().replace(/(?:ies)$/, 'y').replace(/(?:sses|shes|ches|xes)$/, (end) => end.slice(0, -2)).replace(/(?<!s)s$/, '');

/** The single words of the old website that may name a component or a data file ("listing", "neighbourhood", "agent", "mortgage"). */
function oldNameWords(plan) {
  const words = [...(plan?.avoidTerms || []), ...(plan?.terminology || []).map((item) => item.from)]
    .map((term) => String(term || '').trim())
    .filter((term) => /^[A-Za-z]+$/.test(term) && term.length >= 4)
    .map(singular);
  // A word the new website uses itself (its own vocabulary: "Programs", "Faculty") never marks a component as old.
  const own = new Set((plan?.terminology || []).flatMap((item) => String(item.to || '').split(/\s+/)).map(singular));
  return new Set(words.filter((word) => !own.has(word)));
}

/** "ListingCard" -> ["listing", "card"]; "neighbourhoods" -> ["neighbourhood"]. */
const nameTokens = (path) => String(path).split('/').pop().replace(/\.[jt]sx?$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean).map(singular);

function isOldIndustryName(path, words) {
  return nameTokens(path).some((token) => words.has(token));
}

/** The files the page renders now (its component and what it imports, transitively), in the given file list. */
function renderedFiles(files, componentPath, depth = 3) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (!byPath.has(componentPath)) return [];
  return pageDistinctness.reachableFiles(componentPath, byPath, depth).filter((path) => byPath.has(path) && SOURCE.test(path));
}

/** Components the page file imports from src/components/ but never renders or calls. */
function unusedComponentImports(files, componentPath) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const page = byPath.get(componentPath);
  if (!page || typeof page.content !== 'string') return [];
  const source = page.content;
  const body = source.replace(/^\s*import\b[^\n]*$/gm, ' ');
  const lines = source.split('\n');
  const byTarget = new Map();
  for (const [name, target] of pageDistinctness.importMap(page, byPath).entries()) {
    if (!/^src\/components\//.test(target)) continue;
    const used = new RegExp(`<${escapeRegex(name)}\\b|\\b${escapeRegex(name)}\\s*\\(|[=:,(\\[{]\\s*${escapeRegex(name)}\\b`).test(body);
    const entry = byTarget.get(target) || { path: target, names: [], used: false, line: 0 };
    entry.names.push(name);
    entry.used = entry.used || used;
    if (!entry.line) entry.line = lines.findIndex((text) => /^\s*import\b/.test(text) && new RegExp(`\\b${escapeRegex(name)}\\b`).test(text)) + 1;
    byTarget.set(target, entry);
  }
  return [...byTarget.values()].filter((entry) => !entry.used).map(({ path, names, line }) => ({ path, names, line }));
}

/**
 * Every place a visitor of the page would read the old website, grouped by kind.
 * @param {object} p
 * @param {object} p.plan      the website plan (avoidTerms, terminology, matchesTemplate)
 * @param {object} p.page      { componentPath, route, name }
 * @param {Array}  p.files     the candidate files
 * @param {object} p.scope     { ownedList, owned? } what the page may change
 * @param {Array}  [p.baseline] the files before the change (files the change created are checked too)
 * @param {boolean} [p.conversion] the request converts the page to the new kind of website (old components count as well)
 * @returns {Array<{kind, path, line, text, terms, owned}>}
 */
function auditPage({ plan, page, files, scope, baseline = null, conversion = false }) {
  const terms = plan?.avoidTerms || [];
  if (!terms.length && !conversion) return [];
  const unused = unusedComponentImports(files, page.componentPath);
  const { checked, owned, created } = shownFiles({ files, page, scope, baseline, unused });
  const byPath = new Map(files.map((file) => [file.path, file]));
  const findings = [];
  for (const path of checked) {
    const file = byPath.get(path);
    if (!file || typeof file.content !== 'string' || file.encoding === 'base64') continue;
    const kind = path === page.componentPath ? 'visible' : /^src\/data\//.test(path) ? 'data' : 'component';
    for (const snippet of visibleSnippets(file.content)) {
      const hit = findTerms(snippet.text, terms);
      if (!hit.length) continue;
      findings.push({ kind: kind === 'visible' && snippet.heading ? 'section' : kind, path, line: snippet.line, text: snippet.text.slice(0, 120), terms: hit, owned: owned.has(path) || created.has(path) });
    }
  }
  if (conversion) {
    const words = oldNameWords(plan);
    for (const item of unused) {
      if (!isOldIndustryName(item.path, words)) continue;
      findings.push({ kind: 'component', path: page.componentPath, line: item.line, text: `import ${item.names.join(', ')} from ${item.path}`, terms: [], owned: true, unusedImport: item.path });
    }
  }
  return findings;
}

/**
 * The files whose content a visitor of the page sees AND this change may fix: what the page renders now (an imported component that is
 * never used is not rendered, nor what it imports), limited to the page's own files and the files the change created.
 */
function shownFiles({ files, page, scope, baseline = null, unused = null }) {
  const skipped = unused || unusedComponentImports(files, page.componentPath);
  const rendered = renderedFiles(withoutImports(files, page.componentPath, skipped), page.componentPath);
  const owned = new Set(scope?.ownedList || []);
  const before = baseline ? new Set(baseline.map((file) => file.path)) : null;
  const created = new Set(before ? files.filter((file) => !before.has(file.path) && /^src\//.test(file.path)).map((file) => file.path) : []);
  const checked = rendered.length ? rendered.filter((path) => owned.has(path) || created.has(path) || path === page.componentPath) : [...owned];
  return { checked, owned, created };
}

/** The files with the page's import lines of `unused` components blanked (so reachability does not follow them). */
function withoutImports(files, componentPath, unused) {
  if (!unused.length) return files;
  const lines = new Set(unused.map((item) => item.line).filter((line) => line > 0));
  return files.map((file) => (file.path !== componentPath ? file : { ...file, content: String(file.content).split('\n').map((text, index) => (lines.has(index + 1) ? '' : text)).join('\n') }));
}

/* ------------------------------------------------ correcting short leftovers without a model ------------------------------------------------ */

// Leftovers longer than this are real content of the old website: they are rewritten by the model, never word-swapped.
const MAX_REWORD_WORDS = 8;

/** "Listings" -> "Programs", "listing" -> "program": the website's own vocabulary, in the case and number of the original. */
function replacementFor(found, terminology) {
  const lower = found.toLowerCase();
  const exact = terminology.find((item) => String(item.from).toLowerCase() === lower);
  let to = exact?.to;
  if (!to) {
    const base = terminology.find((item) => `${String(item.from).toLowerCase()}s` === lower || `${String(item.from).toLowerCase()}es` === lower);
    if (!base) return null;
    to = /s$/i.test(base.to) ? base.to : `${base.to}s`;
  }
  if (found === found.toUpperCase() && found.length > 1) return to.toUpperCase();
  if (found[0] === found[0].toLowerCase()) return to[0].toLowerCase() + to.slice(1);
  return to[0].toUpperCase() + to.slice(1);
}

const squash = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Replaces the old words in the readable parts of one line: JSX text (outside {expressions}) and visible string literals (when `visible` is given, only the literal that IS that visible text). */
function rewordLine(line, terminology, visible = null) {
  const pattern = new RegExp(`(?<![A-Za-z0-9/_.$-])(${terminology.map((item) => escapeRegex(item.from)).sort((a, b) => b.length - a.length).join('|')})(?:e?s)?(?![A-Za-z0-9/_-])`, 'gi');
  const swap = (text) => text.replace(pattern, (match) => replacementFor(match, terminology) || match);
  // Code attributes keep their value untouched.
  const protectedRanges = [...line.matchAll(CODE_ATTRIBUTE)].map((match) => [match.index, match.index + match[0].length]);
  const isProtected = (index) => protectedRanges.some(([start, end]) => index >= start && index < end);
  let out = line.replace(/(?<![=!-])>((?:[^<>{}]|\{[^{}<>]*\})+)(?=<|$)/g, (match, inner, offset) => (isProtected(offset) ? match : `>${inner.split(/(\{[^{}]*\})/).map((part) => (part.startsWith('{') ? part : swap(part))).join('')}`));
  if (/^\s*(?:import|export\s+\{)/.test(out)) return out;
  // String literals only where a visitor reads them: {'...'} in JSX, text attributes (title="...") and text fields of records (label: '...').
  // A literal anywhere else (a comparison, a key, an argument) is code and keeps its value.
  const literal = (match, lead, quote, inner) => (isCodeString(inner) || (visible !== null && !squash(visible).includes(squash(inner))) ? match : `${lead}${quote}${swap(inner)}${quote}`);
  out = out.replace(/(\{\s*)(['"`])((?:(?!\2)[^\\\n$]|\\.)+)\2(?=\s*\})/g, literal);
  out = out.replace(/(\b(?:alt|title|placeholder|aria-label|label|description|eyebrow|heading|subtitle|text|cta|content)\s*=\s*)(["'])((?:(?!\2)[^\\\n]|\\.)+)\2/g, (match, lead, quote, inner, offset) => (isProtected(offset) ? match : literal(match, lead, quote, inner)));
  out = out.replace(/(\b(?:title|label|name|summary|description|text|heading|question|answer|category|role|quote|eyebrow|tagline|alt|blurb|bio|excerpt|caption|subtitle|cta)\s*:\s*)(['"`])((?:(?!\2)[^\\\n$]|\\.)+)\2/g, literal);
  return out;
}

/**
 * The last step before a page is given up: short leftovers of the old website that the model kept returning ("See listings" on a shared
 * card) are corrected with the website's own vocabulary (plan.terminology), and an old component imported without being used is removed.
 * Only the exact lines found are touched, only their readable text, and only in files the change may write. Leftovers without a planned
 * replacement word, or longer than a short label, are left for the model (they need real rewriting). Returns { files, changes }.
 */
function rewordLeaks(files, problems, plan) {
  const terminology = (plan?.terminology || []).filter((item) => item?.from && item?.to && /^[A-Za-z][A-Za-z ]*$/.test(item.from));
  const byPath = new Map(files.map((file) => [file.path, { ...file }]));
  const changes = [];
  for (const problem of problems || []) {
    for (const leak of problem?.leaks || []) {
      const file = byPath.get(leak.path);
      if (!file || typeof file.content !== 'string' || !leak.owned) continue;
      const lines = file.content.split('\n');
      const index = leak.line - 1;
      if (index < 0 || index >= lines.length) continue;
      if (leak.unusedImport) {
        if (/^\s*import\b/.test(lines[index])) { changes.push({ path: leak.path, line: leak.line, from: lines[index].trim(), to: '' }); lines[index] = ''; file.content = lines.join('\n'); }
        continue;
      }
      if (!terminology.length || leak.text.split(/\s+/).length > MAX_REWORD_WORDS) continue;
      if (!leak.terms.every((term) => terminology.some((item) => String(item.from).toLowerCase() === String(term).toLowerCase() || `${String(item.from).toLowerCase()}s` === String(term).toLowerCase() || String(item.from).toLowerCase() === `${String(term).toLowerCase()}s`))) continue;
      const next = rewordLine(lines[index], terminology, leak.text);
      if (next === lines[index]) continue;
      changes.push({ path: leak.path, line: leak.line, from: lines[index].trim(), to: next.trim() });
      lines[index] = next;
      file.content = lines.join('\n');
    }
  }
  return { files: files.map((file) => byPath.get(file.path) || file), changes };
}

/* ------------------------------------------------ what kind of change is asked ------------------------------------------------ */

const CONVERSION_INTENTS = new Set(['full_rewrite', 'content_replacement', 'website_wide_change']);

/**
 * text       - wording of named elements only
 * section    - the owner ticked or named sections
 * redesign   - new layout or look, content kept
 * conversion - the page becomes a page of the new kind of website (new subject on a template made for another one)
 */
function changeKind({ plan = null, intent = null, policy = null, ticked = false, mode = 'edit' } = {}) {
  if (ticked) return 'section';
  const otherIndustry = Boolean(plan) && plan.matchesTemplate === false;
  if (otherIndustry && (mode === 'website' || policy?.rewrite || (intent && CONVERSION_INTENTS.has(intent.intent) && (intent.scope === 'entire_page' || intent.scope === 'entire_website')))) return 'conversion';
  if (policy?.wholeFile || intent?.intent === 'full_redesign') return 'redesign';
  return 'text';
}

/* ------------------------------------------------ the conversion brief for the writer ------------------------------------------------ */

/**
 * What the writer must know to convert this page: which industry it comes from and goes to, what the page is for, which rendered
 * components and data can be reused and which belong to the old website. Returns '' when there is nothing to say.
 */
function conversionBlock({ plan, page, files, scope, template = null }) {
  if (!plan) return '';
  const words = oldNameWords(plan);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const rendered = renderedFiles(withoutImports(files, page.componentPath, unusedComponentImports(files, page.componentPath)), page.componentPath).filter((path) => path !== page.componentPath);
  const owned = new Set(scope?.ownedList || []);
  const replace = [];
  const reuse = [];
  const data = [];
  for (const path of rendered) {
    const content = byPath.get(path)?.content || '';
    const leaks = findTerms(visibleText(content), plan.avoidTerms || []);
    if (/^src\/data\//.test(path)) { data.push({ path, leaks, owned: owned.has(path) }); continue; }
    if (!/^src\/components\//.test(path)) continue;
    if (isOldIndustryName(path, words) || leaks.length) replace.push({ path, leaks, owned: owned.has(path) });
    else reuse.push(path);
  }
  const identity = plan.identity || {};
  const entry = (plan.pages || []).find((item) => item.route === page.route) || null;
  const from = [template?.category, template?.name].filter(Boolean).join(', ') || 'the kind of website the template was made for';
  const to = [identity.organizationType, identity.category].filter(Boolean).join(', ') || 'the website in the plan';
  const lines = [
    'INDUSTRY CONVERSION (OVERRIDES RULE 8 where it says to keep the components and imports): this page is being converted to another kind of website. Do not only swap words: rebuild the page for its new purpose.',
    `- From: ${from}. To: ${to}${identity.name ? ` ("${identity.name}")` : ''}.`,
    entry ? `- Target page: ${entry.name}. Purpose: ${String(entry.purpose || 'as fits the website').replace(/[.\s]+$/, '')}. Sections it needs: ${(entry.sections || []).join('; ') || 'as fits its purpose'}.` : `- Target page: ${page.name}.`,
    reuse.length ? `- Reusable layout components (neutral; keep using them): ${reuse.join(', ')}.` : '',
    replace.length ? `- Components of the OLD website this page renders: ${replace.map((item) => `${item.path}${item.leaks.length ? ` (shows: ${item.leaks.slice(0, 4).join(', ')})` : ''}`).join('; ')}. Do not render them on this page: remove their imports and build the new sections with markup in the page file or with NEW components you create under src/components/ (other pages may keep using the old ones${replace.some((item) => item.owned) ? '; if you keep one, rewrite every visible word of it for the new website' : ''}).` : '',
    data.length ? `- Data the page reads: ${data.map((item) => `${item.path}${item.leaks.length ? ` (still shows: ${item.leaks.slice(0, 4).join(', ')})` : ''}`).join('; ')}. Keep reading the record this route selects (same export, ids and slugs) so links from other pages still open this page, but show only fields that make sense for the new website; never show the old ones (prices, sale or rental figures, days on market, rooms, areas, agents). New content for the new sections goes in the page or in a NEW file under src/data/.` : '',
    '- Routes, link targets, ids, slugs, file names and variable names are code, not wording: keep the existing routes and links (for example a menu route of the site) even when they contain an old word; only what a visitor reads must be about the new website.',
    '- Never invent facts (numbers, rankings, accreditation, fees, dates, names of people). Describe things in general, truthful terms where the owner has not given details.'
  ];
  return lines.filter(Boolean).join('\n');
}

module.exports = { shownFiles, rewordLeaks, rewordLine, isCodeString, visibleSnippets, visibleText, findTerms, oldNameWords, nameTokens, isOldIndustryName, renderedFiles, unusedComponentImports, auditPage, changeKind, conversionBlock };
