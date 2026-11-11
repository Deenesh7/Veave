/**
 * Decides whether a downloaded file is a usable photograph. An HTTP 200 proves nothing (it can be an error page, a tracking
 * pixel or access-denied text), so a candidate is accepted only when its bytes decode as an image, are big enough and varied
 * enough, fit the slot, are not a repeat of one already taken, and its source is not a watermarked stock site.
 */
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { imageConfig } = require('./imageConfig');

const WATERMARK_HOSTS = /(?:shutterstock|gettyimages|istockphoto|alamy|dreamstime|depositphotos|123rf|adobestock|stock\.adobe|bigstockphoto|canstockphoto|fotolia|pond5|vecteezy|freepik|stock\.adobe)\./i;
const BAD_TITLE = /\b(?:logo|icon|clipart|clip art|vector|illustration|drawing|cartoon|mockup|mock-up|template|screenshot|wallpaper|poster|banner|infographic|diagram|placeholder|lorem|dummy|sample image|no image|image not found|watermark|avatar)\b/i;
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'at', 'for', 'with', 'by', 'to', 'from', 'into', 'over', 'close', 'up', 'shot', 'view', 'scene', 'professional', 'modern', 'high', 'quality', 'photography', 'photograph', 'photo', 'photos', 'image', 'images', 'picture', 'stock', 'hd', 'beautiful', 'background', 'lighting', 'warm', 'bright', 'natural', 'contemporary', 'minimal', 'real', 'best', 'free']);

const stem = (word) => word.replace(/(?:ies)$/, 'y').replace(/(?:ing|es|s)$/, (m) => (word.length > 5 ? '' : m));
const words = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

/** The words of a query that carry the subject ("plated gourmet dish close up" -> plated, gourmet, dish). */
function coreTokens(query) {
  return [...new Set(words(query).filter((word) => word.length >= 3 && !STOP.has(word)).map(stem))];
}

/**
 * How well a search result's own words (title, description, tags) match what the slot needs. Returns { score, matched, needed }.
 * A result with no descriptive text at all can only come from a curated, relevance-ranked provider and is trusted only near the top.
 */
function relevanceOf(candidate, query) {
  const core = coreTokens(query);
  if (!core.length) return { score: 0, matched: 0, needed: 1, reason: 'the query has no subject words' };
  const haystack = new Set(words(`${candidate.title || ''} ${candidate.description || ''} ${(candidate.tags || []).join(' ')} ${candidate.pageUrl || ''}`).map(stem));
  const hasText = haystack.size > 0 && Boolean(candidate.title || candidate.description || (candidate.tags || []).length);
  const needed = core.length <= 2 ? 1 : 2;
  if (!hasText) return candidate.curated && Number(candidate.rank) < 4 ? { score: 0.4, matched: 0, needed, trusted: true } : { score: 0, matched: 0, needed, reason: 'the result has no description to check' };
  const matched = core.filter((token) => haystack.has(token)).length;
  return { score: matched / core.length, matched, needed };
}

