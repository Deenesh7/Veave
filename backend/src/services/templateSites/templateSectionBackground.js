/**
 * Puts a picture, an uploaded video or a YouTube video behind ONE section, straight into the page's code and without the AI. The section
 * (a <section> or a section component such as <Section>) is wrapped in a host that is positioned and clips, and the media is a single
 * layer behind everything in it (a real background, not a block of content), with an optional overlay so the text stays readable.
 * A layer added earlier is replaced, and passing no media takes it away again.
 */
const TemplateRevision = require('../../models/TemplateRevision');
const { getPage, idOf } = require('./templateSiteService');
const { assertNoRunningJob, changeFiles, undoFiles, bumpSite, extractSections, sectionBlocks, jsxElementEnd } = require('./templatePageService');
const { resolveAttachments } = require('./templateUploadService');
const { ValidationError } = require('../../utils/errors');

const OVERLAYS = { none: null, dark: 'rgba(0,0,0,0.45)', darker: 'rgba(0,0,0,0.65)', light: 'rgba(255,255,255,0.55)' };
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MARK = 'data-veave-bg';
const HOST = 'data-veave-bg-host';
const NEEDS_AI = 'This section is built in a way that cannot be changed directly. Describe the background in the instruction box and the AI will add it.';

const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

const SLOT_SECONDS = 8; // with several backgrounds each one is shown this long, then fades into the next
const FADE_SECONDS = 1;
const number = (value) => String(Math.round(value * 1000) / 1000);

/** One background's own element (a picture, a video that always starts from its first frame, or a YouTube video that starts from 0). */
function mediaFor(media) {
  if (media.kind === 'youtube') {
    const id = media.youtubeId;
    const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&start=0&controls=0&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0`;
    return `<iframe src="${src}" title="" tabIndex={-1} allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" style={{ position: 'absolute', top: '50%', left: '50%', width: 'max(100cqw, 177.78cqh)', height: 'max(100cqh, 56.25cqw)', maxWidth: 'none', transform: 'translate(-50%, -50%)', border: 0, pointerEvents: 'none' }} />`;
  }
  if (media.kind === 'video') {
    return `<video src="${attr(media.path)}" autoPlay muted loop playsInline preload="auto" tabIndex={-1} onLoadedData={(e) => { e.currentTarget.muted = true; e.currentTarget.currentTime = 0; e.currentTarget.play().catch(() => {}); }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />`;
  }
  return `<img src="${attr(media.path)}" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />`;
}

/** Plays a slide's video again from its first frame (and reloads a YouTube video so it starts from 0) each time the slide comes back. */
const RESTART = "(e) => { if (e.target !== e.currentTarget) return; const v = e.currentTarget.querySelector('video'); if (v) { v.currentTime = 0; v.play().catch(() => {}); } }";
const RESTART_YOUTUBE = "(e) => { if (e.target !== e.currentTarget) return; const v = e.currentTarget.querySelector('video'); if (v) { v.currentTime = 0; v.play().catch(() => {}); } const f = e.currentTarget.querySelector('iframe'); if (f) f.src = f.src; }";

/**
 * The layer's markup: one element holding the media (and the overlay). It is the first thing inside the host that wraps the section.
 * Takes one background or a list of them: a list is shown as a slideshow (each one fades into the next, then it starts over).
 */
function layerFor(input) {
  const list = (Array.isArray(input) ? input : [input]).filter(Boolean);
  const first = list[0];
  const many = list.length > 1;
  const overlay = Object.prototype.hasOwnProperty.call(OVERLAYS, first.overlay) ? OVERLAYS[first.overlay] : OVERLAYS.dark;
  const hasYoutube = list.some((media) => media.kind === 'youtube');
  const items = encodeURIComponent(JSON.stringify(list.map((media) => (media.kind === 'youtube' ? { kind: 'youtube', youtubeId: media.youtubeId, overlay: first.overlay } : { kind: media.kind, path: media.path, overlay: first.overlay }))));
  // The section's own background is made see-through (the host's direct child), otherwise it would hide the media behind it.
  let css = '.veave-bg-host > * { background: transparent !important; }';
  if (many) {
    const total = list.length * SLOT_SECONDS;
    const fade = (FADE_SECONDS / total) * 100;
    const hold = (SLOT_SECONDS / total) * 100;
    css += ` @keyframes veave-bg-fade-${list.length} { 0% { opacity: 0 } ${number(fade)}% { opacity: 1 } ${number(hold)}% { opacity: 1 } ${number(hold + fade)}% { opacity: 0 } 100% { opacity: 0 } }`;
  }
  const wrapper = `<div ${MARK}="${many ? 'multi' : first.kind}" ${MARK}-items="${items}" aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: -1, overflow: 'hidden', pointerEvents: 'none'${hasYoutube ? ", containerType: 'size'" : ''} }}><style>{'${css}'}</style>`;
  const inner = many
    ? list.map((media, index) => `<div style={{ position: 'absolute', inset: 0, opacity: 0, animation: 'veave-bg-fade-${list.length} ${list.length * SLOT_SECONDS}s linear ${index * SLOT_SECONDS}s infinite both' }} onAnimationStart={${RESTART}} onAnimationIteration={${hasYoutube ? RESTART_YOUTUBE : RESTART}}>${mediaFor(media)}</div>`).join('')
    : mediaFor(first);
  return `${wrapper}${inner}${overlay ? `<div style={{ position: 'absolute', inset: 0, background: '${overlay}' }} />` : ''}</div>`;
}

