import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Check, ImageOff, Film } from 'lucide-react';
import { useTemplateStudioStore, MEDIA_TYPES } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { Modal, PrimaryButton, GhostButton, Spinner, Skeleton, ink, muted, line } from './ui';
import { validatePhotoFile, isVideoFile, matchSection, wholeSectionNote } from './panelLogic';
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
  const { activeSiteId: siteId, activePageId, images, imagesLoaded, loadImages, flash, pageSections, regenerate } = useTemplateStudioStore();
  const [chosenId, setChosenId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const fromPath = pathInCode(target.src);
  const library = (images || []).filter((image) => (videoOk || image.kind !== 'video') && !image.deletedAt);
  const chosen = library.find((image) => image.id === chosenId) || null;
  const chosenIsVideo = chosen?.kind === 'video';
  const busy = uploading || applying;

  useEffect(() => { if (!imagesLoaded) loadImages(); }, [imagesLoaded, loadImages]);

  const upload = async (fileList) => {
    const file = Array.from(fileList || [])[0];
    if (!file || busy) return;
    if (!videoOk && isVideoFile(file)) { setError('A video cannot replace a picture. To play a video, open the section with its pen icon and use the Background button.'); return; }
    const problem = validatePhotoFile(file, { allowVideo: videoOk });
    if (problem) { setError(problem); return; }
    setError(null); setUploading(true);
    try {
      const res = await templateSiteService.uploadPhoto(siteId, file, { pageId: activePageId });
      setChosenId(res.data.photo.id);
      await loadImages();
    } catch (failure) {
      setError(apiMessage(failure, 'The picture could not be uploaded.'));
    } finally {
      setUploading(false);
    }
  };

  const apply = async () => {
    if (!chosenId || busy) return;
    if (background) { onPick?.(library.find((image) => image.id === chosenId)); onClose(); return; }
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
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files); }}
            className={`rounded-md border border-dashed px-3 py-3 text-center ${dragging ? 'border-[#5E7B5F] bg-[#E8F0E8]' : 'border-[#CFC8B6] bg-white'}`}>
            <p className={`flex items-center justify-center gap-1.5 text-xs ${ink}`}>
              {uploading ? <Spinner className="h-4 w-4" /> : <UploadCloud className={`h-4 w-4 ${muted}`} aria-hidden="true" />}
              {uploading ? 'Uploading…' : <>Drop a picture, or <button type="button" disabled={busy} onClick={() => input.current?.click()} className="font-medium text-[#5E7B5F] underline underline-offset-2">upload from your computer</button></>}
            </p>
            <p className={`mt-0.5 text-[11px] ${muted}`}>{videoOk ? 'PNG, JPEG, WebP, GIF, AVIF (8 MB) · MP4, MOV or WebM video (25 MB)' : 'PNG, JPEG, WebP, GIF, AVIF · up to 8 MB. For a video, use Background in the section edit (pen icon).'}</p>
            <input ref={input} type="file" accept={videoOk ? MEDIA_TYPES.join(',') : 'image/png,image/jpeg,image/webp,image/gif,image/avif'} className="hidden" onChange={(event) => { upload(event.target.files); event.target.value = ''; }} />
          </div>
          <div>
            <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${muted}`}>Or choose from your library</p>
            {!imagesLoaded ? <Skeleton className="h-16 w-full" /> : library.length ? (
              <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                {library.map((image) => (
                  <button key={image.id} type="button" disabled={busy} onClick={() => setChosenId(image.id)} aria-pressed={chosenId === image.id} title={image.name}
                    className={`relative aspect-square overflow-hidden rounded border-2 ${chosenId === image.id ? 'border-[#5E7B5F]' : 'border-transparent hover:border-[#B9B2A2]'}`}>
                    <Thumb siteId={siteId} image={image} />
                    {chosenId === image.id ? <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#5E7B5F] text-white"><Check className="h-3 w-3" /></span> : null}
                  </button>
                ))}
              </div>
            ) : <p className={`text-xs ${muted}`}>No pictures yet. Upload one above.</p>}
          </div>
          <p className={`text-[11px] ${muted}`}>{background ? 'The file is saved to your site\'s storage. It is placed behind this section when you press Apply.' : chosenIsVideo ? (onVideo ? 'The video is saved to your site\'s storage. It plays behind this section when you press Apply background. The picture itself stays as it is.' : 'The video is saved to your site\'s storage and the AI plays it behind this section (about 2 minutes). The picture itself stays as it is.') : 'The new picture is saved to your site\'s storage and replaces this one everywhere it is used on the website.'}</p>
          {error ? <p role="alert" className="text-xs text-[#A4493A]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <GhostButton disabled={busy} onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton disabled={!chosenId || busy} onClick={apply}>{applying ? <Spinner className="h-4 w-4" /> : null}{background ? 'Use as background' : chosenIsVideo ? (onVideo ? 'Use as section background' : 'Play as section background') : 'Use this image'}</PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
