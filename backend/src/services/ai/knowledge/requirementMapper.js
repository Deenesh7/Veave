/**
 * RequirementMapper and the pre-code gate: every requirement gets a page, a section and a required output BEFORE any page is written.
 *
 *   mapRequirements   places each requirement on the best existing section of the sitemap, or builds the section (and the page when
 *                     the request implies one) the requirement needs; hands the section the verified knowledge entries for it
 *   gate              checks the mapping: every requirement has a section, every person a profile, every catalogue its actual
 *                     items, every required picture a selection task; returns the table, the tasks it created and what is unresolved
 *
 * A heading that contains a keyword never satisfies a requirement here: a catalogue is mapped together with its item names, and the
 * validator after writing checks that those names are on the page.
 */
const { LAYOUTS } = require('../composition/layoutCatalog');
const { overlap } = require('../deep/deepPlanner');
const { slug } = require('../images/imageRequirements');
const { entriesFor } = require('./knowledgeExtractor');

const LAYOUT_FOR = { person: 'profile', catalogue: 'three-column-cards', timeline: 'timeline', achievements: 'achievement-grid', facilities: 'three-column-cards', narrative: 'editorial-image-right', contact: 'contact-split' };
const WORDS_FOR = { person: 'medium', catalogue: 'long', timeline: 'long', achievements: 'medium', facilities: 'medium', narrative: 'medium', contact: 'short' };
const OUTPUT = {
  person: 'a profile with the person\'s name, role and sourced biography, and their verified portrait when one exists',
  catalogue: 'the actual named items from the sources, grouped by category (not a description of them)',
  timeline: 'dated milestones from the sources, in order',
  achievements: 'specific awards, rankings or accreditations from the sources, each with its year or body where stated',
  facilities: 'the named facilities or services from the sources and what each offers',
  narrative: 'specific explanatory content drawn from the sources',
  contact: 'the contact details the request or the sources give'
};

const sectionText = (page, section) => `${page.name} ${section.heading} ${section.purpose} ${section.summary}`;

function ensurePage(plan, name, purpose = '') {
  const found = plan.pages.find((page) => overlap(name, page.name) >= 0.67 || slug(page.name) === slug(name));
  if (found) return found;
  const id = slug(name);
  const page = { id, name, route: `/${id}`, purpose, sections: [{ id: 'intro', purpose: `Introduce ${name}.`, eyebrow: '', heading: name, summary: `A short opening for ${name}: what the page covers and how to use it.`, facts: [], factIds: [], words: 'short', layout: 'page-intro', spacing: LAYOUTS['page-intro'].spacing, width: LAYOUTS['page-intro'].width, images: [], imageShortfall: 0, order: 1, requirementIds: [] }] };
  // A contact page, when there is one, stays the last page.
  const contact = plan.pages.findIndex((item) => /contact/i.test(item.name));
  if (contact > 0 && contact === plan.pages.length - 1) plan.pages.splice(contact, 0, page); else plan.pages.push(page);
  return page;
}

function buildSection(plan, page, requirement, entries) {
  const layout = LAYOUT_FOR[requirement.contentKind] || 'two-column';
  const used = new Set(page.sections.map((section) => section.id));
  let id = slug(requirement.label) || 'topic';
  while (used.has(id)) id = `${id}-2`;
  const person = requirement.contentKind === 'person' ? entries.find((entry) => entry.kind === 'person') : null;
  const portraitNeeded = (requirement.requiredAssets || []).some((asset) => asset.type === 'person_portrait');
  const section = {
    id, purpose: requirement.description, eyebrow: '', heading: person ? person.attributes.name : requirement.label.replace(/^./, (c) => c.toUpperCase()),
    summary: `${requirement.description} Required output: ${OUTPUT[requirement.contentKind] || OUTPUT.narrative}.`, facts: [], factIds: [],
    words: WORDS_FOR[requirement.contentKind] || 'medium', layout, spacing: LAYOUTS[layout].spacing, width: LAYOUTS[layout].width,
    images: person && portraitNeeded ? [{ role: 'portrait', query: person.attributes.name, alt: '', entity: person.attributes.name, fallbackQuery: '', subject: `${person.attributes.name}, ${person.attributes.role || ''}`.trim(), style: '', avoid: [], alternates: [] }] : [],
    imageShortfall: 0, order: page.sections.length + 1, requirementIds: [requirement.id]
  };
  const last = page.sections[page.sections.length - 1];
  if (last && /cta-band/.test(last.layout)) page.sections.splice(page.sections.length - 1, 0, section); else page.sections.push(section);
  page.sections.forEach((item, index) => { item.order = index + 1; });
  return section;
}

