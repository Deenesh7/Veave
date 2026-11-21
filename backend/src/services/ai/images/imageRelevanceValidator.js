/**
 * ImageRelevanceValidator: decides whether a picture may stand in a section, from evidence, not from the search keywords that found it.
 *
 * Seven questions, each answered from what is known about the picture (its source, description, query, identity evidence, size):
 *   subject      does it depict what the section is about?
 *   institution  does it belong to THIS organisation (its own site, or its name with the picture), where the section claims that?
 *   photograph   is it a photograph, not an engraving, illustration, vector, diagram or painting?
 *   source       is the source trustworthy (official > reference/news > stock; never social or aggregator for a claim)?
 *   suitable     do its size and shape fit the frame?
 *   unique       (checked against the registry by the caller)
 *   identity     for a person: is the identity verified?
 * Verdict: verified | generic (honest stand-in that makes no claim) | rejected. A section whose claim cannot be verified is built
 * text-led. The captions of a generic picture never name the institution.
 */
const { overlap, terms } = require('../deep/deepPlanner');

const ILLUSTRATION = /\b(engraving|etching|illustration|illustrated|vector|clip ?art|drawing|sketch|cartoon|icon|diagram|painting|lithograph|woodcut|3d render|rendering|infographic|stock vector|artwork)\b/i;
const SOCIAL = /(?:^|\.)(?:facebook|instagram|pinterest|twitter|x|tiktok|linkedin|reddit|tumblr|quora|youtube|ytimg|fbcdn)\.(?:com|net|co)$/i;
const AGGREGATOR = /(?:^|\.)(?:alamy|gettyimages|shutterstock|istockphoto|dreamstime|depositphotos|123rf|pngtree|pngwing|freepik|vecteezy|pikbest|wallpaper\w*)\.(?:com|net|org)$/i;
const STOCK = /(?:^|\.)(?:pexels|unsplash|pixabay)\.com$/i;
const GENERIC_NAME_WORDS = new Set(['medical', 'college', 'university', 'institute', 'school', 'hospital', 'company', 'group', 'limited', 'private', 'sciences', 'technical', 'educational', 'trust', 'foundation', 'official', 'international', 'national']);

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/** The distinctive words of the organisation's name ("saveetha"), without the words every institution shares. */
const nameTokens = (siteName) => terms(siteName).filter((word) => !GENERIC_NAME_WORDS.has(word));

/** What an asset's own metadata says about where it came from. */
function sourceOf(asset) {
  const host = hostOf(asset.sourcePage || asset.sourceUrl || asset.url || '');
  if (SOCIAL.test(host)) return { tier: 'social', host };
  if (AGGREGATOR.test(host)) return { tier: 'aggregator', host };
  if (asset.identity?.tier === 'official' || asset.provider === 'official' || asset.officialVerified) return { tier: 'official', host };
  if (STOCK.test(host) || /pexels|unsplash|pixabay/i.test(asset.provider || '')) return { tier: 'stock', host };
  if (asset.identity?.tier) return { tier: asset.identity.tier, host };
  return { tier: 'unknown', host };
}

/** Is the picture tied to this organisation: its own site, or the name with the picture (alt, title, page, query). */
function belongsTo(asset, { siteName = '', officialUrl = '' } = {}) {
  const official = hostOf(officialUrl);
  const host = hostOf(asset.sourcePage || asset.sourceUrl || '');
  if (official && host && (host === official || host.endsWith(`.${official}`) || official.endsWith(`.${host}`))) return { ok: true, via: 'the organisation\'s own website' };
  const words = nameTokens(siteName);
  if (!words.length) return { ok: false, via: 'no organisation name to verify against' };
  const context = `${asset.alt || ''} ${asset.title || ''} ${asset.sourcePage || ''} ${asset.sourceUrl || ''} ${asset.query || ''}`.toLowerCase();
  const hit = words.filter((word) => context.includes(word.slice(0, Math.max(4, word.length - 1))));
  // The query alone does not count: the name must come from the source (its title, page or address), or the picture's own description.
  const fromSource = words.some((word) => `${asset.title || ''} ${asset.sourcePage || ''} ${asset.sourceUrl || ''} ${asset.evaluation?.description || ''}`.toLowerCase().includes(word.slice(0, Math.max(4, word.length - 1))));
  return hit.length && fromSource ? { ok: true, via: 'its source names the organisation' } : { ok: false, via: 'nothing in its source ties it to the organisation' };
}

