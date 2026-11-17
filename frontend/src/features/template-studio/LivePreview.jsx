import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Tablet, Smartphone, RefreshCw } from 'lucide-react';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { ASSET_BASE_PLACEHOLDER } from '../../services/previewService';
import { Skeleton, ErrorNote, IconButton, Spinner, ink, muted, line } from './ui';

const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: '100%' },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: '768px' },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: '390px' }
];

const cache = new Map(); // `${id}@${version}` -> compiled html (already pointing at the template's pictures)

/**
 * The selected template's real website (compiled by the server from the template's own files) in a sandboxed iframe.
 * A theme change is sent to the page as CSS made by the same server code that writes the theme into a created site,
 * so every heading, button, colour and spacing on every page of the preview changes, not a sample card.
 * `onTheme` receives the server's normalised result (for example a text colour corrected for contrast).
 */
export default function LivePreview({ template, pages = [], theme, onTheme }) {
  const [device, setDevice] = useState('desktop');
  const [state, setState] = useState({ status: 'loading', html: '', error: null });
  const [pageRoute, setPageRoute] = useState('/');
  const [themeBusy, setThemeBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const frame = useRef(null);
  const cssRef = useRef('');
  const key = template ? `${template.id}@${template.version}` : null;

  // Compile (once per template) and show the template's website.
  useEffect(() => {
    if (!template) return undefined;
    let alive = true;
    cssRef.current = '';
    setPageRoute('/');
    if (cache.has(key) && reloadKey === 0) { setState({ status: 'ready', html: cache.get(key), error: null }); return undefined; }
    setState({ status: 'loading', html: '', error: null });
    templateSiteService.templateSiteHtml(template.id, template.version)
      .then((res) => {
        if (!alive) return;
        const html = res.data.html.split(ASSET_BASE_PLACEHOLDER).join(`${window.location.origin}/api/templates/${encodeURIComponent(template.id)}/assets`);
        cache.set(key, html);
        setState({ status: 'ready', html, error: null });
      })
      .catch((error) => alive && setState({ status: 'error', html: '', error: apiMessage(error, 'The template preview could not be built.') }));
    return () => { alive = false; };
  }, [key, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = useCallback(() => {
    try { frame.current?.contentWindow?.postMessage({ type: 'veave-theme', css: cssRef.current }, '*'); } catch { /* the frame may be reloading */ }
  }, []);

  // A theme change reaches the page after a short pause (the server makes the CSS).
  const themeKey = JSON.stringify(theme || null);
  const onThemeRef = useRef(onTheme);
  onThemeRef.current = onTheme;
  useEffect(() => {
    if (!template) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      setThemeBusy(true);
      templateSiteService.templateThemeCss(template.id, theme || null, template.version)
        .then((res) => { if (!alive) return; cssRef.current = res.data.css || ''; push(); onThemeRef.current?.(res.data); })
        .catch(() => {})
        .finally(() => alive && setThemeBusy(false));
    }, 140);
    return () => { alive = false; clearTimeout(timer); };
  }, [themeKey, key, push]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (route) => {
    setPageRoute(route);
    try { frame.current?.contentWindow?.postMessage({ type: 'preview-restore-route', route }, '*'); } catch { /* ignore */ }
  };

  const device$ = DEVICES.find((item) => item.id === device);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 bg-[#FBF9F4] px-3 py-2`}>
        <div className={`flex items-center rounded-lg border ${line} bg-[#F3EFE5] p-0.5`} role="group" aria-label="Preview size">
          {DEVICES.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setDevice(id)} aria-pressed={device === id} title={label}
              className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${device === id ? 'bg-white text-[#2B2823] shadow-sm' : `${muted} hover:text-[#2B2823]`}`}>
              <Icon className="h-3.5 w-3.5" /><span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>
        {/* The site's pages as a tab strip: one line that scrolls sideways instead of wrapping; below tablet it takes its own row. */}
        <div className="order-last col-span-3 min-w-0 md:order-none md:col-span-1" role="group" aria-label="Preview page">
          <div className="flex items-center gap-1 overflow-x-auto md:justify-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {pages.map((page) => (
              <button key={page.path} type="button" onClick={() => goTo(page.path)} aria-pressed={pageRoute === page.path} aria-current={pageRoute === page.path ? 'page' : undefined}
                className={`h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition ${pageRoute === page.path ? 'bg-[#5E7B5F] text-white shadow-sm' : `${muted} hover:bg-[#EFEBE1] hover:text-[#2B2823]`}`}>{page.title}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {themeBusy ? <Spinner className="h-3 w-3 text-[#5E7B5F]" /> : null}
          <span className={`hidden text-[11px] 2xl:inline ${muted}`}>{device$.id === 'desktop' ? 'Full width' : device$.width}</span>
          <IconButton label="Refresh preview" onClick={() => { cache.delete(key); setReloadKey((value) => value + 1); }}><RefreshCw className="h-3.5 w-3.5" /></IconButton>
        </div>
      </div>

      <div className="relative min-h-[320px] flex-1 overflow-auto bg-[#EFEBE1] p-3 sm:p-4">
        {state.status === 'loading' ? (
          <div className="mx-auto flex h-full flex-col gap-3 rounded-lg bg-white p-5 shadow-sm" style={{ width: device$.width, maxWidth: '100%' }} aria-busy="true" aria-label="Building the template preview">
            <Skeleton className="h-10 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-6 w-1/2" />
            <div className="grid grid-cols-3 gap-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
            <p className={`mt-auto flex items-center justify-center gap-2 text-xs ${muted}`}><Spinner className="h-3.5 w-3.5" />Building the {template?.name} website…</p>
          </div>
        ) : null}
        {state.status === 'error' ? <ErrorNote onRetry={() => setReloadKey((value) => value + 1)}>{state.error}</ErrorNote> : null}
        {state.status === 'ready' ? (
          <div className="mx-auto h-full overflow-hidden rounded-lg bg-white shadow-[0_1px_3px_rgba(43,40,35,0.12),0_8px_24px_rgba(43,40,35,0.08)] ring-1 ring-black/5 transition-[width] duration-200" style={{ width: device$.width, maxWidth: '100%' }} data-viewport={device}>
            <iframe ref={frame} title={`${template.name} website preview`} srcDoc={state.html} sandbox="allow-scripts" onLoad={() => { push(); }} className={`h-full w-full border-0 bg-white ${ink}`} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
