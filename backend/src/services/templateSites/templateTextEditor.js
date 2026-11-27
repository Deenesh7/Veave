/**
 * Saves one text the owner edited directly in the preview. The browser sends the text as it was shown and the new text; this finds
 * that exact text in the site's source (JSX text or a string in a data file), replaces it, and records a revision. It never guesses:
 * a text that is not written in the source (it is built from other values) or that appears more than once is refused with a reason.
 */
const TemplateRevision = require('../../models/TemplateRevision');
const pageDistinctness = require('../ai/pageDistinctness');
const store = require('./siteFileStore');
const { getPage, idOf } = require('./templateSiteService');
const { assertNoRunningJob, changeFiles, undoFiles, bumpSite } = require('./templatePageService');
const { ValidationError, ConflictError } = require('../../utils/errors');

const SOURCE = /\.(?:jsx?|tsx?)$/i;
const MAX_TEXT = 2000;
const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A pattern for the text as it may be written in source: any whitespace run, and the usual spellings of quotes and ampersands. */
function patternFor(text) {
  const parts = text.trim().split(/\s+/).map((word) => Array.from(word).map((ch) => {
    if (ch === "'" || ch === '\u2019') return "(?:'|\\\\'|&apos;|&#39;|\u2019)";
    if (ch === '"') return '(?:"|\\\\"|&quot;)';
    if (ch === '&') return '(?:&amp;|&)';
    return escapeRe(ch);
  }).join(''));
  return new RegExp(parts.join('\\s+'), 'g');
}

const isWordChar = (ch) => /[A-Za-z0-9]/.test(ch || '');

/** Occurrences of the text that stand on their own (not inside a longer word). */
function occurrences(source, text) {
  const found = [];
  const re = patternFor(text);
  let match;
  while ((match = re.exec(source))) {
    const before = source[match.index - 1];
    const after = source[match.index + match[0].length];
    if (!isWordChar(text[0]) || !isWordChar(before)) { if (!isWordChar(text.at(-1)) || !isWordChar(after)) found.push({ index: match.index, length: match[0].length }); }
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return found;
}

/** The replacement, written the way the surrounding source needs it. */
function renderFor(source, at, newText) {
  const before = source[at.index - 1];
  const after = source[at.index + at.length];
  const quoted = ['\'', '"', '`'].includes(before) && before === after;
  if (quoted) {
    const attribute = source[at.index - 2] === '=';
    if (attribute) return newText.replace(/"/g, '&quot;');
    let out = newText.replace(/\\/g, '\\\\').replace(new RegExp(escapeRe(before), 'g'), `\\${before}`);
    if (before === '`') out = out.replace(/\$\{/g, '\\${');
    return out;
  }
  // JSX text (or a bare piece of text): characters that mean something to JSX cannot be written plainly.
  if (/[{}<>\\`]/.test(newText)) throw new ValidationError('Please avoid the characters { } < > and \\ in this text, as they can\'t be saved here. Ask the AI if you need them.');
  if (/^['"`]/.test(newText.trim()) || /['"`]$/.test(newText.trim())) {
    // a quote next to a JSX tag is fine; inside JSX text it is plain text. Nothing to do.
  }
  return newText;
}

/**
 * A text the owner deleted completely: when it is all that its element holds (<h2>Text</h2>), the element goes with it, so no empty
 * block is left behind. A text inside a quoted string, or in an element with other content, is just emptied.
 */
function removalRange(source, at) {
  const quoted = ['\'', '"', '`'].includes(source[at.index - 1]) && source[at.index - 1] === source[at.index + at.length];
  if (quoted) return { index: at.index, length: at.length, text: '' };
  const before = source.slice(0, at.index);
  const open = /<([A-Za-z][\w.]*)(?:\s[^<>]*)?>\s*$/.exec(before);
  const close = open ? new RegExp(`^\\s*</${open[1].replace(/\./g, '\\.')}\\s*>`).exec(source.slice(at.index + at.length)) : null;
  if (open && close && !/\/\s*>$/.test(open[0])) {
    const start = open.index;
    const lead = /[ \t]*\n?[ \t]*$/.exec(source.slice(0, start))[0];
    return { index: start - lead.length, length: at.index + at.length + close[0].length - (start - lead.length), text: lead.includes('\n') ? '' : lead };
  }
  return { index: at.index, length: at.length, text: '' };
}

function applyEdit(files, page, oldText, newText) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const pageFiles = pageDistinctness.reachableFiles(page.componentPath, byPath, 3).filter((path) => SOURCE.test(path));
  const siteFiles = files.filter((file) => SOURCE.test(file.path) && /^src\//.test(file.path) && file.encoding !== 'base64').map((file) => file.path);
  for (const group of [pageFiles, siteFiles]) {
    const hits = [];
    for (const path of new Set(group)) {
      const file = byPath.get(path);
      if (!file || typeof file.content !== 'string') continue;
      for (const at of occurrences(file.content, oldText)) hits.push({ path, at });
    }
    if (!hits.length) continue;
    if (hits.length > 1) throw new ConflictError(`This exact text appears ${hits.length} times on the site, so changing it here could change the wrong one. Tick its section and ask the AI to change it instead.`);
    const { path, at } = hits[0];
    const file = byPath.get(path);
    const range = newText ? { index: at.index, length: at.length, text: renderFor(file.content, at, newText) } : removalRange(file.content, at);
    const content = `${file.content.slice(0, range.index)}${range.text}${file.content.slice(range.index + range.length)}`;
    return { files: files.map((item) => (item.path === path ? { ...item, content } : item)), path };
  }
  throw new ValidationError('This text comes from the site\'s content, so it can\'t be edited by hand here. Ask the AI to change it instead.');
}

async function editText({ user, siteId, pageId, oldText, newText }) {
  const from = String(oldText ?? '').replace(/\s+/g, ' ').trim();
  const to = String(newText ?? '').replace(/\s+/g, ' ').trim();
  if (!from) throw new ValidationError('Click a text in the preview first.');
  if (from.length > MAX_TEXT || to.length > MAX_TEXT) throw new ValidationError(`Text is limited to ${MAX_TEXT} characters.`);
  if (from === to) return { changed: false, path: null };
  const { site, page } = await getPage(user, siteId, pageId);
  await assertNoRunningJob(site._id, page._id);
  const change = await changeFiles(site, (files) => applyEdit(files, page, from, to));
  if (!change.changed.length) return { changed: false, path: null };
  try {
    const updated = await bumpSite(site._id);
    await TemplateRevision.create({
      siteId: site._id, pageId: null, userId: idOf(user), number: updated.revision, kind: 'text-edit',
      instruction: to ? `Edited text on ${page.name}: "${from.slice(0, 60)}" -> "${to.slice(0, 60)}"` : `Deleted the text "${from.slice(0, 60)}" on ${page.name}`, files: change.changed, before: change.previous, siteRevision: updated.revision
    });
  } catch (error) {
    await undoFiles(site, change);
    throw error;
  }
  return { changed: true, path: change.extra.path };
}

module.exports = { editText, applyEdit, occurrences, patternFor };
