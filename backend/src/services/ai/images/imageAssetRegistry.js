/**
 * ImageAssetRegistry: the one record of every picture a generation job selects, rejects and places.
 *
 * Each entry: { id, sourceUrl, resolvedUrl, sourceSite, subject, page, section, description, width, height, aspect, sha256, hash,
 *   reason, verification, pictureKind, deliberateReuse, selectedAt }.
 * Before a picture is placed it is checked against every earlier one with ImageDuplicateDetector; a picture used in a different
 * section is a duplicate unless the reuse is deliberate (a small logo, a person's portrait on its allowed pages). Rejected pictures are
 * remembered too, so a retry or a recovery pass never selects the same rejected picture again. The registry is a plain object
 * (toJSON / fromJSON) stored on the GenerationJob, so it survives retries and restarts.
 */
const { findDuplicate, normalizeUrl } = require('./imageDuplicateDetector');

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isLogo = (asset) => asset.pictureKind === 'logo' || asset.category === 'logo' || (asset.width && asset.height && Math.max(asset.width, asset.height) <= 220);

class ImageAssetRegistry {
  constructor(saved = null) {
    this.entries = new Map((saved?.entries || []).map((entry) => [entry.id, entry]));
    this.rejected = (saved?.rejected || []).slice(-300);
  }

  list() { return [...this.entries.values()]; }

  /** Whether a picture may be used in this section; { ok, duplicate } where duplicate names the earlier picture and how it matched. */
  check(asset, { page = '', section = '' } = {}) {
    const candidate = this.descriptor(asset);
    const rejected = findDuplicate(candidate, this.rejected);
    if (rejected.duplicate) return { ok: false, duplicate: { ...rejected, of: `rejected:${rejected.of}`, detail: `it was rejected earlier (${rejected.detail})` } };
    const same = this.entries.get(asset.id);
    const others = this.list().filter((entry) => entry.id !== asset.id);
    const found = findDuplicate(candidate, others);
    if (!found.duplicate) return { ok: true, duplicate: null };
    const owner = this.entries.get(found.of);
    const sameSection = owner && owner.page === page && owner.section === section;
    if (sameSection || same?.deliberateReuse || owner?.deliberateReuse || isLogo(asset)) return { ok: true, duplicate: null, reused: found };
    return { ok: false, duplicate: found, owner };
  }

  descriptor(asset) {
    return { id: asset.id, url: asset.resolvedUrl || asset.publicPath || asset.url, sourceUrl: asset.sourceUrl || asset.url || '', sha256: asset.sha256 || '', hash: asset.hash || '', subject: `${asset.alt || ''} ${asset.query || ''} ${asset.entity || ''}` };
  }

  register(asset, { page = '', section = '', reason = '', verification = 'verified', deliberateReuse = false } = {}) {
    const entry = {
      id: asset.id, sourceUrl: asset.sourceUrl || asset.url || '', resolvedUrl: asset.publicPath || asset.path || '', sourceSite: hostOf(asset.sourceUrl || asset.url || asset.sourcePage || ''), subject: asset.entity || asset.requirementHints?.subject || asset.query || '',
      page, section, description: asset.alt || '', width: asset.width || 0, height: asset.height || 0, aspect: asset.width && asset.height ? Number((asset.width / asset.height).toFixed(2)) : null,
      sha256: asset.sha256 || '', hash: asset.hash || '', reason, verification, pictureKind: asset.pictureKind || asset.kind || '', deliberateReuse, normalizedUrl: normalizeUrl(asset.sourceUrl || asset.url || ''), selectedAt: new Date().toISOString()
    };
    this.entries.set(asset.id, entry);
    return entry;
  }

  reject(asset, reason) {
    const d = this.descriptor(asset);
    this.rejected.push({ id: asset.id, url: d.url, sourceUrl: d.sourceUrl, sha256: d.sha256, hash: d.hash, subject: d.subject, reason });
    this.rejected = this.rejected.slice(-300);
  }

  /** Makes the discovery step skip everything already selected or rejected (retries never re-select them). */
  seedTaken(taken) {
    for (const item of [...this.list(), ...this.rejected]) {
      if (item.sha256) taken.sha256.add(item.sha256);
      if (item.hash && !taken.hashes.includes(item.hash)) taken.hashes.push(item.hash);
    }
    return taken;
  }

  toJSON() { return { entries: this.list(), rejected: this.rejected }; }
  static fromJSON(saved) { return new ImageAssetRegistry(saved); }
}

module.exports = { ImageAssetRegistry };
