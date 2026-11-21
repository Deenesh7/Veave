/**
 * Knowledge worker: the "think, retrieve, verify" stage that runs BEFORE the site is planned or written.
 *
 *   1. RequirementExtractor   every detail of the request becomes a tracked requirement
 *   2. official site          an address the request gives, otherwise the best search result for the organisation's name
 *   3. WebsiteCrawler         a bounded crawl of that site for the pages the requirements need
 *   4. KnowledgeExtractor     verified, source-linked entries per requirement; gaps for what could not be found
 *   5. PersonImageResolver    identity-checked portraits for the people found (the chancellor, the founder...)
 *
 * It returns data and never edits the job or the project. Every stage can fail alone: a site that is down leaves gaps (reported and
 * tracked), never invented content. A cancellation always propagates.
 */
const requirementExtractor = require('../knowledge/requirementExtractor');
const crawler = require('../knowledge/websiteCrawler');
const knowledgeExtractor = require('../knowledge/knowledgeExtractor');
const personImages = require('../knowledge/personImageResolver');
const webResearch = require('../research/webResearch');
const entityImagesDefault = require('../entityImages');
const { terms } = require('../deep/deepPlanner');

const enabled = (value) => String(value ?? 'true').toLowerCase() !== 'false';

/**
 * @param input { prompt, ask(system,user), entityAssets, wantsNoImages, signal, onProgress, log, env }
 * @param deps  { crawlSite, findOfficialSite, search, fetchHtml, entityImages, resolvePersonImages }  (injected for tests)
 * @returns {{ site, requirements, knowledge, personAssets, personStatus, pages, diagnostics, source }}
 */
