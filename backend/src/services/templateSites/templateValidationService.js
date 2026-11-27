/**
 * Validation of a regenerated page, in independent stages. Every problem is reported as
 *   { stage, path, route, message, cause, action }
 * (what failed where, the exact error, why, and what the repair should do), so it can be shown to the user and sent to the model
 * unchanged. Stages: scope, code, website, asset, regression. The slow stage, the production build and browser test of every
 * route, is `runBuildGate` and uses the same gate (validateAndRepair, Docker runner, local browser) as the rest of Veave.
 */
const crypto = require('node:crypto');
const aiProtocol = require('../ai/aiProtocol');
const pageDistinctness = require('../ai/pageDistinctness');
const store = require('./siteFileStore');

const SOURCE = /\.(?:jsx?|tsx?)$/i;
const BUILTIN_PACKAGES = new Set(['react', 'react-dom', 'react-router-dom', 'react/jsx-runtime']);
const CREATE_PREFIXES = ['src/components/', 'src/data/'];
// Pictures the page's images are saved as (never replaces an existing file: the name is the content hash).
const ASSET_PREFIX = 'public/assets/images/';
const MIN_PAGE_WORDS = 25;

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const issue = (stage, message, { path = null, route = null, cause = '', action = '' } = {}) => ({ stage, path, route, message, cause, action });

/* ------------------------------------------------ scope: what this page may touch ------------------------------------------------ */

/**
 * The files a regeneration of `page` may change: the page's component and the files only it uses. The shared components, the
 * routing and navigation, the configuration and every other page (and what they use) are out of scope.
 */
/**
 * A prompt that is about the whole website (menu, footer, logo, site name, "everywhere", rebranding) or that names a shared component
 * (e.g. "remove the search tabs") cannot be done inside one page file. Those prompts get a wider scope: see pageScope.
 */