/** The existing section that already is this requirement (by meaning of its heading, purpose and the page it is on). */
function bestSection(plan, requirement) {
  const query = `${requirement.label} ${requirement.expectedSection || ''}`;
  let best = null;
  for (const page of plan.pages) {
    for (const section of page.sections) {
      if (/cta-band|page-intro|hero/.test(section.layout) && requirement.contentKind !== 'narrative') continue;
      // A section that already answers another tracked requirement is not shared: two requirements are two sections (undergraduate and postgraduate courses stay apart).
      if ((section.requirementIds || []).length && !section.requirementIds.includes(requirement.id)) continue;
      const score = overlap(query, sectionText(page, section)) + (requirement.expectedPage && overlap(requirement.expectedPage, page.name) >= 0.5 ? 0.25 : 0);
      if (!best || score > best.score) best = { page, section, score };
    }
  }
  return best && best.score >= 0.67 ? best : null;
}

/**
 * @returns {{ table, tasks, created }}  (mutates plan and requirements)
 */
function mapRequirements({ requirements, plan, knowledge }) {
  const table = [];
  const tasks = [];
  const created = [];
  for (const requirement of requirements) {
    const entries = entriesFor(knowledge, requirement.id);
    let target = bestSection(plan, requirement);
    // A requirement whose content is a catalogue of its own deserves a page when the request implies one and the sitemap has none.
    if (!target && requirement.expectedPage && requirement.contentKind === 'catalogue' && entries.length >= 6) {
      const page = ensurePage(plan, requirement.expectedPage, requirement.description);
      target = { page, section: page.sections.find((section) => overlap(requirement.label, sectionText(page, section)) >= 0.67) || null };
      if (!target.section) { target.section = buildSection(plan, page, requirement, entries); created.push({ requirementId: requirement.id, page: page.id, section: target.section.id }); tasks.push({ type: 'create-section', requirementId: requirement.id, detail: `${page.name} / ${target.section.heading}` }); }
    }
    if (!target) {
      const page = (requirement.expectedPage && ensurePageIfSensible(plan, requirement)) || defaultPage(plan, requirement);
      const section = buildSection(plan, page, requirement, entries);
      target = { page, section };
      created.push({ requirementId: requirement.id, page: page.id, section: section.id });
      tasks.push({ type: 'create-section', requirementId: requirement.id, detail: `${page.name} / ${section.heading}` });
    }
    const { page, section } = target;
    if (!section.requirementIds) section.requirementIds = [];
    if (!section.requirementIds.includes(requirement.id)) section.requirementIds.push(requirement.id);
    section.knowledgeIds = [...new Set([...(section.knowledgeIds || []), ...entries.map((entry) => entry.id)])];
    if (requirement.contentKind === 'catalogue') { section.words = 'long'; section.catalogue = true; }
    // A person's profile gets the portrait slot (the picture itself is verified separately).
    if (requirement.contentKind === 'person') {
      const person = entries.find((entry) => entry.kind === 'person');
      if (person && !section.images.some((need) => need.entity === person.attributes.name) && (requirement.requiredAssets || []).some((asset) => asset.type === 'person_portrait')) {
        section.images.push({ role: 'portrait', query: person.attributes.name, alt: '', entity: person.attributes.name, fallbackQuery: '', subject: `${person.attributes.name}, ${person.attributes.role || ''}`.trim(), style: '', avoid: [], alternates: [] });
      }
      if (!['profile', 'editorial-image-left', 'editorial-image-right'].includes(section.layout)) section.layout = 'profile';
    }
    requirement.sectionIds = [`${page.id}/${section.id}`];
    requirement.expectedPage = page.name;
    requirement.expectedSection = section.heading;
    table.push({ requirement: requirement.label, requirementId: requirement.id, page: page.name, section: section.heading, requiredOutput: OUTPUT[requirement.contentKind] || OUTPUT.narrative, knownItems: entries.length });
  }
  return { table, tasks, created };
}

// A page named by the request ("Leadership", "Academics") is only created when the sitemap has nothing close to it.
function ensurePageIfSensible(plan, requirement) {
  const existing = plan.pages.find((page) => overlap(requirement.expectedPage, page.name) >= 0.5);
  if (existing) return existing;
  return requirement.contentKind === 'catalogue' || requirement.contentKind === 'person' || requirement.contentKind === 'achievements' ? ensurePage(plan, requirement.expectedPage, requirement.description) : null;
}

function defaultPage(plan, requirement) {
  const ranked = plan.pages.map((page) => ({ page, score: Math.max(overlap(requirement.label, `${page.name} ${page.purpose}`), ...page.sections.map((section) => overlap(requirement.label, sectionText(page, section)) * 0.8)) })).sort((a, b) => b.score - a.score);
  if (ranked[0] && ranked[0].score > 0) return ranked[0].page;
  return plan.pages.find((page) => !/^home$|landing|contact/i.test(page.name)) || plan.pages[0];
}

/**
 * The pre-code gate. Returns what is wrong or still open; `ok` is false only for problems that would make the site silently skip a
 * requirement (those were already repaired by mapRequirements, so a false here means the repair itself failed).
 */
