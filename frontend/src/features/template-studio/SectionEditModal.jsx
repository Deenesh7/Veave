import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X, Sparkles, ImagePlus, ImageOff, Film, Layers } from 'lucide-react';
import { useTemplateStudioStore, MEDIA_TYPES } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { PrimaryButton, GhostButton, Spinner, ink, muted, line } from './ui';
import VoiceInputButton from './VoiceInputButton';
import { sectionEditScript } from './sectionEditScripts';
import { sectionOutline } from './sectionOutline';
import { pagePhotos, matchSection, parseYouTubeUrl } from './panelLogic';
import { useImageSrc } from './imageUtils';
import { IMAGE_BUTTON_SCRIPT, YOUTUBE_STILL_SCRIPT } from './previewScripts';
import ImageChangeModal from './ImageChangeModal';

const MAX_TEXT = 4000;
// What the owner may type: the rest of the 4000 characters is room for the section's name and the notes put around it.
const TYPED_MAX = MAX_TEXT - 500;
const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pad = (n) => String(n).padStart(2, '0');

// The page of the popup: the real styles of the website and only this section, with its text editable in place.
function buildDocument(payload, { youtube = false } = {}) {
  return `<!doctype html><html class="${esc(payload.htmlClass)}"><head><meta charset="utf-8">${payload.head}
<style>html,body{margin:0;background:transparent}[data-studio-edit]{outline:1px dashed rgba(94,123,95,.65);outline-offset:2px;cursor:text;min-width:1ch}[data-studio-edit]:hover{background:rgba(94,123,95,.08)}[data-studio-edit]:focus{outline:2px solid #5E7B5F;background:rgba(94,123,95,.12)}[style*="opacity: 0"]:not([data-veave-bg] *){opacity:1!important}${youtube ? 'iframe[src*="youtube"]{display:none!important}' : ''}</style></head>
<body class="${esc(payload.bodyClass)}"><div id="studio-edit-root">${payload.html}</div><script>(${sectionEditScript.toString()})();</script>${IMAGE_BUTTON_SCRIPT}${youtube ? '' : YOUTUBE_STILL_SCRIPT}</body></html>`;
}

/**
 * The popup for ONE section: it shows only that section, its text can be typed over, and under it is the AI instruction bar.
 * "Save" first saves the typed text (each text is replaced exactly where it is written in the source), then, if there is an
 * instruction, sends it to the AI limited to this section (every other section is kept exactly as it is).
 */
