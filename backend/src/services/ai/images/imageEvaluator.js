/**
 * Image evaluation: the step between "a search returned this" and "this goes on the website".
 *
 * A candidate is scored against the section it is meant for (subject, section, industry, quality, composition, brand fit) and is
 * placed only when it clears the threshold. Two modes, and the result always says which one was used:
 *
 *   visual     a vision model looked at the downloaded pixels. `visuallyVerified: true`.
 *   metadata   no vision model (or it failed): only the provider's title/tags, the size and the shape are known, so the bar is stricter
 *              and `visuallyVerified: false`. A metadata result never claims that the photograph was looked at.
 */
const { imageConfig } = require('./imageConfig');
const { relevanceOf } = require('./imageVerification');

const cache = new Map();
const CACHE_LIMIT = 300;
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Weighted score of {subject, section, industry, quality, composition, brand} (each 0..1). */
function weightedScore(scores, weights) {
  let total = 0;
  let used = 0;
  for (const [key, weight] of Object.entries(weights)) { total += clamp01(scores[key]) * weight; used += weight; }
  return used ? total / used : 0;
}

/** Terms the section must not show ("office", "stock handshake"); matched against the provider's own words. */
function avoidHit(candidate, requirement) {
  const avoid = (requirement.avoid || []).map((term) => String(term).toLowerCase().trim()).filter((term) => term.length > 2);
  if (!avoid.length) return null;
  const text = ` ${String(`${candidate.title || ''} ${candidate.description || ''} ${(candidate.tags || []).join(' ')}`).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  return avoid.find((term) => text.includes(` ${term} `)) || null;
}

/** Conservative evaluation from verified metadata only. */
function metadataEvaluation({ candidate, requirement, query, meta, cfg }) {
  const relevance = relevanceOf(candidate, query);
  const subject = relevance.trusted ? 0.4 : clamp01(relevance.score);
  const quality = clamp01(((meta?.width || 0) * (meta?.height || 0)) / 2_000_000);
  const wide = (meta?.aspect || 1.5) >= 1;
  const composition = requirement.orientation === 'portrait' ? (wide ? 0.3 : 1) : (requirement.orientation === 'landscape' ? (wide ? 1 : 0.3) : 0.8);
  const score = subject * 0.7 + quality * 0.15 + composition * 0.15;
  const hit = avoidHit(candidate, requirement);
  const threshold = cfg.evalMetadataMinScore;
  const pass = !hit && score >= threshold;
  return {
    mode: 'metadata', visuallyVerified: false, score: Number(score.toFixed(3)), threshold, pass,
    scores: { subject, section: subject, industry: 0, quality, composition, brand: 0 },
    code: hit ? 'contradicts_section' : (pass ? null : 'below_threshold'),
    reason: hit ? `its description mentions "${hit}", which this section must not show` : (pass ? '' : `metadata relevance ${score.toFixed(2)} is below ${threshold}`)
  };
}

const SYSTEM = 'You are an art director choosing photographs for a website. You are shown ONE candidate photograph and the section it would be placed in. Judge only what is actually visible in the picture; never trust its file name or caption. Reply with ONLY JSON, no prose.';

function promptFor({ requirement, query, site }) {
  const lines = [
    `Website: ${site.name || 'untitled'} | industry: ${site.industry || 'unknown'} | subject: ${site.subject || 'n/a'}`,
    site.audience ? `Audience: ${site.audience}` : null,
    site.visualDirection ? `Visual direction: ${site.visualDirection}` : null,
    site.palette ? `Palette: ${site.palette}` : null,
    `Page: ${requirement.page} | Section: ${requirement.section}${requirement.sectionHeading ? ` ("${requirement.sectionHeading}")` : ''}${requirement.hero ? ' | THIS IS THE HERO IMAGE' : ''}`,
    requirement.sectionSummary ? `What the section says: ${requirement.sectionSummary}` : null,
    `The image should show: ${requirement.subject || query}`,
    requirement.style ? `Photographic style wanted: ${requirement.style}` : null,
    (requirement.avoid || []).length ? `Must NOT show: ${requirement.avoid.join(', ')}` : null,
    `Placed as: ${requirement.component || requirement.category || 'section image'} (aspect ${requirement.aspect || 'any'}, ${requirement.orientation || 'any'} orientation)${requirement.hero ? ', behind or beside the headline text' : ''}`
  ].filter(Boolean);
  return `${lines.join('\n')}\n\nReturn JSON: {"description": "one factual sentence of what the photograph shows (usable as alt text)", "subject": 0-10, "section": 0-10, "industry": 0-10, "quality": 0-10, "composition": 0-10, "brand": 0-10, "contradicts": boolean, "textOrWatermark": boolean, "focalPoint": {"x": 0-100, "y": 0-100}, "tone": "light"|"mid"|"dark", "textSafeZone": "left"|"right"|"top"|"bottom"|"center"|"none", "overlay": "none"|"light"|"medium"|"strong", "reason": "short"}.\nsubject = does it show the requested subject; section = does it support what this section says; industry = does it belong to this website's industry; quality = sharpness, lighting, no blur or distortion; composition = crop and subject placement for the stated placement (and room for text if hero); brand = fit with the palette and visual direction. textOrWatermark = true ONLY for a watermark, a stock-site stamp, an added caption or a logo overlaid on the picture; signs, menus and writing that are part of the scene do not count. contradicts = true if the subject conflicts with the section or industry (for example an office photo on an architecture site). overlay = the lightest text scrim that would keep text readable (none when the photo already has a calm area for text).`;
}