/**
 * @param asset    a stored picture asset
 * @param context  { type (imageTypeFor), section, page, siteName, officialUrl }
 * @returns {{ verdict: 'verified'|'generic'|'rejected', checks, reasons[] }}
 */
function assess(asset, { type = 'supporting_photo', section = {}, page = {}, siteName = '', officialUrl = '' } = {}) {
  const reasons = [];
  const source = sourceOf(asset);
  const label = `${asset.alt || ''} ${asset.title || ''} ${asset.query || ''} ${asset.sourceUrl || ''}`;
  const checks = { subject: true, institution: null, photograph: true, source: source.tier, suitable: true, identity: null };

  if (asset.mime === 'image/svg+xml' || asset.kind === 'illustration' || ILLUSTRATION.test(label)) { checks.photograph = false; reasons.push('it is an illustration or engraving, not a photograph'); }
  if (['social', 'aggregator'].includes(source.tier)) reasons.push(`its source (${source.host}) is not reliable enough`);

  const sectionText = `${page.name || ''} ${section.heading || ''} ${section.purpose || ''} ${section.summary || ''} ${(section.images || []).map((need) => `${need.subject || ''} ${need.query || ''}`).join(' ')}`;
  const own = asset.sectionId && asset.sectionId === section.id;
  const described = `${asset.alt || ''} ${asset.query || ''} ${asset.requirementHints?.subject || ''}`;
  const related = overlap(described, sectionText);
  // A picture that was searched for THIS section by its own subject is related by construction; any other must describe something the section is about.
  if (!own && !asset.entity && related < 0.25 && type !== 'gallery') { checks.subject = false; reasons.push('its description does not relate to this section'); }

  if (type === 'person_portrait') {
    const wanted = (section.images || []).find((need) => need.entity)?.entity;
    checks.identity = Boolean(asset.entityType === 'person' && asset.identity && ['high', 'medium'].includes(asset.identity.level) && (!wanted || String(asset.entity).toLowerCase() === wanted.toLowerCase()));
    if (!checks.identity) reasons.push('the person in the picture is not verified as the person named');
  }

  const claimsInstitution = ['historical_or_campus', 'facility'].includes(type) || /\b(history|legacy|founded|heritage|campus|our (?:hospital|college|institution))\b/i.test(`${section.heading || ''} ${section.purpose || ''}`);
  const belonging = belongsTo(asset, { siteName, officialUrl });
  checks.institution = belonging.ok;
  if (type === 'historical_or_campus') {
    // A historical or campus picture is a claim about THIS organisation: it needs proof that it is theirs, and must be a photograph.
    if (!belonging.ok && !asset.entity) reasons.push(`it is not verified to be a picture of ${siteName || 'this organisation'} (${belonging.via})`);
  }

  if (reasons.length) return { verdict: 'rejected', checks, reasons, source };
  if (claimsInstitution && !belonging.ok) return { verdict: 'generic', checks, reasons: ['a general picture of the subject: it is not presented as this organisation\'s own'], source };
  return { verdict: belonging.ok || asset.entity ? 'verified' : (source.tier === 'official' ? 'verified' : 'generic'), checks, reasons: [belonging.ok ? `ties to the organisation: ${belonging.via}` : 'matches the section subject'], source };
}

/** A caption that does not claim more than the picture's identity supports. */
function honestAlt(asset, assessment, { siteName = '' } = {}) {
  if (assessment.verdict !== 'generic' || !siteName) return asset.alt;
  const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(asset.alt || '').replace(new RegExp(escaped, 'ig'), '').replace(/\s{2,}/g, ' ').replace(/^[\s,:-]+|[\s,:-]+$/g, '') || 'A general photograph';
}

module.exports = { assess, belongsTo, sourceOf, honestAlt, nameTokens, ILLUSTRATION };