async function buildKnowledge(input, deps = {}) {
  const { prompt, ask = null, entityAssets = [], wantsNoImages = false, signal = null, onProgress = async () => {}, log = null, env = process.env } = input;
  const crawlSite = deps.crawlSite || crawler.crawlSite;
  const findOfficialSite = deps.findOfficialSite || crawler.findOfficialSite;
  const resolvePortraits = deps.resolvePersonImages || personImages.resolvePersonImages;
  const diagnostics = { stages: [], crawl: null, official: null, failures: [] };
  const fail = (stage, error) => { if (signal?.aborted) throw error; diagnostics.failures.push({ stage, message: String(error.message).slice(0, 200) }); log?.warn(`knowledge ${stage} skipped: ${error.message}`); };

  // A continued job reuses what an earlier run already retrieved and verified: nothing is crawled or paid for twice.
  const reuse = input.reuse && Array.isArray(input.reuse.requirements) && input.reuse.knowledge ? input.reuse : null;
  if (!reuse) await onProgress({ stepName: 'Reading every detail of your request...', stage: 'requirement_extraction' });
  const reading = reuse ? { site: reuse.site, requirements: reuse.requirements, urls: [], source: 'saved' } : await requirementExtractor.extractRequirements({ prompt, ask });
  const { site, requirements } = reading;
  const result = { site: { ...site }, requirements, knowledge: { version: 1, retrievedAt: new Date().toISOString(), site: { ...site }, sources: [], entries: [], unverified: [], gaps: [], people: [] }, personAssets: [], personStatus: [], pages: [], diagnostics, source: reading.source };
  if (!enabled(env.KNOWLEDGE_RETRIEVAL) || !requirements.length) return result;
  if (reuse) {
    result.knowledge = { ...result.knowledge, ...reuse.knowledge };
    result.site = { ...reuse.site };
    if (enabled(env.ENTITY_IMAGES) && !wantsNoImages && result.knowledge.people?.length) await resolveAndAttach();
    return result;
  }

  // 2. The official site.
  let officialUrl = site.officialUrl || reading.urls[0] || '';
  if (!officialUrl && site.name) {
    try {
      await onProgress({ stepName: `Finding the official website of ${site.name}...`, stage: 'official_site' });
      const found = await findOfficialSite({ name: site.name, search: deps.search || webResearch.searchWeb, signal });
      if (found) { officialUrl = found.url; diagnostics.official = { url: found.url, via: 'search', host: found.host }; }
    } catch (error) { fail('official site search', error); }
  } else if (officialUrl) diagnostics.official = { url: officialUrl, via: 'request' };
  result.site.officialUrl = officialUrl;
  result.knowledge.site.officialUrl = officialUrl;

  // 3. The crawl.
  let crawled = { pages: [], diagnostics: null };
  if (officialUrl) {
    try {
      await onProgress({ stepName: `Reading the pages of ${new URL(officialUrl).hostname}...`, stage: 'website_crawl' });
      const topics = requirements.flatMap((item) => [item.label, item.expectedPage, item.expectedSection]).filter(Boolean);
      crawled = await crawlSite({ startUrl: officialUrl, topics, limits: crawler.crawlLimits(env), signal, fetchHtml: deps.fetchHtml || webResearch.fetchHtml });
      diagnostics.crawl = { ...crawled.diagnostics, pages: crawled.pages.length };
      log?.info(`knowledge: crawled ${crawled.pages.length} page(s) of ${officialUrl} (${crawled.diagnostics.stoppedBy}; ${crawled.diagnostics.failed.length} failed)`);
    } catch (error) { fail('website crawl', error); }
  }
  result.pages = crawled.pages;
  result.knowledge.sources = crawled.pages.map((page, index) => ({ id: `s${index + 1}`, url: page.url, title: page.title, retrievedAt: page.retrievedAt, depth: page.depth, official: true }));

  // 4. Verified entries per requirement; requirements the crawl did not answer are searched for on the official host.
  try {
    await onProgress({ stepName: 'Extracting and verifying the facts, courses and people from the sources...', stage: 'knowledge_extraction' });
    let extracted = await knowledgeExtractor.extractKnowledge({ pages: crawled.pages, requirements, site, ask, signal });
    if (officialUrl && extracted.gaps.length && (deps.search || webResearch.searchWeb)) {
      const more = await searchOnOfficialSite({ gaps: extracted.gaps, requirements, site, officialUrl, search: deps.search || webResearch.searchWeb, fetchHtml: deps.fetchHtml || webResearch.fetchHtml, signal, existing: crawled.pages });
      if (more.length) {
        crawled.pages.push(...more);
        result.pages = crawled.pages;
        extracted = await knowledgeExtractor.extractKnowledge({ pages: crawled.pages, requirements, site, ask, signal });
        result.knowledge.sources = crawled.pages.map((page, index) => ({ id: `s${index + 1}`, url: page.url, title: page.title, retrievedAt: page.retrievedAt, depth: page.depth, official: true }));
      }
    }
    Object.assign(result.knowledge, { entries: extracted.entries, unverified: extracted.unverified, gaps: extracted.gaps, people: extracted.people, diagnostics: extracted.diagnostics });
    for (const requirement of requirements) requirement.knowledgeIds = extracted.entries.filter((entry) => entry.requirementId === requirement.id).map((entry) => entry.id);
  } catch (error) {
    fail('knowledge extraction', error);
    result.knowledge.gaps = requirements.map((item) => ({ requirementId: item.id, label: item.label, reason: officialUrl ? 'extraction failed' : 'no official source could be reached' }));
  }

  // 5. Portraits of the people found.
  if (enabled(env.ENTITY_IMAGES) && !wantsNoImages && result.knowledge.people.length) await resolveAndAttach();
  return result;

  async function resolveAndAttach() {
    try {
      await onProgress({ stepName: 'Verifying portraits of the people on your site...', stage: 'person_images' });
      const portraits = await resolvePortraits({ knowledge: result.knowledge, requirements, site: result.site, pages: result.pages, existingAssets: entityAssets, signal, env, entityImages: deps.entityImages || entityImagesDefault });
      result.personStatus = portraits.status;
      if (portraits.found.assets.length) result.personAssets = await (deps.entityImages || entityImagesDefault).materializeAssets(portraits.found);
    } catch (error) { fail('person images', error); }
  }
}