function parseVision(raw) {
  const json = (/\{[\s\S]*\}/.exec(String(raw || '')) || [])[0];
  if (!json) return null;
  let value;
  try { value = JSON.parse(json); } catch { return null; }
  const num = (key) => { const n = Number(value[key]); return Number.isFinite(n) ? clamp01(n > 1 ? n / 10 : n) : null; };
  const scores = { subject: num('subject'), section: num('section'), industry: num('industry'), quality: num('quality'), composition: num('composition'), brand: num('brand') };
  if (scores.subject === null || scores.section === null) return null; // not a usable verdict
  for (const key of Object.keys(scores)) if (scores[key] === null) scores[key] = 0.5;
  const focal = value.focalPoint && Number.isFinite(Number(value.focalPoint.x)) && Number.isFinite(Number(value.focalPoint.y))
    ? { x: Math.round(Math.max(0, Math.min(100, Number(value.focalPoint.x)))), y: Math.round(Math.max(0, Math.min(100, Number(value.focalPoint.y)))) } : null;
  const oneOf = (v, list, fallback) => (list.includes(String(v)) ? String(v) : fallback);
  return {
    scores, description: clean(value.description, 160), contradicts: value.contradicts === true, textOrWatermark: value.textOrWatermark === true, focalPoint: focal,
    tone: oneOf(value.tone, ['light', 'mid', 'dark'], 'mid'), textSafeZone: oneOf(value.textSafeZone, ['left', 'right', 'top', 'bottom', 'center', 'none'], 'none'),
    overlay: oneOf(value.overlay, ['none', 'light', 'medium', 'strong'], 'light'), reason: clean(value.reason, 160)
  };
}

