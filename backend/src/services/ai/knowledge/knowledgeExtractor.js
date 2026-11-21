/**
 * KnowledgeExtractor: turns crawled pages into a structured, source-linked knowledge object, one requirement at a time.
 *
 *   entries   { id, requirementId, kind, title, text, attributes, sourceUrl, evidence, verified }
 *             kind: person | item (a course, product, department, plan...) | milestone | achievement | facility | fact
 *   gaps      requirements for which the sources gave nothing verifiable: reported, never filled in
 *
 * VERIFIED means the entry's title and its supporting quote are really in the text of the page it cites. A model proposes entries
 * (when one is available) but cannot make anything verified by saying so: every entry is checked against the page text, and what
 * cannot be traced is moved to `unverified` and is never given to the writers. Without a model the same shape is produced by rules
 * that copy text verbatim from the pages.
 */
const { terms, overlap } = require('../deep/deepPlanner');

const norm = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

const ROLE = /\b(vice[- ]chancellor|pro[- ]chancellor|chancellor|co-?founder|founder|chairman|chairperson|president|vice[- ]president|principal|dean|director|ceo|cto|cfo|coo|managing director|registrar|head of [a-z ]+|trustee|owner|proprietor)\b/i;
const NAME = /\b((?:Dr|Prof|Mr|Mrs|Ms|Shri|Smt|Sri|Er|Ar)\.?\s+)?((?:[A-Z][a-z]*\.?\s+){0,3}[A-Z][a-zA-Z'-]{2,}(?:\s+[A-Z][a-zA-Z'-]{2,}){0,2})/;
const YEAR = /\b(1[5-9]\d{2}|20[0-4]\d)\b/;
const AWARD = /\b(award|awarded|rank(?:ed|ing)?|accredit\w*|grade|NAAC|NIRF|NBA|ISO|recogni[sz]\w*|honou?r\w*|winner|first|best|top|certified|approved by)\b/i;
const LEVEL = [[/\b(ph\.?d|doctoral|doctorate|d\.?sc)\b/i, 'Doctoral'], [/\b(d\.?m\.?|m\.?ch\.?|super[- ]?special)/i, 'Super-speciality'], [/\b(post[- ]?graduate|master|m\.?d\.?|m\.?s\.?|m\.?sc|m\.?tech|mba|m\.?phil|pg)\b/i, 'Postgraduate'], [/\b(under[- ]?graduate|bachelor|mbbs|b\.?sc|b\.?tech|b\.?e\.?|b\.?com|bba|bds|bpt|ug)\b/i, 'Undergraduate'], [/\b(diploma|certificate|fellowship)\b/i, 'Diploma and certificate']];

/** Which pages are about a requirement, best first. */
function pagesFor(pages, requirement, limit = 4) {
  const query = `${requirement.label} ${requirement.expectedPage || ''} ${requirement.expectedSection || ''}`;
  return pages.map((page) => {
    const headings = page.blocks.filter((block) => block.tag.startsWith('h')).map((block) => block.text).join(' ');
    let path = '';
    try { path = decodeURIComponent(new URL(page.url).pathname).replace(/[-_/.+]+/g, ' '); } catch { path = ''; }
    const lead = page.blocks.slice(0, 30).map((block) => block.text).join(' ');
    // The label alone is also tried: the page hints ("Academics") only help when they match, and must not dilute a page that is exactly about the label.
    const score = Math.max(overlap(query, `${page.title} ${path}`) * 1.2, overlap(requirement.label, `${page.title} ${path}`) * 1.2, overlap(requirement.label, headings), overlap(query, headings), overlap(query, lead) * 0.6);
    return { page, score };
  }).filter((item) => item.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.page);
}

