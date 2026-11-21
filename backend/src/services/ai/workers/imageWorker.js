/**
 * Image worker: plans the pictures a new site needs, searches, evaluates, selects and stores verified local files, and describes
 * the result for the prompt and the job record. It never writes the job or the project: the orchestrator persists what it returns
 * (through the injected `persist`) and decides what a failure means.
 */
const defaultDiscovery = require('../images/imageDiscoveryService');
const defaultPlanner = require('../composition/compositionPlanner');

const STAGE_TEXT = {
  image_requirements: 'Planning the images your website needs...',
  image_discovery: 'Searching for real photographs...',
  image_selection: 'Choosing the photographs that fit each section...',
  image_verification: 'Checking the photographs...',
  image_download: 'Saving the verified photographs...',
  asset_mapping: 'Matching photographs to your pages...'
};

/** The job-record view of a discovery result (no image bytes). */
function pipelineRecord(found, compositionPlan = null) {
  return {
    stage: 'website_generation', industry: found.plan.industry || compositionPlan?.industry || null, subject: found.plan.subject || null, source: found.plan.source,
    requested: found.plan.requirements.length, verified: found.assets.length, diagnostics: found.diagnostics,
    assets: found.assets.map(({ id, page, section, publicPath, width, height, provider, sourcePage, creator, license, query, evaluation }) => ({ id, page, section, publicPath, width, height, provider, sourcePage, creator, license, query, evaluation })),
    floor: found.floor,
    missing: found.missing.map(({ slot, page, section, code, tried }) => ({ slot, page, section, code, tried }))
  };
}

/**
 * @param input { jobId, prompt, spec, compositionPlan, entityAssets, entityReportAssets, taken, ask, vision, imageCfg, onProgress, persist, signal, log }
 * @param deps  { discovery, planner }
 * @returns {{ found, promptBlock }}
 */
async function discoverSiteImages(input, { discovery = defaultDiscovery, planner = defaultPlanner } = {}) {
  const { jobId, prompt, spec = null, compositionPlan = null, entityAssets = [], entityReportAssets = [], taken, ask = null, vision = null, imageCfg, onProgress = () => {}, persist = async () => {}, signal, log } = input;
  const planned = compositionPlan
    ? planner.topUpRequirements(planner.requirementsFromComposition(compositionPlan, { entityAssets: entityAssets.length ? entityAssets : entityReportAssets, cfg: imageCfg }), { prompt, spec, plan: compositionPlan, cfg: imageCfg })
    : null;
  const found = await discovery.discoverImages({
    prompt, spec, scope: jobId, requirements: planned && planned.length >= 3 ? planned : null, taken, signal, ask, vision,
    siteContext: { name: spec?.name || spec?.title || '', industry: compositionPlan?.industry, audience: compositionPlan?.audience, visualDirection: compositionPlan?.visualDirection || compositionPlan?.design?.imagery || '', palette: compositionPlan?.design?.palette || '' },
    onStage: (stage, info) => {
      log?.info(`images: ${stage} ${JSON.stringify(info || {})}`);
      onProgress({ ...(STAGE_TEXT[stage] ? { stepName: STAGE_TEXT[stage] } : {}), stage });
    }
  });
  await persist({ 'analysis.imagePipeline': pipelineRecord(found, compositionPlan) });
  log?.info(`${found.assets.length}/${found.plan.requirements.length} verified${found.missing.length ? `, missing ${JSON.stringify(found.diagnostics)}` : ''}.`);
  return { found, promptBlock: discovery.buildPromptBlock(found) };
}

module.exports = { discoverSiteImages, pipelineRecord, STAGE_TEXT };
