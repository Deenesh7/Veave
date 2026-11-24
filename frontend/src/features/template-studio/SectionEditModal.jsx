import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X, Sparkles, ImagePlus, ImageOff, Film } from 'lucide-react';
import { useTemplateStudioStore, MEDIA_TYPES } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { PrimaryButton, GhostButton, Spinner, ink, muted, line } from './ui';
import VoiceInputButton from './VoiceInputButton';
import { sectionEditScript } from './sectionEditScripts';
import { sectionOutline } from './sectionOutline';
import { pagePhotos, matchSection } from './panelLogic';
import { useImageSrc } from './imageUtils';

const MAX_TEXT = 4000;
// What the owner may type: the rest of the 4000 characters is room for the section's name and the notes put around it.
const TYPED_MAX = MAX_TEXT - 500;
const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pad = (n) => String(n).padStart(2, '0');

// The page of the popup: the real styles of the website and only this section, with its text editable in place.
function buildDocument(payload) {
  return `<!doctype html><html class="${esc(payload.htmlClass)}"><head><meta charset="utf-8">${payload.head}
<style>html,body{margin:0;background:transparent}[data-studio-edit]{outline:1px dashed rgba(94,123,95,.65);outline-offset:2px;cursor:text;min-width:1ch}[data-studio-edit]:hover{background:rgba(94,123,95,.08)}[data-studio-edit]:focus{outline:2px solid #5E7B5F;background:rgba(94,123,95,.12)}[style*="opacity: 0"]{opacity:1!important}</style></head>
<body class="${esc(payload.bodyClass)}"><div id="studio-edit-root">${payload.html}</div><script>(${sectionEditScript.toString()})();</script></body></html>`;
}

/**
 * The popup for ONE section: it shows only that section, its text can be typed over, and under it is the AI instruction bar.
 * "Save" first saves the typed text (each text is replaced exactly where it is written in the source), then, if there is an
 * instruction, sends it to the AI limited to this section (every other section is kept exactly as it is).
 */
/** A small picture chip: the photo that will be used in this section, with a button to take it out again. */
function PhotoChip({ siteId, image, disabled, onRemove }) {
  const { src, failed } = useImageSrc(siteId, image, { version: 'original', skip: image.kind === 'video' });
  return (
    <span className={`relative inline-flex h-12 w-12 shrink-0 overflow-hidden rounded-md border ${line} bg-[#EFEBE1]`} title={image.name}>
      {image.kind === 'video' ? <span className="flex h-full w-full items-center justify-center bg-[#2B2823] text-white"><Film className="h-4 w-4" aria-hidden="true" /></span> : src ? <img src={src} alt={image.alt || image.name} draggable={false} className="h-full w-full object-cover" /> : <span className={`flex h-full w-full items-center justify-center ${muted}`}>{failed ? <ImageOff className="h-4 w-4" /> : <Spinner className="h-3 w-3" />}</span>}
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
    if (found >= 0) known.current = { key, number: found + 1, item: sections[found] };
    return known.current;
  }, [payload, sections]);
  const title = match?.item?.name || payload.name || 'This section';

  const doc = useMemo(() => buildDocument(current), [current]);

  useEffect(() => {
    const onMessage = (event) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data || {};
      if (data.type === 'sec-edit-change') setEdits(Array.isArray(data.edits) ? data.edits.map((item) => ({ old: String(item.old || ''), next: String(item.next || '') })) : []);
      if (data.type === 'sec-edit-height') setHeight(Math.max(120, Math.min(Number(data.height) || 160, 4000)));
      if (data.type === 'sec-edit-ready') setReady(true);
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

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !saving && !applying) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving, applying]);

  const changed = edits.filter((item) => item.next && item.next !== item.old);
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
      const notes = saved.length ? `\n\n(The owner already typed these changes into this section by hand. Keep them exactly as written: ${saved.map((item) => `"${item.old}" became "${item.next}"`).join('; ')}.)` : '';
      const head = `${lead}${text}${notes}`.slice(0, MAX_TEXT - 300);
      // What the section shows NOW: after an earlier AI change in this pop-up that is the new markup, not the one it opened with.
      const outline = sectionOutline(current.html, saved, Math.max(0, Math.min(1800, MAX_TEXT - head.length - 200)));
      const context = outline ? `\n\nSECTION CONTENT (what the visitor sees in this section right now, with the typed changes applied; for reference, change only what the instruction asks):\n${outline}` : '';
      const instruction = `${head}${context}`.slice(0, MAX_TEXT);
      startKey.current = useTemplateStudioStore.getState().previewKey;
      // A video plays behind the section it is given to; a picture is placed in it.
      const attachments = chosenPhotos.map((image) => (image.kind === 'video'
        ? { path: image.path, placement: 'background', note: `Play this video as the background of the section "${String(title).replace(/"/g, "'")}" (only that section)` }
        : { path: image.path, placement: 'section', note: `For the section "${String(title).replace(/"/g, "'")}"` }));
      started = await regenerate(instruction, attachments, title);
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
            <p className={`text-[11px] ${muted}`}>{applying ? 'The AI is changing this section. The rest of the page is not touched.' : 'Only this section is shown. Click any text to type over it.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving || applying} aria-label="Close" className={`rounded p-1 ${muted} hover:bg-[#EAE5D9] disabled:opacity-50`}><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#EFEBE1] p-3">
          <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5">
            <div className="relative">
              <iframe ref={frame} title={`Section ${title}`} srcDoc={doc} sandbox="allow-scripts" style={{ height }} className={`block w-full border-0 bg-white transition-opacity ${applying ? 'opacity-40' : ''}`} />
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
                <li key={item.old} className="max-w-full truncate rounded-full bg-[#E8F0E8] px-2.5 py-0.5 text-[11px] font-medium text-[#3F5E41]" title={`${item.old} → ${item.next}`}>Changed: “{item.old.slice(0, 28)}{item.old.length > 28 ? '…' : ''}” → “{item.next.slice(0, 28)}{item.next.length > 28 ? '…' : ''}”</li>
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
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={TYPED_MAX} rows={3} disabled={saving || applying || running} aria-label="AI instruction for this section"
              className={`block w-full resize-none rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-relaxed ${ink} placeholder:text-xs placeholder:text-[#A59E90] focus:outline-none focus:ring-0`} />
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="flex items-center gap-2">
                <button type="button" disabled={saving || applying || running} onClick={() => setPrompt('Remove this section completely from the page, including anything that only it used and any link or button that points to it. Do not change any other section.')} className="inline-flex items-center gap-1 rounded-full border border-[#E2DCCF] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#5C564B] hover:bg-[#EFEBE1] disabled:opacity-50"><X className="h-3 w-3" />Remove this section</button>
                <span className={`text-[11px] ${muted}`}>{prompt.length}/{TYPED_MAX}</span>
              </span>
              <span className="flex items-center gap-1">
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
    </div>,
    document.body
  );
}
