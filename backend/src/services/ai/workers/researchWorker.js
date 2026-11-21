/**
 * Research worker: finds out what is true about the people, institutions and places named in the request, and finds verified pictures
 * of them, so the site is written from facts and real photographs instead of placeholders.
 *
 *   1. extract the named subjects
 *   2. research verified facts about them (web research)
 *   3. find identity-checked pictures of them and store them in the project
 *
 * It returns the results and the prompt blocks; it never edits the job or the generation prompt. Each stage can fail on its own
 * without losing what an earlier stage found, and a cancellation always propagates.
 */
const defaultEntityImages = require('../entityImages');
const defaultWebResearch = require('../research/webResearch');

const enabled = (value) => String(value ?? 'true').toLowerCase() !== 'false';

/**
 * @param input { prompt, compositionEligible, wantsNoImages, ask(maxTokens) -> fn|null, signal, onProgress, persist, log, env }
 * @param deps  { entityImages, webResearch }
 * @returns {{ entities, researchDossier, researchBlock, entityImageReport, entityLocal, entityBlock, failures }}
 */
async function discoverNamedSubjects(input, { entityImages = defaultEntityImages, webResearch = defaultWebResearch } = {}) {
  const { prompt, compositionEligible = false, wantsNoImages = false, ask = () => null, signal, onProgress = async () => {}, persist = async () => {}, log, env = process.env } = input;
  const out = { entities: [], researchDossier: null, researchBlock: '', entityImageReport: null, entityLocal: null, entityBlock: '', failures: [] };
  const stop = (ms) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(ms)]);
  const fail = (stage, error) => {
    if (signal?.aborted) throw error; // a cancellation is never swallowed
    out.failures.push({ stage, message: String(error.message).slice(0, 200) });
    log?.warn(`${stage} skipped: ${error.message}`);
  };

  try {
    await onProgress({ stepName: 'Finding the people and organisations in your request...' });
    out.entities = await entityImages.extractEntities(prompt, { ask: ask(700) });

    // 1. Research: verified facts about the named people and institutions.
    if (compositionEligible && out.entities.length && enabled(env.RESEARCH)) {
      try {
        await onProgress({ stepName: 'Researching the people and institutions in your request...', stage: 'research' });
        const dossier = await webResearch.researchSubjects({ prompt, entities: out.entities, ask: ask(3200), signal: stop(Number.parseInt(env.RESEARCH_TIMEOUT_MS, 10) || 120000) });
        out.researchDossier = dossier;
        out.researchBlock = webResearch.buildResearchBlock(dossier) || '';
        if (dossier) await persist({ 'analysis.research': {
          subjects: dossier.subjects.map((subject) => ({ name: subject.name, role: subject.role, affiliation: subject.affiliation, facts: subject.facts.length, corroborated: subject.facts.filter((fact) => fact.corroborated).length })),
          sources: dossier.sources, diagnostics: { searched: dossier.diagnostics.searched, pages: dossier.diagnostics.pages, rejectedPages: dossier.diagnostics.rejectedPages.slice(0, 12), droppedFacts: dossier.diagnostics.droppedFacts.length }
        } });
        log?.info(`research: ${dossier ? dossier.subjects.map((subject) => `${subject.name} ${subject.facts.length} fact(s)`).join(', ') : 'nothing to research'} from ${dossier?.sources.length || 0} source(s).`);
      } catch (error) { fail('research', error); }
    }

    // 2. Pictures of the named subjects: contextual searches (name + institution), identity-checked, saved into the project.
    if (enabled(env.ENTITY_IMAGES) && !wantsNoImages) {
      await onProgress({ stepName: 'Searching the web for the images of the names in your request...' });
      const found = await entityImages.discoverEntityImages({ prompt, entities: out.entities, researchImages: out.researchDossier?.imageCandidates || [], signal: stop(Number.parseInt(env.ENTITY_IMAGES_TIMEOUT_MS, 10) || 90000), onNote: (note) => log?.info(`entity images: ${note}`) });
      out.entityImageReport = found;
      if (compositionEligible && found.assets.length) out.entityLocal = await entityImages.materializeAssets(found);
      out.entityBlock = out.entityLocal ? '' : (entityImages.buildPromptBlock(found) || '');
      await persist({ 'analysis.entityImages': {
        entities: found.entities, missing: found.missing.map((item) => item.name), rejectedIdentity: (found.rejectedIdentity || []).slice(0, 20),
        assets: (out.entityLocal?.assets || found.assets).map(({ entity, kind, pictureKind, url, publicPath, pageUrl, source, title, width, height, identity }) => ({ entity, kind: pictureKind || kind, url: publicPath || url, pageUrl, source, title, width, height, identity }))
      } });
    }
  } catch (error) { fail('entity research / image search', error); }
  return out;
}

module.exports = { discoverNamedSubjects };
