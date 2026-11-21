/**
 * ContextualImageSelector: decides, section by section, whether a picture belongs there, and records why.
 *
 *   buildImageManifest   before the pages are built: for every section the kind of picture it can use (a verified person portrait,
 *                        historical or campus photography, a facility, a product, none), its priority, and what was selected
 *   auditAssets          the pictures already found are judged against their section: the subject must fit, a portrait slot needs a
 *                        verified portrait of that person, a picture is never reused, the frame must suit the picture, and the
 *                        picture must be good enough. A picture that fails is withheld from the writers (it is not placed "to make
 *                        the page prettier"), and a required picture that does not exist is tracked as missing.
 * Nothing here searches or downloads; it only judges what the image workers found.
 */
const { overlap } = require('../deep/deepPlanner');
const relevance = require('../images/imageRelevanceValidator');

const NONE = /statistics|cta-band|contact-split|faq-list|page-intro|achievement-grid|text-block|two-column/;

/** What a section can show, from its layout, purpose and the requirement behind it. */
function imageTypeFor(section, requirements) {
  const kinds = new Set(requirements.filter((item) => (section.requirementIds || []).includes(item.id)).map((item) => item.contentKind));
  if (section.images?.some((need) => need.role === 'portrait' && need.entity) || kinds.has('person')) return 'person_portrait';
  if (kinds.has('timeline')) return 'historical_or_campus';
  if (kinds.has('facilities')) return 'facility';
  if (/gallery/.test(section.layout)) return 'gallery';
  if (/hero/.test(section.layout)) return 'hero_scene';
  if (/editorial|three-column-cards|alternating/.test(section.layout) && section.images?.length) return 'supporting_photo';
  if (NONE.test(section.layout) && !section.images?.length) return 'none';
  return section.images?.length ? 'supporting_photo' : 'none';
}

const ratioOf = (asset) => (asset.width && asset.height ? asset.width / asset.height : 1);
const sectionWords = (page, section) => `${page.name} ${section.heading} ${section.purpose} ${section.summary} ${(section.images || []).map((need) => `${need.subject || ''} ${need.query || ''}`).join(' ')}`;

/** Judges one picture for its section: { ok, reasons[] }. */
function judge(asset, { page, section, type, siteName = '', officialUrl = '', registry = null }, claimed) {
  const reasons = [];
  let blacklist = false;
  let assessment = null;
  if (asset.status && asset.status !== 'verified') reasons.push(`not verified (${asset.status})`);
  if (Math.min(asset.width || 0, asset.height || 0) && Math.min(asset.width, asset.height) < (type === 'hero_scene' ? 500 : 280)) reasons.push('too small for this frame');
  const key = asset.sha256 || asset.hash || asset.id;
  if (claimed.has(key) && claimed.get(key) !== `${page.id}/${section.id}` && !(asset.entity && asset.entityType === 'person')) reasons.push('the same picture is already used in another section');
  if (type === 'person_portrait') {
    const named = (section.images || []).find((need) => need.entity);
    if (!asset.entity || asset.entityType !== 'person') reasons.push('a portrait slot needs a verified picture of the person, not a general photograph');
    else if (named && asset.entity.toLowerCase() !== named.entity.toLowerCase()) reasons.push(`it shows ${asset.entity}, not ${named.entity}`);
    else if (!asset.identity || !['high', 'medium'].includes(asset.identity.level)) reasons.push('the identity of the person in the picture is not verified');
    if (ratioOf(asset) > 1.6) reasons.push('a very wide picture does not suit a portrait frame');
  } else {
    if (asset.entity && asset.entityType === 'person' && type !== 'gallery') reasons.push('a picture of a named person belongs in that person\'s profile');
    if (type === 'hero_scene' && ratioOf(asset) < 0.9) reasons.push('a tall picture does not suit a wide hero');
    if (type === 'none') reasons.push('this section does not call for a picture');
  }
  // Evidence-based relevance: subject, institution, photograph or illustration, source, identity. Not the search keywords.
  if (type !== 'none') {
    assessment = relevance.assess(asset, { type, section, page, siteName, officialUrl });
    if (assessment.verdict === 'rejected') {
      for (const reason of assessment.reasons) if (!reasons.includes(reason)) reasons.push(reason);
      blacklist = assessment.checks.photograph === false || ['social', 'aggregator'].includes(assessment.source.tier) || assessment.checks.identity === false || /not verified to be a picture/.test(assessment.reasons.join(' '));
    }
    // The same picture, or one that looks the same, in another section of this job.
    if (registry && !(asset.entity && asset.entityType === 'person')) {
      const dup = registry.check(asset, { page: page.name, section: section.heading });
      if (!dup.ok) reasons.push(`${dup.duplicate.detail}${dup.owner ? ` (in "${dup.owner.section}" on ${dup.owner.page})` : ''}`);
    }
  }
  return { ok: !reasons.length, reasons, blacklist, assessment };
}

