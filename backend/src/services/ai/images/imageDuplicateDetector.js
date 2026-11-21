/**
 * ImageDuplicateDetector: five independent ways to tell that a picture is already used on the site (or was already rejected), from the
 * cheapest to the most meaningful:
 *   1. exact URL            the very same address
 *   2. normalised URL       the same file behind another address (protocol, www, query, size suffix, CDN resize path, extension)
 *   3. file hash            identical bytes (sha-256 of the stored picture)
 *   4. perceptual hash      the same picture resized, recompressed or re-cropped slightly (64-bit average hash, small hamming distance)
 *   5. semantic similarity  the same described subject that also looks alike (a looser perceptual distance), so two near-identical
 *                           photographs of one building are not used as two different sections
 * Pure functions: no network, no files.
 */
const { hamming } = require('./imageVerification');

const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'photo', 'photograph', 'image', 'picture', 'view', 'of', 'in', 'at', 'a', 'an', 'on']);

/** The identity of the file a URL points to, without the decoration CDNs and CMSs add. */
function normalizeUrl(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return String(url || '').trim().toLowerCase(); }
  let path = decodeURIComponent(parsed.pathname).toLowerCase();
  path = path.replace(/\/(?:w|h|q|c|resize|fit|crop|thumb|thumbs|small|medium|large|original)[_=:-]?\d*(?:,[a-z]_?\d*)*(?=\/)/g, '')   // /w_800/ /resize/
    .replace(/[-_.](?:\d{2,4}x\d{2,4}|thumb|thumbnail|small|medium|large|scaled|min|compressed|\d{3,4}w)(?=\.[a-z0-9]+$|$)/g, '')       // -300x200, _thumb
    .replace(/\.(?:jpe?g|png|webp|avif|gif)$/, '');
  return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${path}`.replace(/\/+$/, '');
}

const tokens = (text) => [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((word) => word.length >= 3 && !STOP.has(word)))];

/** Share of the smaller description's words that the other one also has (0..1). */
function subjectSimilarity(a, b) {
  const x = tokens(a); const y = tokens(b);
  if (!x.length || !y.length) return 0;
  const set = new Set(y);
  return x.filter((word) => set.has(word)).length / Math.min(x.length, y.length);
}

const config = (env = process.env) => ({
  perceptual: Number.parseInt(env.IMAGE_DUPLICATE_HAMMING, 10) || 5,
  semanticHamming: Number.parseInt(env.IMAGE_SIMILAR_HAMMING, 10) || 14,
  semanticSubject: Number.parseFloat(env.IMAGE_SIMILAR_SUBJECT) || 0.8
});

/**
 * @param candidate { url, sourceUrl, sha256, hash, subject }
 * @param known     [{ id, url, sourceUrl, sha256, hash, subject }]  (accepted pictures or rejected ones)
 * @returns {{ duplicate: boolean, kind: string|null, of: string|null, detail: string }}
 */
function findDuplicate(candidate, known, { env = process.env } = {}) {
  const limits = config(env);
  const urls = [candidate.url, candidate.sourceUrl].filter(Boolean);
  const normalized = urls.map(normalizeUrl);
  for (const other of known) {
    const otherUrls = [other.url, other.sourceUrl].filter(Boolean);
    if (urls.some((url) => otherUrls.includes(url))) return { duplicate: true, kind: 'exact-url', of: other.id, detail: 'the same address is already used' };
    if (normalized.some((url) => otherUrls.some((o) => normalizeUrl(o) === url))) return { duplicate: true, kind: 'normalized-url', of: other.id, detail: 'the same file behind another address is already used' };
    if (candidate.sha256 && other.sha256 && candidate.sha256 === other.sha256) return { duplicate: true, kind: 'file-hash', of: other.id, detail: 'identical file content is already used' };
    if (candidate.hash && other.hash) {
      const distance = hamming(candidate.hash, other.hash);
      if (distance <= limits.perceptual) return { duplicate: true, kind: 'perceptual-hash', of: other.id, detail: `visually the same picture (distance ${distance})` };
      if (distance <= limits.semanticHamming && subjectSimilarity(candidate.subject, other.subject) >= limits.semanticSubject) return { duplicate: true, kind: 'semantic', of: other.id, detail: `a near-identical picture of the same subject (distance ${distance})` };
    }
  }
  return { duplicate: false, kind: null, of: null, detail: '' };
}

module.exports = { normalizeUrl, subjectSimilarity, findDuplicate, config };
