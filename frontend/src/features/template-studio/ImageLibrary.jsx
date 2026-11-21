import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Check, X, RotateCcw, AlertCircle, ImageOff, Sparkles, SplitSquareHorizontal, MapPin, ChevronDown } from 'lucide-react';
import { useTemplateStudioStore, PHOTO_TYPES, MAX_ATTACH } from '../../store/templateStudioStore';
import { ConfirmModal, Spinner, Skeleton, IconButton, inputClass, ink, muted, line } from './ui';
import { pagePhotos, imageFilesOf, isRetryable } from './panelLogic';
import { useImageSrc, formatBytes, dimensionsOf } from './imageUtils';
import ImageViewer from './ImageViewer';
import Dropdown from './Dropdown';
import EnhancementReview from './EnhancementReview';

function Thumb({ siteId, image, version = 'original', fit = 'cover' }) {
  const { src, failed } = useImageSrc(siteId, image, { version });
  if (src) return <img src={src} alt={image.alt || image.name} loading="lazy" draggable={false} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`} />;
  if (failed) return <span className={`flex h-full w-full items-center justify-center ${muted}`}><ImageOff className="h-5 w-5" /></span>;
  return <Skeleton className="h-full w-full !rounded-none" />;
}

/** Upload zone + this site's picture library. Chosen pictures are sent with the next "Regenerate Page". */
const STAGES = ['Uploading image', 'Analyzing image', 'Enhancing image with AI', 'Processing completed'];

/** The compact on/off switch: smooth 200 ms slide, green when on. */
function Switch({ on, busy, disabled, label, onClick }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E7B5F] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${on ? 'border-[#5E7B5F] bg-[#5E7B5F]' : 'border-[#CFC8B6] bg-[#D9D4C7]'}`}>
      <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}>
        {busy ? <Spinner className="h-2.5 w-2.5 text-[#5E7B5F]" /> : null}
      </span>
    </button>
  );
}

/**
 * The AI enhancement of one uploaded photo as a switch. Turning it on starts the real enhancement (credits are used only when it
 * succeeds); the original is never replaced: when it is done the owner compares and chooses which version the website uses.
 */