/**
 * @param input { plan, requirements, assets, personStatus }
 * @returns {{ manifest, rejected: [{ id, reasons }], usable: assets[], missingRequired: [...] }}
 */
function auditAssets({ plan, requirements = [], assets = [], personStatus = [], registry = null, siteName = '', officialUrl = '' }) {
  const claimed = new Map();
  const rejected = [];
  const accepted = new Set();
  const manifest = { pages: [] };
  const missingRequired = [];
  for (const page of plan.pages) {
    const entry = { page: page.name, route: page.route, sections: [] };
    for (const section of page.sections) {
      const type = imageTypeFor(section, requirements);
      const mine = assets.filter((asset) => asset.sectionId === section.id && (!asset.route || asset.route === page.route));
      const decisions = mine.map((asset) => {
        const verdict = judge(asset, { page, section, type, siteName, officialUrl, registry }, claimed);
        if (verdict.ok) {
          claimed.set(asset.sha256 || asset.hash || asset.id, `${page.id}/${section.id}`); accepted.add(asset.id);
          // A general picture never claims to be the organisation's own: its caption is made honest.
          if (verdict.assessment?.verdict === 'generic') { asset.alt = relevance.honestAlt(asset, verdict.assessment, { siteName }); asset.generic = true; }
          registry?.register(asset, { page: page.name, section: section.heading, reason: (verdict.assessment?.reasons || ['fits the section'])[0], verification: verdict.assessment?.verdict || 'verified' });
        } else {
          rejected.push({ id: asset.id, section: section.heading, reasons: verdict.reasons });
          if (registry && verdict.blacklist) registry.reject(asset, verdict.reasons.join('; '));
        }
        return { id: asset.id, path: asset.publicPath || asset.path, decision: verdict.ok ? 'placed' : 'withheld', verification: verdict.assessment?.verdict || (verdict.ok ? 'verified' : 'rejected'), reasons: verdict.ok ? [`fits ${type.replace(/_/g, ' ')}`, ...(verdict.assessment?.reasons || [])] : verdict.reasons, source: asset.sourceUrl || asset.sourcePage || null, identity: asset.identity?.level || null };
      });
      const required = type === 'person_portrait' || requirements.some((item) => (section.requirementIds || []).includes(item.id) && (item.requiredAssets || []).some((need) => need.priority === 'required' && need.type !== 'none'));
      const placed = decisions.some((item) => item.decision === 'placed');
      const status = placed ? 'placed' : (type === 'none' ? 'none-needed' : (required ? 'missing-required' : 'none-found'));
      if (status === 'missing-required') {
        const person = (section.images || []).find((need) => need.entity)?.entity;
        const state = personStatus.find((item) => item.name === person);
        missingRequired.push({ page: page.name, section: section.heading, subject: person || type, reason: state?.reason || 'no verified picture was found' });
      }
      entry.sections.push({ section: section.heading, sectionId: section.id, imageType: type, subject: (section.images || []).find((need) => need.subject || need.entity)?.subject || section.heading, priority: required ? 'required' : (type === 'none' ? 'none' : 'recommended'), status, decisions });
    }
    manifest.pages.push(entry);
  }
  // Pictures that belong to no section of the plan (and are not gallery material) are not placed at random either.
  const usable = assets.filter((asset) => accepted.has(asset.id) || (!asset.sectionId && asset.category === 'gallery'));
  return { manifest, rejected, usable, missingRequired };
}

module.exports = { auditAssets, imageTypeFor, judge };
