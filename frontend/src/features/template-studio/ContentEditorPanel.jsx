import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Sparkles, X, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Pencil, Check, RotateCcw, LayoutList, ArrowRight, Type, Loader2 } from 'lucide-react';
import { useTemplateStudioStore, CONTENT_MIN, CONTENT_MAX, readUi, writeUi } from '../../store/templateStudioStore';
import { FAILURE_TITLES } from '../../store/generationJobStore';
import { PanelHeader, EmptyState, IconButton, PrimaryButton, GhostButton, Spinner, Skeleton, inputClass, ink, muted, line } from './ui';
import ImageLibrary from './ImageLibrary';
import VoiceInputButton from './VoiceInputButton';
import { pagePhotos, numberPrefix, expandSectionNumbers } from './panelLogic';

const STEP = { queued: 'Waiting to start', processing: 'Writing the page', validating: 'Building the site and testing every page', repairing: 'Fixing a problem the checks found', committing: 'Saving the new version', completed: 'Saved', failed: 'Failed', cancelled: 'Cancelled' };
const TERMINAL = ['completed', 'failed', 'cancelled'];
const MAX_TEXT = 4000;
const SECTIONS_SHOWN = 10;

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
  const { site, siteLoading, pages, activePageId, selectPage, job, regenerate, cancelJob, busy, drafts, setDraft, selection, images, uploads, lastRequest, renamePage, contentWidth, setContentWidth, clearSelection, pageSections, sectionsLoading, sectionsError, loadSections, editedPageIds } = store;
  const collapsed = useTemplateStudioStore((state) => state.contentCollapsed);
  const setCollapsed = useTemplateStudioStore((state) => state.setContentCollapsed);
  const page = pages.find((item) => item.id === activePageId) || null;
  const [renaming, setRenaming] = useState(null);   // the new name while editing
  const [resizing, setResizing] = useState(false);
  const [picked, setPicked] = useState({}); // the ticked section numbers, per page; they are shown as chips, never typed into the prompt
  // The ticks are kept per website, so a refresh of the page does not lose them.
  const siteKey = site?.id || null;
  const pickedFor = useRef(null);
  useEffect(() => {
    if (!siteKey || pickedFor.current === siteKey) return;
    pickedFor.current = siteKey;
    setPicked(readUi().picked?.[siteKey] || {});
  }, [siteKey]);
  useEffect(() => {
    if (!siteKey || pickedFor.current !== siteKey) return;
    const clean = Object.fromEntries(Object.entries(picked).filter(([, numbers]) => Array.isArray(numbers) && numbers.length));
    writeUi({ picked: { ...(readUi().picked || {}), [siteKey]: clean } });
  }, [picked, siteKey]);
  const panel = useRef(null);

  const currentPageIndex = pages.findIndex((item) => item.id === activePageId);
  const nextPage = currentPageIndex >= 0 && currentPageIndex < pages.length - 1 ? pages[currentPageIndex + 1] : null;

  const isPageEdited = (p) => Boolean(
    (editedPageIds && editedPageIds[p?.id]) ||
    p?.currentRevision > 1 ||
    Boolean(p?.lastInstruction) ||
    p?.generation?.state === 'completed'
  );

  const instruction = (activePageId && drafts[activePageId]) || '';
  const running = job && !TERMINAL.includes(job.status);
  const mine = job && (job.pageId === activePageId || !job.pageId);
  const chosen = (activePageId && selection[activePageId]) || {};
  const chosenImages = pagePhotos(chosen, images).ids;
  const uploading = uploads.some((item) => item.status === 'queued' || item.status === 'uploading');
  const canSend = Boolean(instruction.trim()) && !running && !busy.regenerate && !uploading;

  useEffect(() => { setRenaming(null); }, [activePageId]);

  // Only the page being edited is read (reading a page also remembers it as the site's last page, so reading every page would
  // overwrite that). Other pages are read when they are opened.
  useEffect(() => {
    if (activePageId && pageSections[activePageId] === undefined) loadSections(activePageId);
  }, [activePageId, pageSections, loadSections]);

  // The sections are exactly what the server found in this page's source: no invented names, no forced Navigation / Footer.
  const loaded = activePageId ? pageSections[activePageId] : undefined;
  const sections = Array.isArray(loaded) ? loaded : [];
  const [showAllSections, setShowAllSections] = useState(false);
  useEffect(() => { setShowAllSections(false); }, [activePageId]);
  const checkedNumbers = (activePageId && picked[activePageId]) || [];

  // The ticked sections are told to the preview, which dims every other section so the chosen ones are easy to see.
  const focusKey = checkedNumbers.map((n) => sections[n - 1]?.id).filter(Boolean).join('|');
  useEffect(() => {
    const chosenSections = checkedNumbers.map((n) => sections[n - 1]).filter(Boolean).map((item) => ({ name: item.name, domId: item.domId || null }));
    window.dispatchEvent(new CustomEvent('studio-focus-sections', { detail: { sections: chosenSections } }));
  }, [focusKey, activePageId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('studio-focus-sections', { detail: { sections: [] } })); }, []);
  const selectedIndex = Math.max(-1, ...checkedNumbers.map((n) => n - 1));
  const expanded = showAllSections || selectedIndex >= SECTIONS_SHOWN;
  const visibleSections = expanded ? sections : sections.slice(0, SECTIONS_SHOWN);
  const hiddenCount = sections.length - visibleSections.length;
  const sectionsFailed = Boolean(activePageId && sectionsError?.[activePageId]);
  const isLoadingSections = Boolean(activePageId && (loaded === undefined || (sectionsLoading && !sections.length)) && !sectionsFailed);
  // Sections are picked with check boxes and shown as chips above the prompt; the AI is sent their names.
  const setChecked = (numbers) => setPicked((state) => ({ ...state, [activePageId]: [...new Set(numbers)].sort((a, b) => a - b) }));
  const toggleSection = (section, idx) => {
    if (!activePageId || running) return;
    const number = idx + 1;
    const on = !checkedNumbers.includes(number);
    setChecked(on ? [...checkedNumbers, number] : checkedNumbers.filter((n) => n !== number));
    if (on) {
      requestAnimationFrame(() => { const box = document.getElementById('page-instruction'); if (box) box.focus({ preventScroll: true }); });
      window.dispatchEvent(new CustomEvent('studio-scroll-section', { detail: { id: section.id, name: section.name, domId: section.domId || null, order: section.order } }));
    }
  };

  // Touching anything in the Content column folds the app's menu sidebar (the far-left Template Studio menu), so the work area gets the room.
  const foldMenu = () => { const store = useTemplateStudioStore.getState(); if (!store.appSidebarHidden) store.setAppSidebarHidden(true); };

  const selectedText = useTemplateStudioStore((state) => state.selectedText);
  const editSelectedText = useTemplateStudioStore((state) => state.editSelectedText);
  const saveSelectedText = useTemplateStudioStore((state) => state.saveSelectedText);
  const setSelectedText = useTemplateStudioStore((state) => state.setSelectedText);
  const closeSelectedText = () => { if (selectedText) { saveSelectedText(); window.dispatchEvent(new CustomEvent('studio-text-clear')); setSelectedText(null); } };
  const TAG_LABEL = { h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading', p: 'Paragraph', a: 'Link', button: 'Button', li: 'List item', label: 'Label', blockquote: 'Quote', figcaption: 'Caption' };

  const attachmentsNow = () => chosenImages.map((id) => ({ path: images.find((image) => image.id === id).path, placement: chosen[id].placement, note: chosen[id].note }));

  const submit = async (event) => {
    event.preventDefault();
    if (!canSend) return;
    // The text stays in place until the page is saved, so a failed run can be sent again with one click.
    const sent = expandSectionNumbers(`${numberPrefix(checkedNumbers)}${instruction.trim()}`, sections);
    if (await regenerate(sent.instruction, attachmentsNow(), sent.focus)) { clearSelection(); setChecked([]); }
  };

  const saveName = async () => {
    const name = (renaming || '').trim();
    if (!name || name === page.name) { setRenaming(null); return; }
    if (await renamePage(page.id, { name })) setRenaming(null);
  };

  // Dragging the panel's right edge changes its width; the width is remembered.
  // With the menu sidebar and the Pages column both folded, Content and Preview share the room 30 / 70 (until the owner drags the edge).
  const menuHidden = useTemplateStudioStore((state) => state.appSidebarHidden);
  const pagesFolded = useTemplateStudioStore((state) => state.pagesCollapsed);
  const [manualSize, setManualSize] = useState(false);
  useEffect(() => { if (!(menuHidden && pagesFolded)) setManualSize(false); }, [menuHidden, pagesFolded]);
  const focusLayout = menuHidden && pagesFolded && !collapsed && !manualSize;

  const startResize = (event) => {
    event.preventDefault();
    setManualSize(true);
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
    <section ref={panel} aria-label="Content editor" onPointerDownCapture={foldMenu} onFocusCapture={foldMenu} style={{ '--content-width': focusLayout ? 'calc((100% - 3rem) * 0.3)' : `${contentWidth}px` }}
      className={`${className} ${collapsed ? 'lg:!hidden' : ''} relative w-full shrink-0 flex-col border-r ${line} bg-[#FBF9F4] lg:w-[var(--content-width)] ${resizing ? '' : 'lg:transition-[width] lg:duration-200'}`}>
      <PanelHeader title="Content" action={<IconButton label="Hide Content" className="hidden lg:block" onClick={() => setCollapsed(true)}><ChevronsLeft className="h-4 w-4" /></IconButton>} />

      {siteLoading && !site ? <div className="space-y-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-28" /></div> : null}
      {!siteLoading && !site ? <EmptyState title="Nothing to edit yet">Create or pick a site, then choose a page.</EmptyState> : null}
      {site && !page ? <EmptyState title="Choose a page">Pick a page in the list to describe the changes you want.</EmptyState> : null}

      {site && page ? (
        <div className="min-h-0 flex-1 divide-y divide-[#E2DCCF] overflow-y-auto">
          {/* A. Text clicked in the preview: edit it here and the page changes as you type */}
          <section aria-label="Selected text" className="px-5 py-4">
            <div className="mb-2 flex items-baseline justify-between">
              <SectionTitle><Type className="mr-1 inline h-3 w-3 align-[-2px]" />Text in the page</SectionTitle>
              {selectedText ? <button type="button" onClick={closeSelectedText} aria-label="Done editing this text" className="rounded p-0.5 hover:bg-[#EFEBE1]"><X className="h-3 w-3" /></button> : null}
            </div>
            {selectedText ? (
              <div>
                <div className={`mb-1.5 flex items-center justify-between text-[11px] ${muted}`}>
                  <span className="rounded-full bg-[#E8F0E8] px-2 py-0.5 font-medium text-[#3F5E41]">{TAG_LABEL[selectedText.tag] || 'Text'}</span>
                  <span role="status" aria-live="polite" className="flex items-center gap-1">
                    {selectedText.status === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</> : selectedText.status === 'saved' ? <><Check className="h-3 w-3 text-[#5E7B5F]" />Saved</> : selectedText.status === 'error' ? <span className="text-[#A4493A]">Not saved</span> : selectedText.text.replace(/\s+/g, ' ').trim() !== selectedText.saved ? 'Editing…' : null}
                  </span>
                </div>
                <textarea
                  aria-label="Text of the selected element" value={selectedText.text} disabled={running} rows={Math.min(8, Math.max(2, Math.ceil(selectedText.text.length / 38)))}
                  onChange={(event) => editSelectedText(event.target.value)} onBlur={saveSelectedText} maxLength={2000}
                  className={`${inputClass} resize-y px-3 py-2 text-sm leading-relaxed`}
                />
                {selectedText.status === 'error' && selectedText.error ? <p role="alert" className="mt-1.5 rounded-md border border-[#D9B8B0] bg-[#F7E9E5] p-2 text-[11px] text-[#7A3A2E]">{selectedText.error}</p> : <p className={`mt-1.5 text-[11px] ${muted}`}>The page changes as you type and the change is saved to the site.</p>}
              </div>
            ) : (
              <p className={`rounded-md border border-dashed ${line} p-3 text-center text-xs ${muted}`}>Click any text in the preview to edit it here.</p>
            )}
          </section>

          {/* B. Page sections – prominent list of all detected sections */}
          <section aria-label="Page sections" className="px-5 py-5">
            <div className="mb-2.5 flex items-baseline justify-between">
              <SectionTitle hint={sections.length ? `${sections.length} ${sections.length === 1 ? 'section' : 'sections'}` : null}>
                <LayoutList className="mr-1 inline h-3 w-3 align-[-2px]" />
                Sections on this page
              </SectionTitle>
              {activePageId ? (
                <IconButton label="Refresh sections" onClick={() => loadSections(activePageId)} disabled={sectionsLoading} className="!p-0.5">
                  <RotateCcw className={`h-3 w-3 ${sectionsLoading ? 'animate-spin text-[#5E7B5F]' : ''}`} />
                </IconButton>
              ) : null}
            </div>

            {isLoadingSections ? (
              <div className="space-y-2" role="status" aria-label="Reading the sections of this page">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : sectionsFailed ? (
              <div role="alert" className="rounded-md border border-[#D9B8B0] bg-[#F7E9E5] p-3 text-xs text-[#7A3A2E]">
                <p>{sectionsError[activePageId]}</p>
                <button type="button" onClick={() => loadSections(activePageId)} className="mt-1.5 font-medium underline underline-offset-2">Try again</button>
              </div>
            ) : sections.length > 0 ? (
              <ol className="space-y-1.5" aria-label="Sections on this page">
                {visibleSections.map((sec, idx) => {
                  const selected = checkedNumbers.includes(idx + 1);
                  return (
                    <li key={sec.id}>
                      <label
                        title={`Select section ${idx + 1} (${sec.name}) and show it in the preview`}
                        className={`flex w-full cursor-pointer items-center gap-2 rounded-md border bg-white p-2 text-left text-xs transition focus-within:ring-2 focus-within:ring-[#5E7B5F] ${selected ? 'border-[#5E7B5F] bg-[#F1F6F1]' : `${line} hover:border-[#5E7B5F]/60 hover:bg-[#FDFCF9]`} ${running ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <input type="checkbox" checked={selected} disabled={running} onChange={() => toggleSection(sec, idx)} aria-label={`Section ${idx + 1}: ${sec.name}`} className="h-3.5 w-3.5 shrink-0 accent-[#5E7B5F]" />
                        <span className={`flex h-4 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold ${selected ? 'bg-[#5E7B5F] text-white' : 'bg-[#EFEBE1] text-[#5E7B5F]'}`}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className={`truncate font-medium ${ink}`}>{sec.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {sections.length > SECTIONS_SHOWN && !isLoadingSections && !sectionsFailed ? (
              <button type="button" onClick={() => setShowAllSections((value) => !value)} aria-expanded={expanded} className={`mt-2 w-full rounded-md border border-dashed ${line} px-3 py-2 text-xs font-medium ${ink} hover:border-[#5E7B5F]/60 hover:bg-[#FDFCF9] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E7B5F]`}>
                {expanded ? 'Show fewer sections' : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'section' : 'sections'}`}
              </button>
            ) : null}
            {isLoadingSections || sectionsFailed || sections.length > 0 ? null : (
              <p className={`rounded-md border border-dashed ${line} p-3 text-center text-xs ${muted}`}>
                No separate sections were found on this page. It renders as one layout, and the AI instruction below still applies to the whole page.
              </p>
            )}
          </section>

          {/* C. AI page instructions */}
          <form onSubmit={submit} aria-label="AI page instructions" className="space-y-5 px-5 py-5">
            <div>
              <SectionTitle hint={<span className={instruction.length > MAX_TEXT - 200 ? 'text-[#A4493A]' : ''}>{instruction.length}/{MAX_TEXT}</span>}>AI instructions</SectionTitle>
              <div className={`rounded-md border ${line} bg-white focus-within:border-[#5E7B5F] focus-within:ring-1 focus-within:ring-[#5E7B5F]`}>
                {checkedNumbers.length ? (
                  <div className={`flex flex-wrap items-center gap-1.5 border-b ${line} px-2.5 py-2`} aria-label="Selected sections">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>{checkedNumbers.length === 1 ? 'Section' : 'Sections'}</span>
                    {checkedNumbers.map((n) => (
                      <span key={n} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#E8F0E8] py-0.5 pl-1 pr-1.5 text-[11px] font-medium text-[#3F5E41]">
                        <span className="flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-[#5E7B5F] px-1 font-mono text-[10px] font-semibold text-white">{String(n).padStart(2, '0')}</span>
                        <span className="max-w-[9rem] truncate">{sections[n - 1]?.name}</span>
                        <button type="button" disabled={running} onClick={() => setChecked(checkedNumbers.filter((x) => x !== n))} aria-label={`Remove section ${n}`} className="rounded-full p-0.5 hover:bg-[#5E7B5F]/15 disabled:opacity-50"><X className="h-3 w-3" /></button>
                      </span>
                    ))}
                    {checkedNumbers.length > 1 ? <button type="button" disabled={running} onClick={() => setChecked([])} className={`ml-auto text-[11px] font-medium underline underline-offset-2 ${muted}`}>Clear</button> : null}
                  </div>
                ) : null}
                <textarea id="page-instruction" aria-label="Instruction for this page" value={instruction} onChange={(event) => setDraft(page.id, event.target.value)} maxLength={MAX_TEXT} rows={4} disabled={running}
                  placeholder={checkedNumbers.length ? 'What should change in the selected sections?' : 'Tell the AI what to change on this page…'}
                  className={`block min-h-[6rem] w-full resize-y rounded-md border-0 bg-transparent px-3 py-2 text-sm leading-relaxed ${ink} placeholder:text-xs placeholder:text-[#A59E90] focus:outline-none focus:ring-0`} />
                <div className="flex justify-end px-2 pb-2">
                  <VoiceInputButton disabled={running} onText={(text) => setDraft(page.id, `${instruction}${instruction && !/\s$/.test(instruction) ? ' ' : ''}${text}`.slice(0, MAX_TEXT))} />
                </div>
              </div>
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
                Normally only this page changes. If your prompt is about the whole site (menu, footer, logo, site name, or something like &ldquo;remove the rental tabs&rdquo;), the shared parts change too. The current version is kept if the new one does not pass the checks.
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
                      {lastRequest && lastRequest.pageId === page.id ? <PrimaryButton className="!px-3 !py-1.5 text-xs" disabled={busy.regenerate} onClick={() => regenerate(lastRequest.instruction, lastRequest.attachments, lastRequest.focusSection)}><RotateCcw className="h-3 w-3" />Try again</PrimaryButton> : null}
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