/** The backgrounds a layer (or the source around a section) currently holds, as [{ kind, path | youtubeId }]. */
function itemsOf(source, start) {
  const hostAt = source.slice(0, start).lastIndexOf(`<div ${HOST}`);
  if (hostAt < 0) return [];
  const layerAt = source.indexOf(`<div ${MARK}=`, hostAt);
  const layerEnd = layerAt >= 0 && layerAt < start ? jsxElementEnd(source, layerAt) : null;
  if (layerEnd === null || layerEnd > start || source.slice(layerEnd, start).trim()) return [];
  const layerText = source.slice(layerAt, layerEnd);
  const found = new RegExp(`${MARK}-items="([^"]*)"`).exec(layerText);
  if (!found) {
    // A layer put there before the list was recorded: read what it plays from its own markup.
    const youtube = /embed\/([A-Za-z0-9_-]{11})/.exec(layerText);
    if (youtube) return [{ kind: 'youtube', youtubeId: youtube[1] }];
    const video = /<video[^>]*\ssrc="([^"]+)"/.exec(layerText);
    if (video) return [{ kind: 'video', path: video[1].replace(/&amp;/g, '&') }];
    const image = /<img[^>]*\ssrc="([^"]+)"/.exec(layerText);
    return image ? [{ kind: 'image', path: image[1].replace(/&amp;/g, '&') }] : [];
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(found[1]));
    return Array.isArray(parsed) ? parsed.filter((item) => item && (item.kind === 'youtube' ? item.youtubeId : item.path)) : [];
  } catch { return []; }
}

const HOST_OPEN = `<div ${HOST} className="veave-bg-host" style={{ position: 'relative', isolation: 'isolate', overflow: 'hidden' }}>`;

/**
 * Puts `layer` behind the element (a <section> or a section component, however it is written) that starts at `start`: the element is
 * wrapped in a host that is positioned and clips, and the layer is the host's first child. An earlier layer is replaced; with no layer the
 * host is taken away again. Also clears a layer of the older kind that was placed inside the section's children.
 */
function setLayer(source, start, layer) {
  let text = source;
  let end = jsxElementEnd(text, start);
  if (end === null) throw new ValidationError(NEEDS_AI);
  const legacy = text.slice(start, end).indexOf(`<div ${MARK}=`);
  if (legacy >= 0) {
    const at = start + legacy;
    const legacyEnd = jsxElementEnd(text, at);
    if (legacyEnd === null) throw new ValidationError(NEEDS_AI);
    text = `${text.slice(0, at).replace(/[ \t]*\n?[ \t]*$/, '\n')}${text.slice(legacyEnd).replace(/^[ \t]*\n?/, '')}`;
    end = jsxElementEnd(text, start);
    if (end === null) throw new ValidationError(NEEDS_AI);
  }
  const hostAt = text.slice(0, start).lastIndexOf(`<div ${HOST}`);
  let host = null;
  if (hostAt >= 0) {
    const open = text.indexOf('>', hostAt) + 1;
    const layerAt = text.indexOf(`<div ${MARK}=`, open);
    const layerEnd = layerAt >= 0 && !text.slice(open, layerAt).trim() ? jsxElementEnd(text, layerAt) : null;
    const tail = text.slice(end);
    const closing = /^\s*<\/div>/.exec(tail);
    if (layerEnd !== null && !text.slice(layerEnd, start).trim() && closing) host = { hostAt, open, layerAt, layerEnd, closeAt: end + closing[0].length, closeStart: end + closing[0].indexOf('<') };
  }
  if (host) {
    if (layer) return `${text.slice(0, host.layerAt)}${layer}${text.slice(host.layerEnd)}`;
    return `${text.slice(0, host.hostAt)}${text.slice(start, end)}${text.slice(host.closeAt)}`;
  }
  if (!layer) return text;
  return `${text.slice(0, start)}${HOST_OPEN}\n${layer}\n${text.slice(start, end)}\n</div>${text.slice(end)}`;
}

function applyBackground(files, page, sectionId, layer) {
  const pageFile = files.find((entry) => entry.path === page.componentPath);
  if (!pageFile || typeof pageFile.content !== 'string') throw new ValidationError('The page file could not be read.');
  const item = extractSections(pageFile.content, { withRanges: true }).find((entry) => entry.id === sectionId);
  if (!item) throw new ValidationError('That section is no longer on the page. Refresh the list and try again.');
  if (!/^<[A-Za-z]/.test(pageFile.content.slice(item.index))) throw new ValidationError(NEEDS_AI);
  const content = setLayer(pageFile.content, item.index, layer);
  return { files: files.map((entry) => (entry.path === pageFile.path ? { ...entry, content } : entry)), name: item.name };
}

