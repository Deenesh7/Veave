/**
 * The owner's request as an ordered work list, made from the page itself before the AI is asked: the page's sections (as the Content panel
 * numbers them), the files that show them, what the intent engine understood, the exact texts the owner gave and the pictures to place.
 * The page writer gets it as a checklist to do and to check item by item; the reviewer judges the change against the same items, so
 * "rewrite the page" means the same thing to both.
 */
const validation = require('./templateValidationService');

const MAX_ITEMS = 14;
const SUBJECT_INTENTS = /full_rewrite|content_replacement|partial_redesign|full_redesign/;

/** Files the page shows that still speak about the template's own subject (its words are mostly still there). */
function isStale(path, { files, template, originals }) {
  if (!(originals instanceof Map)) return false;
  const generic = validation.genericWords(template?.id);
  const original = originals.get(path);
  const current = (files.find((file) => file.path === path) || {}).content;
  if (!original || typeof current !== 'string') return false;
  const before = [...validation.ownedWordSet([{ path, content: original }], { ownedList: [path] })].filter((word) => !generic.has(word));
  if (before.length < 10) return false;
  const now = validation.ownedWordSet([{ path, content: current }], { ownedList: [path] });
  return before.filter((word) => now.has(word)).length / before.length > 0.6;
}

function staleFiles({ files, scope, template, originals }) {
  return (scope.pageFiles || []).filter((path) => scope.owned.has(path)).filter((path) => isStale(path, { files, template, originals }));
}

/**
 * Data a file reads from a shared data file this change may not edit (`typeOptions` from src/data/listings.js): the old subject's options
 * and records would keep showing through it, so the file must stop importing them and hold its own values.
 */
function sharedImports(path, { files, scope, template, originals }) {
  const source = (files.find((file) => file.path === path) || {}).content || '';
  const dir = path.split('/').slice(0, -1);
  const found = [];
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const parts = [...dir];
    for (const step of match[2].split('/')) { if (step === '..') parts.pop(); else if (step !== '.') parts.push(step); }
    const base = parts.join('/');
    const target = [base, `${base}.js`, `${base}.jsx`].find((candidate) => files.some((file) => file.path === candidate));
    // A shared file another change already rewrote for the new subject is fine to keep using.
    if (!target || !/^src\/data\//.test(target) || scope.owned.has(target) || !isStale(target, { files, template, originals })) continue;
    found.push(`${match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean).join(', ')} from ${target}`);
  }
  return found.length ? ` It reads ${found.join('; ')}, a shared file you may not change: replace that import with its own values for the new subject written in ${path} (or a NEW file under src/data/), so no option or record of the old subject is shown.` : '';
}

/**
 * @returns {Array<{ n: number, text: string }>} the items, in the order they should be done (empty when there is nothing to list).
 */
function buildWorkList({ instruction, page, files, scope, policy = null, intent = null, attachments = [], template = null, originals = null }) {
  const own = validation.ownerWords(instruction).replace(/^In (?:(?:and |, )?section \d+ \("[^"]*"\)(?:,? ?(?:and )?)?)+:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const subject = intent?.subject ? ` for ${intent.subject}` : '';
  const source = (files.find((file) => file.path === page.componentPath) || {}).content || '';
  let blocks = [];
  try { blocks = require('./templatePageService').sectionBlocks(source); } catch { blocks = []; }
  // "Homes in ${n.name}" is read as "Homes in …": the name of a section whose heading is filled in from data.
  const sections = blocks.flatMap((block) => block.numbers.map((number) => ({ number, name: String(block.name).replace(/\$\{[^}]*\}/g, '…') })));
  const ticked = validation.selectedSectionNumbers(instruction);
  const items = [];
  const add = (text) => { if (text && items.length < MAX_ITEMS && !items.some((item) => item.text === text)) items.push({ n: items.length + 1, text }); };
  const pad = (n) => String(n).padStart(2, '0');

  if (ticked.length) {
    for (const n of ticked) {
      const section = sections.find((item) => item.number === n);
      if (section) add(`Section ${pad(n)} "${section.name}": ${own}`);
    }
    add(`Leave every other section (${sections.filter((item) => !ticked.includes(item.number)).map((item) => `${pad(item.number)} "${item.name}"`).join(', ') || 'none'}) exactly as it is.`);
  } else if (policy?.rewrite || SUBJECT_INTENTS.test(intent?.intent || '') && intent?.scope === 'entire_page') {
    for (const section of sections) add(`Section ${pad(section.number)} "${section.name}": ${policy?.refinement ? `keep what already fits; rewrite what still speaks about another subject${subject}` : `rewrite its heading, text, labels and buttons${subject}`}.`);
    for (const path of staleFiles({ files, scope, template, originals }).filter((item) => item !== page.componentPath)) add(`${path}: it still speaks about the template's original subject. Rewrite its visible text and records${subject}; keep its export names, props and field names, so every page that uses it still works.${sharedImports(path, { files, scope, template, originals })}`);
    if (!sections.length) add(`${page.componentPath}: ${own}`);
  } else if (intent?.operations?.length) {
    for (const op of intent.operations) add(`${op.type.replace(/_/g, ' ')}: ${op.target === 'entire_page' ? 'the whole page' : op.target}.`);
    add(`As the owner said it: ${own}`);
  }

  const required = require('./templateBehaviorTests').requiredTexts(instruction);
  if (required.length) add(`Use these exact texts, as written: ${required.map((text) => JSON.stringify(text)).join(', ')}.`);
  for (const photo of attachments.filter((item) => item.record)) add(`Set the picture of the record "${photo.record}" (${photo.recordsPath || 'its data file'}) to ${photo.path}${photo.alt ? `, alt="${photo.alt}"` : ''}.`);
  for (const photo of attachments.filter((item) => !item.record)) add(`Place the picture ${photo.path}${String(photo.placement || '').startsWith('section:') ? ` in the "${photo.placement.slice(8)}" section` : ' where the instruction asks for it'}${photo.alt ? `, alt="${photo.alt}"` : ''}.`);
  return items.length >= 2 ? items : [];
}

const asText = (items) => items.map((item) => `${item.n}. ${item.text}`).join('\n');

module.exports = { buildWorkList, staleFiles, asText, MAX_ITEMS };
