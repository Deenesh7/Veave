import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Replace, Trash2, Check, Sparkles } from 'lucide-react';
import { useTemplateStudioStore, PLACEMENT_OPTIONS } from '../../store/templateStudioStore';
import { Modal, ConfirmModal, PrimaryButton, GhostButton, Spinner, Skeleton, IconButton, inputClass, ink, muted, line } from './ui';
import Dropdown from './Dropdown';
import { useImageSrc, formatBytes, dimensionsOf } from './imageUtils';

const when = (value) => { try { return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } };

/** Large preview of one library picture with zoom, its file details, the owner's notes, and Replace / Remove. */
export default function ImageViewer({ image, onClose }) {
  const { site, pages, activePageId, selection, images, toggleImage, updateImage, removeImage, replaceImage, busy } = useTemplateStudioStore();
  const live = images.find((item) => item.id === image?.id) || image;
  const { src, failed } = useImageSrc(site?.id, live, { full: true });
  const [zoom, setZoom] = useState(1);
  const [alt, setAlt] = useState('');
  const [placement, setPlacement] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef(null);
  const id = live?.id;

  useEffect(() => { setZoom(1); setAlt(live?.alt || ''); setPlacement(live?.placement || ''); setNote(live?.note || ''); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!live) return null;

  const chosen = Boolean(activePageId && selection[activePageId]?.[live.id]);
  const working = Boolean(busy[`image:${live.id}`]);
  const usedPages = pages.filter((page) => live.usedOn?.includes(page.id));
  const dirty = alt !== (live.alt || '') || placement !== (live.placement || '') || note !== (live.note || '');
  const save = async () => { setSaving(true); const ok = await updateImage(live.id, { alt, placement, note }); setSaving(false); if (ok) onClose(); };

  const replace = async (file) => {
    if (!file) return;
    setProgress(0);
    const next = await replaceImage(live.id, file, setProgress);
    setProgress(null);
    if (next) onClose();
  };

  return (
    <>
      <Modal open onClose={confirm ? () => {} : onClose} title={live.name} size="xl">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className={`relative flex h-[min(60vh,520px)] items-center justify-center overflow-auto rounded-md border ${line} bg-[#EFEBE1]`}>
              {src ? <img src={src} alt={live.alt || live.name} draggable={false} className="select-none transition-[width] duration-150" style={zoom === 1 ? { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } : { width: `${zoom * 100}%`, maxWidth: 'none', margin: 'auto' }} /> : failed ? <p className={`px-6 text-center text-sm ${muted}`}>The picture could not be loaded. It is still stored with your site.</p> : <Skeleton className="h-full w-full" />}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <IconButton label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, +(value - 0.5).toFixed(1)))}><ZoomOut className="h-4 w-4" /></IconButton>
                <span className={`w-12 text-center text-xs tabular-nums ${muted}`}>{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
                <IconButton label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, +(value + 0.5).toFixed(1)))}><ZoomIn className="h-4 w-4" /></IconButton>
                <IconButton label="Fit to window" onClick={() => setZoom(1)}><Maximize2 className="h-4 w-4" /></IconButton>
              </div>
              <p className={`text-[11px] ${muted}`}>{dimensionsOf(live)} · {formatBytes(live.size)} · {String(live.mime || '').replace('image/', '').toUpperCase()}</p>
            </div>
          </div>

          <div className="space-y-4">
            <dl className={`space-y-1 rounded-md border ${line} bg-white p-3 text-xs`}>
              <div className="flex justify-between gap-3"><dt className={muted}>File</dt><dd className={`truncate ${ink}`} title={live.name}>{live.name}</dd></div>
              <div className="flex justify-between gap-3"><dt className={muted}>Uploaded</dt><dd className={ink}>{when(live.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className={muted}>Used on</dt><dd className={`text-right ${ink}`}>{usedPages.length ? usedPages.map((page) => page.name).join(', ') : live.usedElsewhere ? 'Shared parts of the site' : 'Not used yet'}</dd></div>
            </dl>

            {live.caption || live.captionStatus === 'pending' ? (
              <div className={`rounded-md border ${line} bg-[#F3EFE5] p-3`}>
                <p className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${muted}`}><Sparkles className="h-3 w-3" />What the AI sees</p>
                <p className={`mt-1 text-xs leading-relaxed ${ink}`}>{live.caption || 'Looking at the picture…'}</p>
                {live.tags?.length ? <p className={`mt-1.5 text-[11px] ${muted}`}>{live.tags.join(' · ')}</p> : null}
              </div>
            ) : null}

            <div>
              <label htmlFor="img-alt" className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Alt text</label>
              <input id="img-alt" value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={200} placeholder="Describe the picture for visitors who cannot see it" className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Where should it go?</label>
              <div className="mt-1"><Dropdown label="Where should it go?" value={placement} onChange={setPlacement} options={PLACEMENT_OPTIONS} /></div>
            </div>
            <div>
              <label htmlFor="img-note" className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Image instruction <span className="normal-case tracking-normal">(optional)</span></label>
              <textarea id="img-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={3} placeholder="e.g. Use this as the project cover for the lake house." className={`${inputClass} mt-1 resize-none`} />
              <p className={`mt-1 text-[11px] ${muted}`}>This guides placement when the page is regenerated. It does not edit the photo.</p>
            </div>

            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" aria-label="Choose a replacement picture" onChange={(event) => { replace(event.target.files?.[0]); event.target.value = ''; }} />
            {progress !== null ? <div className="h-1 overflow-hidden rounded bg-[#E9E4D7]"><div className="h-full bg-[#5E7B5F] transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} /></div> : null}

            <div className="flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={save} disabled={!dirty || saving || working}>{saving ? <Spinner /> : <Check className="h-4 w-4" />}Save details</PrimaryButton>
              {activePageId ? <GhostButton onClick={() => toggleImage(live.id)} aria-pressed={chosen}>{chosen ? 'Selected for this page' : 'Use on this page'}</GhostButton> : null}
            </div>
            <div className={`flex items-center gap-2 border-t ${line} pt-3`}>
              <GhostButton onClick={() => fileInput.current?.click()} disabled={working}>{working && progress !== null ? <Spinner className="h-3 w-3" /> : <Replace className="h-3.5 w-3.5" />}Replace</GhostButton>
              <GhostButton onClick={() => setConfirm(true)} disabled={working} className="!text-[#A4493A]"><Trash2 className="h-3.5 w-3.5" />Remove</GhostButton>
            </div>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        open={confirm} danger busy={working} title="Remove this picture?" confirmLabel="Remove picture"
        message={usedPages.length || live.usedElsewhere
          ? `"${live.name}" is shown on ${usedPages.length ? usedPages.map((page) => page.name).join(', ') : 'shared parts of the site'}. It will leave the library, but the file stays in your site so those pages and their revisions keep working.`
          : `"${live.name}" will leave the library. The file stays in your site, and uploading it again brings it back.`}
        onClose={() => setConfirm(false)}
        onConfirm={async () => { if (await removeImage(live.id)) { setConfirm(false); onClose(); } }}
      />
    </>
  );
}