/** A small picture chip: the photo that will be used in this section, with a button to take it out again. */
function PhotoChip({ siteId, image, disabled, onRemove }) {
  const { src, failed } = useImageSrc(siteId, image, { version: 'original', skip: image.kind === 'video' || image.kind === 'youtube' });
  return (
    <span className={`relative inline-flex h-12 w-12 shrink-0 overflow-hidden rounded-md border ${line} bg-[#EFEBE1]`} title={image.name}>
      {image.kind === 'youtube' ? <img src={`https://i.ytimg.com/vi/${image.youtubeId}/default.jpg`} alt="YouTube video" draggable={false} className="h-full w-full object-cover" /> : image.kind === 'video' ? <span className="flex h-full w-full items-center justify-center bg-[#2B2823] text-white"><Film className="h-4 w-4" aria-hidden="true" /></span> : src ? <img src={src} alt={image.alt || image.name} draggable={false} className="h-full w-full object-cover" /> : <span className={`flex h-full w-full items-center justify-center ${muted}`}>{failed || !image.id ? <ImageOff className="h-4 w-4" /> : <Spinner className="h-3 w-3" />}</span>}
      <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove photo ${image.name}`} className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 disabled:opacity-50"><X className="h-2.5 w-2.5" /></button>
    </span>
  );
}

export default function SectionEditModal({ payload, onClose }) {
  const store = useTemplateStudioStore();
  const { activeSiteId, activePageId, pageSections, job, regenerate, cancelJob, busy, flash, previewKey, images, selection, uploads, uploadFiles, toggleImage, clearSelection } = store;
  const running = job && !['completed', 'failed', 'cancelled'].includes(job.status);
  const sections = Array.isArray(pageSections[activePageId]) ? pageSections[activePageId] : [];
  const [edits, setEdits] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(false);
  const frame = useRef(null);
  const fileInput = useRef(null);
  const chosenPhotos = pagePhotos((activePageId && selection[activePageId]) || {}, images).ids.map((id) => images.find((image) => image.id === id));
  const pageUploads = uploads.filter((item) => item.pageId === activePageId && (item.status === 'queued' || item.status === 'uploading' || item.status === 'error'));
  const uploading = pageUploads.some((item) => item.status === 'queued' || item.status === 'uploading');
  const [imageEdit, setImageEdit] = useState(null);   // a picture of this section opened with its image button
  const [bgPicker, setBgPicker] = useState(false);     // choosing a picture or video to play behind this section
  const [bgItems, setBgItems] = useState([]);           // the backgrounds this section has now (several play one after the other)
  const [bgBusy, setBgBusy] = useState(false);
  const [reloading, setReloading] = useState(0);       // bumped after a picture was swapped: the section is read again from the rebuilt website
  const [applying, setApplying] = useState(false); // the AI is changing this section; the popup stays open on it until that is done
  const [fresh, setFresh] = useState(null);         // the section as it is after the AI changed it: { html, head, htmlClass, bodyClass }
  const [updated, setUpdated] = useState(false);
  const startKey = useRef(previewKey);
  const current = useMemo(() => (fresh ? { ...payload, ...fresh } : payload), [payload, fresh]);

  // Which section of the Content column this is (its number is what the AI is told, and what keeps every other section locked).
  // Once known it is kept: after the AI renames the section's heading the new name may not be found in the list right away.
  const known = useRef(null);
  const match = useMemo(() => {
    const key = `${payload.domId || ''}|${payload.name || ''}|${payload.index ?? ''}`;
    if (known.current?.key !== key) known.current = null; // another section was opened
    const found = matchSection(sections, { domId: payload.domId || '', name: payload.name || '', index: Number.isInteger(payload.index) ? payload.index : -1, html: payload.html || '' });
    // The preview and the server name a section differently: when both count the same number of blocks, the position tells which it is.
    const byPosition = found < 0 && Number.isInteger(payload.index) && payload.index >= 0 && payload.total > 0 && payload.total === sections.length ? payload.index : -1;
    const at = found >= 0 ? found : byPosition;
    if (at >= 0) known.current = { key, number: at + 1, item: sections[at] };
    return known.current;
  }, [payload, sections]);
  const title = match?.item?.name || payload.name || 'This section';

  // The sandboxed section frame cannot start YouTube, so the pop-up plays it itself, behind the (see-through) frame.
  const youtubeId = bgItems.find((item) => item.kind === 'youtube')?.youtubeId || '';
  const doc = useMemo(() => buildDocument(current, { youtube: Boolean(youtubeId) }), [current, youtubeId]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data || {};
      if (data.type === 'sec-edit-change') setEdits(Array.isArray(data.edits) ? data.edits.map((item) => ({ old: String(item.old || ''), next: String(item.next || '') })) : []);
      if (data.type === 'sec-edit-height') setHeight(Math.max(120, Math.min(Number(data.height) || 160, 4000)));
      if (data.type === 'sec-edit-ready') setReady(true);
      if (data.type === 'studio-image-edit') setImageEdit({ src: String(data.src || ''), alt: String(data.alt || ''), width: Number(data.width) || 0, height: Number(data.height) || 0 });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // While the popup is open, the same section is the only one that stays clear in the page behind it.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('studio-focus-sections', { detail: { sections: [{ name: title, domId: payload.domId || null }] } }));
    return () => window.dispatchEvent(new CustomEvent('studio-focus-sections', { detail: { sections: [] } }));
  }, [title, payload.domId]);

  // When the job ends: on success, wait for the preview to reload and read this same section again, so the popup shows the new result.
  useEffect(() => {
    if (!applying || !job) return undefined;
    if (job.status === 'failed' || job.status === 'cancelled') { setApplying(false); setProblems([{ text: title, reason: job.status === 'cancelled' ? 'Cancelled. Nothing was changed.' : (job.error || 'The section was not changed.') }]); return undefined; }
    if (job.status !== 'completed' || previewKey === startKey.current) return undefined;
    let stop = false;
    const read = () => new Promise((resolve) => {
      const key = `${Date.now()}-${Math.random()}`;
      const on = (event) => { if (event.detail?.key === key) { window.removeEventListener('studio-section-html', on); clearTimeout(timer); resolve(event.detail.html ? event.detail : null); } };
      const timer = setTimeout(() => { window.removeEventListener('studio-section-html', on); resolve(null); }, 1200);
      window.addEventListener('studio-section-html', on);
      window.dispatchEvent(new CustomEvent('studio-get-section', { detail: { key, domId: payload.domId || '', name: payload.name || '' } }));
    });
    (async () => {
      // The preview reloads after a save: an answer that is still the old section (same markup as before) comes from the old page, so keep asking.
      const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const before = squash(current.html);
      let found = null;
      for (let attempt = 0; attempt < 16 && !stop; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 900 : 700));
        const got = await read();
        if (got) { found = got; if (squash(got.html) !== before) break; }
      }
      if (stop) return;
      if (found) { setFresh({ html: found.html, head: found.head || payload.head, htmlClass: found.htmlClass ?? payload.htmlClass, bodyClass: found.bodyClass ?? payload.bodyClass }); setReady(false); setEdits([]); setPrompt(''); setUpdated(true); }
      setApplying(false);
    })();
    return () => { stop = true; };
  }, [applying, job?.status, previewKey]);

  // A swapped picture: once the website has rebuilt, the section is read again so the popup shows the new picture.
  useEffect(() => {
    if (!reloading) return undefined;
    let stop = false;
    const read = () => new Promise((resolve) => {
      const key = `${Date.now()}-${Math.random()}`;
      const on = (event) => { if (event.detail?.key === key) { window.removeEventListener('studio-section-html', on); clearTimeout(timer); resolve(event.detail.html ? event.detail : null); } };
      const timer = setTimeout(() => { window.removeEventListener('studio-section-html', on); resolve(null); }, 1200);
      window.addEventListener('studio-section-html', on);
      window.dispatchEvent(new CustomEvent('studio-get-section', { detail: { key, domId: payload.domId || '', name: payload.name || '' } }));
    });
    (async () => {
      const squash = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const before = squash(current.html);
      for (let attempt = 0; attempt < 40 && !stop; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 900 : 700));
        const got = await read();
        if (got && squash(got.html) !== before) { setFresh({ html: got.html, head: got.head || payload.head, htmlClass: got.htmlClass ?? payload.htmlClass, bodyClass: got.bodyClass ?? payload.bodyClass }); setReady(false); setEdits([]); break; }
      }
    })();
    return () => { stop = true; };
  }, [reloading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !saving && !applying && !imageEdit && !bgPicker) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving, applying, imageEdit, bgPicker]);

  // A YouTube link typed or pasted into the instruction bar becomes the section's background (shown as a chip) instead of staying as text.
  const youtubeIn = (text) => {
    const match = /(?:https?:\/\/)?(?:[\w-]+\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/\S+/i.exec(text || '');
    const parsed = match ? parseYouTubeUrl(match[0]) : null;
    return parsed?.ok ? { id: parsed.id, raw: match[0] } : null;
  };
  // The section the backgrounds belong to. When the list of sections was not matched yet it is loaded and matched again here.
  const findItem = async () => {
    if (match?.item) return match.item;
    if (located) return located;
    const state = useTemplateStudioStore.getState();
    let list = Array.isArray(state.pageSections[state.activePageId]) ? state.pageSections[state.activePageId] : [];
    if (!list.length) { await state.loadSections?.(state.activePageId); const next = useTemplateStudioStore.getState(); list = Array.isArray(next.pageSections[next.activePageId]) ? next.pageSections[next.activePageId] : []; }
    const found = matchSection(list, { domId: payload.domId || '', name: payload.name || '', index: Number.isInteger(payload.index) ? payload.index : -1, html: payload.html || '' });
    const at = found >= 0 ? found : (Number.isInteger(payload.index) && payload.index >= 0 && payload.total > 0 && payload.total === list.length ? payload.index : -1);
    if (at >= 0) return list[at];
    // The names in the preview and in the code do not agree: the section is found by the texts it shows.
    try {
      const doc = new DOMParser().parseFromString(`<div>${payload.html || ''}</div>`, 'text/html');
      const texts = [...doc.querySelectorAll('h1,h2,h3,h4,p,a,button,li,span')].filter((node) => !node.querySelector('h1,h2,h3,h4,p,a,button,li,span')).map((node) => node.textContent.replace(/\s+/g, ' ').trim()).filter((text) => text.length >= 4).sort((x, y) => y.length - x.length);
      const res = await templateSiteService.locateSection(state.activeSiteId, state.activePageId, texts.slice(0, 12));
      const found = res.data?.section;
      return found ? (list.find((item) => item.id === found.id) || { id: found.id, name: found.name }) : null;
    } catch { return null; }
  };
  const [located, setLocated] = useState(null);
  useEffect(() => { if (match?.item) return undefined; let stop = false; findItem().then((item) => { if (!stop) setLocated(item); }); return () => { stop = true; }; }, [match?.item, payload.html]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionId = match?.item?.id || located?.id;
  useEffect(() => {
    if (!sectionId) return undefined;
    let stop = false;
    useTemplateStudioStore.getState().getSectionBackground(sectionId).then((items) => { if (!stop) setBgItems(items); });
    return () => { stop = true; };
  }, [sectionId, reloading]);

  // A background of the section as a library entry (for its small picture); a file that is no longer in the library gets a plain placeholder.
  const backgroundChip = (item) => {
    if (item.kind === 'youtube') return { ...item, id: `youtube:${item.youtubeId}`, name: 'YouTube video' };
    const entry = images.find((image) => image.path === item.path || `/${image.path}` === item.path || image.path === `/${item.path}`);
    return entry ? { ...entry, kind: item.kind === 'video' ? 'video' : entry.kind } : { ...item, id: null, name: String(item.path || '').split('/').pop() };
  };
  const sameMedia = (x, y) => (x.kind === 'youtube' ? y.kind === 'youtube' && x.youtubeId === y.youtubeId : x.kind !== 'youtube' && x.path === y.path);
  const toItem = (media) => (media.kind === 'youtube' ? { kind: 'youtube', youtubeId: media.youtubeId, overlay: media.overlay || 'dark' } : { kind: media.kind === 'video' ? 'video' : 'image', path: media.path, overlay: media.overlay || 'dark', name: media.name, id: media.id });
  // Puts the whole list behind the section at once (no AI). An empty list takes the background away.
  const applyBackgrounds = async (list, done) => {
    const item = await findItem();
    if (!item) { setProblems([{ text: 'Background', reason: 'This section could not be found in the page. Close this window and open the section again.' }]); return; }
    setBgBusy(true);
    setProblems([]);
    const result = await useTemplateStudioStore.getState().setSectionBackground(item.id, list.length ? list : null);
    setBgBusy(false);
    if (result.ok) { setBgItems(list); if (list.length) setReloading((n) => n + 1); else stripBackground(); setUpdated(true); flash('success', done); }
    else setProblems([{ text: 'Background', reason: result.error }]);
  };
  // Taking the background away: the pop-up drops the wrapper and its layer at once, without waiting for the page behind to rebuild.
  const stripBackground = () => {
    const doc = new DOMParser().parseFromString(`<body>${current.html || ''}</body>`, 'text/html');
    doc.querySelectorAll('[data-veave-bg-host]').forEach((host) => {
      host.querySelectorAll(':scope > [data-veave-bg]').forEach((layer) => layer.remove());
      host.replaceWith(...Array.from(host.childNodes));
    });
    setFresh({ html: doc.body.innerHTML, head: current.head, htmlClass: current.htmlClass, bodyClass: current.bodyClass });
    setReady(false); setEdits([]);
  };
  // A chosen background (picture, uploaded video or YouTube link, one or several) is added to the ones the section already has and put behind it at once; it never goes through the instruction bar.
  const chooseBackground = async (media) => {
    if (!media || saving || applying || running || bgBusy) return;
    const picked = (Array.isArray(media) ? media : [media]).map(toItem);
    const overlay = picked[0].overlay;
    const kept = bgItems.filter((old) => !picked.some((item) => sameMedia(old, item))).map((old) => ({ ...old, overlay }));
    await applyBackgrounds([...kept, ...picked].slice(0, 8), picked.length > 1 || kept.length ? 'The backgrounds were applied. They play one after the other.' : 'The background was applied to this section.');
  };
  const removeBackground = (index) => applyBackgrounds(bgItems.filter((_, i) => i !== index), bgItems.length > 1 ? 'The background was removed.' : 'The background was removed from this section.');
  const changePrompt = (value) => {
    const found = youtubeIn(value);
    if (!found) { setPrompt(value); return; }
    chooseBackground({ kind: 'youtube', id: `youtube:${found.id}`, youtubeId: found.id, url: found.raw, name: 'YouTube video', overlay: 'dark' });
    setPrompt(value.replace(found.raw, '').replace(/\s{2,}/g, ' ').trimStart());
  };

  const changed = edits.filter((item) => item.next !== item.old);
  const canSave = !saving && !applying && !running && !busy.regenerate && !uploading && (changed.length > 0 || prompt.trim().length > 0 || chosenPhotos.length > 0);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setProblems([]);
    const failed = [];
    const saved = [];
    for (const item of changed) {
      try { await templateSiteService.editText(activeSiteId, activePageId, { oldText: item.old, newText: item.next }); saved.push(item); }
      catch (error) { failed.push({ text: item.old, reason: apiMessage(error, 'The text could not be saved.') }); }
    }
    if (saved.length) { useTemplateStudioStore.setState((state) => ({ previewKey: state.previewKey + 1 })); useTemplateStudioStore.getState().loadRevisions?.(activePageId); }
    let started = true;
    const text = prompt.trim() || (chosenPhotos.length ? `Use the uploaded photo${chosenPhotos.length === 1 ? '' : 's'} in this section where ${chosenPhotos.length === 1 ? 'it fits' : 'they fit'} best, replacing the current picture if there is one.` : '');
    if (text) {
      const lead = match ? `In section ${pad(match.number)} ("${String(title).replace(/"/g, "'")}"): ` : `In the section "${String(title).replace(/"/g, "'")}": `;
      const notes = saved.length ? `\n\n(The owner already typed these changes into this section by hand. Keep them exactly as written (a deleted text stays deleted): ${saved.map((item) => (item.next ? `"${item.old}" became "${item.next}"` : `"${item.old}" was deleted`)).join('; ')}.)` : '';
      const head = `${lead}${text}${notes}`.slice(0, MAX_TEXT - 300);
      // What the section shows NOW: after an earlier AI change in this pop-up that is the new markup, not the one it opened with.
      const outline = sectionOutline(current.html, saved, Math.max(0, Math.min(1800, MAX_TEXT - head.length - 200)));
      const context = outline ? `\n\nSECTION CONTENT (what the visitor sees in this section right now, with the typed changes applied; for reference, change only what the instruction asks):\n${outline}` : '';
      const instruction = `${head}${context}`.slice(0, MAX_TEXT);
      startKey.current = useTemplateStudioStore.getState().previewKey;
      // A video plays behind the section it is given to; a picture is placed in it.
      const photoEntries = chosenPhotos.map((image) => (image.kind === 'video'
        ? { path: image.path, placement: 'background', note: `Play this video as the background of the section "${String(title).replace(/"/g, "'")}" (only that section)` }
        : { path: image.path, placement: 'section', note: `For the section "${String(title).replace(/"/g, "'")}"` }));
      started = await regenerate(instruction, photoEntries, title);
      if (started) { clearSelection?.(); setApplying(true); setUpdated(false); }
    }
    setSaving(false);
    if (failed.length) { setProblems(failed); if (saved.length || !started) { setEdits((list) => list.filter((item) => failed.some((f) => f.text === item.old))); } return; }
    if (started && !text) { if (saved.length) flash('success', saved.length === 1 ? 'The text was saved.' : `${saved.length} texts were saved.`); onClose(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Edit section ${title}`}>
      <div className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-xl bg-[#FBF9F4] shadow-2xl">
        <div className={`flex items-center gap-3 border-b ${line} px-4 py-3`}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E7B5F] text-white"><Pencil className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className={`truncate text-sm font-semibold ${ink}`}>Edit section{match ? ` ${pad(match.number)}` : ''}: {title}</h3>
            <p className={`text-[11px] ${muted}`}>{applying ? 'The AI is changing this section. The rest of the page is not touched.' : 'Only this section is shown. Click any text to type over it, or hover a picture to change it.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving || applying} aria-label="Close" className={`rounded p-1 ${muted} hover:bg-[#EAE5D9] disabled:opacity-50`}><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#EFEBE1] p-3">
          <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5">
            <div className="relative">
              {youtubeId ? (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-[#2B2823]" style={{ containerType: 'size' }}>
                  <iframe key={youtubeId} title="" tabIndex={-1} allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin"
                    src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=1&loop=1&playlist=${youtubeId}&start=0&controls=0&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0`}
                    style={{ position: 'absolute', top: '50%', left: '50%', width: 'max(100cqw, 177.78cqh)', height: 'max(100cqh, 56.25cqw)', maxWidth: 'none', transform: 'translate(-50%, -50%)', border: 0, pointerEvents: 'none' }} />
                </div>
              ) : null}
              <iframe ref={frame} title={`Section ${title}`} srcDoc={doc} allow="autoplay; encrypted-media" sandbox="allow-scripts" style={{ height }} className={`relative block w-full border-0 ${youtubeId ? 'bg-transparent' : 'bg-white'} transition-opacity ${applying ? 'opacity-40 blur-[5px]' : ''}`} />
              {applying ? (
                <div className="absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
                  <span className={`flex items-center gap-2 rounded-full border ${line} bg-[#FBF9F4]/95 px-3 py-1.5 text-xs shadow ${ink}`}><Spinner className="h-3 w-3 text-[#5E7B5F]" />{job?.stepName || 'Updating this section…'}</span>
                </div>
              ) : null}
            </div>
          </div>
          {updated && !applying ? <p role="status" className="mt-2 text-center text-xs font-medium text-[#3F5E41]">This section was updated and saved.</p> : null}
          {!ready ? <p className={`mt-2 text-center text-xs ${muted}`}>Loading the section…</p> : null}
        </div>

        <div className={`space-y-3 border-t ${line} bg-white px-4 py-3`}>
          {changed.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Your text changes">
              {changed.map((item) => (
                <li key={item.old} className="max-w-full truncate rounded-full bg-[#E8F0E8] px-2.5 py-0.5 text-[11px] font-medium text-[#3F5E41]" title={item.next ? `${item.old} → ${item.next}` : `Deleted: ${item.old}`}>{item.next ? <>Changed: “{item.old.slice(0, 28)}{item.old.length > 28 ? '…' : ''}” → “{item.next.slice(0, 28)}{item.next.length > 28 ? '…' : ''}”</> : <>Deleted: “{item.old.slice(0, 28)}{item.old.length > 28 ? '…' : ''}”</>}</li>
              ))}
            </ul>
          ) : null}
          {problems.length ? (
            <div role="alert" className="space-y-1 rounded-md border border-[#E2DCCF] bg-[#FBF9F4] p-2.5 text-xs text-[#5C564B]">
              {problems.map((item) => <p key={item.text}><b>“{item.text.slice(0, 40)}”</b>: {item.reason}</p>)}
              <p>Describe those changes in the instruction below and the AI will make them in this section.</p>
            </div>
          ) : null}
          <div className={`rounded-md border ${line} bg-white focus-within:border-[#5E7B5F] focus-within:ring-1 focus-within:ring-[#5E7B5F]`}>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E2DCCF] px-2.5 py-2">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>Section</span>
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#E8F0E8] py-0.5 pl-1 pr-2 text-[11px] font-medium text-[#3F5E41]">
                {match ? <span className="flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-[#5E7B5F] px-1 font-mono text-[10px] font-semibold text-white">{pad(match.number)}</span> : null}
                <span className="max-w-[16rem] truncate">{title}</span>
              </span>
            </div>
            {bgItems.length ? (
              <div className={`flex flex-wrap items-center gap-2 border-b ${line} px-2.5 py-2`} aria-label="Backgrounds of this section">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>{bgItems.length > 1 ? 'Backgrounds' : 'Background'}</span>
                {bgItems.map((item, index) => (
                  <PhotoChip key={`${item.path || item.youtubeId}-${index}`} siteId={activeSiteId} image={backgroundChip(item)} disabled={saving || applying || running || bgBusy} onRemove={() => removeBackground(index)} />
                ))}
                <span className={`max-w-[18rem] truncate text-[11px] ${muted}`}>{bgBusy ? 'Updating…' : bgItems.length > 1 ? 'They play one after the other behind this section' : bgItems[0].kind === 'youtube' ? 'YouTube video plays behind this section' : bgItems[0].kind === 'video' ? 'Video plays behind this section' : 'Picture behind this section'}</span>
                {bgItems.length > 1 ? <button type="button" disabled={saving || applying || running || bgBusy} onClick={() => applyBackgrounds([], 'The backgrounds were removed from this section.')} className="ml-auto text-[11px] font-medium text-[#A4493A] underline underline-offset-2 disabled:opacity-50">Remove all</button> : null}
              </div>
            ) : null}
            {chosenPhotos.length || pageUploads.length ? (
              <div className={`flex flex-wrap items-center gap-2 border-b ${line} px-2.5 py-2`} aria-label="Photos for this section">
                {chosenPhotos.map((image) => <PhotoChip key={image.id} siteId={activeSiteId} image={image} disabled={saving || applying || running} onRemove={() => toggleImage(image.id, false, activePageId)} />)}
                {pageUploads.map((item) => (
                  <span key={item.id} className={`inline-flex max-w-[11rem] items-center gap-1.5 rounded-md border ${line} bg-[#FBF9F4] px-2 py-1 text-[11px] ${item.status === 'error' ? 'text-[#A4493A]' : muted}`} title={item.error || item.name}>
                    {item.status === 'error' ? <ImageOff className="h-3 w-3 shrink-0" /> : <Spinner className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{item.status === 'error' ? item.error : `${item.name} ${Math.round((item.progress || 0) * 100)}%`}</span>
                    {item.status === 'error' ? <button type="button" onClick={() => useTemplateStudioStore.getState().dismissUpload(item.id)} aria-label="Dismiss" className="shrink-0"><X className="h-3 w-3" /></button> : null}
                  </span>
                ))}
              </div>
            ) : null}
            <textarea value={prompt} onChange={(event) => changePrompt(event.target.value)} onPaste={(event) => { const pasted = event.clipboardData?.getData('text') || ''; if (youtubeIn(pasted)) { event.preventDefault(); changePrompt(`${prompt}${prompt && !/\s$/.test(prompt) ? ' ' : ''}${pasted}`); } }} maxLength={TYPED_MAX} rows={3} disabled={saving || applying || running} aria-label="AI instruction for this section"
              className={`block w-full resize-none rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-relaxed ${ink} placeholder:text-xs placeholder:text-[#A59E90] focus:outline-none focus:ring-0`} />
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="flex items-center gap-2">
                <button type="button" disabled={saving || applying || running} onClick={() => setPrompt('Remove this section completely from the page, including anything that only it used and any link or button that points to it. Do not change any other section.')} className="inline-flex items-center gap-1 rounded-full border border-[#E2DCCF] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#5C564B] hover:bg-[#EFEBE1] disabled:opacity-50"><X className="h-3 w-3" />Remove this section</button>
                <span className={`text-[11px] ${muted}`}>{prompt.length}/{TYPED_MAX}</span>
              </span>
              <span className="flex items-center gap-1">
              <button type="button" disabled={saving || applying || running || bgBusy} onClick={() => setBgPicker(true)} title="Set pictures or videos as the background of this section" className={`inline-flex h-7 items-center gap-1 rounded-full border ${line} bg-white px-2.5 text-[11px] font-medium ${muted} hover:bg-[#EFEBE1] disabled:opacity-50`}>{bgBusy ? <Spinner className="h-3 w-3" /> : <Layers className="h-3.5 w-3.5" />}{bgItems.length ? `Background (${bgItems.length})` : 'Background'}</button>
              <input ref={fileInput} type="file" multiple accept={MEDIA_TYPES.join(',')} className="hidden" aria-label="Choose photos or videos for this section" onChange={(event) => { uploadFiles(event.target.files); event.target.value = ''; }} />
              <button type="button" disabled={saving || applying || running} onClick={() => fileInput.current?.click()} aria-label="Add a photo" title="Add a photo to this section" className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${line} bg-white ${muted} hover:bg-[#EFEBE1] disabled:opacity-50`}><ImagePlus className="h-3.5 w-3.5" /></button>
              <VoiceInputButton disabled={saving || applying || running} onText={(text) => setPrompt((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`.slice(0, TYPED_MAX))} />
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className={`text-[11px] leading-relaxed ${muted}`}>{applying ? 'Updating this section. This window stays open until it is done.' : running ? 'A page is being generated. Wait for it to finish.' : 'Typed text is saved first. The AI then gets the content of this section together with your instruction and changes only this section; every other section stays exactly as it is.'}</p>
            <div className="flex justify-end gap-2">
              {applying ? <GhostButton onClick={cancelJob} disabled={job?.status === 'committing'}>Stop</GhostButton> : <GhostButton onClick={onClose} disabled={saving}>{updated ? 'Close' : 'Cancel'}</GhostButton>}
              <PrimaryButton onClick={save} disabled={!canSave}>{saving ? <Spinner /> : <Sparkles className="h-4 w-4" />}{prompt.trim() || chosenPhotos.length ? (changed.length ? 'Save and apply AI' : 'Apply with AI') : 'Save text'}</PrimaryButton>
            </div>
          </div>
        </div>
      </div>
      {imageEdit ? <ImageChangeModal key={imageEdit.src} target={imageEdit} zClass="z-[90]" onClose={() => setImageEdit(null)} onDone={() => setReloading((n) => n + 1)} onVideo={(media) => chooseBackground(media || null)} /> : null}
      {bgPicker ? <ImageChangeModal key="bg" target={{ src: '' }} mode="background" zClass="z-[90]" onClose={() => setBgPicker(false)} onPick={(media) => chooseBackground(media || null)} /> : null}
    </div>,
    document.body
  );
}