/** The text of a page the model reads: headings and the paragraphs and list items under them, capped. */
function excerpt(page, requirement, max = 5000) {
  const want = terms(`${requirement.label} ${requirement.expectedSection || ''}`);
  const lines = [];
  let used = 0;
  let relevantHeading = false;
  for (const block of page.blocks) {
    if (block.tag.startsWith('h')) relevantHeading = want.length ? terms(block.text).some((word) => want.includes(word)) : true;
    const keep = block.tag.startsWith('h') || relevantHeading || page.blocks.length < 60;
    if (!keep) continue;
    const line = `${block.tag.startsWith('h') ? '## ' : '- '}${clip(block.text, 400)}`;
    if (used + line.length > max) break;
    lines.push(line); used += line.length + 1;
  }
  return lines.join('\n');
}

/** Whether a statement is really on a page: its words (as trigrams) appear in the page text in order. */
function supportedBy(statement, pageText) {
  const words = norm(statement).split(' ').filter(Boolean);
  if (!words.length) return false;
  const text = ` ${pageText} `;
  if (text.includes(` ${words.join(' ')} `)) return true;
  if (words.length < 4) return false;
  const grams = [];
  for (let i = 0; i + 2 < words.length; i += 1) grams.push(words.slice(i, i + 3).join(' '));
  return grams.filter((gram) => text.includes(` ${gram} `)).length / grams.length >= 0.8;
}

const pageTextOf = (page) => norm(`${page.title} ${page.description || ''} ${page.blocks.map((block) => block.text).join(' ')}`);

/** "Dr. N. M. Veeraiyan" -> "N. M. Veeraiyan": the title is not part of the name a picture or a page is matched on. */
const bareName = (name) => String(name || '').replace(/^(?:Dr|Prof|Mr|Mrs|Ms|Shri|Smt|Sri|Er|Ar)\.?\s+/i, '').replace(/\s+/g, ' ').trim();

const levelOf = (text) => (LEVEL.find(([pattern]) => pattern.test(text)) || [])[1] || '';

/* ---------------------------------------------------------------- rule-based readers ---------------------------------------------------------------- */

/** Items listed under a heading that names the requirement ("Undergraduate Programmes" -> the list items below it). */
function listItems(page, requirement) {
  const want = terms(requirement.label);
  const items = [];
  let group = '';
  let level = 0;
  // A page whose own title is the requirement ("Postgraduate Programmes") lists it under every heading it has (degrees, then super-speciality...).
  const pageIsAbout = want.length > 0 && overlap(requirement.label, page.title) >= 0.5;
  let active = pageIsAbout;
  for (const block of page.blocks) {
    if (block.tag.startsWith('h')) {
      const rank = Number(block.tag[1]);
      if (active && !pageIsAbout && rank <= level) active = false;
      if (want.length && overlap(requirement.label, block.text) >= 0.5) { active = true; level = rank; group = block.text; }
      else if (active) group = block.text;
      continue;
    }
    if (!active || !['li', 'td'].includes(block.tag)) continue;
    const text = clip(block.text, 160);
    const words = text.split(' ').length;
    if (text.length >= 3 && words <= 16 && !/^(?:home|about|contact|read more|apply|click|learn more|view|download|login)\b/i.test(text)) items.push({ title: text, group, quote: text });
  }
  return items;
}

function peopleIn(page) {
  const found = [];
  for (const block of page.blocks) {
    const role = ROLE.exec(block.text);
    if (!role) continue;
    const name = NAME.exec(block.text.replace(role[0], ' '));
    if (!name) continue;
    const full = clip(`${name[1] || ''}${name[2]}`, 80).replace(/\s+/g, ' ').trim();
    if (full.split(' ').length < 2 || ROLE.test(full)) continue;
    found.push({ name: bareName(full), role: role[1].replace(/\b\w/g, (c) => c.toUpperCase()), text: clip(block.text, 500), quote: clip(block.text, 160) });
  }
  return found;
}

