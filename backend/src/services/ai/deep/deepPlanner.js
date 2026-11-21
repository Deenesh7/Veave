/**
 * Requirement planning for deep generation. It runs right after the composition plan (the sitemap) and before anything is written:
 *   1. extract every topic, entity, feature and requirement the user asked for (the model; a deterministic reading of the request
 *      when no model is reachable),
 *   2. map each requirement onto the sections that will cover it,
 *   3. give every requirement that has no section a real section on the best-fitting page, so the sitemap covers the request
 *      before a line of code exists,
 *   4. list what the request does not say and a writer must not invent (facts that need verification).
 * The sitemap itself comes from the composition planner (deep mode); this module never replaces it.
 */
const { LAYOUTS } = require('../composition/layoutCatalog');
const { slug } = require('../images/imageRequirements');

const STOP = new Set(['the', 'and', 'for', 'with', 'about', 'that', 'this', 'its', 'our', 'all', 'any', 'from', 'into', 'their', 'your', 'website', 'site', 'page', 'pages', 'create', 'make', 'build', 'covering', 'including', 'include', 'full', 'complete', 'detailed', 'information', 'details', 'section', 'sections']);

/** "courses" and "course", "categories" and "category", "achievements" and "achievement" share a stem. */
function stem(word) {
  if (word.length > 4 && /ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:sses|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && /s$/.test(word) && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  if (word.length > 6 && /ing$/.test(word)) return word.slice(0, -3);
  return word;
}

/** Content words of a text, lightly stemmed so "courses"/"course" and "achievements"/"achievement" meet. */
function terms(text) {
  return [...new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .map(stem)
    .filter((word) => word.length >= 3 && !STOP.has(word)))];
}

/** Share of the requirement's terms that the text contains (0..1). */
function overlap(label, text) {
  const wanted = terms(label);
  if (!wanted.length) return 0;
  const have = new Set(terms(text));
  return wanted.filter((word) => have.has(word)).length / wanted.length;
}

const sectionText = (page, section) => `${page.name} ${section.heading} ${section.purpose} ${section.summary} ${(section.facts || []).join(' ')}`;

/** Topics of the request read without a model: the comma / "and" separated list after "covering", "including", "with"... */
function heuristicRequirements(prompt) {
  const text = String(prompt || '').replace(/\s+/g, ' ');
  const lead = /\b(?:covering|including|includes|include|featuring|features|containing|with|about|showing|listing|for)\b[:\s]+(.{12,600})$/i.exec(text);
  const list = (lead ? lead[1] : text).split(/[,;]|\band\b|&/i).map((part) => part.replace(/^(?:its|their|the|a|an|all|of)\s+/i, '').replace(/[.!?]+$/, '').trim()).filter((part) => part.length >= 3 && part.length <= 60 && terms(part).length);
  const unique = [...new Map(list.map((part) => [part.toLowerCase(), part])).values()].slice(0, 16);
  return unique.map((label) => ({ label, importance: 'core' }));
}

/** The best sections for a requirement by meaning overlap with what each section is about. */
function matchSections(label, plan, { threshold = 0.5 } = {}) {
  return plan.pages.flatMap((page) => page.sections.map((section) => ({ id: `${page.id}/${section.id}`, score: overlap(label, sectionText(page, section)) })))
    .filter((item) => item.score >= threshold).sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.id);
}

