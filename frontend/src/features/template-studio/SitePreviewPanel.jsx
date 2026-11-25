import React, { useCallback, useEffect, useRef, useState } from 'react';
import SectionEditModal from './SectionEditModal';
import { penScript, blocksScript } from './sectionEditScripts';
import { API_URL } from '../../config';
import { Monitor, Tablet, Smartphone, RefreshCw, Maximize2, Minimize2, History, RotateCcw, X, Palette, Type } from 'lucide-react';
import { useTemplateStudioStore, readUi, writeUi } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { ASSET_BASE_PLACEHOLDER } from '../../services/previewService';
import ThemePanel from './ThemePanel';
import { THEME_LISTENER, TEXT_EDIT_SCRIPT, FOCUS_SCRIPT, IMAGE_BUTTON_SCRIPT } from './previewScripts';
import ImageChangeModal from './ImageChangeModal';
import { PanelHeader, EmptyState, ErrorNote, IconButton, Spinner, Skeleton, GhostButton, PrimaryButton, ink, muted, line } from './ui';


// The assistant a generated website can call: window.VEAVE_AI.ask(question, { topic }) -> Promise<string>. Published websites get the same helper.
const siteAiRuntime = (projectId) => {
  const base = String(API_URL || '/api').replace(/\/+$/, '');
  const endpoint = /^https?:/i.test(base) ? `${base}/site-ai/ask` : `${window.location.origin}${base.startsWith('/') ? '' : '/'}${base}/site-ai/ask`;
  return `<script>window.VEAVE_AI={endpoint:${JSON.stringify(endpoint)},project:${JSON.stringify(String(projectId || ''))},ask:function(q,o){o=o||{};var self=this;return fetch(self.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:self.project,question:String(q||''),topic:o.topic||''})}).then(function(r){return r.json().catch(function(){return {};}).then(function(d){if(!r.ok||!d.success)throw new Error((d&&d.error&&d.error.message)||'The assistant is unavailable right now.');return d.answer;});});}};</script>`;
};

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
  const { site, pages, activePageId, previewKey, selectPage, job, lastRequest, revisionPreview, closeRevisionPreview, restoreRevision, previewRevision, busy } = useTemplateStudioStore();
  const iframeRef = useRef(null);
  const [full, setFull] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [textMode, setTextModeState] = useState(() => readUi().textMode !== false);
  const setTextMode = (next) => setTextModeState((value) => { const resolved = typeof next === 'function' ? next(value) : next; writeUi({ textMode: resolved }); return resolved; }); // click text in the page to edit it in the Content column (off: links work as in the real site)
  const textModeRef = useRef(readUi().textMode !== false);
  const [imageEdit, setImageEdit] = useState(null); // the picture opened with its image button: { src, alt, width, height }
  const [sectionEdit, setSectionEdit] = useState(null); // the section opened with its pen: { name, domId, html, head, ... }
  const scrollRef = useRef(0); // where the visitor was in the page, kept across reloads (a saved change reloads the preview)
  const focusRef = useRef([]);
  const startRouteRef = useRef({ key: null, route: '/' });
  const frameRouteRef = useRef(null); // the route the website itself last reported
  // Sections are only dimmed while the website really shows the selected page; otherwise the ticks would blur another page.
  const sendFocus = useCallback(() => {
    try {
      const { activePageId: activeId } = useTemplateStudioStore.getState();
      const shown = frameRouteRef.current;
      const same = shown === null || pageForRouteRef.current?.(shown)?.id === activeId;
      iframeRef.current?.contentWindow?.postMessage({ type: 'studio-focus-sections', sections: same ? focusRef.current : [] }, '*');
    } catch { /* the frame may be reloading */ }
  }, []);
  const pageForRouteRef = useRef(null);
  useEffect(() => {
    const onGet = (event) => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-section-get', ...event.detail }, '*'); } catch { /* the frame may be reloading */ } };
    window.addEventListener('studio-get-section', onGet);
    return () => window.removeEventListener('studio-get-section', onGet);
  }, []);
  useEffect(() => {
    const onFocus = (event) => { focusRef.current = event.detail?.sections || []; sendFocus(); };
    window.addEventListener('studio-focus-sections', onFocus);
    return () => window.removeEventListener('studio-focus-sections', onFocus);
  }, [sendFocus]);
  const sendTextMode = useCallback(() => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-text-mode', enabled: textModeRef.current }, '*'); } catch { /* the frame may be reloading */ } }, []);
  useEffect(() => {
    textModeRef.current = textMode;
    sendTextMode();
    if (!textMode) useTemplateStudioStore.getState().setSelectedText(null);
  }, [textMode, sendTextMode]);
  // The Content column sends typed text into the page, and clears the highlight when the selection is closed.
  useEffect(() => {
    const onSet = (event) => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-text-set', id: event.detail.id, text: event.detail.text }, '*'); } catch { /* ignore */ } };
    const onClear = () => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-text-clear' }, '*'); } catch { /* ignore */ } };
    window.addEventListener('studio-text-set', onSet);
    window.addEventListener('studio-text-clear', onClear);
    return () => { window.removeEventListener('studio-text-set', onSet); window.removeEventListener('studio-text-clear', onClear); };
  }, []);
  // While the theme panel is open, the app sidebar and the Pages / Content columns fold away so the preview gets the room; they come back as they were.
  useEffect(() => {
    if (!themeOpen) return undefined;
    const before = useTemplateStudioStore.getState();
    const saved = { sidebar: before.appSidebarHidden, pages: before.pagesCollapsed, content: before.contentCollapsed };
    before.setAppSidebarHidden(true);
    before.setPagesCollapsed(true);
    before.setContentCollapsed(true);
    return () => {
      const now = useTemplateStudioStore.getState();
      now.setAppSidebarHidden(saved.sidebar);
      now.setPagesCollapsed(saved.pages);
      now.setContentCollapsed(saved.content);
    };
  }, [themeOpen]);
  const cssRef = useRef('');
  const pushCss = useCallback((css) => {
    cssRef.current = css;
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'veave-theme', css }, '*'); } catch { /* the frame may be reloading */ }
  }, []);
  const closeTheme = useCallback((saved) => {
    setThemeOpen(false);
    if (!saved) pushCss(''); // unsaved changes are dropped; a saved one reloads the preview from the site itself
    cssRef.current = '';
  }, [pushCss]);
  const page = pages.find((item) => item.id === activePageId) || null;
  const [device, setDeviceState] = useState(() => (DEVICES.some((item) => item.id === readUi().device) ? readUi().device : 'desktop'));
  const setDevice = (id) => { writeUi({ device: id }); setDeviceState(id); };
  const [manualKey, setManualKey] = useState(0);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const [state, setState] = useState({ status: 'idle', html: '', hash: '', error: null });
  const hashRef = useRef('');
  const routeRef = useRef('/');
  const pagesRef = useRef(pages);
  const liveRouteRef = useRef('');
  pagesRef.current = pages;
  // A detail page is one sample of a dynamic route (/listings/k-1001 for /listings/:id): another record of the same route belongs to it too.
  const pageForRoute = useCallback((route) => {
    const list = pagesRef.current;
    const exact = list.find((item) => item.route === route);
    if (exact) return exact;
    const parts = route.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return list.find((item) => {
      const own = String(item.route || '').split('/').filter(Boolean);
      return own.length === parts.length && own.slice(0, -1).every((part, i) => part === parts[i]) && own[own.length - 1] !== parts[parts.length - 1];
    }) || null;
  }, []);
  // The page's own route changed (its sample record was rewritten away and the page now opens another one): the record the website was
  // left on is that old, missing record, so it is forgotten and the page's route is shown.
  const pageRouteRef = useRef({ id: null, route: null });
  if (page && pageRouteRef.current.id === page.id && pageRouteRef.current.route !== page.route) liveRouteRef.current = '';
  if (page) pageRouteRef.current = { id: page.id, route: page.route };
  // Keep showing the record the visitor opened, as long as it belongs to the selected page.
  routeRef.current = liveRouteRef.current && page && pageForRoute(liveRouteRef.current)?.id === page.id ? liveRouteRef.current : (page?.route || '/');
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

  pageForRouteRef.current = pageForRoute;
  const settleRef = useRef(0); // until this time, a route the website reports on its own (its start page) is not a visitor's choice
  const showRoute = useCallback((route) => {
    const send = () => {
      try {
        const frame = iframeRef.current?.contentWindow;
        // The generated page is browsed, not inspected: links must navigate instead of selecting elements.
        frame?.postMessage({ type: 'toggle-inspect-mode', enabled: false }, '*');
        frame?.postMessage({ type: 'preview-restore-route', route }, '*');
      } catch { /* the frame may be reloading */ }
    };
    send();
    // The website may not be listening yet right after a refresh, so the selected page is asked for again a few times.
    [250, 800, 1800].forEach((ms) => setTimeout(() => { if (routeRef.current === route) send(); }, ms));
  }, []);

  // Choosing a page in the list shows that page in the website.
  useEffect(() => { if (state.status === 'ready') showRoute(routeRef.current); }, [page?.route, state.status, state.hash, showRoute]);

  // Clicking a section in the Content column scrolls the website to that part of the page.
  useEffect(() => {
    const onScroll = (event) => {
      try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-scroll-to', section: { name: event.detail?.name ?? event.detail, domId: event.detail?.domId || null, index: event.detail?.index ?? -1, total: event.detail?.total ?? 0 } }, '*'); } catch { /* the frame may be reloading */ }
    };
    window.addEventListener('studio-scroll-section', onScroll);
    return () => window.removeEventListener('studio-scroll-section', onScroll);
  }, []);

  // The website tells the studio when the visitor navigates inside it, so the page list follows.
  useEffect(() => {
    const onMessage = (event) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      if (event.data?.type === 'preview-rendered') { showRoute(routeRef.current); sendTextMode(); }
      if (event.data?.type === 'studio-scroll') {
        scrollRef.current = Number(event.data.y) || 0;
        const siteKey = useTemplateStudioStore.getState().activeSiteId;
        if (siteKey) writeUi({ scroll: { ...(readUi().scroll || {}), [`${siteKey}:${routeRef.current}`]: scrollRef.current } });
      }
      if (event.data?.type === 'studio-section-html') window.dispatchEvent(new CustomEvent('studio-section-html', { detail: { key: event.data.key, html: String(event.data.html || ''), head: String(event.data.head || ''), htmlClass: String(event.data.htmlClass || ''), bodyClass: String(event.data.bodyClass || '') } }));
      if (event.data?.type === 'studio-nav-section') window.dispatchEvent(new CustomEvent('studio-nav-section', { detail: { domId: String(event.data.domId || ''), name: String(event.data.name || '') } }));
      if (event.data?.type === 'studio-image-edit' && revisionPreview?.status !== 'ready') setImageEdit({ src: String(event.data.src || ''), alt: String(event.data.alt || ''), width: Number(event.data.width) || 0, height: Number(event.data.height) || 0, section: event.data.section && event.data.section.name ? event.data.section : null });
      if (event.data?.type === 'studio-text-deselected') useTemplateStudioStore.getState().setSelectedText(null);
      if (event.data?.type === 'studio-section-edit' && revisionPreview?.status !== 'ready') setSectionEdit({ name: String(event.data.name || ''), domId: String(event.data.domId || ''), index: event.data.index, html: String(event.data.html || ''), head: String(event.data.head || ''), htmlClass: String(event.data.htmlClass || ''), bodyClass: String(event.data.bodyClass || '') });
      if (event.data?.type === 'studio-text-selected' && revisionPreview?.status !== 'ready') useTemplateStudioStore.getState().setSelectedText({ id: event.data.id, text: String(event.data.text || ''), tag: String(event.data.tag || '') });
      if (event.data?.type === 'preview-route-changed') {
        const route = String(event.data.route || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
        frameRouteRef.current = route;
        setTimeout(sendFocus, 0);
        if (Date.now() < settleRef.current && route !== (routeRef.current.split(/[?#]/)[0].replace(/\/+$/, '') || '/')) return;
        liveRouteRef.current = route;
        const target = pageForRoute(route);
        if (target) selectPage(target.id);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectPage, showRoute, sendTextMode, revisionPreview, pageForRoute]);

  const width = DEVICES.find((item) => item.id === device)?.width || '100%';
  const regenerating = job && !['completed', 'failed', 'cancelled'].includes(job.status);
  const sectionName = job && job.pageId && lastRequest && lastRequest.pageId === job.pageId ? String(lastRequest.focusSection || '').trim() : '';

  // An older revision, when one is being looked at, replaces the live site until it is closed.
  const old = revisionPreview?.status === 'ready' ? revisionPreview : null;
  const oldHtml = old ? old.html.split(ASSET_BASE_PLACEHOLDER).join(`${window.location.origin}/api/preview-assets/${old.token}`) : '';
  const raw = old ? oldHtml : state.html;
  const injected = THEME_LISTENER + `<script>(${blocksScript.toString()})();</script>` + TEXT_EDIT_SCRIPT + FOCUS_SCRIPT + `<script>(${penScript.toString()})();</script>` + IMAGE_BUTTON_SCRIPT;
  const frameKey = old ? `rev-${old.number}` : `${state.hash}:${manualKey}`;
  // A rebuilt website (after a finished job, a refresh) starts ON the page being edited instead of Home. The route is fixed per frame, so
  // moving between pages never reloads the frame.
  if (startRouteRef.current.key !== frameKey) startRouteRef.current = { key: frameKey, route: routeRef.current || '/' };
  const startScript = `<script>window.__veaveInitialRoute=${JSON.stringify(startRouteRef.current.route).replace(/</g, '\\u003c')};</script>`;
  const withRuntime = raw && !old ? (raw.includes('<head>') ? raw.replace('<head>', () => `<head>${startScript}${siteAiRuntime(site?.projectId)}`) : `${startScript}${siteAiRuntime(site?.projectId)}${raw}`) : raw;
  const html = raw && !old ? (withRuntime.includes('</body>') ? withRuntime.replace('</body>', () => `${injected}</body>`) : withRuntime + injected) : raw;
  const loading = revisionPreview?.status === 'loading' || (!old && site && state.status === 'loading' && !state.html);
  const frameError = revisionPreview?.status === 'error' ? revisionPreview.error : (!old && site && state.status === 'error' ? state.error : null);

  return (
    <section aria-label="Live website preview" className={`${className} min-w-0 flex-1 flex-col bg-[#EFEBE1] ${full ? 'fixed inset-0 z-50 !flex' : ''}`}>
      <PanelHeader
        title={full && site ? `${site.name} · Preview` : 'Preview'}
        action={site ? (
          <div className="flex items-center gap-1">
            <span className={`mr-2 hidden max-w-[10rem] truncate font-mono text-[11px] sm:inline ${muted}`}>{routeRef.current || page?.route || '/'}</span>
            <div role="group" aria-label="Device" className={`flex items-center rounded-md border ${line} bg-[#F7F4EE] p-0.5`}>
              {DEVICES.map(({ id, label, icon: Icon, hint }) => (
                <button key={id} type="button" onClick={() => setDevice(id)} aria-pressed={device === id} aria-label={`${label} preview`} title={`${label} (${hint})`}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition ${device === id ? 'bg-white text-[#2B2823] shadow-sm' : `${muted} hover:text-[#2B2823]`}`}>
                  <Icon className="h-3.5 w-3.5" />{device === id ? <span className="hidden xl:inline">{label}</span> : null}
                </button>
              ))}
            </div>
            <span className="mx-1 h-4 w-px bg-[#D8D2C3]" aria-hidden="true" />
            <IconButton label={textMode ? 'Editing text: click any text in the page (click to turn off and browse links)' : 'Click to edit text in the page'} onClick={() => setTextMode((value) => !value)} disabled={Boolean(revisionPreview)} className={textMode ? 'bg-white text-[#5E7B5F] shadow-sm' : ''}><Type className="h-4 w-4" /></IconButton>
            <IconButton label="Change theme" onClick={() => (themeOpen ? closeTheme(false) : setThemeOpen(true))} disabled={Boolean(revisionPreview)} className={themeOpen ? 'bg-white shadow-sm' : ''}><Palette className="h-4 w-4" /></IconButton>
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
      <div className="relative min-h-0 flex-1 overflow-hidden p-0" style={{ paddingRight: themeOpen ? 340 : 0 }}>
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
              onLoad={() => { settleRef.current = Date.now() + 2500; frameRouteRef.current = null; showRoute(routeRef.current); sendTextMode(); setTimeout(sendFocus, 400); try { const savedY = scrollRef.current || Number(readUi().scroll?.[`${useTemplateStudioStore.getState().activeSiteId}:${routeRef.current}`]) || 0; if (savedY > 0) iframeRef.current?.contentWindow?.postMessage({ type: 'studio-restore-scroll', y: savedY }, '*'); } catch { /* the frame may be reloading */ } useTemplateStudioStore.getState().setSelectedText(null); if (cssRef.current) pushCss(cssRef.current); }} className="h-full w-full border-0 bg-white"
            />
          </div>
        ) : null}
        {themeOpen && site ? <ThemePanel key={site.id} onCss={pushCss} onClose={closeTheme} /> : null}
        {regenerating ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3" role="status">
            <span className={`flex items-center gap-2 rounded-full border ${line} bg-[#FBF9F4]/95 px-3 py-1.5 text-xs shadow ${ink}`}><Spinner className="h-3 w-3 text-[#5E7B5F]" />{job.pageId ? (sectionName ? `Updating the section “${sectionName}”. The rest of the page stays as it is.` : 'Regenerating a page. This is the current saved version.') : 'Writing the pages. This is the current saved version.'}</span>
          </div>
        ) : null}
      </div>
      {imageEdit ? <ImageChangeModal key={imageEdit.src} target={imageEdit} onClose={() => setImageEdit(null)} /> : null}
      {sectionEdit ? <SectionEditModal key={`${sectionEdit.domId}:${sectionEdit.index}:${sectionEdit.name}`} payload={sectionEdit} onClose={() => setSectionEdit(null)} /> : null}
    </section>
  );
}
