import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Sparkles, X, ChevronsLeft, ChevronsRight, Pencil, Check, RotateCcw } from 'lucide-react';
import { useTemplateStudioStore, CONTENT_MIN, CONTENT_MAX } from '../../store/templateStudioStore';
import { FAILURE_TITLES } from '../../store/generationJobStore';
import { PanelHeader, EmptyState, IconButton, PrimaryButton, GhostButton, Spinner, Skeleton, inputClass, ink, muted, line } from './ui';
import ImageLibrary from './ImageLibrary';

const STEP = { queued: 'Waiting to start', processing: 'Writing the page', validating: 'Building the site and testing every page', repairing: 'Fixing a problem the checks found', committing: 'Saving the new version', completed: 'Saved', failed: 'Failed', cancelled: 'Cancelled' };
const TERMINAL = ['completed', 'failed', 'cancelled'];
const MAX_TEXT = 4000;

function SectionTitle({ children, hint }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${muted}`}>{children}</h4>
      {hint ? <span className={`text-[11px] ${muted}`}>{hint}</span> : null}
    </div>
  );
}

export default function ContentEditorPanel({ className = '' }) {
  const store = useTemplateStudioStore();
  const { site, siteLoading, pages, activePageId, job, regenerate, cancelJob, busy, drafts, setDraft, selection, images, uploads, lastRequest, renamePage, contentWidth, setContentWidth, clearSelection } = store;
  const collapsed = useTemplateStudioStore((state) => state.contentCollapsed);
  const setCollapsed = useTemplateStudioStore((state) => state.setContentCollapsed);
  const page = pages.find((item) => item.id === activePageId) || null;
  const [renaming, setRenaming] = useState(null);   // the new name while editing
  const [resizing, setResizing] = useState(false);
  const panel = useRef(null);

  const instruction = (activePageId && drafts[activePageId]) || '';
  const running = job && !TERMINAL.includes(job.status);
  const mine = job && (job.pageId === activePageId || !job.pageId);
  const chosen = (activePageId && selection[activePageId]) || {};
  const chosenImages = Object.keys(chosen).filter((id) => images.some((image) => image.id === id));
  const uploading = uploads.some((item) => item.status === 'queued' || item.status === 'uploading');
  const canSend = Boolean(instruction.trim()) && !running && !busy.regenerate && !uploading;

  useEffect(() => { setRenaming(null); }, [activePageId]);

  const attachmentsNow = () => chosenImages.map((id) => ({ path: images.find((image) => image.id === id).path, placement: chosen[id].placement, note: chosen[id].note }));

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    // The text stays in place until the page is saved, so a failed run can be sent again with one click.
    if (await regenerate(instruction.trim(), attachmentsNow())) clearSelection();
  };

  const saveName = async () => {
    const name = (renaming || '').trim();
    if (!name || name === page.name) { setRenaming(null); return; }
    if (await renamePage(page.id, { name })) setRenaming(null);
  };

  // Dragging the panel's right edge changes its width; the width is remembered.
  const startResize = (event) => {
    event.preventDefault();
    const left = panel.current.getBoundingClientRect().left;
    setResizing(true);
    const move = (moveEvent) => setContentWidth(moveEvent.clientX - left);
    const stop = () => { setResizing(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <>
    {collapsed ? (
      <aside aria-label="Content editor (collapsed)" className="hidden w-12 shrink-0 flex-col items-center gap-3 border-r border-[#E2DCCF] bg-[#FBF9F4] py-3 lg:flex">
        <IconButton label="Show Content" onClick={() => setCollapsed(false)}><ChevronsRight className="h-4 w-4" /></IconButton>
      </aside>
    ) : null}
    <section ref={panel} aria-label="Content editor" style={{ '--content-width': `${contentWidth}px` }}
      className={`${className} ${collapsed ? 'lg:!hidden' : ''} relative w-full shrink-0 flex-col border-r ${line} bg-[#FBF9F4] lg:w-[var(--content-width)] ${resizing ? '' : 'lg:transition-[width] lg:duration-200'}`}>
      <PanelHeader title="Content" action={<IconButton label="Hide Content" className="hidden lg:block" onClick={() => setCollapsed(true)}><ChevronsLeft className="h-4 w-4" /></IconButton>} />

      {siteLoading && !site ? <div className="space-y-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-28" /></div> : null}
      {!siteLoading && !site ? <EmptyState title="Nothing to edit yet">Create or pick a site, then choose a page.</EmptyState> : null}
      {site && !page ? <EmptyState title="Choose a page">Pick a page in the list to describe the changes you want.</EmptyState> : null}

      {site && page ? (
        <div className="min-h-0 flex-1 divide-y divide-[#E2DCCF] overflow-y-auto">
          {/* A. Page information */}
          <section aria-label="Page information" className="px-5 py-5">
            <SectionTitle>Page</SectionTitle>
            {renaming !== null ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={renaming} onChange={(event) => setRenaming(event.target.value)} maxLength={60} aria-label="Page name" className={`${inputClass} font-serif text-lg`}
                  onKeyDown={(event) => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') setRenaming(null); }} />
                <IconButton label="Save name" onClick={saveName}><Check className="h-4 w-4" /></IconButton>
                <IconButton label="Cancel" onClick={() => setRenaming(null)}><X className="h-4 w-4" /></IconButton>
              </div>
            ) : (
              <div className="group flex items-start justify-between gap-2">
                <h3 className={`font-serif text-2xl leading-tight ${ink}`}>{page.name}</h3>
                <IconButton label="Rename page" disabled={running} className="mt-1 opacity-60 group-hover:opacity-100" onClick={() => setRenaming(page.name)}><Pencil className="h-3.5 w-3.5" /></IconButton>
              </div>
            )}
            <p className={`mt-1 inline-block rounded bg-[#EFEBE1] px-1.5 py-0.5 font-mono text-[11px] ${muted}`}>{page.route}</p>
          </section>

          {/* B. AI page instructions */}
          <form onSubmit={submit} aria-label="AI page instructions" className="space-y-5 px-5 py-5">
            <div>
              <SectionTitle hint={<span className={instruction.length > MAX_TEXT - 200 ? 'text-[#A4493A]' : ''}>{instruction.length}/{MAX_TEXT}</span>}>AI instructions</SectionTitle>
              <textarea id="page-instruction" aria-label="Instruction for this page" value={instruction} onChange={(event) => setDraft(page.id, event.target.value)} maxLength={MAX_TEXT} rows={4} disabled={running}
                placeholder="Tell the AI what to change on this page…"
                className={`${inputClass} min-h-[6rem] resize-y px-3 py-2 text-sm leading-relaxed placeholder:text-xs`} />
            </div>

            {/* C. Photos */}
            <div>
              <SectionTitle>Photos</SectionTitle>
              <ImageLibrary disabled={running} />
            </div>

            <div className="space-y-2">
              <PrimaryButton type="submit" className="w-full !py-2.5" disabled={!canSend}>
                {busy.regenerate || running ? <Spinner /> : <Sparkles className="h-4 w-4" />}{running && mine ? 'Regenerating…' : 'Regenerate Page'}
              </PrimaryButton>
              <p className={`text-[11px] leading-relaxed ${muted}`}>
                {chosenImages.length ? <><ImagePlus className="mr-1 inline h-3 w-3" />{chosenImages.length} photo{chosenImages.length === 1 ? '' : 's'} will be placed on this page exactly as uploaded. </> : null}
                Only this page changes. Navigation, footer and other pages stay as they are, and the current version is kept if the new one does not pass the checks.
              </p>
            </div>
          </form>

          {job && mine ? (
            <div className="px-5 py-4" role="status" aria-live="polite">
              <div className={`rounded-md border p-3 ${job.status === 'failed' ? 'border-[#D9B8B0] bg-[#F7E9E5]' : job.status === 'completed' ? 'border-[#B8CBB9] bg-[#E8F0E8]' : `${line} bg-white`}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm font-medium ${ink}`}>{running ? (job.type === 'site-customize' ? (job.stepName || STEP[job.status]) : STEP[job.status] || job.stepName) : job.status === 'completed' ? (job.type === 'site-customize' ? 'The website was generated' : 'The page was regenerated and saved') : job.status === 'cancelled' ? 'Cancelled. Nothing was changed.' : (FAILURE_TITLES[job.errorCode] || 'The page was not changed')}</p>
                  {running && job.status !== 'committing' ? <GhostButton onClick={cancelJob} className="!px-2 !py-1"><X className="h-3 w-3" />Cancel</GhostButton> : null}
                </div>
                {running ? (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded bg-[#E9E4D7]"><div className="h-full bg-[#5E7B5F] transition-all" style={{ width: `${Math.max(5, job.progress || 0)}%` }} /></div>
                    <p className={`mt-1.5 text-[11px] ${muted}`}>{job.stepName && job.stepName !== STEP[job.status] ? job.stepName : 'This usually takes under a minute. You can keep browsing the preview.'}</p>
                  </>
                ) : null}
                {job.status === 'failed' ? (
                  <div className="mt-2 text-xs text-[#7A3A2E]">
                    <p className="break-words">{job.error}</p>
                    {job.result?.issues?.length ? <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{job.result.issues.slice(0, 4).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul> : null}
                    <p className={`mt-1.5 ${muted}`}>The previous version of the page is still in place, and your photos are safe in the library.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lastRequest && lastRequest.pageId === page.id ? <PrimaryButton className="!px-3 !py-1.5 text-xs" disabled={busy.regenerate} onClick={() => regenerate(lastRequest.instruction, lastRequest.attachments)}><RotateCcw className="h-3 w-3" />Try again</PrimaryButton> : null}
                      <GhostButton className="!px-3 !py-1.5 text-xs" onClick={() => document.getElementById('page-instruction')?.focus()}>Edit the instruction</GhostButton>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

        </div>
      ) : null}

      {/* Drag the right edge to resize (desktop) */}
      <div role="separator" aria-orientation="vertical" aria-label="Resize the content panel" aria-valuemin={CONTENT_MIN} aria-valuemax={CONTENT_MAX} aria-valuenow={contentWidth} tabIndex={0}
        onPointerDown={startResize} onDoubleClick={() => setContentWidth(360)}
        onKeyDown={(event) => { if (event.key === 'ArrowLeft') setContentWidth(contentWidth - 20); if (event.key === 'ArrowRight') setContentWidth(contentWidth + 20); }}
        className={`absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize lg:block ${resizing ? 'bg-[#5E7B5F]/40' : 'hover:bg-[#5E7B5F]/30 focus:bg-[#5E7B5F]/30'}`} />
    </section>
    </>
  );
}
