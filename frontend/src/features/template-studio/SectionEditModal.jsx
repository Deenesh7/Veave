import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, X, Sparkles } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { PrimaryButton, GhostButton, Spinner, ink, muted, line } from './ui';
import VoiceInputButton from './VoiceInputButton';
import { sectionEditScript } from './sectionEditScripts';
import { sectionOutline } from './sectionOutline';
import { PRODUCTION_PRESET, PRODUCTION_PRESET_LABEL } from './promptPresets';

const MAX_TEXT = 4000;
const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
export default function SectionEditModal({ payload, onClose }) {
  const store = useTemplateStudioStore();
  const { activeSiteId, activePageId, pageSections, job, regenerate, busy, flash } = store;
  const running = job && !['completed', 'failed', 'cancelled'].includes(job.status);
  const sections = Array.isArray(pageSections[activePageId]) ? pageSections[activePageId] : [];
  const [edits, setEdits] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState([]);
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(false);
  const frame = useRef(null);

  // Which section of the Content column this is (its number is what the AI is told).
  const match = useMemo(() => {
    const byId = payload.domId ? sections.findIndex((item) => item.domId === payload.domId || item.id === payload.domId) : -1;
    const wanted = norm(payload.name);
    const byName = byId >= 0 ? byId : sections.findIndex((item) => norm(item.name) === wanted);
    return byName >= 0 ? { number: byName + 1, item: sections[byName] } : null;
  }, [payload, sections]);
  const title = match?.item?.name || payload.name || 'This section';

  const doc = useMemo(() => buildDocument(payload), [payload]);

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

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const changed = edits.filter((item) => item.next && item.next !== item.old);
  const canSave = !saving && !running && !busy.regenerate && (changed.length > 0 || prompt.trim().length > 0);

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
    const text = prompt.trim();
    if (text) {
      const lead = match ? `In section ${pad(match.number)} ("${String(title).replace(/"/g, "'")}"): ` : `In the section "${String(title).replace(/"/g, "'")}": `;
      const notes = saved.length ? `\n\n(The owner already typed these changes into this section by hand. Keep them exactly as written: ${saved.map((item) => `"${item.old}" became "${item.next}"`).join('; ')}.)` : '';
      const head = `${lead}${text}${notes}`.slice(0, MAX_TEXT - 300);
      const outline = sectionOutline(payload.html, saved, Math.max(0, Math.min(1800, MAX_TEXT - head.length - 200)));
      const context = outline ? `\n\nSECTION CONTENT (what the visitor sees in this section right now, with the typed changes applied; for reference, change only what the instruction asks):\n${outline}` : '';
      const instruction = `${head}${context}`.slice(0, MAX_TEXT);
      started = await regenerate(instruction, [], title);
    }
    setSaving(false);
    if (failed.length) { setProblems(failed); if (saved.length || !started) { setEdits((list) => list.filter((item) => failed.some((f) => f.text === item.old))); } return; }
    if (started) { if (saved.length && !text) flash('success', saved.length === 1 ? 'The text was saved.' : `${saved.length} texts were saved.`); onClose(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Edit section ${title}`}>
      <div className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-xl bg-[#FBF9F4] shadow-2xl">
        <div className={`flex items-center gap-3 border-b ${line} px-4 py-3`}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5E7B5F] text-white"><Pencil className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <h3 className={`truncate text-sm font-semibold ${ink}`}>Edit section{match ? ` ${pad(match.number)}` : ''}: {title}</h3>
            <p className={`text-[11px] ${muted}`}>Only this section is shown. Click any text to type over it.</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className={`rounded p-1 ${muted} hover:bg-[#EAE5D9] disabled:opacity-50`}><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#EFEBE1] p-3">
          <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5">
            <iframe ref={frame} title={`Section ${title}`} srcDoc={doc} sandbox="allow-scripts" style={{ height }} className="block w-full border-0 bg-white" />
          </div>
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
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={MAX_TEXT} rows={3} disabled={saving || running} aria-label="AI instruction for this section"
              placeholder="Tell the AI what to change in this section only…" className={`block w-full resize-y rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-relaxed ${ink} placeholder:text-xs placeholder:text-[#A59E90] focus:outline-none focus:ring-0`} />
            <div className="flex items-center justify-between px-2.5 pb-2">
              <span className="flex items-center gap-2">
                <button type="button" disabled={saving || running} onClick={() => setPrompt('Remove this section completely from the page, including anything that only it used and any link or button that points to it. Do not change any other section.')} className="inline-flex items-center gap-1 rounded-full border border-[#E2DCCF] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#5C564B] hover:bg-[#EFEBE1] disabled:opacity-50"><X className="h-3 w-3" />Remove this section</button>
                <button type="button" disabled={saving || running} onClick={() => setPrompt(PRODUCTION_PRESET)} className="inline-flex items-center gap-1 rounded-full border border-[#CFE0CF] bg-[#E8F0E8] px-2.5 py-0.5 text-[11px] font-medium text-[#3F5E41] hover:bg-[#DCE9DC] disabled:opacity-50"><Sparkles className="h-3 w-3" />{PRODUCTION_PRESET_LABEL}</button>
                <span className={`text-[11px] ${muted}`}>{prompt.length}/{MAX_TEXT}</span>
              </span>
              <VoiceInputButton disabled={saving || running} onText={(text) => setPrompt((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`.slice(0, MAX_TEXT))} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className={`text-[11px] leading-relaxed ${muted}`}>{running ? 'A page is being generated. Wait for it to finish.' : 'Typed text is saved first. The AI then gets the content of this section together with your instruction and changes only this section; every other section stays exactly as it is.'}</p>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={onClose} disabled={saving}>Cancel</GhostButton>
              <PrimaryButton onClick={save} disabled={!canSave}>{saving ? <Spinner /> : <Sparkles className="h-4 w-4" />}{prompt.trim() ? (changed.length ? 'Save and apply AI' : 'Apply with AI') : 'Save text'}</PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