function EnhancementBlock({ siteId, image, onCompare }) {
  const { enhanceImage, chooseEnhancement, busy } = useTemplateStudioStore();
  const e = image.enhancement || {};
  // The comparison is open while a finished result still waits for a choice; once chosen it folds into one status row (reopen any time).
  const [open, setOpen] = useState(e.status === 'completed' && !e.applied);
  const wasPending = useRef(e.status === 'completed' && !e.applied);
  useEffect(() => {
    if (e.status === 'completed' && !e.applied) { setOpen(true); wasPending.current = true; }
    else if (e.status === 'completed' && wasPending.current) { setOpen(false); wasPending.current = false; }
  }, [e.status, e.applied]);
  if (!e.status) return null;
  const stage = e.status === 'queued' ? 1 : e.status === 'analyzing' ? 1 : e.status === 'enhancing' ? 2 : e.status === 'completed' ? 3 : -1;
  const starting = Boolean(busy[`enhance:${image.id}`]);
  const choosing = Boolean(busy[`choose:${image.id}`]);
  const completed = e.status === 'completed';
  const failed = e.status === 'failed' || e.status === 'skipped';
  const on = Boolean(e.active) || (completed && e.applied !== 'original');
  const working = Boolean(e.active) || starting;
  const label = e.active ? 'AI Enhancement Enabled' : completed ? (on ? 'AI Enhanced' : 'Enhanced · original in use') : 'Enhance with AI';
  const flip = () => {
    if (working || choosing) return;
    if (completed) chooseEnhancement(image.id, on ? 'original' : 'enhanced');
    else enhanceImage(image.id); // none, failed or skipped: start (again); the server charges only when it succeeds
  };

  return (
    <div className="mt-2">
      <div className={`flex h-9 items-center gap-2 rounded-md border px-2.5 transition-colors duration-200 ${on ? 'border-[#5E7B5F] bg-[#E8F0E8]' : `${line} bg-white`}`}>
        <Sparkles className={`h-3.5 w-3.5 shrink-0 transition-colors duration-200 ${on ? 'text-[#33503A]' : muted}`} aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate text-xs font-medium transition-colors duration-200 ${on ? 'text-[#33503A]' : ink}`}>{label}</span>
        {completed ? <Check className="h-3.5 w-3.5 shrink-0 text-[#33503A]" aria-label="Enhanced" /> : null}
        <Switch on={on} busy={working} disabled={working || choosing} label="Enhance with AI" onClick={flip} />
      </div>

      {e.active ? (
        <div className={`mt-1.5 rounded-md border ${line} bg-[#F7F4EE] p-2`} role="status" aria-live="polite">
          <p className={`flex items-center gap-1.5 text-xs font-medium ${ink}`}><Spinner className="h-3 w-3 text-[#5E7B5F]" />{e.step || 'Enhancing image with AI...'}</p>
          <ol className="mt-1.5 flex gap-1" aria-label="Enhancement progress">
            {STAGES.map((stageLabel, index) => <li key={stageLabel} title={stageLabel} className={`h-1 flex-1 rounded ${index < stage ? 'bg-[#5E7B5F]' : index === stage ? 'animate-pulse bg-[#5E7B5F]/60' : 'bg-[#E2DCCF]'}`} />)}
          </ol>
          <p className={`mt-1 text-[11px] ${muted}`}>You can keep working. Your original photo is safe.</p>
        </div>
      ) : null}

      {completed ? (
        <div className="mt-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <p className="min-w-0 flex-1 truncate text-[#33503A]">{e.applied === 'enhanced' ? 'Using enhanced image' : e.applied === 'original' ? 'Using original image' : 'Choose the photo to use'}</p>
            {e.applied ? (
              <button type="button" disabled={choosing} onClick={() => chooseEnhancement(image.id, e.applied === 'enhanced' ? 'original' : 'enhanced')} className={`shrink-0 underline underline-offset-2 hover:text-[#2B2823] disabled:opacity-50 ${muted}`}>{e.applied === 'enhanced' ? 'Change to original' : 'Use enhanced'}</button>
            ) : null}
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={`inline-flex shrink-0 items-center gap-0.5 ${muted} hover:text-[#2B2823]`}>{open ? 'Hide' : 'Compare'}<ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /></button>
          </div>
          {open ? (
            <div className="mt-1.5 rounded-md border border-[#B8CBB9] bg-[#F3F7F3] p-2">
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {[['Original', 'original', 'bg-[#2B2823]/70'], ['Enhanced', 'enhanced', 'bg-[#5E7B5F]/90']].map(([name, version, tone]) => (
                  <button key={version} type="button" onClick={onCompare} aria-label={`${name} photo, open the comparison`} className={`relative h-24 overflow-hidden rounded border bg-[#F3EFE5] ${version === 'enhanced' ? 'border-[#5E7B5F]' : 'border-[#CFC8B6]'}`}>
                    <Thumb siteId={siteId} image={image} version={version} fit="contain" />
                    <span className={`absolute inset-x-0 bottom-0 px-1 py-px text-center text-[9px] text-white ${tone}`}>{name}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-col gap-1.5 min-[420px]:flex-row">
                <button type="button" onClick={onCompare} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-[#CFC8B6] bg-white px-2 py-1.5 text-[11px] font-medium hover:bg-[#EFEBE1]"><SplitSquareHorizontal className="h-3 w-3" />Compare</button>
                <button type="button" disabled={choosing || e.applied === 'enhanced'} onClick={() => chooseEnhancement(image.id, 'enhanced')} className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-900 px-2 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50">{choosing ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}Use Enhanced Image</button>
              </div>
              {!e.applied ? <button type="button" disabled={choosing} onClick={() => chooseEnhancement(image.id, 'original')} className={`mt-1.5 block w-full text-center text-[11px] underline underline-offset-2 hover:text-[#2B2823] disabled:opacity-50 ${muted}`}>Keep original image</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <div className="mt-1.5 rounded-md border border-[#E2DCCF] bg-[#FBF9F4] p-2" role="alert">
          <p className="text-xs font-medium text-[#5C564B]">{e.status === 'skipped' ? 'Enhancement skipped' : 'Enhancement did not finish'}</p>
          {e.error ? <p className="mt-0.5 text-[11px] leading-snug text-[#5C564B]">{e.error}</p> : null}
          <p className={`mt-0.5 text-[11px] ${muted}`}>Your original photo is kept and still works on the page. No credits were used.</p>
          {e.errorCode !== 'PROVIDER_CREDITS' && e.errorCode !== 'PROVIDER_AUTH' ? (
            <button type="button" disabled={starting} onClick={() => enhanceImage(image.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[#CFC8B6] bg-white px-2 py-1 text-[11px] hover:bg-[#EFEBE1] disabled:opacity-50">
              {starting ? <Spinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ImageLibrary({ disabled = false }) {
  const { site, pageSections, activePageId, images, imagesLoaded, imagesError, loadImages, uploads, selection, uploadFiles, retryUpload, dismissUpload, clearFinishedUploads, toggleImage, setImageChoice, removeImage, busy } = useTemplateStudioStore();
  const pages = useTemplateStudioStore((state) => state.pages);
  const [deleting, setDeleting] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const input = useRef(null);
  const chosen = (activePageId && selection[activePageId]) || {};
  const { ids: chosenIds, count: photoCount, max: photoMax, missing: photoMissing } = pagePhotos(chosen, images, MAX_ATTACH);
  const siteId = site?.id;
  // Where a photo can go: only the sections that are on this page.
  const pageSectionNames = (Array.isArray(pageSections?.[activePageId]) ? pageSections[activePageId] : []).map((section) => String(section?.name ?? section).trim()).filter(Boolean);
  const placementOptionsFor = (current) => {
    const options = [{ value: '', label: 'Let the page decide', hint: 'The AI picks the best spot on this page' }, { value: 'page-background', label: 'Background of this page only', hint: 'The picture sits behind every section of this page. Other pages are not changed' }, ...[...new Set(pageSectionNames)].map((name) => ({ value: `section:${name}`, label: name, hint: 'Place it in this section of the page' }))];
    if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current.replace(/^section:/, ''), hint: 'Chosen earlier' });
    return options;
  };
  // A finished upload disappears from the queue once its picture shows in the library.
  const queue = uploads.filter((item) => item.status !== 'done' || !images.some((image) => image.id === item.imageId));
  const finished = queue.some((item) => item.status === 'done');
  const busyQueue = queue.some((item) => item.status === 'queued' || item.status === 'uploading');
  // Pictures already in the site's library that this page is not using yet: one click adds them (the same picture can serve several pages).
  const libraryRest = images.filter((image) => !chosenIds.includes(image.id));
  const accept = (files) => { if (!disabled) uploadFiles(files); };

  return (
    <div>
      <div
        onDragOver={(event) => { if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); accept(event.dataTransfer.files); }}
        onPaste={(event) => { const files = imageFilesOf(event.clipboardData?.files); if (files.length) { event.preventDefault(); accept(files); } }}
        className={`rounded-md border border-dashed px-3 py-2.5 text-center transition-colors ${dragging ? 'border-[#5E7B5F] bg-[#E8F0E8]' : 'border-[#CFC8B6] bg-white hover:border-[#B9B2A2]'} ${disabled ? 'opacity-60' : ''}`}
      >
        <p className={`flex items-center justify-center gap-1.5 text-xs ${ink}`}><UploadCloud className={`h-4 w-4 shrink-0 ${dragging ? 'text-[#5E7B5F]' : muted}`} aria-hidden="true" />Drop photos or <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="font-medium text-[#5E7B5F] underline underline-offset-2 hover:text-[#506B52] disabled:no-underline disabled:opacity-60">browse</button></p>
        <p className={`mt-0.5 text-[10px] ${muted}`}>PNG, JPEG, WebP, GIF, AVIF · 8 MB each</p>
        <input ref={input} type="file" multiple accept={PHOTO_TYPES.join(',')} className="hidden" aria-label="Choose photos to upload" onChange={(event) => { accept(event.target.files); event.target.value = ''; }} />
      </div>

      {queue.length ? (
        <ul className="mt-3 space-y-2" aria-label="Uploads">
          {queue.map((item) => (
            <li key={item.id} className={`flex items-center gap-3 rounded-md border p-2 ${item.status === 'error' ? 'border-[#E2DCCF] bg-[#FBF9F4]' : `${line} bg-white`}`}>
              <span className={`h-10 w-10 shrink-0 overflow-hidden rounded border ${line} bg-[#EFEBE1]`}>{item.preview ? <img src={item.preview} alt="" className="h-full w-full object-cover" /> : <AlertCircle className="m-2.5 h-5 w-5 text-[#A4493A]" />}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-xs font-medium ${ink}`}>{item.name}</p>
                {item.status === 'error' ? <p className="text-[11px] text-[#5C564B]">{item.error}</p> : (
                  <>
                    <p className={`text-[11px] ${muted}`}>{formatBytes(item.size)} · {item.status === 'queued' ? 'Waiting' : item.status === 'uploading' ? (item.progress >= 1 ? 'Saving…' : `Uploading image ${Math.round(item.progress * 100)}%`) : item.reused ? 'Already in the library' : 'Uploaded'}</p>
                    {item.status === 'uploading' ? <div className="mt-1 h-1 overflow-hidden rounded bg-[#E9E4D7]"><div className="h-full bg-[#5E7B5F] transition-all" style={{ width: `${Math.max(4, item.progress * 100)}%` }} /></div> : null}
                  </>
                )}
              </div>
              {item.status === 'uploading' ? <Spinner className="h-4 w-4 text-[#5E7B5F]" /> : null}
              {item.status === 'done' ? <Check className="h-4 w-4 text-[#5E7B5F]" /> : null}
              {item.duplicate && images.some((image) => image.id === item.imageId) ? <button type="button" onClick={() => setViewing(images.find((image) => image.id === item.imageId))} className="shrink-0 rounded border border-[#D9B8B0] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#5C564B] hover:bg-[#FBF3F0]">View</button> : null}
              {isRetryable(item) ? <IconButton label="Try again" onClick={() => retryUpload(item.id)}><RotateCcw className="h-3.5 w-3.5" /></IconButton> : null}
              {item.status !== 'uploading' ? <IconButton label="Dismiss" onClick={() => dismissUpload(item.id)}><X className="h-3.5 w-3.5" /></IconButton> : null}
            </li>
          ))}
          {finished && !busyQueue ? <li><button type="button" onClick={clearFinishedUploads} className={`text-[11px] underline ${muted}`}>Clear finished uploads</button></li> : null}
        </ul>
      ) : null}

      <div className="mt-4 space-y-2">
        <h5 className={`text-[11px] font-medium uppercase tracking-wider ${muted}`}>Photos for this page <span className="normal-case tracking-normal" aria-live="polite" aria-label={`${photoCount} of ${photoMax} photos`}>{photoCount}/{photoMax}</span></h5>
        {!imagesLoaded && !images.length ? <p className={`text-[11px] ${muted}`}>Loading your photos…</p> : null}
        {imagesError ? <p role="alert" className="text-[11px] text-[#5C564B]">{imagesError} <button type="button" onClick={loadImages} className="underline">Try again</button></p> : null}
        {imagesLoaded && !chosenIds.length && !imagesError ? <p className={`text-[11px] ${muted}`}>No photos chosen for this page yet. Upload one above{libraryRest.length ? ' or add one from your library below' : ''}.</p> : null}
        {photoMissing > 0 ? <p className={`text-[11px] ${muted}`}>{photoMissing} chosen photo{photoMissing === 1 ? ' is' : 's are'} no longer in the library and will not be sent.</p> : null}
          <ul className="space-y-2">
            {chosenIds.map((id) => {
              const image = images.find((item) => item.id === id);
              if (!image) return null;
              return (
                <li key={id} className={`rounded-md border ${line} bg-white p-1.5`}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setViewing(image)} aria-label={`Open ${image.name}`} className={`h-9 w-9 shrink-0 overflow-hidden rounded border ${line}`}><Thumb siteId={siteId} image={image} /></button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs font-medium ${ink}`}>{image.name}</p>
                      <p className={`text-[11px] ${muted}`}>{dimensionsOf(image)}</p>
                    </div>
                    <IconButton label={`Do not use ${image.name} on this page`} onClick={() => toggleImage(id, false)}><X className="h-3.5 w-3.5" /></IconButton>
                  </div>
                  <EnhancementBlock siteId={siteId} image={image} onCompare={() => setReviewing(image)} />
                  <div className="mt-1.5"><Dropdown compact icon={MapPin} label={`Where ${image.name} should go`} value={chosen[id].placement} onChange={(placement) => setImageChoice(id, { placement })} options={placementOptionsFor(chosen[id].placement)} /></div>
                  <input value={chosen[id].note} onChange={(event) => setImageChoice(id, { note: event.target.value })} maxLength={300} aria-label={`Instruction for ${image.name}`} placeholder="Optional: how to use this photo" className={`${inputClass} mt-1 !py-1 text-xs`} />
                </li>
              );
            })}
          </ul>
        </div>

      {libraryRest.length && chosenIds.length < photoMax ? (
        <div className="mt-3">
          <h5 className={`mb-1.5 text-[11px] font-medium uppercase tracking-wider ${muted}`}>Add from your library <span className="normal-case tracking-normal">{libraryRest.length}</span></h5>
          <ul className="flex flex-wrap gap-1.5" aria-label="Photos in your library not used on this page">
            {libraryRest.slice(0, 24).map((image) => (
              <li key={image.id} className="group relative">
                <button type="button" disabled={disabled} onClick={() => toggleImage(image.id, true)} aria-label={`Use ${image.name} on this page`} title={`Use ${image.name} on this page`} className={`h-11 w-11 overflow-hidden rounded border ${line} bg-[#EFEBE1] transition hover:border-[#5E7B5F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E7B5F] disabled:opacity-50`}><Thumb siteId={siteId} image={image} /></button>
                <button type="button" onClick={() => setDeleting(image)} aria-label={`Delete ${image.name} from the library`} title="Delete from the library" className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#D9B8B0] bg-white text-[#A4493A] opacity-100 shadow-sm transition hover:bg-[#F7E9E5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A4493A] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><X className="h-3 w-3" strokeWidth={3} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          {libraryRest.length > 24 ? <p className={`mt-1 text-[11px] ${muted}`}>Showing the newest 24 of {libraryRest.length}.</p> : null}
        </div>
      ) : null}

      {deleting ? (() => {
        const usedOn = (pages || []).filter((page) => deleting.usedOn?.includes(page.id));
        return (
          <ConfirmModal
            open danger busy={Boolean(busy?.[`image:${deleting.id}`])} title="Delete this photo?" confirmLabel="Delete photo"
            message={usedOn.length || deleting.usedElsewhere
              ? `"${deleting.name}" is shown on ${usedOn.length ? usedOn.map((page) => page.name).join(', ') : 'shared parts of the site'}. It will leave your library, but the file stays in your site so those pages and their earlier versions keep working.`
              : `"${deleting.name}" will leave your library. Uploading the same photo again brings it back.`}
            onClose={() => setDeleting(null)}
            onConfirm={async () => { if (await removeImage(deleting.id)) setDeleting(null); }}
          />
        );
      })() : null}

      {reviewing ? <EnhancementReview image={reviewing} onClose={() => setReviewing(null)} /> : null}
      {viewing ? <ImageViewer image={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