async function resolveOne(site, media) {
  const overlay = Object.prototype.hasOwnProperty.call(OVERLAYS, media?.overlay) ? media.overlay : 'dark';
  if (media?.kind === 'youtube') {
    if (!YOUTUBE_ID.test(String(media.youtubeId || ''))) throw new ValidationError('That YouTube link is not valid. Copy the link again from YouTube.');
    return { kind: 'youtube', youtubeId: media.youtubeId, overlay };
  }
  if (media?.kind === 'video' || media?.kind === 'image') {
    const [asset] = await resolveAttachments(site, [{ path: String(media.path || '') }]);
    if (!asset) throw new ValidationError('Choose a picture or video from your library.');
    return { kind: asset.kind === 'video' ? 'video' : 'image', path: asset.path, overlay };
  }
  throw new ValidationError('Choose a picture, a video or a YouTube link.');
}

const MAX_BACKGROUNDS = 8;

async function readPageSource(user, siteId, pageId) {
  const { site, page } = await getPage(user, siteId, pageId);
  const Project = require('../../models/Project');
  const project = await Project.findOne({ _id: site.projectId }, { files: 1 }).lean();
  const clean = (value) => String(value || '').replace(/^\/+/, '');
  const stored = (project?.files || []).find((file) => clean(file.path) === clean(page.componentPath) || file.path === page.componentPath);
  if (!stored) return '';
  const file = await require('../storage/s3BlobStorage').hydrateFile(stored);
  return String(file.content || '');
}

/** The backgrounds the section has now: [{ kind: 'youtube' | 'video' | 'image', youtubeId | path }]. */
async function getSectionBackground({ user, siteId, pageId, sectionId }) {
  const source = await readPageSource(user, siteId, pageId);
  const item = extractSections(source, { withRanges: true }).find((entry) => entry.id === sectionId);
  if (!item || !/^<[A-Za-z]/.test(source.slice(item.index))) return { items: [] };
  return { items: itemsOf(source, item.index) };
}

/**
 * Which section of the page holds the texts the owner sees in a section of the preview (used when the names of the preview and of the
 * code do not agree). The section whose code contains the most of the longest texts wins; null when nothing is found for sure.
 */
async function locateSection({ user, siteId, pageId, texts }) {
  const wanted = [...new Set((Array.isArray(texts) ? texts : []).map((text) => String(text || '').replace(/\s+/g, ' ').trim()).filter((text) => text.length >= 4))].slice(0, 12);
  if (!wanted.length) return { section: null };
  const source = await readPageSource(user, siteId, pageId);
  const list = extractSections(source, { withRanges: true });
  const squash = (value) => String(value || '').replace(/\s+/g, ' ');
  const scores = sectionBlocks(source).map((block) => {
    const haystack = squash(block.source);
    return { block, score: wanted.reduce((sum, text) => sum + (haystack.includes(text) ? text.length : 0), 0) };
  }).filter((entry) => entry.score > 0).sort((x, y) => y.score - x.score);
  if (!scores.length || (scores[1] && scores[1].score === scores[0].score)) return { section: null };
  const item = list[scores[0].block.number - 1];
  return { section: item ? { id: item.id, name: item.name } : null };
}

/** media: one background, a list of them (shown one after the other), or null / an empty list (take the background away). */
async function setSectionBackground({ user, siteId, pageId, sectionId, media }) {
  if (!sectionId || typeof sectionId !== 'string') throw new ValidationError('Choose the section.');
  const { site, page } = await getPage(user, siteId, pageId);
  const wanted = (Array.isArray(media) ? media : media ? [media] : []).slice(0, MAX_BACKGROUNDS);
  const resolved = [];
  for (const entry of wanted) resolved.push(await resolveOne(site, entry));
  await assertNoRunningJob(site._id, page._id);
  const layer = resolved.length ? layerFor(resolved) : null;
  const change = await changeFiles(site, (files) => applyBackground(files, page, sectionId, layer));
  if (!change.changed.length) return { changed: false };
  try {
    const updated = await bumpSite(site._id);
    const what = resolved.length > 1 ? `${resolved.length} backgrounds` : resolved[0]?.kind === 'youtube' ? 'a YouTube video background' : `a ${resolved[0]?.kind} background`;
    await TemplateRevision.create({
      siteId: site._id, pageId: null, userId: idOf(user), number: updated.revision, kind: 'section-background',
      instruction: `${resolved.length ? `Set ${what} on` : 'Removed the background of'} the section "${change.extra.name}" of ${page.name}`, files: change.changed, before: change.previous, siteRevision: updated.revision
    });
  } catch (error) {
    await undoFiles(site, change);
    throw error;
  }
  return { changed: true, name: change.extra.name };
}

module.exports = { setSectionBackground, getSectionBackground, locateSection, applyBackground, layerFor, setLayer, itemsOf };
