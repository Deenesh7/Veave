/**
 * Deterministic content-depth checks for generated section components: how much real text a section carries, whether it contains
 * placeholder copy, and whether the same paragraph is repeated in several sections (padding). No model, no network.
 */
const { CONTENT_LENGTH } = require('../composition/layoutCatalog');

// Layouts whose job is not to carry paragraphs: they are judged on structure, not on word count.
const STRUCTURAL = /split-hero|full-width-hero|page-intro|cta-band|statistics|gallery|contact-split|faq-list|achievement-grid|timeline/;
// Navigation-style filler: sentences that describe looking for information instead of giving it.
const FILLER = [
  /\b(?:explore|discover|find out|learn more about|browse|visit|read more about|click|view) (?:the |our |all )?[\w' -]{0,40}(?:story|information|details|programmes?|courses?|content|offerings?|page|pages|section|site|website)\b/i,
  /\b(?:information|details|content|courses?|programmes?) (?:is |are )?(?:available|can be found|will be (?:added|available|updated)) (?:on|in|at) (?:this|the|our) (?:site|website|page)\b/i,
  /\bfind the [\w' -]{0,30}information (?:available|on this)/i
];
const PLACEHOLDER = /lorem ipsum|coming soon|your (?:text|content|description) here|placeholder text|\bTODO\b|\bTBD\b|\[(?:insert|add|your)[^\]]*\]|to be (?:added|announced|updated)/i;

/** The words a visitor can read in a JSX source: text nodes and sentence-like string literals, without class names, paths or imports. */
function visibleText(source) {
  let src = String(source || '')
    .replace(/^\s*import\b[^\n]*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ')
    .replace(/\b(?:className|class|src|href|to|id|key|alt|type|rel|target|name|style|role|loading|decoding|fetchPriority|viewBox|d|fill|stroke|aria-[\w-]+|data-[\w-]+|placeholder|htmlFor|value)\s*=\s*(?:\{`[\s\S]*?`\}|\{(["'])[\s\S]*?\1\}|(["'])[\s\S]*?\2|\{[^{}]*\})/g, ' ');
  const parts = [];
  for (const match of src.matchAll(/>([^<>{}]{2,})</g)) parts.push(match[1]);
  for (const match of src.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)) {
    const value = match[2];
    const words = value.trim().split(/\s+/);
    if (words.length >= 3 && /[a-z]{3,}/i.test(value) && !/^[\w./:#@-]+$/.test(value) && !/[=;{}]|=>|\bflex\b|\bgrid\b|\bpx-\d|\btext-[a-z]/.test(value)) parts.push(value);
  }
  return parts.join('\n').replace(/&nbsp;|&amp;|&#?\w+;/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

const wordCount = (text) => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/** Adaptive minimum for a section: a share of its planned length, never forced above what the plan asked for. */
function minimumWords(section) {
  if (STRUCTURAL.test(section.layout || '')) return Math.max(12, Math.round((CONTENT_LENGTH[section.words] ?? 40) * 0.4));
  return Math.max(40, Math.round((CONTENT_LENGTH[section.words] ?? 70) * 0.7));
}

/** Problems with one section's source: too little text, placeholder copy, no heading. */
function sectionProblems(section, source) {
  const text = visibleText(source);
  const words = wordCount(text);
  const problems = [];
  const minimum = minimumWords(section);
  if (words < minimum) problems.push({ kind: 'thin', message: `only ${words} words of real content (needs about ${minimum} or more for "${section.heading || section.id}")` });
  if (PLACEHOLDER.test(text)) problems.push({ kind: 'placeholder', message: 'contains placeholder or unfinished copy' });
  // A short sentence that only points elsewhere is not content: it is reported so the section is rewritten with real information.
  const filler = String(text).split(/\n+|(?<=[.!?])\s+/).filter((sentence) => sentence.trim().split(/\s+/).length <= 24 && FILLER.some((pattern) => pattern.test(sentence)));
  if (filler.length) problems.push({ kind: 'filler', message: `contains navigation filler instead of information ("${filler[0].trim().slice(0, 90)}")` });
  if (!/<h[1-3]\b/.test(source)) problems.push({ kind: 'heading', message: 'has no heading element' });
  if (!/export\s+default\b/.test(source)) problems.push({ kind: 'export', message: 'has no default export' });
  return { words, text, problems };
}

const normalize = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Paragraphs or sentences of nine or more words that appear in more than one section. The first occurrence keeps the text; every
 * later section that repeats it is reported.
 * @param entries [{ key, text }]
 * @returns {Map<string, string[]>} key -> the repeated passages found in that section
 */
function findRepeatedText(entries) {
  const seen = new Map();
  const repeated = new Map();
  for (const { key, text } of entries) {
    const passages = String(text || '').split(/\n+|(?<=[.!?])\s+/).map((passage) => passage.trim()).filter((passage) => wordCount(passage) >= 9);
    for (const passage of passages) {
      const id = normalize(passage);
      if (!id) continue;
      const owner = seen.get(id);
      if (owner === undefined) seen.set(id, key);
      else if (owner !== key) repeated.set(key, [...(repeated.get(key) || []), passage.slice(0, 140)]);
    }
  }
  return repeated;
}

module.exports = { visibleText, wordCount, minimumWords, sectionProblems, findRepeatedText, STRUCTURAL };
