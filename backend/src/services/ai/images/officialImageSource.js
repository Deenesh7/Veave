/**
 * Official image source: pictures that the organisation's OWN pages already show, matched to the sections they belong to.
 *
 * Image discovery searches stock libraries and the web for a subject. For a section about an organisation's history, campus, hospital or
 * research, the best picture is the one on its own website next to that very subject, so it is looked for first:
 *   1. the crawled pages' pictures are scored against each section's subject by their alt text, caption, file name and the heading
 *      they sit under (never by position or size alone),
 *   2. the best candidates are downloaded and verified like every other picture (decoded, big enough, not blank, not a duplicate of
 *      anything the job already holds),
 *   3. each becomes an asset marked as official, with its source page, so the relevance validator treats it as the organisation's own.
 * Nothing is invented: a section with no matching official picture stays with whatever image discovery found, or goes text-led.
 */
const { overlap, terms } = require('../deep/deepPlanner');
const { verifyAndPrepare } = require('./imageVerification');
const { imageConfig } = require('./imageConfig');
const { findDuplicate } = require('./imageDuplicateDetector');
const { ILLUSTRATION } = require('./imageRelevanceValidator');

const SKIP = /logo|icon|sprite|avatar|placeholder|pixel|banner-ad|advert|sponsor|badge|favicon|spacer|loader|arrow|button/i;
const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36) || 'official';

/** What a section's picture should show, as words to match against the picture's own description. */
function sectionSubject(page, section) {
  return `${section.heading || ''} ${(section.images || []).map((need) => `${need.subject || ''} ${need.query || ''}`).join(' ')} ${section.purpose || ''}`;
}

/** Sections that can use a picture of the organisation itself (not a person: portraits have their own resolver). */
function wantingSections(plan) {
  const out = [];
  for (const page of plan.pages) for (const section of page.sections) {
    if ((section.images || []).some((need) => need.role === 'portrait' && need.entity)) continue;
    if (!section.images?.length && !/timeline|editorial|three-column-cards|alternating/.test(section.layout)) continue;
    if (/cta-band|contact-split|statistics|faq-list|page-intro/.test(section.layout)) continue;
    out.push({ page, section });
  }
  return out;
}

/** Candidates from the crawled pages for one section, best first. */
function candidatesFor({ page, section }, pages, { used = new Set(), min = 0.34 } = {}) {
  const subject = sectionSubject(page, section);
  const out = [];
  for (const crawled of pages) {
    const pageTitleScore = overlap(subject, `${crawled.title} ${crawled.url.replace(/[-_/.:]+/g, ' ')}`);
    for (const image of crawled.images || []) {
      if (!image.src || used.has(image.src) || SKIP.test(image.src) || SKIP.test(image.alt || '')) continue;
      const label = `${image.alt || ''} ${image.title || ''} ${decodeURIComponent(String(image.src).split('/').pop() || '').replace(/[-_.]+/g, ' ')}`;
      if (ILLUSTRATION.test(label)) continue;
      const own = overlap(subject, label);
      // The picture's own description is the main evidence; the page it sits on only breaks ties.
      const score = own * 1 + pageTitleScore * 0.25;
      if (own >= min || (own > 0 && pageTitleScore >= 0.5 && terms(label).length >= 2)) out.push({ image, page: crawled, score, label });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * @param input { plan, pages, taken, registry?, download, siteName, jobId, signal, cfg, max }
 * @returns {{ assets, files, matched: [{ section, image, source }], skipped: [{ section, reason }] }}
 */
async function findOfficialAssets({ plan, pages = [], taken = { sha256: new Set(), hashes: [] }, registry = null, download, siteName = '', signal = null, cfg = imageConfig(), max = 8 } = {}) {
  const out = { assets: [], files: [], matched: [], skipped: [] };
  if (!pages.length || typeof download !== 'function') return out;
  const used = new Set();
  let counter = 0;
  for (const target of wantingSections(plan)) {
    if (out.assets.length >= max) break;
    signal?.throwIfAborted?.();
    const options = candidatesFor(target, pages, { used }).slice(0, 3);
    let placed = false;
    for (const option of options) {
      used.add(option.image.src);
      let buffer;
      try { buffer = await download(option.image.src, { signal }); } catch (error) { if (signal?.aborted) throw error; out.skipped.push({ section: target.section.heading, reason: `download failed (${String(error.message).slice(0, 60)})` }); continue; }
      const verified = await verifyAndPrepare(buffer, { orientation: null }, { cfg, taken });
      if (!verified.ok) { out.skipped.push({ section: target.section.heading, reason: verified.reason }); continue; }
      const id = `official-${slug(target.page.name)}-${slug(target.section.heading)}-${String(++counter).padStart(2, '0')}`;
      const path = `public/assets/images/${id}.webp`;
      const asset = {
        id, kind: 'official', page: target.page.name, route: target.page.route, section: target.section.heading, sectionId: target.section.id, category: 'feature', generic: false, hero: false,
        alt: String(option.image.alt || option.label).replace(/\s+/g, ' ').trim().slice(0, 160), aspect: `${Math.round(verified.meta.width / verified.meta.height * 10) / 10 >= 1.2 ? '4/3' : '1/1'}`,
        path, publicPath: `/${path.slice('public/'.length)}`, mime: 'image/webp', width: verified.meta.width, height: verified.meta.height, bytes: verified.meta.bytes, sha256: verified.meta.sha256, hash: verified.meta.hash,
        sourceUrl: option.image.src, sourcePage: option.page.url, provider: 'official', officialVerified: true, creator: '', license: 'as published by the organisation\'s own website', licenseUrl: '', query: sectionSubject(target.page, target.section).replace(/\s+/g, ' ').trim().slice(0, 90),
        status: 'verified', storage: 'pending_commit', url: `/${path.slice('public/'.length)}`, identity: { level: 'high', tier: 'official', host: new URL(option.page.url).hostname, via: ['the organisation\'s own page'] },
        requirementHints: { subject: option.label.slice(0, 120), sectionHeading: target.section.heading, sectionSummary: target.section.summary || '' }, evaluation: { mode: 'official-source', visuallyVerified: false, score: Math.round(option.score * 100) / 100 }
      };
      // Anything the job already holds (a stock picture selected earlier, a rejected one) is compared by file, look and subject.
      if (registry) { const dup = registry.check(asset, { page: target.page.name, section: target.section.heading }); if (!dup.ok) { out.skipped.push({ section: target.section.heading, reason: dup.duplicate.detail }); continue; } }
      taken.sha256.add(asset.sha256); if (asset.hash) taken.hashes.push(asset.hash);
      out.assets.push(asset);
      out.files.push({ path, content: verified.buffer.toString('base64'), language: 'binary', encoding: 'base64' });
      out.matched.push({ section: target.section.heading, page: target.page.name, image: option.image.src, source: option.page.url, score: asset.evaluation.score });
      placed = true;
      break;
    }
    if (!placed && !options.length) out.skipped.push({ section: target.section.heading, reason: 'no picture on the official pages describes this subject' });
  }
  return out;
}

module.exports = { findOfficialAssets, candidatesFor, wantingSections, sectionSubject };