async function shrink(buffer, cfg) {
  const sharp = require('sharp');
  const data = await sharp(buffer).resize({ width: cfg.visionMaxSide, height: cfg.visionMaxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

/**
 * @param buffer       the verified (decoded) image bytes
 * @param meta         { sha256, width, height, aspect }
 * @param vision       optional async ({ system, user, image }) => string; when absent the metadata mode is used
 * @param site         { name, industry, subject, audience, visualDirection, palette }
 * @returns {{ mode, visuallyVerified, score, threshold, pass, scores, code, reason, description?, focalPoint?, overlay?, textSafeZone?, tone? }}
 */
async function evaluateCandidate({ buffer, meta, candidate, requirement, query, site = {}, vision = null, cfg = imageConfig() }) {
  const threshold = requirement.hero ? cfg.evalHeroMinScore : cfg.evalMinScore;
  const fallback = () => metadataEvaluation({ candidate, requirement, query, meta, cfg });
  if (!vision || !cfg.visionEval) return fallback();
  const key = `${meta?.sha256}|${requirement.page}|${requirement.section}|${requirement.subject || query}|${requirement.hero ? 'h' : ''}|${site.industry || ''}`;
  if (cache.has(key)) return cache.get(key);
  let verdict = null;
  let visionError = '';
  try {
    const image = await shrink(buffer, cfg);
    verdict = parseVision(await vision({ system: SYSTEM, user: promptFor({ requirement, query, site }), image }));
    if (!verdict) visionError = 'the vision model returned no usable verdict';
  } catch (error) { visionError = clean(error?.message || error, 100); }
  if (!verdict) return { ...fallback(), visionError }; // not cached: a later attempt may reach the vision model
  const score = weightedScore(verdict.scores, cfg.evalWeights);
  const hit = avoidHit(candidate, requirement);
  let code = null;
  let reason = '';
  if (verdict.contradicts) { code = 'contradicts_section'; reason = `its subject conflicts with the section${verdict.reason ? ` (${verdict.reason})` : ''}`; }
  else if (hit) { code = 'contradicts_section'; reason = `it shows "${hit}", which this section must not show`; }
  else if (verdict.textOrWatermark) { code = 'text_or_watermark'; reason = 'the photograph carries text, a logo or a watermark'; }
  else if (verdict.scores.subject < cfg.evalMinSubject) { code = 'wrong_subject'; reason = `the subject does not match (${(verdict.scores.subject * 10).toFixed(0)}/10)${verdict.description ? `: it shows ${verdict.description}` : ''}`; }
  else if (score < threshold) { code = 'below_threshold'; reason = `weighted relevance ${score.toFixed(2)} is below ${threshold}`; }
  const result = {
    mode: 'visual', visuallyVerified: true, score: Number(score.toFixed(3)), threshold, pass: !code, scores: verdict.scores, code, reason,
    description: verdict.description, focalPoint: verdict.focalPoint, overlay: verdict.overlay, textSafeZone: verdict.textSafeZone, tone: verdict.tone
  };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  return result;
}

/**
 * A relevance gate for pictures that arrive through an edit (a link the model wrote). It judges the picture against the alt text and
 * words around the <img>. When there is no vision model, or nothing says what the picture is for, it makes no claim and lets the
 * existing checks decide (it never reports an unchecked picture as verified).
 */
function editGate({ vision, site = {}, cfg = imageConfig() }) {
  if (!vision || !cfg.visionEval) return null;
  return async ({ url, body, context }) => {
    const subject = clean(context?.alt || context?.nearby, 160);
    if (!subject) return { ok: true, checked: false };
    const sharp = require('sharp');
    let meta;
    try { const info = await sharp(body).metadata(); meta = { width: info.width, height: info.height, aspect: info.width / info.height, sha256: require('node:crypto').createHash('sha256').update(body).digest('hex') }; } catch { return { ok: true, checked: false }; }
    const requirement = { page: 'edited page', section: clean(context.nearby, 60) || 'edited section', sectionSummary: clean(context.nearby, 200), subject, orientation: 'any', aspect: 'any', hero: false, category: 'section image' };
    const evaluation = await evaluateCandidate({ buffer: body, meta, candidate: { url }, requirement, query: subject, site, vision, cfg });
    if (!evaluation.visuallyVerified) return { ok: true, checked: false };
    return { ok: evaluation.pass, checked: true, reason: evaluation.reason, score: evaluation.score };
  };
}

function clearEvaluationCache() { cache.clear(); }

module.exports = { editGate, evaluateCandidate, metadataEvaluation, weightedScore, parseVision, avoidHit, clearEvaluationCache };
