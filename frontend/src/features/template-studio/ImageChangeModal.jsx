import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Check, ImageOff, Film, Link2, Youtube, X } from 'lucide-react';
import { useTemplateStudioStore, MEDIA_TYPES } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { Modal, ConfirmModal, PrimaryButton, GhostButton, Spinner, Skeleton, ink, muted, line } from './ui';
import { validatePhotoFile, isVideoFile, matchSection, wholeSectionNote, parseYouTubeUrl, YOUTUBE_OVERLAYS, youtubeBackgroundNote } from './panelLogic';
import { useImageSrc } from './imageUtils';

// The address the website names for a picture: the preview serves the site's files under /api/preview-assets/<token>/…, the code names them as /…
const pathInCode = (src) => {
  const match = /\/api\/preview-assets\/[a-f0-9]+(\/[^?#]*)/i.exec(src || '');
  if (match) { try { return decodeURI(match[1]); } catch { return match[1]; } }
  return String(src || '').split(/[?#]/)[0];
};

function Thumb({ siteId, image }) {
  const { src, failed } = useImageSrc(siteId, image, { skip: image.kind === 'video' });
  if (image.kind === 'video') return <span className="flex h-full w-full items-center justify-center bg-[#2B2823] text-white" title={image.name}><Film className="h-4 w-4" aria-hidden="true" /></span>;
  if (src) return <img src={src} alt={image.alt || image.name} loading="lazy" draggable={false} className="h-full w-full object-cover" />;
  if (failed) return <span className={`flex h-full w-full items-center justify-center ${muted}`}><ImageOff className="h-5 w-5" /></span>;
  return <Skeleton className="h-full w-full !rounded-none" />;
}

/** Opened by the image button in the preview: pick a picture from the library or upload one (it is stored in the site's storage), then use it. */
export default function ImageChangeModal({ target, onClose, mode = 'swap', onPick = null, onVideo = null, onDone = null, zClass = 'z-50' }) {
  const background = mode === 'background';
  // A video cannot replace a picture, but when the section of the picture is known it can play behind that section.
  const videoOk = background || Boolean(target.section) || Boolean(onVideo);
  const canYouTube = videoOk;
  const { activeSiteId: siteId, activePageId, images, imagesLoaded, loadImages, flash, pageSections, regenerate, removeImage: removeLibraryImage } = useTemplateStudioStore();
  const [chosenId, setChosenId] = useState(null);
  const [deleting, setDeleting] = useState(null);   // the library picture or video the owner is about to delete
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [chosenIds, setChosenIds] = useState([]);       // background mode: several pictures and videos can be picked; they play one after the other
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const [source, setSource] = useState('upload');   // background mode: 'upload' (picture or video file) or 'youtube' (a link)
  const [ytUrl, setYtUrl] = useState('');
  const [overlay, setOverlay] = useState('dark');
  const youtube = parseYouTubeUrl(ytUrl);
  const fromPath = pathInCode(target.src);
  const library = (images || []).filter((image) => (videoOk || image.kind !== 'video') && !image.deletedAt);
  const isChosen = (id) => (background ? chosenIds.includes(id) : chosenId === id);
  const choose = (id) => { if (background) setChosenIds((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id])); else setChosenId(id); };
  const chosen = library.find((image) => image.id === chosenId) || null;
  const chosenIsVideo = chosen?.kind === 'video';
  const busy = uploading || applying;

  useEffect(() => { if (!imagesLoaded) loadImages(); }, [imagesLoaded, loadImages]);

  const upload = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, background ? 8 : 1);
    if (!files.length || busy) return;
    for (const file of files) await uploadOne(file);
  };

  const uploadOne = async (file) => {
    if (!videoOk && isVideoFile(file)) { setError('A video cannot replace a picture. To play a video, open the section with its pen icon and use the Background button.'); return; }
    const problem = validatePhotoFile(file, { allowVideo: videoOk });
    if (problem) { setError(problem); return; }
    setError(null); setUploading(true);
    try {
      const res = await templateSiteService.uploadPhoto(siteId, file, { pageId: activePageId });
      choose(res.data.photo.id);
      await loadImages();
    } catch (failure) {
      setError(apiMessage(failure, 'The picture could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  };

  const applyYouTube = async () => {
    if (!youtube.ok || busy) return;
    const media = { kind: 'youtube', id: `youtube:${youtube.id}`, youtubeId: youtube.id, url: ytUrl.trim(), name: 'YouTube video', overlay };
    if (background) { onPick?.([media]); onClose(); return; }
    if (onVideo) { onVideo(media); onClose(); return; }
    // Opened from a picture of the page: the video goes behind the section that holds the picture. It is put straight into the code;
    // only a section that cannot be changed that way is handed to the AI.
    const sections = Array.isArray(pageSections?.[activePageId]) ? pageSections[activePageId] : [];
    const found = matchSection(sections, { domId: target.section?.domId || '', name: target.section?.name || '', index: Number.isInteger(target.section?.index) ? target.section.index : -1 });
    setError(null); setApplying(true);
    if (found >= 0) {
      const result = await useTemplateStudioStore.getState().setSectionBackground(sections[found].id, media);
      if (result.ok) { flash('success', 'The YouTube video now plays behind the section.'); onDone?.(); onClose(); return; }
    }
    const title = String((found >= 0 ? sections[found]?.name : target.section?.name) || 'this section').replace(/"/g, "'");
    const lead = found >= 0 ? `In section ${String(found + 1).padStart(2, '0')} ("${title}"): ` : `In the section "${title}": `;
    const picture = { path: fromPath, alt: target.alt || '' };
    const started = await regenerate(`${lead}${youtubeBackgroundNote(youtube.id, overlay)} The section is the block that CONTAINS the picture "${picture.alt || picture.path}" (src ${picture.path}).`.slice(0, 4000), [], title);
    if (started) { flash('info', 'The AI is adding the video behind the section. It will appear in the preview when it is done.'); onClose(); return; }
    setApplying(false);
  };

  const apply = async () => {
    if (background) {
      const picked = chosenIds.map((id) => library.find((image) => image.id === id)).filter(Boolean).map((image) => ({ ...image, overlay }));
      if (!picked.length || busy) return;
      onPick?.(picked); onClose(); return;
    }
    if (!chosenId || busy) return;
    if (chosenIsVideo && onVideo) { onVideo(chosen); onClose(); return; }
    if (chosenIsVideo) {
      // A video plays behind the section the picture is in: the AI is asked for exactly that, limited to that section.
      const sections = Array.isArray(pageSections?.[activePageId]) ? pageSections[activePageId] : [];
      const found = matchSection(sections, { domId: target.section?.domId || '', name: target.section?.name || '', index: Number.isInteger(target.section?.index) ? target.section.index : -1 });
      const title = String((found >= 0 ? sections[found]?.name : target.section?.name) || 'this section').replace(/"/g, "'");
      const lead = found >= 0 ? `In section ${String(found + 1).padStart(2, '0')} ("${title}"): ` : `In the section "${title}": `;
      const picture = { path: fromPath, alt: target.alt || '' };
      const instruction = `${lead}Use the video "${chosen.name}" as the BACKGROUND of the section that CONTAINS the picture "${picture.alt || picture.path}" (src ${picture.path}; find that picture in the code). The background covers the whole block that holds that picture together with its text, headings, lists and figures, behind all of it, with the text kept readable; the video is muted, loops and plays automatically. ${wholeSectionNote(picture, { listed: false })} Change nothing else.`;
      setError(null); setApplying(true);
      const started = await regenerate(instruction, [{ path: chosen.path, placement: 'background', note: `Background of the section "${title}" (only that section), behind its text` }], title);
      if (started) { flash('info', 'The AI is adding the video behind the section. It will appear in the preview when it is done.'); onClose(); return; }
      setApplying(false);
      return;
    }
    setError(null); setApplying(true);
    try {
      await templateSiteService.swapImage(siteId, fromPath, chosenId);
      useTemplateStudioStore.setState((state) => ({ previewKey: state.previewKey + 1 }));
      loadImages();
      flash('success', 'The picture was changed.');
      onDone?.();
      onClose();
    } catch (failure) {
      setError(apiMessage(failure, 'The picture could not be changed.'));
      setApplying(false);
    }
  };


  const overlayPicker = (
    <fieldset>
      <legend className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>Overlay for readable text</legend>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {YOUTUBE_OVERLAYS.map((item) => (
          <button key={item.value} type="button" aria-pressed={overlay === item.value} onClick={() => setOverlay(item.value)} title={item.hint}
            className={`rounded-md border px-2 py-1.5 text-xs font-medium ${overlay === item.value ? 'border-[#5E7B5F] bg-[#E8F0E8] text-[#3F5E41]' : `${line} bg-white ${ink} hover:border-[#B9B2A2]`}`}>{item.label}</button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={background ? 'Set the background of this section' : 'Change this image'} wide zClass={zClass}>
      <div className={`grid gap-4 ${background ? '' : 'sm:grid-cols-[180px_1fr]'}`}>
        {background ? null : <div>
          <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>Now</p>
          <div className={`flex aspect-square items-center justify-center overflow-hidden rounded-md border ${line} bg-[#EFEBE1]`}>
            {target.src ? <img src={target.src} alt={target.alt || 'Current picture'} className="h-full w-full object-cover" /> : <ImageOff className={`h-6 w-6 ${muted}`} />}
          </div>
          {target.width ? <p className={`mt-1 text-[11px] ${muted}`}>Shown at {target.width} × {target.height}px</p> : null}
        </div>}
        <div className="min-w-0 space-y-3">
          {canYouTube ? (
            <div role="tablist" aria-label="Background source" className={`grid grid-cols-2 gap-1 rounded-lg border ${line} bg-[#EFEBE1] p-1`}>
              {[['upload', background ? 'Image / video upload' : 'Image upload', UploadCloud], ['youtube', 'YouTube URL', Youtube]].map(([value, label, Icon]) => (
                <button key={value} type="button" role="tab" aria-selected={source === value} disabled={busy} onClick={() => { setSource(value); setError(null); }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${source === value ? 'bg-white text-[#2B2823] shadow-sm' : `${muted} hover:text-[#2B2823]`}`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          ) : null}
          {canYouTube && source === 'youtube' ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="bg-youtube-url" className={`mb-1 block text-[11px] font-medium uppercase tracking-wide ${muted}`}>YouTube link</label>
                <div className="relative">
                  <Link2 className={`pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${muted}`} aria-hidden="true" />
                  <input id="bg-youtube-url" type="url" inputMode="url" autoFocus value={ytUrl} onChange={(event) => setYtUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyYouTube(); } }}
                    placeholder="https://www.youtube.com/watch?v=…" aria-invalid={Boolean(ytUrl.trim() && !youtube.ok)} aria-describedby="bg-youtube-help"
                    className={`w-full rounded-md border bg-white py-2 pl-9 pr-3 text-sm ${ink} placeholder:text-[#A59E90] focus:outline-none focus:ring-1 ${ytUrl.trim() && !youtube.ok ? 'border-[#A4493A] focus:border-[#A4493A] focus:ring-[#A4493A]' : 'border-[#E2DCCF] focus:border-[#5E7B5F] focus:ring-[#5E7B5F]'}`} />
                </div>
                {ytUrl.trim() && !youtube.ok ? <p id="bg-youtube-help" role="alert" className="mt-1 text-xs text-[#A4493A]">{youtube.error}</p> : <p id="bg-youtube-help" className={`mt-1 text-[11px] ${muted}`}>Works with youtube.com/watch?v=…, youtu.be/… and youtube.com/shorts/… links.</p>}
              </div>
              {youtube.ok ? (
                <div className={`relative aspect-video overflow-hidden rounded-md border ${line} bg-[#2B2823]`} style={{ containerType: 'size' }}>
                  <img src={`https://i.ytimg.com/vi/${youtube.id}/hqdefault.jpg`} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                  <iframe key={youtube.id} title="Live preview of the YouTube background" tabIndex={-1} loading="lazy" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin"
                    src={`https://www.youtube-nocookie.com/embed/${youtube.id}?autoplay=1&mute=1&loop=1&playlist=${youtube.id}&start=0&controls=0&playsinline=1&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0`}
                    style={{ position: 'absolute', top: '50%', left: '50%', width: 'max(100cqw, 177.78cqh)', height: 'max(100cqh, 56.25cqw)', maxWidth: 'none', transform: 'translate(-50%, -50%)', border: 0, pointerEvents: 'none' }} />
                  {YOUTUBE_OVERLAYS.find((item) => item.value === overlay)?.color ? <span className="pointer-events-none absolute inset-0" style={{ background: YOUTUBE_OVERLAYS.find((item) => item.value === overlay).color }} /> : null}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">Your section text appears here</span></span>
                </div>
              ) : null}
              {overlayPicker}
              <p className={`text-[11px] ${muted}`}>The video becomes the background of the whole section: it plays muted on a loop, with no player controls, and fills the section on desktop, tablet and mobile. Your text and layout stay on top.</p>
              <div className="flex justify-end gap-2">
                <GhostButton disabled={busy} onClick={onClose}>Cancel</GhostButton>
                <PrimaryButton disabled={!youtube.ok || busy} onClick={applyYouTube}>{applying ? <Spinner className="h-4 w-4" /> : null}Use as background</PrimaryButton>
              </div>
            </div>
          ) : (<>
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files); }}
            className={`rounded-md border border-dashed px-3 py-3 text-center ${dragging ? 'border-[#5E7B5F] bg-[#E8F0E8]' : 'border-[#CFC8B6] bg-white'}`}>
            <p className={`flex items-center justify-center gap-1.5 text-xs ${ink}`}>
              {uploading ? <Spinner className="h-4 w-4" /> : <UploadCloud className={`h-4 w-4 ${muted}`} aria-hidden="true" />}
              {uploading ? 'Uploading…' : <>Drop a picture, or <button type="button" disabled={busy} onClick={() => input.current?.click()} className="font-medium text-[#5E7B5F] underline underline-offset-2">upload from your computer</button></>}
            </p>
            <p className={`mt-0.5 text-[11px] ${muted}`}>{videoOk ? 'PNG, JPEG, WebP, GIF, AVIF (8 MB) · MP4, MOV or WebM video (25 MB)' : 'PNG, JPEG, WebP, GIF, AVIF · up to 8 MB. For a video, use Background in the section edit (pen icon).'}</p>
            <input ref={input} type="file" multiple={background} accept={videoOk ? MEDIA_TYPES.join(',') : 'image/png,image/jpeg,image/webp,image/gif,image/avif'} className="hidden" onChange={(event) => { upload(event.target.files); event.target.value = ''; }} />
          </div>
          <div>
            <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>{background ? 'Or choose from your library (pick one or several)' : 'Or choose from your library'}</p>
            {!imagesLoaded ? <Skeleton className="h-16 w-full" /> : library.length ? (
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                {library.map((image) => (
                  <div key={image.id} className="group relative">
                    <button type="button" disabled={busy} onClick={() => choose(image.id)} aria-pressed={isChosen(image.id)} title={image.name}
                      className={`relative block aspect-square w-full overflow-hidden rounded border-2 ${isChosen(image.id) ? 'border-[#5E7B5F]' : 'border-transparent hover:border-[#B9B2A2]'}`}>
                      <Thumb siteId={siteId} image={image} />
                      {isChosen(image.id) ? <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#5E7B5F] text-white"><Check className="h-3 w-3" /></span> : null}
                    </button>
                    <button type="button" disabled={busy} aria-label={`Delete ${image.name} from the library`} title="Delete from the library" onClick={() => setDeleting(image)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white shadow transition hover:bg-[#A4493A] focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-50"><X className="h-3 w-3" strokeWidth={3} /></button>
                  </div>
                ))}
              </div>
            ) : <p className={`text-xs ${muted}`}>No pictures yet. Upload one above.</p>}
          </div>
          <p className={`text-[11px] ${muted}`}>{background ? 'The files are saved to your site\'s storage and placed behind this section right away, with no AI. With several, each one fades into the next.' : chosenIsVideo ? (onVideo ? 'The video is saved to your site\'s storage. It plays behind this section when you press Apply background. The picture itself stays as it is.' : 'The video is saved to your site\'s storage and the AI plays it behind this section (about 2 minutes). The picture itself stays as it is.') : 'The new picture is saved to your site\'s storage and replaces this one everywhere it is used on the website.'}</p>
          {background && chosenIds.length ? overlayPicker : null}
          {error ? <p role="alert" className="text-xs text-[#A4493A]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <GhostButton disabled={busy} onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton disabled={(background ? !chosenIds.length : !chosenId) || busy} onClick={apply}>{applying ? <Spinner className="h-4 w-4" /> : null}{background ? (chosenIds.length > 1 ? `Use ${chosenIds.length} as background` : 'Use as background') : chosenIsVideo ? (onVideo ? 'Use as section background' : 'Play as section background') : 'Use this image'}</PrimaryButton>
          </div>
          </>)}
        </div>
      </div>
      <ConfirmModal open={Boolean(deleting)} danger busy={deleteBusy} zClass="z-[100]" title={deleting?.kind === 'video' ? 'Delete this video?' : 'Delete this picture?'} confirmLabel="Delete"
        message={deleting ? <>“{deleting.name}” will be removed from your library. Pages that already show it keep it until you change them. This cannot be undone.</> : ''}
        onClose={() => { if (!deleteBusy) setDeleting(null); }}
        onConfirm={async () => {
          const target = deleting;
          setDeleteBusy(true);
          const ok = await removeLibraryImage(target.id);
          setDeleteBusy(false);
          if (ok) { setChosenIds((list) => list.filter((id) => id !== target.id)); setChosenId((id) => (id === target.id ? null : id)); setDeleting(null); }
        }} />
    </Modal>
  );
}