/** Pages of the official host that a web search offers for a requirement the crawl could not answer. */
async function searchOnOfficialSite({ gaps, requirements, site, officialUrl, search, fetchHtml, signal, existing, maxFetch = 6 }) {
  const known = new Set(existing.map((page) => page.url));
  const fetched = [];
  for (const gap of gaps.slice(0, 6)) {
    if (signal?.aborted || fetched.length >= maxFetch) break;
    const requirement = requirements.find((item) => item.id === gap.requirementId);
    if (!requirement) continue;
    let results = [];
    try { results = await search(`${site.name || ''} ${requirement.label} ${new URL(officialUrl).hostname}`.trim(), { signal }); } catch (error) { if (signal?.aborted) throw error; continue; }
    for (const item of results.filter((entry) => crawler.sameSite(entry.url, officialUrl)).slice(0, 2)) {
      const url = crawler.normalizeUrl(item.url);
      if (!url || known.has(url) || fetched.length >= maxFetch) continue;
      known.add(url);
      try {
        const page = await fetchHtml(url, { signal, timeoutMs: 12000 });
        const parsed = webResearch.parsePage(page.html, page.url, { listMin: 3 });
        fetched.push({ url: crawler.normalizeUrl(page.url) || url, title: parsed.title, description: parsed.description, depth: 1, blocks: parsed.blocks, images: parsed.images, ogImage: parsed.ogImage, retrievedAt: new Date().toISOString(), relevance: 0.5, links: 0 });
      } catch (error) { if (signal?.aborted) throw error; }
    }
  }
  return fetched;
}

/**
 * One more targeted look for a requirement the written site did not cover: a smaller crawl ordered by the requirement's own words, plus a
 * search on the official host, then extraction for that requirement only. New verified entries are added to the knowledge object.
 * @returns {number} how many new entries were added
 */
async function retrieveForRequirement({ requirement, knowledge, requirements, ask = null, signal = null, env = process.env, deps = {}, pages = [] }) {
  const officialUrl = knowledge.site?.officialUrl;
  if (!officialUrl || !enabled(env.KNOWLEDGE_RETRIEVAL)) return 0;
  const fetchHtml = deps.fetchHtml || webResearch.fetchHtml;
  const search = deps.search || webResearch.searchWeb;
  const known = new Set(pages.map((page) => page.url));
  const fresh = [];
  const crawl = await (deps.crawlSite || crawler.crawlSite)({ startUrl: officialUrl, topics: [requirement.label, requirement.description, ...(requirement.requiredContent || [])], limits: crawler.crawlLimits(env, { maxPages: 10, maxDepth: 3 }), signal, fetchHtml });
  fresh.push(...crawl.pages.filter((page) => !known.has(page.url)));
  fresh.forEach((page) => known.add(page.url));
  const searched = await searchOnOfficialSite({ gaps: [{ requirementId: requirement.id, label: requirement.label }], requirements, site: knowledge.site || {}, officialUrl, search, fetchHtml, signal, existing: [...pages, ...fresh] });
  fresh.push(...searched);
  const all = [...pages, ...fresh];
  const extracted = await knowledgeExtractor.extractKnowledge({ pages: all, requirements: [requirement], site: knowledge.site || {}, ask, signal });
  const have = new Set(knowledge.entries.filter((entry) => entry.requirementId === requirement.id).map((entry) => knowledgeExtractor.norm(entry.title)));
  let added = 0;
  for (const entry of extracted.entries) {
    if (have.has(knowledgeExtractor.norm(entry.title))) continue;
    knowledge.entries.push({ ...entry, id: `k${knowledge.entries.length + 1}` });
    added += 1;
  }
  if (added) { knowledge.gaps = knowledge.gaps.filter((gap) => gap.requirementId !== requirement.id); requirement.knowledgeIds = knowledge.entries.filter((entry) => entry.requirementId === requirement.id).map((entry) => entry.id); }
  for (const page of fresh) knowledge.sources.push({ id: `s${knowledge.sources.length + 1}`, url: page.url, title: page.title, retrievedAt: page.retrievedAt, depth: page.depth, official: true });
  pages.push(...fresh);
  return added;
}

/** A compact record of the knowledge object for the job document and the writers (never the raw pages). */
function knowledgeRecord(result) {
  const k = result.knowledge;
  return {
    site: result.site, source: result.source, retrievedAt: k.retrievedAt,
    requirements: result.requirements.map(({ id, label, contentKind, importance, expectedPage, expectedSection, knowledgeIds }) => ({ id, label, contentKind, importance, expectedPage, expectedSection, entries: knowledgeIds.length })),
    sources: k.sources.slice(0, 40), entries: k.entries, gaps: k.gaps, unverifiedCount: k.unverified.length, people: k.people,
    personImages: result.personStatus, crawl: result.diagnostics.crawl, official: result.diagnostics.official, failures: result.diagnostics.failures
  };
}

module.exports = { buildKnowledge, knowledgeRecord, retrieveForRequirement, searchOnOfficialSite };
