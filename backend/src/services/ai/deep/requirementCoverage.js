/**
 * Requirement coverage validation: compares what the user asked for with what the website actually says.
 *
 * Every requirement is judged by meaning (a model reads a digest of each written section) and then checked against hard facts the
 * model cannot talk its way around: the section it points to must exist and carry enough real text. When no model is reachable the
 * judgement falls back to a stem-level term overlap between the requirement and the text of the sections. A requirement is
 *   covered   the site addresses it in a section with real content,
 *   partial   it is mentioned or covered thinly,
 *   missing   nothing on the site addresses it.
 */
const { visibleText, wordCount } = require('./depthChecks');
const { terms, overlap } = require('./deepPlanner');

const COVERED = 'covered';
const PARTIAL = 'partial';
const MISSING = 'missing';

/** [{ key: 'pageId/sectionId', page, heading, text, words }] for every written section. */
function digestSections(state) {
  const digest = [];
  for (const page of state.pages) {
    for (const section of page.sections) {
      const source = state.files[section.file];
      if (!source) continue;
      const text = visibleText(source);
      digest.push({ key: `${page.id}/${section.id}`, page: page.name, heading: section.heading, text, words: wordCount(text) });
    }
  }
  return digest;
}

const COVERAGE_SYSTEM = `You check whether a generated website covers what the user asked for. Reply with ONLY JSON, no prose:
{"results": [{"id": string, "status": "covered"|"partial"|"missing", "where": ["pageId/sectionId"], "reason": string}]}
RULES: judge by meaning, not by keywords: "covered" = a section really explains the requirement with specific, useful content; "partial" = it is only mentioned in passing, covered by generic or very thin text, or only one part of a broad requirement ("all courses" with two courses) is addressed; "missing" = nothing on the site addresses it. "where" lists the sections (copy the exact keys) that address it. Be strict: a heading alone is not coverage.`;

/** Hard facts that override the model: the sections it cites must exist and hold real text. */
function reconcile(result, digest, minimumWords) {
  const known = new Map(digest.map((item) => [item.key, item]));
  const cited = (result.where || []).map((key) => known.get(key)).filter(Boolean);
  if (result.status === COVERED && (!cited.length || !cited.some((item) => item.words >= minimumWords))) return { ...result, status: cited.length ? PARTIAL : MISSING, reason: cited.length ? 'the section that addresses it is too thin' : 'no written section addresses it' };
  return result;
}

/** The deterministic judgement: how much of the requirement's vocabulary appears in the best sections. */
function lexicalResult(requirement, digest, minimumWords) {
  const scored = digest.map((item) => ({ item, score: Math.max(overlap(requirement.label, `${item.heading} ${item.page}`), overlap(requirement.label, item.text) * 0.9) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.34) return { id: requirement.id, status: MISSING, where: [], reason: 'no section addresses it' };
  const where = scored.filter((entry) => entry.score >= 0.34).slice(0, 3).map((entry) => entry.item.key);
  const strong = scored.some((entry) => entry.score >= 0.66 && entry.item.words >= minimumWords);
  return { id: requirement.id, status: strong ? COVERED : PARTIAL, where, reason: strong ? 'terms found in a substantial section' : 'only a partial match' };
}

/**
 * @param input { state, ask, minimumWords }
 * @returns {{ results: [{ id, status, where, reason }], source: 'model'|'lexical' }}  (also written onto state.requirements)
 */
async function checkCoverage({ state, ask = null, minimumWords = 60 }) {
  const digest = digestSections(state);
  let results = null;
  let source = 'lexical';
  if (ask && digest.length) {
    try {
      const sections = digest.map((item) => `${item.key} | ${item.page} | ${item.heading} | ${item.words} words | ${item.text.replace(/\s+/g, ' ').slice(0, 320)}`).join('\n');
      const requirements = state.requirements.map((item) => `${item.id}: ${item.label}`).join('\n');
      const text = await ask(COVERAGE_SYSTEM, `REQUIREMENTS:\n${requirements}\n\nWRITTEN SECTIONS (key | page | heading | size | opening text):\n${sections.slice(0, 60000)}`);
      const json = (/\{[\s\S]*\}/.exec(String(text || '')) || [])[0];
      const parsed = json ? JSON.parse(json) : null;
      if (parsed && Array.isArray(parsed.results)) {
        const byId = new Map(parsed.results.map((item) => [String(item.id), item]));
        results = state.requirements.map((requirement) => {
          const item = byId.get(requirement.id);
          const status = [COVERED, PARTIAL, MISSING].includes(item?.status) ? item.status : null;
          // A requirement the model did not mention is judged by the deterministic check instead of being assumed covered.
          return status ? { id: requirement.id, status, where: Array.isArray(item.where) ? item.where.map(String) : [], reason: String(item.reason || '').slice(0, 200) } : lexicalResult(requirement, digest, minimumWords);
        });
        source = 'model';
      }
    } catch { results = null; }
  }
  if (!results) results = state.requirements.map((requirement) => lexicalResult(requirement, digest, minimumWords));
  results = results.map((result) => reconcile(result, digest, minimumWords));
  for (const result of results) {
    const requirement = state.requirements.find((item) => item.id === result.id);
    if (!requirement) continue;
    requirement.status = result.status;
    requirement.evidence = (result.where || []).join(', ');
    requirement.note = result.reason || '';
  }
  return { results, source };
}

module.exports = { checkCoverage, digestSections, lexicalResult, reconcile, COVERED, PARTIAL, MISSING, COVERAGE_SYSTEM };