function gate({ requirements, plan, knowledge, personStatus = [] }) {
  const issues = [];
  const tasks = [];
  const open = [];
  const sectionOf = (requirement) => { const [pageId, sectionId] = (requirement.sectionIds[0] || '').split('/'); return plan.pages.find((page) => page.id === pageId)?.sections.find((section) => section.id === sectionId) || null; };
  for (const requirement of requirements) {
    const section = sectionOf(requirement);
    const entries = entriesFor(knowledge, requirement.id);
    if (!section) { issues.push({ requirementId: requirement.id, problem: 'no page or section' }); continue; }
    if (requirement.contentKind === 'person') {
      const person = entries.find((entry) => entry.kind === 'person');
      if (!person) { open.push({ requirementId: requirement.id, problem: 'the person\'s name could not be verified from a source; the profile will describe the role without naming anyone' }); tasks.push({ type: 'retrieve-content', requirementId: requirement.id, detail: 'person not identified' }); }
      for (const asset of (requirement.requiredAssets || []).filter((item) => item.type === 'person_portrait')) {
        const status = personStatus.find((item) => person && item.name === person.attributes.name);
        tasks.push({ type: 'select-image', requirementId: requirement.id, detail: `${asset.type} of ${person?.attributes.name || requirement.label}`, state: status?.state || 'missing' });
        if (!status || status.state !== 'verified') open.push({ requirementId: requirement.id, problem: `no verified portrait (${status?.reason || 'person not identified'}); a neutral design is used and the missing picture is tracked` });
      }
    }
    if (requirement.contentKind === 'catalogue' && !entries.length) { open.push({ requirementId: requirement.id, problem: 'no verified item list was retrieved; the section will say what is available without inventing items' }); tasks.push({ type: 'retrieve-content', requirementId: requirement.id, detail: 'catalogue empty' }); }
    if (['timeline', 'achievements'].includes(requirement.contentKind) && !entries.length) open.push({ requirementId: requirement.id, problem: 'no sourced facts were retrieved; the section will stay general and make no specific claims' });
  }
  return { ok: !issues.length, issues, tasks, open };
}

/** What a writer is told for a section: the verified items it must contain, grouped, and what it must not invent. */
function knowledgeBlockFor({ section, requirements, knowledge }) {
  const mine = requirements.filter((item) => (section.requirementIds || []).includes(item.id));
  if (!mine.length) return '';
  const lines = [];
  for (const requirement of mine) {
    const entries = entriesFor(knowledge, requirement.id);
    lines.push(`REQUIREMENT ${requirement.id}: ${requirement.label} - ${requirement.description}\n  required output: ${OUTPUT[requirement.contentKind] || OUTPUT.narrative}`);
    if (!entries.length) { lines.push('  verified source content: NONE retrieved. Write only general, certainly-true statements about this topic; make no specific claims (no names, figures, dates, course titles or awards) and do not present anything as an official list.'); continue; }
    if (requirement.contentKind === 'catalogue') {
      const groups = new Map();
      for (const entry of entries) { const key = entry.attributes.group || entry.attributes.level || 'Other'; groups.set(key, [...(groups.get(key) || []), entry]); }
      lines.push(`  VERIFIED ITEMS (source: ${knowledge.site?.officialUrl || 'official site'}). Include EVERY item below by its exact name, organised by the group shown; add nothing that is not listed; show duration/eligibility/price only where given:`);
      for (const [group, list] of groups) lines.push(`    ${group}: ${list.map((entry) => `${entry.title}${entry.attributes.duration ? ` (${entry.attributes.duration})` : ''}${entry.attributes.eligibility ? ` [eligibility: ${entry.attributes.eligibility}]` : ''}`).join('; ')}`);
    } else {
      lines.push(`  VERIFIED FACTS (write from these in your own words; do not add specifics beyond them):\n${entries.slice(0, 14).map((entry) => `    - ${entry.attributes.date ? `${entry.attributes.date}: ` : ''}${entry.title === entry.text ? entry.text : `${entry.title}: ${entry.text}`}${entry.attributes.role ? ` [role: ${entry.attributes.role}]` : ''}`).join('\n')}`);
    }
  }
  return lines.join('\n');
}

/** The verified content of the whole site for the one-shot generation prompt (the deep writers get it section by section). */
function knowledgePromptBlock({ plan, requirements, knowledge }) {
  const parts = [];
  for (const page of plan.pages) for (const section of page.sections) {
    const block = knowledgeBlockFor({ section, requirements, knowledge });
    if (block) parts.push(`[${page.name} / ${section.heading}]\n${block}`);
  }
  if (!parts.length) return '';
  return `VERIFIED CONTENT RETRIEVED FROM THE ORGANISATION'S OWN SOURCES (ground truth: place each block in the section named; never replace a listed item with a generic description, never invent items, names, dates or awards that are not listed, and where a block says nothing was retrieved stay general):\n${parts.join('\n\n')}`;
}

module.exports = { knowledgePromptBlock, mapRequirements, gate, knowledgeBlockFor, ensurePage, OUTPUT, LAYOUT_FOR };