function rejectCandidate(candidate, { query = '' } = {}) {
  const host = (() => { try { return new URL(candidate.url).hostname; } catch { return ''; } })();
  const pageHost = (() => { try { return new URL(candidate.pageUrl || 'https://x.invalid').hostname; } catch { return ''; } })();
  if (WATERMARK_HOSTS.test(host) || WATERMARK_HOSTS.test(pageHost)) return { code: 'watermarked_source', reason: 'the source is a watermarked stock-photo site' };
  const fileName = (() => { try { return decodeURIComponent(new URL(candidate.url).pathname.split('/').pop() || ''); } catch { return ''; } })();
  const text = `${candidate.title || ''} ${fileName}`; // the title and file name say what a picture is; a long description often mentions other things
  const asked = String(query).toLowerCase();
  const bad = BAD_TITLE.exec(text);
  if (bad && !asked.includes(bad[0].toLowerCase())) return { code: 'not_a_photograph', reason: `it looks like a ${bad[0]}, not a photograph` };
  if (/\.(?:svg|gif|ico|bmp|tiff?)(?:[?#]|$)/i.test(candidate.url)) return { code: 'unsupported_format', reason: 'the file type is not a photograph format' };
  if (candidate.filetype && /^(?:svg|gif)$/i.test(candidate.filetype)) return { code: 'unsupported_format', reason: 'the file type is not a photograph format' };
  if (Number(candidate.width) && Number(candidate.height) && Math.min(candidate.width, candidate.height) < 300) return { code: 'too_small', reason: 'the listed size is too small' };
  return null;
}

/** 64-bit average hash: two files with the same picture (resized, recompressed) have almost identical hashes. */
async function averageHash(buffer) {
  const raw = await sharp(buffer).rotate().resize(8, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  const mean = raw.reduce((sum, v) => sum + v, 0) / raw.length;
  let bits = '';
  for (const v of raw) bits += v >= mean ? '1' : '0';
  return bits;
}
const hamming = (a, b) => { let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) d += 1; return d; };

/**
 * @param buffer       the downloaded bytes
 * @param requirement  { hero, aspect, orientation }
 * @param taken        { sha256: Set, hashes: string[] } what the site already uses (duplicates are rejected)
 * @returns {{ ok: true, buffer, meta } | { ok: false, code, reason }}
 */
async function verifyAndPrepare(buffer, requirement = {}, { cfg = imageConfig(), taken = { sha256: new Set(), hashes: [] } } = {}) {
  const { sniffImage } = require('../remoteImageLocalizer');
  if (!buffer || !buffer.length) return { ok: false, code: 'empty_response', reason: 'the response was empty' };
  if (buffer.length > cfg.maxBytes) return { ok: false, code: 'too_large', reason: 'the file is larger than the limit' };
  if (buffer.length < 4096) return { ok: false, code: 'invalid_image', reason: 'the file is too small to be a photograph' };
  const sniffed = sniffImage(buffer);
  if (!sniffed || !/^image\/(?:jpeg|png|webp|avif)$/.test(sniffed.mime)) return { ok: false, code: 'not_an_image', reason: 'the response is not a photograph file (it may be an HTML or error page)' };
  let prepared;
  try {
    const meta = await sharp(buffer, { failOn: 'error' }).metadata();
    const shortSide = Math.min(meta.width || 0, meta.height || 0);
    const longSide = Math.max(meta.width || 0, meta.height || 0);
    if (!meta.width || !meta.height) return { ok: false, code: 'invalid_image', reason: 'the image has no dimensions' };
    if (shortSide < cfg.minShortSide && !(requirement.orientation === 'portrait' && shortSide >= Math.round(cfg.minShortSide * 0.8))) return { ok: false, code: 'low_resolution', reason: `the image is only ${meta.width}x${meta.height}` };
    if (requirement.hero && longSide < cfg.minHeroLongSide) return { ok: false, code: 'low_resolution', reason: `a hero image needs at least ${cfg.minHeroLongSide}px on its long side (this is ${longSide})` };
    const ratio = meta.width / meta.height;
    if (ratio < 0.4 || ratio > 3.4) return { ok: false, code: 'bad_aspect', reason: `the aspect ratio ${ratio.toFixed(2)} does not fit a page section` };
    if (requirement.orientation === 'landscape' && ratio < 1) return { ok: false, code: 'bad_aspect', reason: 'the slot needs a landscape picture' };
    if (requirement.orientation === 'portrait' && ratio > 1.15) return { ok: false, code: 'bad_aspect', reason: 'the slot needs a portrait picture' };
    // A full decode (not just the header) proves the pixels are really there.
    prepared = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: cfg.maxOutputWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const stats = await sharp(prepared.data).stats();
    const spread = stats.channels.slice(0, 3).reduce((sum, ch) => sum + ch.stdev, 0) / 3;
    if (spread < 6) return { ok: false, code: 'blank_image', reason: 'the picture is blank or a flat colour' };
    if (prepared.data.length < 6000) return { ok: false, code: 'invalid_image', reason: 'the decoded picture is too small to be a photograph' };
  } catch (error) {
    return { ok: false, code: 'invalid_image', reason: `the file could not be decoded (${String(error.message).slice(0, 80)})` };
  }
  const sha256 = createHash('sha256').update(prepared.data).digest('hex');
  const hash = await averageHash(prepared.data).catch(() => '');
  if (taken.sha256.has(sha256) || (hash && taken.hashes.some((other) => hamming(other, hash) <= 5))) return { ok: false, code: 'duplicate', reason: 'the same picture is already used on this site' };
  return { ok: true, buffer: prepared.data, meta: { width: prepared.info.width, height: prepared.info.height, bytes: prepared.data.length, mime: 'image/webp', sha256, hash, aspect: Number((prepared.info.width / prepared.info.height).toFixed(3)) } };
}

module.exports = { verifyAndPrepare, relevanceOf, rejectCandidate, coreTokens, averageHash, hamming, WATERMARK_HOSTS };