const SITE_WIDE_WORDS = /\b(nav(?:bar|igation)?|menu|header|footer|logo|brand(?:ing)?|re-?brand|site[ -]?name|site[ -]?wide|whole (?:web)?site|entire (?:web)?site|all (?:the )?pages|every page|other pages|across (?:the )?(?:web)?site|throughout|everywhere|all references|favicon|page title|tagline)\b/i;
// With ticked sections only an explicit request about the shared parts counts: "header", "menu" or "brand" are usually words of the
// section itself (a section header, a restaurant menu, pasted copy), and the section's own name ("Listing Card") names its component.
const TICKED_SITE_WIDE_WORDS = /\b(nav(?:bar|igation)|footer|logo|re-?brand|site[ -]?name|site[ -]?wide|whole (?:web)?site|entire (?:web)?site|all (?:the )?pages|every page|other pages|across (?:the )?(?:web)?site|everywhere|favicon|page title|tagline)\b/i;
const SECTION_LEAD = /^In ((?:and |, )?section \d+ \("[^"]*"\)(?:,? ?(?:and )?)?)+:\s*/i;
const isTickedEdit = (instruction) => selectedSectionNumbers(instruction).length > 0 || /ticked only the section\(s\)/.test(String(instruction || ''));
function wantsSiteWide(instruction, files = []) {
  const text = ownerWords(instruction);
  // The ticked sections decide the scope (their components and records are added by pageScope); the page stays a page edit.
  if (isTickedEdit(instruction)) return TICKED_SITE_WIDE_WORDS.test(text.replace(SECTION_LEAD, ''));
  if (SITE_WIDE_WORDS.test(text)) return true;
  // "remove/replace/rename X" where X also lives in the shared parts of the site (menu, footer, shared components, site data).
  if (/\b(remove|delete|get rid of|replace|rename|drop|eliminate|references?)\b/i.test(text)) {
    const stop = new Set(['remove', 'delete', 'replace', 'rename', 'with', 'this', 'that', 'page', 'pages', 'section', 'sections', 'from', 'about', 'make', 'instead', 'add', 'and', 'the', 'all', 'references', 'reference', 'lot', 'unique', 'features', 'home', 'text', 'content', 'there', 'which', 'them', 'they', 'into', 'then', 'also', 'more']);
    const shared = files.filter((file) => /^(?:src\/(?:components|data)\/|index\.html$)/.test(file.path) && typeof file.content === 'string');
    const words = [...new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((word) => !stop.has(word)))];
    for (const word of words) {
      const stem = word.length > 6 ? word.slice(0, word.length - 2) : word.length > 4 ? word.slice(0, 4) : word;
      const pattern = new RegExp(`\\b${stem.replace(/[^a-z]/g, '')}`, 'i');
      if (shared.some((file) => pattern.test(file.content))) return true;
    }
  }
  // The section's own words are written in a shared component (for example the tabs and search box of the hero): the behaviour the owner
  // asks for lives in that component, so the AI must be allowed to change it. Two or more of the section's texts must be found there.
  // Only the texts of a section the owner is looking at count: the whole page's content (PAGE CONTENT) always includes text that shared
  // components show, which would make every page edit a change of the whole website.
  const phrases = [...new Set((String(instruction || '').replace(/\n\nPAGE CONTENT[\s\S]*$/, '').match(/"([^"\n]{10,120})"/g) || []).map((item) => item.slice(1, -1).trim()))];
  if (phrases.length >= 2) {
    const components = files.filter((file) => /^src\/components\/[^/]+\.jsx?$/.test(file.path) && typeof file.content === 'string');
    if (components.some((file) => phrases.filter((phrase) => file.content.includes(phrase)).length >= 2)) return true;
  }
  const squashed = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return files.some((file) => /^src\/components\/[A-Za-z0-9]+\.jsx?$/.test(file.path) && (() => {
    const name = file.path.split('/').pop().replace(/\.jsx?$/, '').toLowerCase();
    return name.length >= 6 && squashed.includes(name);
  })());
}

/**
 * The sections the owner ticked or named ("In section 04 ("Listing Card"): ...", "ticked only the section(s) "A", "B""), by name.
 * A name such as "Listing Card" is the name of a component (ListingCard.jsx): see pageScope.
 */
function namedSections(instruction) {
  const text = String(instruction || '');
  const names = [...text.matchAll(/section \d+ \("([^"]+)"\)/gi)].map((match) => match[1]);
  // The job's note quotes every name on its own ("Hours, Location", "Team"), so a comma inside a name does not split it.
  const ticked = (text.match(/ticked only the section\(s\) "([^\n]+?)" of this page/i) || [])[1];
  if (ticked) names.push(...ticked.split(/",\s*"/).map((item) => item.replace(/^"|"$/g, '')));
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

function pageScope({ files, page, pages, template, siteWide = false, includeSharedContent = false, sectionNames = [], sectionPhrases = [] }) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const locked = new Set([...(template?.scaffold?.sharedFiles || []), ...(template?.scaffold?.protectedFiles || []), ...(template?.scaffold?.requiredFiles || []), 'src/App.jsx', 'src/main.jsx', 'src/data/site.js', 'src/index.css', 'package.json', 'index.html']);
  const usedElsewhere = new Set();
  for (const other of pages.filter((item) => String(item._id) !== String(page._id))) {
    for (const path of pageDistinctness.reachableFiles(other.componentPath, byPath, 2)) usedElsewhere.add(path);
  }
  const reachable = pageDistinctness.reachableFiles(page.componentPath, byPath, 2).filter((path) => byPath.has(path) && SOURCE.test(path));
  const owned = reachable.filter((path) => path === page.componentPath || (!locked.has(path) && !usedElsewhere.has(path) && path.startsWith('src/')));
  // The page's own files (its component and what only it uses), before shared content is added for a rewrite or a ticked section.
  const ownOnly = [...owned];
  const sectionFiles = [];
  // A rewrite covers what only THIS page shows. A component or data file that other pages use as well is never changed in place (that would
  // change those pages too): the page stops using it and builds its own copy in a NEW file (src/components/ or src/data/), or writes the
  // markup in the page. `includeSharedContent` is therefore kept only for callers that pass it; it no longer opens shared files.
  // A section the owner named whose code is a component shared with other pages (the "Listing Card" section is ListingCard.jsx, which also
  // renders on other pages, and shows the records of src/data/listings.js): that component and the data it displays are the section.
  // Without them the owner's request about the section could not change anything and every answer was thrown away.
  if (sectionNames.length) {
    const squash = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (const name of sectionNames.map(squash).filter((item) => item.length >= 4)) {
      const component = reachable.find((path) => !locked.has(path) && /^src\/components\//.test(path) && squash(path.split('/').pop().replace(/\.[jt]sx?$/, '')) === name);
      if (!component) continue;
      sectionFiles.push(component);
      if (!owned.includes(component)) owned.push(component);
      // The records the cards show come from the component's own data or, as often, from the data the PAGE imports and maps over.
      for (const data of [...pageDistinctness.reachableFiles(component, byPath, 1), ...pageDistinctness.reachableFiles(page.componentPath, byPath, 1)]) if (/^src\/data\//.test(data) && SOURCE.test(data) && !locked.has(data) && byPath.has(data)) { sectionFiles.push(data); if (!owned.includes(data)) owned.push(data); }
    }
  }
  // The ticked section's own texts are written in a component (the tabs and search box of a hero): that component shows the section, so
  // it may change with it (without making the whole website changeable). Two or more of the section's texts must be found there.
  if (sectionPhrases.length >= 2) {
    for (const path of reachable) {
      const content = textOf(byPath.get(path));
      if (owned.includes(path) || locked.has(path) || !/^src\/components\//.test(path) || !content) continue;
      if (sectionPhrases.filter((phrase) => content.includes(phrase)).length >= 2) { sectionFiles.push(path); owned.push(path); }
    }
  }
  if (siteWide) {
    // Site-wide prompt: the shared components, shared data, site data and the HTML shell may change too. Other pages, the router, config and styles may not.
    const otherPageFiles = new Set(pages.filter((item) => String(item._id) !== String(page._id)).map((item) => item.componentPath));
    const hard = new Set(['src/App.jsx', 'src/main.jsx', 'src/index.css', 'package.json', 'package-lock.json']);
    for (const file of files) {
      const path = file.path;
      if (owned.includes(path) || otherPageFiles.has(path) || hard.has(path) || file.encoding === 'base64') continue;
      if (path === 'index.html' || path === 'src/data/site.js' || (/^src\/(?:components|data)\//.test(path) && SOURCE.test(path))) owned.push(path);
    }
  }
  const shared = reachable.filter((path) => !owned.includes(path));
  return { siteWide, sectionFiles: [...new Set(sectionFiles)], pageFiles: reachable, ownOnly, owned: new Set(owned), ownedList: owned, sharedList: shared, locked, canCreate: (path) => CREATE_PREFIXES.some((prefix) => path.startsWith(prefix)) && !byPath.has(path) && SOURCE.test(path) };
}

/** Splits operations into those inside the scope and those that are dropped (with the reason, which goes into the repair prompt). */
function filterOperations(operations, scope) {
  const allowed = [];
  const dropped = [];
  for (const op of operations) {
    const operation = String(op.operation || 'modify').toLowerCase();
    let reason = null;
    if (['rename', 'delete'].includes(operation)) reason = `${operation} is not allowed in a page regeneration`;
    else if (scope.owned.has(op.path)) reason = null;
    else if (operation === 'create' && scope.canCreate(op.path)) reason = null;
    else reason = scope.locked.has(op.path) ? 'it is a shared or locked file' : scope.canCreate(op.path) === false && operation === 'create' ? 'new files may only be created under src/components/ or src/data/' : 'it belongs to another page or to the shared site';
    if (reason) dropped.push({ path: op.path, operation, reason }); else allowed.push(op);
  }
  return { allowed, dropped };
}

/* ------------------------------------------------ the checks ------------------------------------------------ */

function bareImports(files) {
  const found = new Map();
  for (const file of files.filter((item) => SOURCE.test(item.path))) {
    for (const match of textOf(file).matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"./][^'"]*)['"]/g)) {
      const name = match[1].startsWith('@') ? match[1].split('/').slice(0, 2).join('/') : match[1].split('/')[0];
      (found.get(name) || found.set(name, []).get(name)).push(file.path);
    }
  }
  return found;
}

function installedPackages(files) {
  try {
    const pkg = JSON.parse(textOf(files.find((file) => file.path === 'package.json')) || '{}');
    return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}), ...BUILTIN_PACKAGES]);
  } catch { return new Set(BUILTIN_PACKAGES); }
}

/**
 * The words of the files a job may actually change (the page and what only it uses). Shared components and other pages are left out:
 * they cannot be rewritten by this job, so counting them would make "the wording really changed" impossible to satisfy.
 */
function ownedWordSet(files, scope) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const text = (scope.ownedList || []).map((path) => visibleWording(textOf(byPath.get(path)))).join('\n');
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 2));
}

/**
 * What a visitor can READ in a source file: the text between tags, labels and placeholders, and the human strings of data files.
 * Class names, import paths, identifiers, urls and ids are not wording (counting them made a rewrite impossible to measure).
 */