function datedBlocks(page, requirement) {
  const want = terms(requirement.label);
  return page.blocks.filter((block) => !block.tag.startsWith('h') && YEAR.test(block.text) && block.text.length >= 25).map((block) => ({ title: clip(block.text.replace(/^[-–•\s]+/, ''), 110), text: clip(block.text, 420), date: YEAR.exec(block.text)[1], quote: clip(block.text, 160), weight: overlap(requirement.label, `${page.title} ${block.text}`) + (want.length ? 0 : 1) }));
}

function paragraphsFor(page, requirement, { achievementsOnly = false } = {}) {
  const paragraphs = [];
  let relevant = false;
  for (const block of page.blocks) {
    if (block.tag.startsWith('h')) { relevant = overlap(requirement.label, block.text) >= 0.34; continue; }
    if (block.text.length < 60) continue;
    if (achievementsOnly && !AWARD.test(block.text)) continue;
    if (relevant || achievementsOnly || overlap(requirement.label, block.text) >= 0.5) paragraphs.push({ title: clip(block.text, 90), text: clip(block.text, 480), quote: clip(block.text, 160) });
  }
  return paragraphs;
}

function ruleEntries(requirement, selected) {
  const out = [];
  for (const page of selected) {
    const base = { sourceUrl: page.url, sourceTitle: page.title };
    if (requirement.contentKind === 'person') for (const person of peopleIn(page)) out.push({ ...base, kind: 'person', title: person.name, text: person.text, quote: person.quote, attributes: { name: person.name, role: person.role } });
    else if (requirement.contentKind === 'catalogue') for (const item of listItems(page, requirement)) out.push({ ...base, kind: 'item', title: item.title, text: item.title, quote: item.quote, attributes: { group: item.group, level: levelOf(`${item.group} ${item.title}`) } });
    else if (requirement.contentKind === 'timeline') for (const item of datedBlocks(page, requirement).sort((a, b) => b.weight - a.weight).slice(0, 12)) out.push({ ...base, kind: 'milestone', title: item.title, text: item.text, quote: item.quote, attributes: { date: item.date } });
    else if (requirement.contentKind === 'achievements') for (const item of paragraphsFor(page, requirement, { achievementsOnly: true }).slice(0, 12)) out.push({ ...base, kind: 'achievement', title: item.title, text: item.text, quote: item.quote, attributes: { date: (YEAR.exec(item.text) || [])[1] || '' } });
    else for (const item of paragraphsFor(page, requirement).slice(0, 6)) out.push({ ...base, kind: requirement.contentKind === 'facilities' ? 'facility' : 'fact', title: item.title, text: item.text, quote: item.quote, attributes: {} });
  }
  return out;
}

/* ---------------------------------------------------------------- model reader ---------------------------------------------------------------- */

const READER_SYSTEM = `You extract facts for ONE requirement of a website from text copied from an organisation's own web pages. Reply with ONLY JSON, no prose:
{"entries": [{"title": string, "text": string, "quote": string, "attributes": object}]}
RULES: use ONLY the text given; never add anything from memory. "title" is the exact name of the thing (a person's full name, a course, product, department, plan, award, facility or milestone). "text" is one or two sentences using only facts in the text. "quote" is a short phrase copied EXACTLY from the text that proves the entry. "attributes": for a person {"name","role"}; for an item {"group","level","duration","eligibility","price"} with only the values the text states; for a milestone or award {"date"} only when stated. For a catalogue requirement list EVERY item the text names. If the text has nothing for the requirement, return {"entries": []}.`;

async function modelEntries(ask, requirement, selected) {
  const material = selected.map((page) => `PAGE ${page.url}\n${excerpt(page, requirement)}`).join('\n\n').slice(0, 14000);
  const raw = await ask(READER_SYSTEM, `REQUIREMENT: ${requirement.label} - ${requirement.description}\nCONTENT NEEDED: ${requirement.requiredContent.join('; ')}\n\n${material}`);
  const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
  const parsed = json ? JSON.parse(json) : null;
  return (Array.isArray(parsed?.entries) ? parsed.entries : []).filter((item) => item && item.title).map((item) => ({
    kind: { person: 'person', catalogue: 'item', timeline: 'milestone', achievements: 'achievement', facilities: 'facility' }[requirement.contentKind] || 'fact',
    title: clip(item.title, 140), text: clip(item.text || item.title, 600), quote: clip(item.quote || '', 240), attributes: item.attributes && typeof item.attributes === 'object' ? item.attributes : {}
  }));
}