function normalizeRequirements(raw, plan, prompt) {
  const valid = new Set(plan.pages.flatMap((page) => page.sections.map((section) => `${page.id}/${section.id}`)));
  const source = Array.isArray(raw) && raw.length ? raw : heuristicRequirements(prompt);
  const seen = new Set();
  const requirements = [];
  for (const item of source.slice(0, 40)) {
    const label = String(item?.label || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    let sectionIds = (Array.isArray(item.sectionIds) ? item.sectionIds : []).map(String).filter((id) => valid.has(id));
    if (!sectionIds.length) sectionIds = matchSections(label, plan);
    requirements.push({ id: `r${requirements.length + 1}`, label, importance: item?.importance === 'supporting' ? 'supporting' : 'core', sectionIds, status: 'pending', evidence: '', note: '' });
  }
  return requirements;
}

const REQUIREMENTS_SYSTEM = `You read a website request and its planned sitemap. Reply with ONLY JSON, no prose:
{"siteName": string, "category": string, "requirements": [{"label": string, "importance": "core"|"supporting", "sectionIds": ["pageId/sectionId"]}], "missingInfo": [string]}
RULES: "requirements" lists EVERY distinct topic, person, entity, feature, department, product, course, achievement or requirement the request names or clearly implies, each as a short noun phrase of 2-6 words (split "courses, research and clinical facilities" into three). "core" = the request explicitly names it; "supporting" = it is implied and helpful. "sectionIds" lists the planned sections (as "pageId/sectionId", copied exactly from the sitemap) that will cover it; use [] when no planned section covers it. "siteName" is the name of the organisation, person or product (from the request; never invented). "missingInfo" lists specific facts a writer would need but the request does not give (names, dates, figures, prices, awards), which must be written without inventing them. Never add requirements the request does not support.`;

/** A readable outline of the sitemap for the requirement model. */
function outline(plan) {
  return plan.pages.map((page) => `${page.id} "${page.name}" ${page.route}${page.purpose ? ` - ${page.purpose}` : ''}\n${page.sections.map((section) => `  ${page.id}/${section.id}: ${section.heading || section.purpose} [${section.layout}]`).join('\n')}`).join('\n');
}

const nextLayout = (page) => (page.sections.filter((section) => /editorial/.test(section.layout)).length % 2 ? 'two-column' : 'editorial-image-right');

/** A real section for a requirement the sitemap does not cover yet, on the page that fits it best, before the closing call to action. */
function addRequirementSection(plan, requirement) {
  const scored = plan.pages.map((page) => ({ page, score: Math.max(overlap(requirement.label, `${page.name} ${page.purpose}`), ...page.sections.map((section) => overlap(requirement.label, sectionText(page, section)) * 0.8)) }));
  scored.sort((a, b) => b.score - a.score);
  const generic = plan.pages.find((page) => !/^home$|landing/i.test(page.name) && !/contact/i.test(page.name));
  const target = (scored[0].score > 0 ? scored[0].page : generic) || plan.pages[0];
  const layout = nextLayout(target);
  const used = new Set(target.sections.map((section) => section.id));
  let id = slug(requirement.label) || 'topic';
  while (used.has(id)) id = `${id}-2`;
  const section = {
    id, purpose: `Cover "${requirement.label}" in depth, as the request asks.`, eyebrow: '', heading: requirement.label.replace(/^./, (c) => c.toUpperCase()),
    summary: `Everything a visitor needs to know about ${requirement.label}: what it is, why it matters and how it relates to the rest of the site. Use only facts from the request; where a specific is not given, describe it in general terms without inventing names, dates or figures.`,
    facts: [], factIds: [], words: 'medium', layout, spacing: LAYOUTS[layout].spacing, width: LAYOUTS[layout].width, images: [], imageShortfall: 0, order: target.sections.length + 1,
    requirementIds: [requirement.id]
  };
  const last = target.sections[target.sections.length - 1];
  if (last && /cta-band/.test(last.layout)) target.sections.splice(target.sections.length - 1, 0, section); else target.sections.push(section);
  target.sections.forEach((item, index) => { item.order = index + 1; });
  return `${target.id}/${section.id}`;
}

/** Records on every section the requirements it covers (what the writer is told to cover and what the validator checks). */
function attachRequirements(plan, requirements) {
  for (const page of plan.pages) for (const section of page.sections) section.requirementIds = [];
  for (const requirement of requirements) {
    for (const key of requirement.sectionIds) {
      const [pageId, sectionId] = key.split('/');
      const section = plan.pages.find((page) => page.id === pageId)?.sections.find((item) => item.id === sectionId);
      if (section && !section.requirementIds.includes(requirement.id)) section.requirementIds.push(requirement.id);
    }
  }
}

/**
 * @param input { prompt, plan, ask }  plan is the composition plan (mutated: sections are added for uncovered requirements)
 * @returns {{ requirements, missingInfo, siteName, category, source, added }}
 */
async function planRequirements({ prompt, plan, ask = null }) {
  let raw = null;
  let source = 'heuristic';
  if (ask) {
    try {
      const text = await ask(REQUIREMENTS_SYSTEM, `WEBSITE REQUEST:\n${String(prompt || '').slice(0, 5000)}\n\nPLANNED SITEMAP:\n${outline(plan)}`);
      const json = (/\{[\s\S]*\}/.exec(String(text || '')) || [])[0];
      raw = json ? JSON.parse(json) : null;
      if (raw && Array.isArray(raw.requirements) && raw.requirements.length) source = 'model'; else raw = null;
    } catch { raw = null; }
  }
  const requirements = normalizeRequirements(raw?.requirements, plan, prompt);
  const added = [];
  for (const requirement of requirements) {
    if (requirement.sectionIds.length) continue;
    requirement.sectionIds = [addRequirementSection(plan, requirement)];
    added.push(requirement.id);
  }
  attachRequirements(plan, requirements);
  const missingInfo = (Array.isArray(raw?.missingInfo) ? raw.missingInfo : []).map((item) => String(item).replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 20);
  return { requirements, missingInfo, siteName: String(raw?.siteName || '').trim().slice(0, 80), category: String(raw?.category || plan.industry || '').trim().slice(0, 60), source, added };
}

module.exports = { planRequirements, heuristicRequirements, normalizeRequirements, matchSections, addRequirementSection, attachRequirements, terms, overlap, outline, REQUIREMENTS_SYSTEM };
