import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Tablet, Smartphone, RefreshCw, Maximize2, Minimize2, History, RotateCcw, X } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { ASSET_BASE_PLACEHOLDER } from '../../services/previewService';
import { PanelHeader, EmptyState, ErrorNote, IconButton, Spinner, Skeleton, GhostButton, PrimaryButton, ink, muted, line } from './ui';

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: '100%', hint: 'Full width' },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: '768px', hint: '768 px' },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: '390px', hint: '390 px' }
];

/**
 * The generated website itself, compiled on the server and shown in a sandboxed iframe: the page cannot reach the studio (no
 * same-origin access) and talks to it only through messages. Nothing here is a mock-up of the site.
 */
export default function SitePreviewPanel({ className = '' }) {
  const { site, pages, activePageId, previewKey, selectPage, job, revisionPreview, closeRevisionPreview, restoreRevision, previewRevision, busy } = useTemplateStudioStore();
  const [full, setFull] = useState(false);
  const page = pages.find((item) => item.id === activePageId) || null;
  const [device, setDevice] = useState('desktop');
  const [manualKey, setManualKey] = useState(0);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const [state, setState] = useState({ status: 'idle', html: '', hash: '', error: null });
  const iframeRef = useRef(null);
  const hashRef = useRef('');
  const routeRef = useRef('/');
  const pagesRef = useRef(pages);
  routeRef.current = page?.route || '/';
  pagesRef.current = pages;
  const siteId = site?.id || null;

  const load = useCallback(async (force) => {
    if (!siteId) return;
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const res = await templateSiteService.getPreview(siteId, { hash: force ? '' : hashRef.current });
      const preview = res.data.preview;
      if (preview.status !== 'ready') {
        setState({ status: 'error', html: '', hash: '', error: preview.error || (preview.status === 'skipped' ? 'The site is too large to preview.' : 'The preview could not be built.') });
        return;
      }
      if (preview.unchanged && !force) { setState((current) => ({ ...current, status: 'ready' })); return; }
      const base = `${window.location.origin}/api/preview-assets/${preview.token}`;
      hashRef.current = preview.sourceHash;
      setState({ status: 'ready', html: preview.html.split(ASSET_BASE_PLACEHOLDER).join(base), hash: preview.sourceHash, error: null });
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error: apiMessage(error, 'The preview could not be loaded.') }));
    }
  }, [siteId]);

  // A different site starts from nothing; a saved change or the refresh button reloads (and is compared by hash, so nothing flickers when unchanged).
  useEffect(() => { hashRef.current = ''; setState({ status: siteId ? 'loading' : 'idle', html: '', hash: '', error: null }); }, [siteId]);
  useEffect(() => { load(manualKey > 0); }, [load, previewKey, manualKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const showRoute = useCallback((route) => {
    try {
      const frame = iframeRef.current?.contentWindow;
      // The generated page is browsed, not inspected: links must navigate instead of selecting elements.
      frame?.postMessage({ type: 'toggle-inspect-mode', enabled: false }, '*');
      frame?.postMessage({ type: 'preview-restore-route', route }, '*');
    } catch { /* the frame may be reloading */ }
  }, []);

  // Choosing a page in the list shows that page in the website.
  useEffect(() => { if (state.status === 'ready') showRoute(routeRef.current); }, [page?.route, state.status, state.hash, showRoute]);

  // The website tells the studio when the visitor navigates inside it, so the page list follows.
  useEffect(() => {
    const onMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (event.data?.type === 'preview-rendered') showRoute(routeRef.current);
      if (event.data?.type === 'preview-route-changed') {
        const route = String(event.data.route || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
        const target = pagesRef.current.find((item) => item.route === route);
        if (target) selectPage(target.id);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectPage, showRoute]);

  const width = DEVICES.find((item) => item.id === device)?.width || '100%';
  const regenerating = job && !['completed', 'failed', 'cancelled'].includes(job.status);

  // An older revision, when one is being looked at, replaces the live site until it is closed.
  const old = revisionPreview?.status === 'ready' ? revisionPreview : null;
  const oldHtml = old ? old.html.split(ASSET_BASE_PLACEHOLDER).join(`${window.location.origin}/api/preview-assets/${old.token}`) : '';
  const html = old ? oldHtml : state.html;
  const frameKey = old ? `rev-${old.number}` : `${state.hash}:${manualKey}`;
  const loading = revisionPreview?.status === 'loading' || (!old && site && state.status === 'loading' && !state.html);
  const frameError = revisionPreview?.status === 'error' ? revisionPreview.error : (!old && site && state.status === 'error' ? state.error : null);

  return (
    <section aria-label="Live website preview" className={`${className} min-w-0 flex-1 flex-col bg-[#EFEBE1] ${full ? 'fixed inset-0 z-50 !flex' : ''}`}>
      <PanelHeader
        title={full && site ? `${site.name} · Preview` : 'Preview'}
        action={site ? (
          <div className="flex items-center gap-1">
            <span className={`mr-2 hidden max-w-[10rem] truncate font-mono text-[11px] sm:inline ${muted}`}>{page?.route || '/'}</span>
            <div role="group" aria-label="Device" className={`flex items-center rounded-md border ${line} bg-[#F7F4EE] p-0.5`}>
              {DEVICES.map(({ id, label, icon: Icon, hint }) => (
                <button key={id} type="button" onClick={() => setDevice(id)} aria-pressed={device === id} aria-label={`${label} preview`} title={`${label} (${hint})`}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition ${device === id ? 'bg-white text-[#2B2823] shadow-sm' : `${muted} hover:text-[#2B2823]`}`}>
                  <Icon className="h-3.5 w-3.5" />{device === id ? <span className="hidden xl:inline">{label}</span> : null}
                </button>
              ))}
            </div>
            <span className="mx-1 h-4 w-px bg-[#D8D2C3]" aria-hidden="true" />
            <IconButton label="Refresh preview" onClick={() => setManualKey((value) => value + 1)} disabled={Boolean(old)}><RefreshCw className={`h-4 w-4 ${state.status === 'loading' ? 'animate-spin' : ''}`} /></IconButton>
            <IconButton label={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull((value) => !value)}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</IconButton>
          </div>
        ) : null}
      />
      {revisionPreview ? (
        <div role="status" className={`flex flex-wrap items-center gap-2 border-b ${line} bg-[#F3EFE5] px-4 py-2 text-xs ${ink}`}>
          <History className="h-3.5 w-3.5 text-[#5E7B5F]" />
          <span className="font-medium">{revisionPreview.kind === 'version' ? (revisionPreview.status === 'loading' ? 'Opening that version…' : `Viewing version ${revisionPreview.number}${revisionPreview.label ? ` · ${revisionPreview.label}` : ''}`) : (revisionPreview.status === 'loading' ? `Opening revision ${revisionPreview.number}…` : `Viewing revision ${revisionPreview.number}`)}</span>
          <span className={muted}>Read-only. Nothing has changed yet.</span>
          <span className="ml-auto flex gap-1.5">
            <GhostButton className="!px-2 !py-1 text-xs" onClick={closeRevisionPreview}><X className="h-3 w-3" />Back to current</GhostButton>
            {old ? <PrimaryButton className="!px-2.5 !py-1 text-xs" disabled={busy.restore || regenerating} onClick={() => (old.kind === 'version' ? useTemplateStudioStore.getState().restoreVersion(old.versionId) : restoreRevision(old.number))}><RotateCcw className="h-3 w-3" />Restore this</PrimaryButton> : null}
          </span>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden p-0">
        {!site ? <EmptyState title="No website to show">Create a site from a template and it appears here as a real, working website.</EmptyState> : null}
        {loading ? (
          <div className="mx-auto flex h-full flex-col gap-3 bg-white p-4 transition-[width] duration-200" style={{ width, maxWidth: '100%' }} aria-busy="true" aria-label="Building the preview">
            <Skeleton className="h-8 w-full" /><Skeleton className="h-48 w-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-6 w-1/2" />
            <div className="grid grid-cols-3 gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
            <p className={`mt-auto flex items-center justify-center gap-2 text-xs ${muted}`}><Spinner className="h-3.5 w-3.5" />{revisionPreview?.status === 'loading' ? 'Building that revision…' : 'Building the preview…'}</p>
          </div>
        ) : null}
        {frameError ? (
          <ErrorNote onRetry={revisionPreview ? () => (revisionPreview.kind === 'version' ? useTemplateStudioStore.getState().previewVersion(revisionPreview.versionId, revisionPreview.label) : previewRevision(revisionPreview.number)) : () => setManualKey((value) => value + 1)}>{frameError}</ErrorNote>
        ) : null}
        {site && html && !frameError ? (
          <div className={`mx-auto h-full overflow-hidden bg-white transition-[width] duration-200 ${width === '100%' ? '' : `border-x ${line} shadow-sm`}`} style={{ width, maxWidth: '100%' }} data-viewport={device}>
            <iframe
              key={frameKey} ref={iframeRef} title={`${site.name} website preview`} srcDoc={html}
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              onLoad={() => showRoute(routeRef.current)} className="h-full w-full border-0 bg-white"
            />
          </div>
        ) : null}
        {regenerating ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3" role="status">
            <span className={`flex items-center gap-2 rounded-full border ${line} bg-[#FBF9F4]/95 px-3 py-1.5 text-xs shadow ${ink}`}><Spinner className="h-3 w-3 text-[#5E7B5F]" />{job.pageId ? 'Regenerating a page. This is the current saved version.' : 'Writing the pages. This is the current saved version.'}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
