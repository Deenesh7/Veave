/**
 * Planning worker: decides the pages, their sections, layouts and picture needs BEFORE any code is written.
 * It reads the request and returns a plan; it never touches job state or project files.
 */
const defaultPlanner = require('../composition/compositionPlanner');
const deepPlanner = require('../deep/deepPlanner');
const requirementMapper = require('../knowledge/requirementMapper');
const adaptiveLayout = require('../composition/adaptiveLayout');

/**
 * @param input { prompt, spec, entities, dossier, imageEligible, entityAssets, ask, onProgress, deep }  (deep: a larger sitemap plus the requirements it must cover)
 * @param deps  { planner }  (injected for tests)
 * @returns {{ compositionPlan, summary, deepPlan }}  deepPlan is { requirements, missingInfo, siteName, ... } in deep mode, otherwise null
 */
async function planComposition({ prompt, spec = null, entities = [], dossier = null, imageEligible = false, entityAssets = [], ask = null, onProgress = () => {}, deep = false, requirements = null, knowledge = null, personStatus = [] }, { planner = defaultPlanner } = {}) {
  onProgress({ stepName: 'Planning the pages and their layout...', stage: 'composition_planning' });
  // The tracked requirements (and what the sources gave for them) go to the sitemap planner, so the pages it plans fit the request.
  const context = requirements?.length ? requirementContext(requirements, knowledge) : '';
  const compositionPlan = await planner.buildCompositionPlan({ prompt, spec, entities, dossier, ask, deep, context });
  // Deep mode: every requirement of the request is mapped to the sections that cover it (a requirement with no section gets one) before pictures are searched.
  let deepPlan = null;
  if (requirements?.length) {
    // Requirements were extracted and researched before planning: map every one onto a page and section, then check the mapping.
    onProgress({ stepName: 'Mapping every requirement onto pages and sections...', stage: 'requirement_mapping' });
    const mapping = requirementMapper.mapRequirements({ requirements, plan: compositionPlan, knowledge });
    const gate = requirementMapper.gate({ requirements, plan: compositionPlan, knowledge, personStatus });
    // The layouts follow what the sources really gave: the number of items decides columns, timelines and grids.
    const layouts = adaptiveLayout.adaptPlan({ plan: compositionPlan, requirements, knowledge, assets: entityAssets });
    const gaps = (knowledge?.gaps || []).map((gap) => `${gap.label}: ${gap.reason}`);
    deepPlan = { requirements, missingInfo: [...gaps, ...gate.open.map((item) => item.problem)].slice(0, 20), siteName: knowledge?.site?.name || '', category: compositionPlan.industry || '', source: 'knowledge', added: mapping.created.map((item) => item.requirementId), mapping, gate, layouts };
  } else if (deep) {
    onProgress({ stepName: 'Mapping every requirement of the request onto the sitemap...', stage: 'requirement_planning' });
    deepPlan = await deepPlanner.planRequirements({ prompt, plan: compositionPlan, ask });
  }
  // When no pictures will be discovered, no section may promise one.
  if (!imageEligible) compositionPlan.pages.forEach((page) => page.sections.forEach((section) => { section.images = []; }));
  if (entityAssets.length) planner.assignEntityAssets(compositionPlan, entityAssets);
  return { compositionPlan, deepPlan, summary: `${compositionPlan.source}: ${compositionPlan.pages.map((page) => `${page.name}[${page.sections.map((section) => section.layout).join(',')}]`).join(' ')}` };
}

/** What the sitemap planner is told about the tracked requirements and the verified content retrieved for them. */
function requirementContext(requirements, knowledge) {
  const lines = ['TRACKED REQUIREMENTS (every one needs a place in the sitemap; a catalogue needs its actual items listed, not a heading):'];
  for (const item of requirements) {
    const count = (knowledge?.entries || []).filter((entry) => entry.requirementId === item.id).length;
    lines.push(`- ${item.label} [${item.contentKind}${item.importance === 'core' ? ', core' : ''}]${item.expectedPage ? ` -> page "${item.expectedPage}"` : ''}: ${item.description}${count ? ` (${count} verified items retrieved from the official source)` : ' (no verified source content retrieved)'}`);
  }
  return lines.join('\n');
}

/** The part of the plan stored on the job document (what the frontend and support read). */
function planRecord(plan) {
  return {
    source: plan.source, industry: plan.industry,
    pages: plan.pages.map((page) => ({ id: page.id, name: page.name, route: page.route, balance: page.balanceNotes, sections: page.sections.map((section) => ({ id: section.id, layout: section.layout, spacing: section.spacing, width: section.width, words: section.words, density: section.density?.state, images: section.images.length })) }))
  };
}

/** The text appended to the generation prompt for this plan and the pictures that were found for it. */
function planPromptBlock(plan, { assets = [], entityAssets = [] } = {}, { planner = defaultPlanner } = {}) {
  return planner.buildPromptBlock(plan, { assets, entityAssets });
}

module.exports = { requirementContext, planComposition, planRecord, planPromptBlock };