/**
 * @param input { pages, requirements, site, ask?, maxEntriesPerRequirement? }
 * @returns {{ entries, unverified, gaps, people, diagnostics }}
 */
async function extractKnowledge({ pages = [], requirements = [], site = {}, ask = null, maxEntriesPerRequirement = 80, signal = null } = {}) {
  const entries = [];
  const unverified = [];
  const gaps = [];
  const diagnostics = { reader: ask ? 'model+verify' : 'rules', modelFailures: 0 };
  const texts = new Map(pages.map((page) => [page.url, pageTextOf(page)]));
  const seen = new Set();
  for (const requirement of requirements) {
    signal?.throwIfAborted?.();
    const selected = pagesFor(pages, requirement);
    let candidates = [];
    if (selected.length && ask) {
      try { candidates = await modelEntries(ask, requirement, selected); } catch (error) { if (signal?.aborted) throw error; diagnostics.modelFailures += 1; candidates = []; }
    }
    // A model that found nothing (or failed) does not end the search: the rules read the same pages.
    if (!candidates.length && selected.length) candidates = ruleEntries(requirement, selected);
    let kept = 0;
    for (const candidate of candidates) {
      if (kept >= maxEntriesPerRequirement) break;
      const proof = candidate.quote || candidate.text;
      const source = (candidate.sourceUrl && texts.has(candidate.sourceUrl) ? [candidate.sourceUrl] : selected.map((page) => page.url)).find((url) => {
        const text = texts.get(url);
        const titleTerms = terms(candidate.title);
        return supportedBy(proof, text) && (!titleTerms.length || titleTerms.every((word) => text.includes(word) || norm(candidate.title).split(' ').every((token) => text.includes(token))));
      });
      const key = `${requirement.id}|${norm(candidate.title)}`;
      if (seen.has(key)) continue;
      if (!source) { unverified.push({ requirementId: requirement.id, title: candidate.title, reason: 'not found in the cited pages' }); continue; }
      seen.add(key);
      kept += 1;
      const attributes = { ...candidate.attributes };
      if (requirement.contentKind === 'person') { attributes.name = bareName(attributes.name || candidate.title); attributes.role = attributes.role || (ROLE.exec(candidate.text) || [])[1] || ''; }
      if (requirement.contentKind === 'catalogue' && !attributes.level) attributes.level = levelOf(`${attributes.group || ''} ${candidate.title}`);
      entries.push({ id: `k${entries.length + 1}`, requirementId: requirement.id, kind: candidate.kind, title: requirement.contentKind === 'person' ? attributes.name : candidate.title, text: candidate.text, attributes, sourceUrl: source, evidence: clip(proof, 200), verified: true });
    }
    if (!kept) gaps.push({ requirementId: requirement.id, label: requirement.label, reason: selected.length ? 'the pages found did not contain verifiable content for it' : (pages.length ? 'no crawled page is about it' : 'no source could be retrieved') });
  }
  const people = entries.filter((entry) => entry.kind === 'person').map((entry) => ({ name: entry.attributes.name, role: entry.attributes.role, requirementId: entry.requirementId, sourceUrl: entry.sourceUrl, affiliation: site.name || '' }));
  return { entries, unverified, gaps, people, diagnostics };
}

/** Entries of a requirement, for the writers and the validator. */
const entriesFor = (knowledge, requirementId) => (knowledge?.entries || []).filter((entry) => entry.requirementId === requirementId);

module.exports = { bareName, extractKnowledge, entriesFor, pagesFor, excerpt, supportedBy, listItems, peopleIn, levelOf, norm, READER_SYSTEM };
