/**
 * PersonImageResolver: finds the portrait of a person the request asks for but does not name ("the chancellor").
 *
 *   1. the person's full name and role come from VERIFIED knowledge entries (the organisation's own pages), not from a guess,
 *   2. pictures on the organisation's own pages whose alt text, title or file name carries that name are offered first,
 *   3. the existing identity-checked search (entityImages) looks for more, in the context of the organisation,
 *   4. every picture must pass the identity check (source tier, name with the picture, organisation with the name, decodable, big
 *      enough); the first search hit is never trusted,
 *   5. a person with no verified picture is reported as missing with the reason; the site then uses a neutral design for that slot.
 * A random doctor, student or stock photograph is never a substitute.
 */
const imageSearch = require('../imageSearch');
const defaultEntityImages = require('../entityImages');

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** People that need a portrait: persons of the knowledge object that belong to a requirement asking for one. */
function peopleNeedingPortraits({ knowledge, requirements }) {
  const wanted = new Set(requirements.filter((item) => (item.requiredAssets || []).some((asset) => asset.type === 'person_portrait')).map((item) => item.id));
  const seen = new Set();
  return (knowledge?.people || []).filter((person) => wanted.has(person.requirementId) && person.name && !seen.has(norm(person.name)) && seen.add(norm(person.name)));
}

/** Pictures on the organisation's own pages that name the person (alt, title or file name). */
function officialCandidates(pages, person) {
  const out = [];
  for (const page of pages || []) {
    for (const image of page.images || []) {
      const label = `${image.alt || ''} ${image.title || ''} ${decodeURIComponent(String(image.src || '').split('/').pop() || '').replace(/[-_.]+/g, ' ')}`;
      if (!image.src || !imageSearch.matchesSubject(label, person.name)) continue;
      out.push({ imageUrl: image.src, title: image.alt || image.title || person.name, pageUrl: page.url, snippet: `${person.name} ${person.role || ''}`.trim(), source: 'official', entity: person.name });
    }
  }
  return out;
}

/**
 * @returns {{ found: { assets, missing, rejectedIdentity }, people, status: [{ name, role, requirementId, state: 'verified'|'missing', reason }] }}
 */
async function resolvePersonImages({ knowledge, requirements, site = {}, pages = [], existingAssets = [], signal = null, env = process.env, entityImages = defaultEntityImages, discoverOptions = {} } = {}) {
  const people = peopleNeedingPortraits({ knowledge, requirements }).filter((person) => !existingAssets.some((asset) => asset.entityType === 'person' && norm(asset.entity) === norm(person.name)));
  const status = [];
  if (!people.length) return { found: { assets: [], missing: [], rejectedIdentity: [] }, people: [], status };
  const entities = people.map((person) => ({ name: person.name, type: 'person', role: person.role || '', affiliation: site.name || person.affiliation || '' }));
  const researchImages = people.flatMap((person) => officialCandidates(pages, person));
  const found = await entityImages.discoverEntityImages({ entities, researchImages, signal, env, ...discoverOptions });
  for (const person of people) {
    const mine = found.assets.filter((asset) => norm(asset.entity) === norm(person.name));
    const rejected = (found.rejectedIdentity || []).filter((item) => norm(item.entity) === norm(person.name));
    status.push({ name: person.name, role: person.role, requirementId: person.requirementId, state: mine.length ? 'verified' : 'missing', reason: mine.length ? `${mine.length} picture(s) passed the identity check (${mine[0].identity?.tier || 'source'}, ${mine[0].identity?.level || 'checked'})` : (rejected.length ? `${rejected.length} candidate picture(s) failed the identity check` : 'no picture of this person was found') });
  }
  return { found, people, status };
}

module.exports = { resolvePersonImages, peopleNeedingPortraits, officialCandidates };
