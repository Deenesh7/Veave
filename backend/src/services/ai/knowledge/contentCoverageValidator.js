/**
 * ContentCoverageValidator: after the pages are written, compares the website with the requirements and the verified knowledge.
 *
 * A requirement is judged by what is ON the page, not by its heading:
 *   - when verified items exist for it (course names, a person, dated milestones, awards, facilities) the items must be present in the
 *     mapped section's text: all of a catalogue, the person's name with a real profile, at least half of the facts;
 *   - when the sources gave nothing, the semantic coverage check (a model reading the written sections, with the hard text-length
 *     guard) decides, and the result is marked as not grounded in sources;
 *   - a required picture is present when its verified file is used in the mapped section; a picture that does not exist is tracked
 *     as missing and does not change the content verdict.
 * Output per requirement: { id, name, status: covered | incomplete | missing, contentPresent, imagePresent?, expectedItems, matchedItems,
 * missingItems[], pages[], grounded, reason }. Requirement objects also get status (covered | partial | missing) and missingItems.
 */
const { visibleText, wordCount } = require('../deep/depthChecks');
const { terms } = require('../deep/deepPlanner');
const { entriesFor, norm } = require('./knowledgeExtractor');
const semantic = require('../deep/requirementCoverage');

const THRESHOLD = { catalogue: 0.85, person: 1, timeline: 0.5, achievements: 0.5, facilities: 0.5, narrative: 0.4, contact: 0.4 };

/** Whether an item (a name, a milestone) is in a text: the whole name, or most of its significant words, in the text. */
function present(title, textNorm, date = '') {
  const t = norm(title);
  if (!t) return false;
  if (textNorm.includes(t)) return true;
  const words = terms(title);
  if (words.length < 3) return false;
  const have = words.filter((word) => textNorm.includes(word)).length;
  return have / words.length >= 0.75 && (!date || textNorm.includes(String(date)));
}

function sectionsOf(requirement, state) {
  const keys = new Set(requirement.sectionIds || []);
  const out = [];
  for (const page of state.pages) for (const section of page.sections) {
    if (keys.has(`${page.id}/${section.id}`) || (section.requirementIds || []).includes(requirement.id)) out.push({ page, section, source: state.files[section.file] || '' });
  }
  return out;
}

/**
 * @param input { requirements, state, knowledge, assets, ask, minimumWords }
 * @returns {{ results, source }}
 */
async function validateCoverage({ requirements, state, knowledge, assets = [], ask = null, minimumWords = 50 }) {
  const siteText = norm([...Object.values(state.files)].map((source) => visibleText(source)).join(' '));
  const results = [];
  const ungrounded = [];
  for (const requirement of requirements) {
    const entries = entriesFor(knowledge, requirement.id);
    const mapped = sectionsOf(requirement, state);
    const text = norm(mapped.map((item) => visibleText(item.source)).join(' '));
    const words = mapped.reduce((sum, item) => sum + wordCount(visibleText(item.source)), 0);
    const result = { id: requirement.id, name: requirement.label, status: 'missing', contentPresent: false, expectedItems: entries.length, matchedItems: 0, missingItems: [], pages: [...new Set(mapped.map((item) => item.page.name))], grounded: entries.length > 0, reason: '' };
    if (!mapped.some((item) => item.source)) { result.reason = 'no section of the site was written for it'; results.push(result); continue; }
    if (entries.length) {
      const match = entries.map((entry) => ({ entry, here: present(entry.attributes?.name || entry.title, text, entry.attributes?.date), elsewhere: present(entry.attributes?.name || entry.title, siteText, entry.attributes?.date) }));
      result.matchedItems = match.filter((item) => item.here).length;
      result.missingItems = match.filter((item) => !item.here).map((item) => item.entry.title).slice(0, 60);
      const ratio = result.matchedItems / entries.length;
      const need = requirement.contentKind === 'person' ? 1 : (THRESHOLD[requirement.contentKind] ?? 0.5);
      const enough = requirement.contentKind === 'catalogue' ? words >= Math.min(60, entries.length * 3) : words >= minimumWords;
      result.contentPresent = result.matchedItems > 0;
      if (ratio >= need && (requirement.contentKind === 'person' ? words >= minimumWords : enough)) { result.status = 'covered'; result.reason = `${result.matchedItems} of ${entries.length} sourced item(s) are on the page`; }
      else if (result.matchedItems > 0 || match.some((item) => item.elsewhere)) { result.status = 'incomplete'; result.reason = result.matchedItems ? `only ${result.matchedItems} of ${entries.length} sourced item(s) are on the page` : 'the sourced items appear on other pages but not where this requirement is mapped'; }
      else { result.status = 'missing'; result.reason = 'none of the sourced items are on the site'; }
    } else ungrounded.push({ requirement, result, words });
    results.push(result);
  }
  // Requirements with no sourced items: the semantic reading decides (and the text-length guard inside it keeps a heading from counting).
  let source = 'sources';
  if (ungrounded.length) {
    const check = await semantic.checkCoverage({ state: { requirements: ungrounded.map((item) => item.requirement), pages: state.pages, files: state.files }, ask, minimumWords });
    source = check.source === 'model' ? 'sources+model' : 'sources+lexical';
    for (const { requirement, result } of ungrounded) {
      const verdict = check.results.find((item) => item.id === requirement.id);
      result.status = verdict?.status === 'covered' ? 'covered' : verdict?.status === 'partial' ? 'incomplete' : 'missing';
      result.contentPresent = result.status !== 'missing';
      result.reason = `${verdict?.reason || ''}${result.status === 'covered' ? ' (no sourced items exist for it: judged by meaning only)' : ''}`.trim();
      if (verdict?.where?.length) result.pages = [...new Set(verdict.where.map((key) => state.pages.find((page) => page.id === key.split('/')[0])?.name).filter(Boolean))];
    }
  }
  // Pictures: present when the verified file is used in the mapped section.
  for (const requirement of requirements) {
    const result = results.find((item) => item.id === requirement.id);
    const wantsPicture = (requirement.requiredAssets || []).some((asset) => asset.type === 'person_portrait');
    if (!wantsPicture) continue;
    const people = entriesFor(knowledge, requirement.id).filter((entry) => entry.kind === 'person').map((entry) => entry.attributes.name);
    const asset = assets.find((item) => item.entityType === 'person' && people.some((name) => norm(name) === norm(item.entity)));
    const mapped = sectionsOf(requirement, state);
    result.imagePresent = Boolean(asset && mapped.some((item) => item.source.includes(asset.publicPath)));
    result.imageState = asset ? (result.imagePresent ? 'placed' : 'verified picture exists but is not on the page') : 'no verified picture (neutral design used)';
  }
  for (const result of results) {
    const requirement = requirements.find((item) => item.id === result.id);
    requirement.status = result.status === 'covered' ? 'covered' : result.status === 'incomplete' ? 'partial' : 'missing';
    requirement.evidence = result.pages.join(', ');
    requirement.note = result.reason;
    requirement.missingItems = result.missingItems;
  }
  return { results, source };
}

module.exports = { validateCoverage, present, sectionsOf };