function visibleWording(source) {
  const code = String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*(?:import|export)\b[^\n]*\bfrom\s+['"][^'"]+['"];?/gm, ' ').replace(/^\s*import\s+['"][^'"]+['"];?/gm, ' ')
    .replace(/\b(?:className|class|to|href|src|srcSet|key|id|type|ref|style|role|rel|target|htmlFor|name|value|method|action|loading|width|height|viewBox|d|fill|stroke)\s*=\s*(?:"[^"]*"|'[^']*'|\{`[^`]*`\}|\{(?:"[^"]*"|'[^']*')\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g, ' ');
  const parts = [];
  for (const match of code.matchAll(/(?<![=!])>([^<>{}=]*[A-Za-z]{3,}[^<>{}=]*)</g)) parts.push(match[1]);
  for (const match of code.matchAll(/(['"`])((?:(?!\1)[^\\\n$]|\\.){3,})\1/g)) {
    const value = match[2].trim();
    if (!/[A-Za-z]{3,}/.test(value) || /^[\/.#@]|:\/\/|^[\w.-]+@[\w.-]+$/.test(value)) continue;
    const tokens = value.split(/\s+/);
    if (tokens.length === 1 && !/^[A-Z][a-z]{2,}$/.test(value)) continue; // an id, key or css word
    if (tokens.every((token) => /^[\w\-:\/\[\]\.%!#@,]+$/.test(token)) && tokens.some((token) => /[-:\[\]\/]/.test(token)) && !/^[A-Z]/.test(value)) continue; // a class list
    parts.push(value);
  }
  return parts.join(' ');
}
/** A short, readable listing of the visible wording of some files (for the reviewer). */
function wordingOf(files, paths, limit = 3500) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const out = [];
  let size = 0;
  for (const path of paths) {
    const text = visibleWording(textOf(byPath.get(path))).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const line = `- ${path}: ${text.slice(0, Math.max(200, Math.floor(limit / Math.max(1, paths.length))))}`;
    out.push(line);
    size += line.length;
    if (size > limit) break;
  }
  return out.join('\n');
}
/** Share of the old wording of the changeable files that is still there, or null when there is too little to judge. */
function keptShareOwned(baseline, candidate, scope) {
  const before = ownedWordSet(baseline, scope);
  if (before.size < 40) return null;
  const after = ownedWordSet(candidate, scope);
  return [...before].filter((word) => after.has(word)).length / before.size;
}

/** The page's own words (its component and what only it uses), for the "is this still a real, distinct page" checks. */
function pageWords(files, componentPath) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const source = pageDistinctness.pageSource(componentPath, byPath, 2);
  const text = pageDistinctness.visibleText(source);
  return { text, words: text.split(/\s+/).filter((word) => /[a-z]{2,}/i.test(word)).length, set: new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 2)) };
}

/**
 * Static checks of a candidate against the files before the change. Returns the list of problems (empty = acceptable).
 * @param {object} p  { baseline, candidate, scope, page, pages, template, changedPaths }
 */
/**
 * "Add images / use these photos" is a picture-only edit: the words of the page must stay. A rewrite, a removal or a new subject is
 * not picture-only, so the instruction must name pictures and must not ask for any change of the text.
 */
const PICTURE_WORDS = /\b(images?|photos?|pictures?|photographs?|gallery|banner|logo)s?\b/i;
const TEXT_CHANGE_WORDS = /\b(rewrite|re-?write|remove|delete|replace the (?:text|heading|content|copy)|(?:change|edit|update|shorten|lengthen|translate) the (?:text|heading|title|content|copy|wording)|text|heading|title|content|copy|wording|about|instead|for (?:a|an|the|my) |turn|convert|transform|redesign|rebuild|new section)\b/i;
function isPictureOnlyEdit(instruction, attachments = [], policy = null) {
  if (policy?.pictureOnly === true) return true;
  const text = ownerWords(instruction);
  if (TEXT_CHANGE_WORDS.test(text.replace(/\b(image|photo|picture)s? (?:and|or) (?:text|content)\b/gi, ''))) return false;
  return PICTURE_WORDS.test(text) || (attachments.length > 0 && text.split(/\s+/).length <= 30);
}
const REWRITE_WORDS = /\b(rewrite|re-?write|redo|redesign|rebuild|recreate|revamp|overhaul|start over|from scratch|transform|convert|turn (?:this|the|it)|(?:make|change) (?:this|the) (?:page|website|site) (?:for|into|about)|for (?:a|an|the|my) [\p{L} ]{2,40}(?:website|site|college|school|hospital|company|business)|all (?:the )?(?:sections|content|text)|whole page|entire page|every section|across (?:all )?sections)\b/iu;
/**
 * How much of the page's existing wording must survive an instruction. A picture-only instruction keeps almost everything; any other
 * edit keeps most of the page (it may change what it names, not the rest); a selected section leaves the other sections alone.
 * A rewrite, a website-wide change or a change of subject is allowed to replace the content.
 */
/** "Remove this section", "delete the tabs", "get rid of the footer links": the owner wants something gone, so the page legitimately loses words. */
const REMOVE_WORDS = /\b(remove|delete|get rid of|take out|take away|drop|eliminate|erase|hide)\b/i;
// With a confident intent the operations decide ("remvoe the footer" is a removal); without one the words do.
const wantsRemoval = (instruction, policy = null) => (typeof policy?.removal === 'boolean' ? policy.removal : REMOVE_WORDS.test(ownerWords(instruction)));

function keepRatioFor({ instruction, attachments = [], siteWide = false, rewrite = false, policy = null }) {
  if (siteWide || rewrite) return null;
  // The detected intent decides how much of the page must survive (a rewrite none, a bug fix almost all); no intent: the words decide.
  if (policy && policy.keepRatio !== undefined) return policy.keepRatio;
  if (REWRITE_WORDS.test(ownerWords(instruction))) return null;
  if (wantsRemoval(instruction)) return 0.25; // only a guard against emptying the page; the minimum-words check still applies
  if (isPictureOnlyEdit(instruction, attachments, policy)) return 0.9;
  return /The owner ticked only the section/.test(String(instruction || '')) || selectedSectionNumbers(instruction).length ? 0.8 : 0.7;
}

/**
 * The part of an instruction the owner actually asked for. The section popup adds reference material after it (what the section shows
 * now, what was typed by hand); those words describe the page, so they must never decide what kind of change this is.
 */
// Everything after the owner's own words is added by the studio or the job: the page and section context, "(The owner ticked only the
// section ... do not touch, restyle, reword, reorder or REMOVE them ...)" and the note about a failed earlier try. None of it is the
// owner's request ("remove" in that note once made every ticked-section edit look like a request to delete the section).
const CONTEXT_MARK = /\n\n(?:SECTION(?: \d+)? CONTENT|PAGE CONTENT|PAGE CONTEXT|\(The owner|\(A previous try|This applies to the text)/;
const ownerWords = (instruction) => { const text = String(instruction || ''); const at = text.search(CONTEXT_MARK); return at >= 0 ? text.slice(0, at) : text; };

/** The section numbers the owner ticked: the panel sends 'In section 02 ("Name"), section 05 ("Name"): ...'. */
function selectedSectionNumbers(instruction) {
  const lead = String(instruction || '').match(/^In ((?:and |, )?section \d+ \("[^"]*"\)(?:,? ?(?:and )?)?)+:/i);
  return lead ? [...new Set([...lead[0].matchAll(/section (\d+) \("/gi)].map((m) => Number(m[1])))] : [];
}

/**
 * The sections the owner did NOT tick must be exactly as they were. Returns a problem for the ones that changed, or null.
 * Only checked when the page has recognisable sections (the same ones the panel lists).
 */
function untouchedSectionProblem({ baselineSource, candidateSource, numbers, page }) {
  if (!numbers.length) return null;
  const blocks = require('./templatePageService').sectionBlocks(baselineSource);
  const total = blocks.reduce((sum, block) => sum + block.numbers.length, 0);
  if (!blocks.length || numbers.some((n) => n > total)) return null;
  const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const after = squash(candidateSource);
  // A section's source runs up to where the NEXT section starts, so when the next one is the owner's, the tail of this one is the code that
  // opens the container around it (`<div className="grid">{results.map((l) => (`). Changing the ticked section changes that tail (a renamed
  // loop variable, another list), so only what is before the last complete element of the block must stay exactly as it was.
  const sameAsBefore = (block, index) => {
    let source = squash(block.source);
    const next = blocks[index + 1];
    if (next && next.numbers.some((n) => numbers.includes(n))) {
      const closed = Math.max(source.lastIndexOf('/>') >= 0 ? source.lastIndexOf('/>') + 2 : -1, source.lastIndexOf('</') >= 0 ? source.indexOf('>', source.lastIndexOf('</')) + 1 : -1);
      if (closed > 40) source = source.slice(0, closed);
    }
    return after.includes(source);
  };
  const changed = blocks.filter((block, index) => !block.numbers.some((n) => numbers.includes(n)) && !sameAsBefore(block, index));
  if (!changed.length) return null;
  const names = changed.slice(0, 6).map((block) => `${String(block.number).padStart(2, '0')} "${block.name}"`).join(', ');
  return issue('preserve', `Section${changed.length > 1 ? 's' : ''} ${names} ${changed.length > 1 ? 'were' : 'was'} changed, but the owner selected only section${numbers.length > 1 ? 's' : ''} ${numbers.map((n) => String(n).padStart(2, '0')).join(', ')}.`, { path: page.componentPath, route: page.route, cause: 'Sections that were not ticked must stay exactly as they are.', action: `Start again from the ORIGINAL page code. Change ONLY section${numbers.length > 1 ? 's' : ''} ${numbers.map((n) => String(n).padStart(2, '0')).join(', ')}; copy every other section character for character (same JSX, same text, same images).` });
}

/**
 * Does the owner want the website itself to answer visitors with AI ("open a popup where AI generates content", "ask AI box")?
 * Then the page must call the platform's assistant (window.VEAVE_AI); a fixed written popup is not what was asked for.
 */
function wantsAiAnswers(instruction) {
  const text = ownerWords(instruction);
  if (/\b(images?|photos?|pictures?|logo|illustrations?|background)\b/i.test(text)) return false;
  // AI + something that is produced for a visitor + a place where the visitor meets it (a pop-up, a box, a button, a question).
  return /\b(ai|a\.i\.|artificial intelligence|chat ?bot|assistant|gpt|llm)\b/i.test(text) && /\b(generate[sd]?|generating|answers?|replies|reply|respond|responds?|response|explain|ask|content|tell)\b/i.test(text) && /\b(pop-?up|poopup|pop ?up|box|modal|dialog|chat|chatbot|assistant|ask|visitors?|click(?:ed|s)?|button|tab|typed?|question|questions)\b/i.test(text);
}
// The assistant must really be ASKED and its answer used: a file that only mentions window.VEAVE_AI does not count.
const callsAssistant = (files) => files.some((file) => typeof file.content === 'string' && /^src\//.test(file.path) && /\bVEAVE_AI\b/.test(file.content) && /\.ask\s*\(/.test(file.content) && (/\.then\s*\(/.test(file.content) || /\bawait\b[^;\n]*\.ask\s*\(/.test(file.content)));

/**
 * Does a route of the router ("/listings/:id") serve the route of a page ("/listings/k-1001")? A detail page of a template is one sample
 * of a dynamic route, so its route is a concrete address that the router matches with a parameter. Static segments must be equal.
 */
function routeMatches(pattern, actual) {
  if (pattern === actual) return true;
  const a = String(actual || '').split('/').filter(Boolean);
  const p = String(pattern || '').split('/').filter(Boolean);
  return p.length === a.length && p.length > 0 && p.every((segment, index) => segment === a[index] || (segment.startsWith(':') && segment.length > 1));
}
/** The internal links of a source file: literal ones ("/programs") and template ones ("/programs/${p.id}" -> "/programs/:param"). */
function internalLinks(source) {
  const links = new Set();
  for (const match of String(source || '').matchAll(/\b(?:to|href)\s*=\s*(?:["'](\/[^"'#?\s]*)["']|\{\s*["'](\/[^"'#?\s]*)["']\s*\}|\{\s*`(\/[^`#?\s]*)`\s*\})/g)) {
    const link = (match[1] || match[2] || match[3]).replace(/\$\{[^}]*\}/g, ':param').replace(/\/+$/, '') || '/';
    if (/\.[a-z0-9]{2,5}$/i.test(link) || /^\/(?:assets|images)\//.test(link)) continue;
    links.add(link);
  }
  return links;
}

/**
 * What the change added must be connected to the app: a NEW link on a changed file must lead to a route of the router (src/App.jsx), and a
 * NEW source file must be imported by something (a component nobody imports is never shown). Links that were already there are not judged.
 */
function appConnectionProblems({ baseline, candidate, page, changedPaths = [] }) {
  const problems = [];
  const routes = pageDistinctness.extractRoutes(candidate).filter((route) => route.path && route.path !== '*' && !route.path.includes('*'));
  if (!routes.length) return problems;
  const before = new Map(baseline.map((file) => [file.path, file]));
  const known = (link) => link === '/' || routes.some((route) => routeMatches(route.path, link) || (link.includes(':param') && routeMatches(link.replace(/:param/g, ':p'), route.path)));
  for (const path of changedPaths) {
    const file = candidate.find((item) => item.path === path);
    if (!file || !SOURCE.test(path) || !/^src\//.test(path) || path === 'src/App.jsx') continue;
    const old = internalLinks(textOf(before.get(path)));
    const broken = [...internalLinks(textOf(file))].filter((link) => !old.has(link) && !known(link));
    if (broken.length) problems.push(issue('website', `${path} links to ${broken.map((link) => `"${link.replace(/:param/g, '...')}"`).join(', ')}, which ${broken.length === 1 ? 'is not a route' : 'are not routes'} of the app (src/App.jsx).`, { path, route: page.route, cause: 'A link the change added leads nowhere: the router has no such page.', action: `Link only to routes the app has: ${[...new Set(routes.map((route) => route.path))].slice(0, 20).join(', ')}.` }));
  }
  const byPath = new Map(candidate.map((file) => [file.path, file]));
  const imported = new Set(candidate.filter((file) => SOURCE.test(file.path)).flatMap((file) => [...pageDistinctness.importMap(file, byPath).values()]));
  for (const file of candidate) {
    if (before.has(file.path) || !SOURCE.test(file.path) || !/^src\/(?:components|data)\//.test(file.path) || imported.has(file.path)) continue;
    // A file imported only for its side effects or re-exported is still connected.
    if (candidate.some((other) => SOURCE.test(other.path) && new RegExp(`['"][./]*${file.path.replace(/^src\//, '').replace(/\.[jt]sx?$/, '').split('/').pop()}(?:\\.[jt]sx?)?['"]`).test(textOf(other)))) continue;
    problems.push(issue('website', `${file.path} was created but nothing imports it, so it never appears on the page.`, { path: file.path, route: page.route, cause: 'A new component or data file that is not connected to the page.', action: `Import and use ${file.path} in ${page.componentPath}, or do not create it.` }));
  }
  return problems;
}

const routesFor = (candidate, route) => pageDistinctness.extractRoutes(candidate).filter((item) => routeMatches(item.path, route)).sort((x, y) => Number(y.path === route) - Number(x.path === route));

/**
 * A video must really play: it is a <video> (not an <img> or a CSS background), and it is muted, inline and set to autoplay, because a
 * browser refuses to start any other kind. Returns { message, cause } or null when it is used correctly.
 */
function videoUseProblem(source, photo) {
  const escaped = photo.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!source.includes(photo.path)) return { message: `The video you attached ("${photo.name}") is not used on the page.`, cause: 'The attached video was left out.' };
  if (new RegExp(`<img\\b[^>]*${escaped}`).test(source)) return { message: `The video ("${photo.name}") was put in an <img>, which cannot play it.`, cause: 'A video needs a <video> element.' };
  const tags = [...source.matchAll(/<video\b[^>]*>/g)].map((match) => match[0]);
  const viaSource = new RegExp(`<video\\b[^>]*>[\\s\\S]{0,300}?<source\\b[^>]*${escaped}`).exec(source);
  const tag = tags.find((item) => item.includes(photo.path)) || (viaSource ? viaSource[0].match(/<video\b[^>]*>/)[0] : null);
  if (!tag) return { message: `The video ("${photo.name}") is not shown with a <video> element.`, cause: 'It was used as something other than a video (for example a CSS background).' };
  const missing = [['autoPlay', /\bautoPlay\b|\bautoplay\b/], ['muted', /\bmuted\b/], ['playsInline', /\bplaysInline\b|\bplaysinline\b/], ['loop', /\bloop\b/]].filter(([, pattern]) => !pattern.test(tag)).map(([name]) => name);
  return missing.length ? { message: `The video ("${photo.name}") is missing ${missing.join(', ')}, so the browser will not start or keep playing it.`, cause: 'A background video must be muted, inline, looping and autoplaying.' } : null;
}

function checkCandidate({ baseline, candidate, scope, page, pages, template, changedPaths, attachments = [], instruction = '', siteWide = false, rewrite = false, policy = null, originalFiles = null }) {
  const problems = [];
  // ai: an AI answer box must really call the assistant
  if (wantsAiAnswers(instruction) && !callsAssistant(candidate)) {
    problems.push(issue('ai', 'The page was asked to show AI-generated content, but nothing calls the website assistant, so the box would only show fixed text.', { path: page.componentPath, route: page.route, cause: 'The AI content was written into the page instead of being asked for.', action: 'Make the box call window.VEAVE_AI.ask(question, { topic }) (it returns a Promise of a plain-text answer): open the pop-up at once with a loading line, put the answer in it when the Promise resolves, and show a clear error line (not an invented answer) if it fails. Do not write the answer text into the page.' }));
  }
  // functional: nothing that only looks finished (unused data, empty handlers, fake success, an assistant that is never asked)
  for (const found of require('./templateFunctionalAudit').auditChange({ baseline, candidate, changedPaths })) {
    problems.push(issue('functional', found.message, { path: found.path, route: page.route, cause: 'The code looks complete but does not do what it appears to do.', action: found.action }));
  }
  // data: rewritten records must still be readable by the code that filters, sorts and searches them (otherwise the page shows nothing)
  for (const found of require('./templateDataContract').brokenReads({ baseline, candidate, changedPaths, owned: scope.owned })) {
    const fields = found.fields.slice(0, 10).join(', ');
    problems.push(issue('functional', `${found.path} still reads the fields ${fields} of the records in ${found.dataPath}, but the new records no longer have them: its filter, sorting or search would hide every record (or break), so the page would show nothing.`, { path: found.path, route: page.route, cause: 'The records were rewritten without the code that reads them.', action: found.owned ? `Change the filter, sorting and search code of ${found.path} (only that code, not its sections) so it reads the fields the new records have, or keep ${fields} in every record with values that make sense for them.` : `${found.path} cannot be changed by this edit: keep the fields ${fields} in every record of ${found.dataPath}, with values that make sense for the new records.` }));
  }
  // removal: a section the owner asked to remove must really be gone (not just emptied), and nothing may still link to it
  const tickedForRemoval = selectedSectionNumbers(instruction);
  if (tickedForRemoval.length && wantsRemoval(instruction, policy)) {
    const before = (baseline.find((file) => file.path === page.componentPath) || {}).content;
    const afterSource = (candidate.find((file) => file.path === page.componentPath) || {}).content || '';
    const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const blocks = before ? require('./templatePageService').sectionBlocks(before) : [];
    const stillThere = blocks.filter((block) => block.numbers.some((n) => tickedForRemoval.includes(n)) && block.source.length > 40 && squash(afterSource).includes(squash(block.source)));
    if (stillThere.length) problems.push(issue('preserve', `Section ${stillThere.map((block) => `${String(block.number).padStart(2, '0')} "${block.name}"`).join(', ')} was asked to be removed but is still on the page.`, { path: page.componentPath, route: page.route, cause: 'The section was kept or only partly changed.', action: 'Delete the whole section from the page (its complete element, not just its text), together with imports, data and links that only it used.' }));
    // links to ids that only the removed sections had
    const idsBefore = new Set([...(before || '').matchAll(/\bid=["']([\w-]+)["']/g)].map((m) => m[1]));
    const idsAfter = new Set([...afterSource.matchAll(/\bid=["']([\w-]+)["']/g)].map((m) => m[1]));
    const dangling = [...new Set([...candidate.filter((file) => /^src\/.*\.(jsx?|tsx?)$/.test(file.path) && typeof file.content === 'string').flatMap((file) => [...file.content.matchAll(/["'`]\/?#([\w-]+)["'`]/g)].map((m) => m[1]))])].filter((id) => idsBefore.has(id) && !idsAfter.has(id));
    if (dangling.length) problems.push(issue('preserve', `A link still points to the removed section (#${dangling.slice(0, 3).join(', #')}).`, { path: page.componentPath, route: page.route, cause: 'A menu, button or card still links to a section that no longer exists.', action: 'Remove those links or point them to a section that exists.' }));
  }
  // preserve: ticked sections only
  const ticked = selectedSectionNumbers(instruction);
  if (ticked.length) {
    const text = (files) => (files.find((file) => file.path === page.componentPath) || {}).content;
    const locked = untouchedSectionProblem({ baselineSource: text(baseline), candidateSource: text(candidate), numbers: ticked, page });
    if (locked) problems.push(locked);
  }
  // preserve: the instruction may change what it names, not the rest of the page
  const keepRatio = keepRatioFor({ instruction, attachments, siteWide, rewrite, policy });
  // A rewrite must really replace the wording: a page that still has almost all of its words was not rewritten.
  if (policy?.maxKeep && !siteWide) {
    // Measured on the page's own files: shared data it displays (another page's records, the departments of the site) is judged file by
    // file below, against the template; counted here it made a full rewrite of the page itself look like "94% unchanged".
    const kept = keptShareOwned(baseline, candidate, scope.ownOnly ? { ...scope, ownedList: scope.ownOnly } : scope);
    if (kept !== null) {
      if (kept > policy.maxKeep) problems.push(issue('intent', `The page was asked to be rewritten, but ${Math.round(kept * 100)}% of its wording is unchanged.`, { path: page.componentPath, route: page.route, cause: 'The change was too small for a rewrite.', action: 'Write new content for the whole page: new headings, paragraphs, labels and button text for every section, and improve the composition. Return the complete file with operation "modify".' }));
    }
  }
  // A rewrite covers everything the page displays (its own sections, the components and the sample data it renders), not only the page file.
  // "Rewritten" is measured against the template as it was shipped: a file that still reads like the template's original website was not
  // rewritten, and one that an earlier change already rewrote is not asked again.
  if (policy?.rewrite) {
    const original = originalFiles instanceof Map ? originalFiles : null;
    // Only the words that belong to the template's own subject count ("bedrooms", "brownstones"): words that other templates use too
    // ("Full name", "Email", "Send") are generic, and a contact form made of them is right for any website, so it is never "old wording".
    const generic = genericWords(template?.id);
    const left = (scope.pageFiles || []).filter((path) => scope.owned.has(path)).map((path) => {
      const reference = original?.get(path) ?? (policy.refinement ? null : textOf(baseline.find((file) => file.path === path)));
      if (!reference) return null;
      const before = ownedWordSet([{ path, content: reference }], { ownedList: [path] });
      if (before.size < 15) return null;
      const distinct = [...before].filter((word) => !generic.has(word));
      if (generic.size && distinct.length < 10) return null;
      const judged = generic.size ? distinct : [...before];
      const after = ownedWordSet(candidate, { ownedList: [path] });
      const kept = judged.filter((word) => after.has(word)).length / judged.length;
      return kept > 0.85 ? { path, kept } : null;
    }).filter(Boolean);
    if (left.length) problems.push(issue('intent', `The page was asked to be rewritten, but ${left.map((item) => `${item.path} (${Math.round(item.kept * 100)}% still the old wording)`).join(', ')} still ${left.length > 1 ? 'have' : 'has'} the old wording.`, { path: left[0].path, route: page.route, cause: 'Only part of what the page shows was rewritten: the rest still speaks about the old subject.', action: `Rewrite ${left.map((item) => item.path).join(', ')} as well: every label, heading, badge, placeholder, option, button text and sample record in them, for this website. Keep their export names, props, field names, number of records and image paths so the other pages still build. Return each as a complete file with operation "modify".` }));
  }
  if (keepRatio) {
    const before = pageWords(baseline, page.componentPath);
    const after = pageWords(candidate, page.componentPath);
    if (before.set.size >= 40) {
      const kept = [...before.set].filter((word) => after.set.has(word)).length / before.set.size;
      if (kept < keepRatio) {
        problems.push(issue('preserve', `Only ${Math.round(kept * 100)}% of the page's existing wording is still there (${before.words} words before, ${after.words} now); this instruction should change only what it mentions.`, { path: page.componentPath, route: page.route, cause: 'Parts of the page the instruction did not mention were removed or rewritten.', action: 'Start again from the ORIGINAL page code. Change only the parts the instruction names; keep every other section, heading, paragraph, button, card and image exactly as it was. Use small exact "patch" edits.' }));
      }
    }
  }
  // scope: nothing outside the page was changed
  const baselinePaths = new Set(baseline.map((file) => file.path));
  for (const path of changedPaths) {
    if (scope.owned.has(path)) continue;
    if (path === 'package-lock.json') continue;
    if (!baselinePaths.has(path) && (CREATE_PREFIXES.some((prefix) => path.startsWith(prefix)) || path.startsWith(ASSET_PREFIX))) continue;
    problems.push(issue('scope', `${path} was changed but is outside this page.`, { path, cause: 'Only the page and the files only it uses may change.', action: 'Undo that change.' }));
  }
  // asset: every photo the user attached must really be placed on this page, with its exact path
  const pageSourceText = pageDistinctness.pageSource(page.componentPath, new Map(candidate.map((file) => [file.path, file])), 2);
  for (const photo of attachments) {
    if (photo.kind === 'video') {
      const found = videoUseProblem(pageSourceText, photo);
      if (found) problems.push(issue('asset', found.message, { path: page.componentPath, route: page.route, cause: found.cause, action: `Place <video src="${photo.path}" autoPlay muted loop playsInline preload="auto" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover motion-reduce:hidden" /> as the first child of the section that gets it (the section is "relative isolate overflow-hidden"), followed by a dark overlay div, with the section's text above it.` }));
    } else if (!pageSourceText.includes(photo.path)) {
      problems.push(issue('asset', `The photo you attached ("${photo.name}") is not used on the page.`, { path: page.componentPath, route: page.route, cause: 'The attached picture was left out.', action: `Place <img src="${photo.path}" alt="..." > where it fits the instruction.`.replace('" >', '">') }));
    }
  }
  // code: the build must not get worse
  for (const found of store.newProblems(baseline, candidate)) {
    problems.push(issue('code', `${found.path}: ${String(found.message).slice(0, 240)}`, { path: found.path, cause: found.category === 'import' ? 'An import does not resolve.' : 'The code does not compile.', action: 'Fix this exact error in this file.' }));
  }
  const installed = installedPackages(candidate);
  for (const [name, paths] of bareImports(candidate.filter((file) => changedPaths.includes(file.path)))) {
    if (!installed.has(name)) problems.push(issue('code', `${paths[0]} imports "${name}", which is not installed in this project.`, { path: paths[0], cause: 'Packages cannot be added by a page regeneration.', action: `Remove the use of "${name}" or replace it with plain React and Tailwind.` }));
  }
  // website: everything a page edit added is connected to the app (links lead to routes of src/App.jsx, new files are imported). When a
  // whole website is written, a broken link is flagged for review by finalSiteChecks instead (its pages are never regenerated for it).
  if (!rewrite) problems.push(...appConnectionProblems({ baseline, candidate, page, changedPaths }));
  // website: the route still renders this page's component, and the page is a real, distinct page
  const routes = routesFor(candidate, page.route);
  if (!routes.length || (routes[0].target && routes[0].target !== page.componentPath)) {
    problems.push(issue('website', `The route ${page.route} no longer renders ${page.componentPath}.`, { route: page.route, path: page.componentPath, cause: 'The page component was renamed, removed or its default export changed.', action: `Keep ${page.componentPath} with its default export.` }));
  }
  const mine = pageWords(candidate, page.componentPath);
  if (mine.words < MIN_PAGE_WORDS) problems.push(issue('website', `${page.name} has only ${mine.words} words of content; it would be nearly blank.`, { path: page.componentPath, route: page.route, cause: 'The page lost its content.', action: 'Keep or rewrite the real content of the page; do not empty it.' }));
  for (const other of pages.filter((item) => String(item._id) !== String(page._id))) {
    const theirs = pageWords(candidate, other.componentPath);
    if (mine.set.size >= MIN_PAGE_WORDS && theirs.set.size >= MIN_PAGE_WORDS && pageDistinctness.jaccard(mine.set, theirs.set) >= 0.85) {
      problems.push(issue('website', `${page.name} now repeats the content of ${other.name} (${Math.round(pageDistinctness.jaccard(mine.set, theirs.set) * 100)}% the same text).`, { path: page.componentPath, route: page.route, cause: 'The page was copied from another page.', action: `Write content that fits the "${page.name}" page and is different from "${other.name}".` }));
    }
  }
  // regression: locked and shared files are exactly as the template defines them / as they were
  for (const locked of template?.scaffold?.protectedFiles || []) {
    if (locked === 'package.json' || scope.owned.has(locked)) continue;
    const before = baseline.find((file) => file.path === locked);
    const after = candidate.find((file) => file.path === locked);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `${locked} is locked and was changed.`, { path: locked, cause: 'Locked files are part of the template.', action: 'Leave it unchanged.' }));
  }
  for (const sharedPath of template?.scaffold?.sharedFiles || []) {
    if (scope.owned.has(sharedPath)) continue;
    const before = baseline.find((file) => file.path === sharedPath);
    const after = candidate.find((file) => file.path === sharedPath);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `The shared file ${sharedPath} was changed.`, { path: sharedPath, cause: 'Shared components are used by every page.', action: 'Leave it unchanged.' }));
  }
  const unchangedPages = pages.filter((item) => String(item._id) !== String(page._id));
  for (const other of unchangedPages) {
    const before = baseline.find((file) => file.path === other.componentPath);
    const after = candidate.find((file) => file.path === other.componentPath);
    if (before && (!after || after.content !== before.content)) problems.push(issue('regression', `The ${other.name} page (${other.componentPath}) was changed.`, { path: other.componentPath, route: other.route, cause: 'A regeneration may only change its own page.', action: 'Undo that change.' }));
  }
  return problems;
}

/**
 * Words the OTHER templates use too (in at least two of them): the vocabulary of any website (forms, buttons, navigation), as opposed
 * to the words of one template's subject. Computed once per template and kept.
 */
const genericCache = new Map();
function genericWords(templateId) {
  if (!templateId) return new Set();
  if (genericCache.has(templateId)) return genericCache.get(templateId);
  let generic = new Set();
  try {
    const templates = require('../templates/templateService');
    const counts = new Map();
    for (const [id] of templates.loadRegistry()) {
      if (id === templateId) continue;
      let files;
      try { files = templates.instantiateFiles(templates.resolveTemplate(id, {})); } catch { continue; }
      const words = new Set(visibleWording(files.filter((file) => SOURCE.test(file.path) && /^src\//.test(file.path)).map(textOf).join('\n')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((word) => word.length > 2));
      for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    }
    generic = new Set([...counts].filter(([, n]) => n >= 2).map(([word]) => word));
  } catch { generic = new Set(); }
  genericCache.set(templateId, generic);
  return generic;
}

/** Remote image links in the changed files that could not be downloaded become asset problems. */
function imageProblems(failed = [], spare = []) {
  return failed.map((item) => issue('asset', `The image ${item.url} could not be downloaded (${item.reason || 'unreachable'}).`, {
    cause: 'The link is dead or not a public image.',
    action: spare.length ? `Use one of these verified pictures instead: ${spare.slice(0, 4).map((asset) => asset.url).join(', ')}.` : 'Use a different real, public image link, or remove that image.'
  }));
}

/* ------------------------------------------------ build + browser gate ------------------------------------------------ */

const PLAN_PATH = 'veave.validation.json';

/**
 * The production build and a browser test of every route, through the shared gate. `repair(files, diagnostics, history)` is the
 * page-scoped repair (it may only change this page's files). Returns { files, report }; throws a PipelineError when it still fails.
 */
/* ------------------------------------------------ a faulty browser test must not fail the page ------------------------------------------------ */

const isPlanDiagnostic = (item) => item?.path === 'veave.validation.json' || /veave\.validation\.json/.test(String(item?.message || ''));
/** Did ONLY the AI-written behaviour tests fail (the build, every route and the error checks passed)? */
// A request of the browser test to the build machine's own preview server that was dropped (ECONNRESET, net::ERR_FAILED): the machine's
// fault, not the page's, so it never decides whether the page failed.
const TRANSIENT_FETCH = /ECONNRESET|socket hang up|net::ERR_(?:FAILED|CONNECTION_RESET|CONNECTION_CLOSED|EMPTY_RESPONSE|ABORTED)/i;
const isTransientFetch = (item) => /^https?:\/\/(?:127\.0\.0\.1|localhost)[:/]/.test(String(item?.path || item?.message || '')) && TRANSIENT_FETCH.test(String(item?.message || ''));
function behaviourFailureOnly(diagnostics = []) {
  const list = (Array.isArray(diagnostics) ? diagnostics : []).filter((item) => !isTransientFetch(item));
  return list.some(isPlanDiagnostic) && list.every((item) => isPlanDiagnostic(item) || /^Error: Browser validation failed/.test(String(item?.message || '')));
}
/** "strict mode violation: locator resolved to 3 elements": the test's selector was ambiguous, which is a fault of the test, not of the page. */
const strictModeProblem = (diagnostics = []) => (Array.isArray(diagnostics) ? diagnostics : []).some((item) => isPlanDiagnostic(item) && /strict mode violation|resolved to \d+ elements/i.test(String(item?.message || '')));
/** The same tests, each selector made to mean its FIRST match (a count or a style check keeps its exact meaning). */
function relaxSelectors(tests = []) {
  return tests.map((test) => ({ ...test, steps: (test.steps || []).map((step) => (!step?.selector || / >> nth=/.test(step.selector) || (step.action === 'assert' && (step.count !== undefined || step.style !== undefined)) ? step : { ...step, selector: `${step.selector} >> nth=0` })) }));
}

/**
 * What a build check covers. "page" (the default): the pages the change can affect, on the desktop screen, without following every link
 * of the home page. "full": every page, desktop and mobile, and the link crawl, as before (VALIDATION_SCOPE=full). The screens can be set
 * with VALIDATION_VIEWPORTS (for example "desktop,mobile").
 */
function gateScope() {
  const full = String(process.env.VALIDATION_SCOPE || 'page').toLowerCase() === 'full';
  const named = String(process.env.VALIDATION_VIEWPORTS || '').split(',').map((name) => name.trim()).filter((name) => name === 'desktop' || name === 'mobile');
  const viewports = named.length ? [...new Set(named)] : (full ? ['desktop', 'mobile'] : ['desktop']);
  return { full, viewports, maxRoutes: full ? null : 0 };
}

const CODE_FILE = /^(?:src\/.+\.(?:jsx?|tsx?|css|json)|index\.html|package\.json|(?:vite|tailwind|postcss)\.config\.[cm]?js)$/;
/**
 * The routes to test for a change: the edited page and the home page, plus every other page that uses a file the change touched (so a
 * rewritten data file or shared component still tests the pages that read it). When the change touches something no page imports (the
 * router, the menu, the shared layout, the styles, package.json) every page can be affected, so every route is returned.
 */
function affectedRoutes({ files, changedPaths = [], page, pages = [], routeOf = (item) => item.route }) {
  const everything = [...new Set(['/', ...pages.map(routeOf)])];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const code = changedPaths.filter((path) => CODE_FILE.test(path));
  const reach = pages.map((item) => ({ item, files: new Set(pageDistinctness.reachableFiles(item.componentPath, byPath, 4)) }));
  if (code.some((path) => !reach.some((entry) => entry.files.has(path)))) return everything;
  const out = ['/'];
  const add = (item) => { const route = routeOf(item); if (!out.includes(route)) out.push(route); };
  if (page) add(page);
  for (const entry of reach) if (!page || String(entry.item._id) !== String(page._id)) if (code.some((path) => entry.files.has(path))) add(entry.item);
  return out;
}

async function runBuildGate(files, { routes, extraTests = [], signal, onProgress, repair, maxRepairs }) {
  const { validateAndRepair } = require('../ai/validationGate');
  const { executeProject, isDockerAvailable } = require('../ai/executionRunner');
  const { verifyPreviewRuntime } = require('../ai/targetRenderVerifier');
  let useDocker;
  if (process.env.ENABLE_DOCKER_VALIDATION === 'true') useDocker = true;
  else if (process.env.ENABLE_DOCKER_VALIDATION === 'false') useDocker = false;
  else useDocker = await isDockerAvailable();
  const scope = gateScope();
  const tests = routes.map((path) => ({ name: `Route ${path}`, path, viewports: scope.viewports, steps: [{ action: 'assert', selector: '#root', visible: true }] })).concat(extraTests);
  const withPlan = tests.length ? [...files.filter((file) => file.path !== PLAN_PATH), { path: PLAN_PATH, language: 'json', content: JSON.stringify({ version: 1, tests }, null, 2) }] : files;
  const validated = await validateAndRepair(withPlan, {
    signal, onProgress, repair, requireExecution: true, requireArtifacts: useDocker,
    maxRepairs: maxRepairs ?? (Number.parseInt(process.env.TEMPLATE_BUILD_REPAIRS, 10) || 3),
    run: useDocker
      ? async (current, options) => {
          const outcome = await executeProject(current, { ...options, viewports: scope.viewports, maxRoutes: scope.maxRoutes });
          if (outcome?.infrastructure) {
            const local = await verifyPreviewRuntime(current, options);
            return { ...local, degradedExecution: true, infrastructure: outcome.diagnostics, checks: [{ name: 'build', status: 'skipped', reason: 'Isolated build runner unavailable; only the local browser runtime check ran.' }, ...(local.checks || [])] };
          }
          return outcome;
        }
      : (current, options) => verifyPreviewRuntime(current, options)
  });
  validated.report.validationMode = useDocker && validated.report.validationMode !== 'local-browser-fallback' ? 'docker-build' : 'local-browser-fallback';
  return { files: validated.files.filter((file) => file.path !== PLAN_PATH), report: validated.report };
}

/**
 * Checks the whole website once every page has been written. It never regenerates anything: it only reports which pages need a look.
 * Returns [{ pageId, message }] (a page may appear more than once).
 *   - the page's component file exists and its route is registered in the router
 *   - internal links on the page point at routes that exist
 *   - pictures the page shows (/assets/...) exist in the site
 */
/** Links to a section of a page: href="#team" / to="/about#team" -> [{ route, id }] (a "#..." alone means the page itself). */
function anchorLinksOf(source, page) {
  const out = [];
  for (const match of String(source || '').matchAll(/\b(?:to|href)\s*(?:=|:)\s*\{?\s*["'](\/?[^"'#?\s]*)#([A-Za-z][\w-]*)["']/g)) out.push({ route: match[1] ? match[1].replace(/\/+$/, '') || '/' : page.route, id: match[2] });
  return out;
}
const hasSectionId = (source, id) => {
  const text = String(source || '');
  // An id written out (id="team", id: 'team'), or ids built in code (id={section.id}) when the name appears in that code as a quoted word.
  if (new RegExp(`\\bid\\s*=\\s*(?:\\{\\s*)?["'\`]${id}["'\`]|\\bid\\s*:\\s*["']${id}["']`).test(text)) return true;
  return /\bid\s*=\s*\{\s*[^"'`\s}]/.test(text) && new RegExp(`["'\`]${id}["'\`]`).test(text);
};
/** The page a link to "route#id" lands on, with everything it shows (its own source and what it imports). */
function anchorTarget(route, fromPage, pages, byPath) {
  const target = route === fromPage.route ? fromPage : pages.find((item) => item.route === route);
  if (!target || !byPath.has(target.componentPath)) return null;
  return { name: target.name, source: pageDistinctness.pageSource(target.componentPath, byPath, 2) };
}

function finalSiteChecks(files, pages) {
  const found = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const routes = pageDistinctness.extractRoutes(files);
  const known = new Set(routes.map((route) => route.path));
  known.add('/');
  for (const page of pages) {
    const file = byPath.get(page.componentPath);
    if (!file) { found.push({ pageId: String(page._id), message: `The page file ${page.componentPath} is missing.` }); continue; }
    if (!routes.some((route) => routeMatches(route.path, page.route) && (!route.target || route.target === page.componentPath))) found.push({ pageId: String(page._id), message: `The route ${page.route} does not show this page.` });
    const source = pageDistinctness.pageSource(page.componentPath, byPath, 2);
    const seen = new Set();
    for (const match of source.matchAll(/\b(?:to|href)=["'](\/[^"'#?\s]*)["']/g)) {
      const target = match[1].replace(/\/+$/, '') || '/';
      if (seen.has(target) || /\.[a-z0-9]{2,5}$/i.test(target)) continue;
      seen.add(target);
      if (!known.has(target) && !routes.some((route) => route.path && !route.path.includes('*') && routeMatches(route.path, target))) found.push({ pageId: String(page._id), message: `A link goes to ${target}, which is not a page of this website.` });
    }
    for (const link of anchorLinksOf(source, page)) {
      const target = anchorTarget(link.route, page, pages, byPath);
      if (target && !hasSectionId(target.source, link.id)) found.push({ pageId: String(page._id), message: `A link goes to ${link.route === page.route ? '' : link.route}#${link.id}, but ${target.name} has no section with that id.` });
    }
    for (const match of source.matchAll(/(?:\bsrc=|\bimage\s*:\s*)["'](\/(?:assets|images)\/[^"']+)["'](?!\s*\+)/g)) {
      if (!byPath.has(`public${match[1]}`) && !byPath.has(match[1].slice(1))) found.push({ pageId: String(page._id), message: `The picture ${match[1]} is not in the site.` });
    }
  }
  // The menu and footer links of src/data/site.js (to: '/#campus', to: '/mortgage') are shown on every page: they are judged here, on the home page.
  const home = pages.find((item) => item.route === '/');
  const menu = byPath.get('src/data/site.js');
  if (home && menu && typeof menu.content === 'string') {
    const seen = new Set();
    for (const match of menu.content.matchAll(/\b(?:to|href)\s*:\s*["'](\/[^"'\s]*)["']/g)) {
      const [path, id] = match[1].split('#');
      const target = path.replace(/\/+$/, '') || '/';
      const key = `${target}#${id || ''}`;
      if (seen.has(key) || /\.[a-z0-9]{2,5}$/i.test(target)) continue;
      seen.add(key);
      if (!known.has(target) && !routes.some((route) => route.path && !route.path.includes('*') && routeMatches(route.path, target))) { found.push({ pageId: String(home._id), message: `The menu links to ${target}, which is not a page of this website.` }); continue; }
      const landing = id && anchorTarget(target, home, pages, byPath);
      if (landing && !hasSectionId(landing.source, id)) found.push({ pageId: String(home._id), message: `The menu links to ${target === '/' ? '' : target}#${id}, but ${landing.name} has no section with that id.` });
    }
  }
  return found;
}

module.exports = { appConnectionProblems, internalLinks, genericWords, isTickedEdit, wantsRemoval, finalSiteChecks, pageScope, wantsSiteWide, ownerWords, filterOperations, checkCandidate, wantsAiAnswers, selectedSectionNumbers, untouchedSectionProblem, isPictureOnlyEdit, keepRatioFor, imageProblems, runBuildGate, pageWords, routeMatches, videoUseProblem, namedSections, behaviourFailureOnly, strictModeProblem, relaxSelectors, ownedWordSet, keptShareOwned, visibleWording, wordingOf, issue, sha, MIN_PAGE_WORDS, affectedRoutes, gateScope };
