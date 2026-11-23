import React, { useCallback, useEffect, useRef, useState } from 'react';
import SectionEditModal from './SectionEditModal';
import { penScript } from './sectionEditScripts';
import { API_URL } from '../../config';
import { Monitor, Tablet, Smartphone, RefreshCw, Maximize2, Minimize2, History, RotateCcw, X, Palette, Type } from 'lucide-react';
import { useTemplateStudioStore, readUi, writeUi } from '../../store/templateStudioStore';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { ASSET_BASE_PLACEHOLDER } from '../../services/previewService';
import ThemePanel from './ThemePanel';
import { PanelHeader, EmptyState, ErrorNote, IconButton, Spinner, Skeleton, GhostButton, PrimaryButton, ink, muted, line } from './ui';

// Lets the page take theme CSS from the studio while the theme panel is open (the same listener the template preview uses).
const THEME_LISTENER = `<style id="veave-theme"></style><script>window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='veave-theme'){document.getElementById('veave-theme').textContent=d.css||'';}});</script>`;

// Click-to-edit text inside the page. A click on text selects it and tells the studio; the studio sends new text back as it is typed.
const TEXT_EDIT_SCRIPT = `<script>(function(){
var on=true,sel=null,hov=null,map={},n=0;
var st=document.createElement('style');st.textContent='[data-studio-hover]{outline:1px dashed #5E7B5F!important;outline-offset:2px;cursor:text!important}[data-studio-sel]{outline:2px solid #5E7B5F!important;outline-offset:2px;background-color:rgba(94,123,95,.08)}';document.head.appendChild(st);
var st2=document.createElement('style');st2.textContent='[data-studio-soft]{opacity:.4!important;filter:grayscale(.35);transition:opacity .25s ease,filter .25s ease}';document.head.appendChild(st2);
function soft(el){clearSoft();if(!el)return;var s=el.closest&&el.closest('section');if(!s)return;var all=document.querySelectorAll('section');for(var i=0;i<all.length;i++){var o=all[i];if(o!==s&&!o.contains(s)&&!s.contains(o))o.setAttribute('data-studio-soft','');}}
function clearSoft(){var d=document.querySelectorAll('[data-studio-soft]');for(var i=0;i<d.length;i++)d[i].removeAttribute('data-studio-soft');}
function own(el){var t='';for(var c=el.firstChild;c;c=c.nextSibling){if(c.nodeType===3)t+=c.nodeValue;}return t;}
function norm(t){return t.replace(/\s+/g,' ').trim();}
function skip(el){return !el||/^(SCRIPT|STYLE|SVG|PATH|INPUT|TEXTAREA|SELECT|OPTION|HTML|BODY)$/i.test(el.tagName)||el.id==='root';}
function at(x,y,target){var node=null;try{if(document.caretRangeFromPoint){var r=document.caretRangeFromPoint(x,y);node=r&&r.startContainer;}else if(document.caretPositionFromPoint){var p=document.caretPositionFromPoint(x,y);node=p&&p.offsetNode;}}catch(e){}
if(node&&node.nodeType===3&&norm(node.nodeValue)){var rg=document.createRange();rg.selectNodeContents(node);var b=rg.getBoundingClientRect();if(x>=b.left-4&&x<=b.right+4&&y>=b.top-4&&y<=b.bottom+4){var el=node.parentNode;if(!skip(el)&&norm(own(el)))return el;}}
if(target&&target.nodeType===1&&!skip(target)&&norm(own(target)))return target;return null;}
function mark(el,attr,val){if(el)el.removeAttribute(attr);if(val)val.setAttribute(attr,'');}
document.addEventListener('pointerdown',function(e){if(e.target&&e.target.closest&&e.target.closest('#studio-pen'))return;window.parent.postMessage({type:'studio-preview-touch'},'*');},true);
document.addEventListener('mousemove',function(e){if(!on)return;var el=at(e.clientX,e.clientY,e.target);if(el===hov)return;if(hov)hov.removeAttribute('data-studio-hover');hov=el;if(el&&el!==sel)el.setAttribute('data-studio-hover','');},true);
var LIVE='button,a,summary,select,input,textarea,[role="tab"],[role="button"],[role="switch"],label';
document.addEventListener('click',function(e){if(!on)return;if(e.ctrlKey||e.metaKey)return;if(e.target&&e.target.closest&&e.target.closest(LIVE))return;var el=at(e.clientX,e.clientY,e.target);if(!el){if(sel){sel.removeAttribute('data-studio-sel');sel=null;clearSoft();window.parent.postMessage({type:'studio-text-deselected'},'*');}return;}e.preventDefault();e.stopImmediatePropagation();
if(sel)sel.removeAttribute('data-studio-sel');sel=el;el.removeAttribute('data-studio-hover');el.setAttribute('data-studio-sel','');
soft(el);if(!el.__sid){el.__sid='s'+(++n);map[el.__sid]=el;}
window.parent.postMessage({type:'studio-text-selected',id:el.__sid,text:norm(own(el)),tag:el.tagName.toLowerCase()},'*');},true);
window.addEventListener('message',function(e){var d=e.data;if(!d)return;
if(d.type==='studio-text-mode'){on=!!d.enabled;if(!on){clearSoft();if(sel)sel.removeAttribute('data-studio-sel');if(hov)hov.removeAttribute('data-studio-hover');sel=hov=null;}}
if(d.type==='studio-text-clear'){clearSoft();if(sel)sel.removeAttribute('data-studio-sel');sel=null;}
if(d.type==='studio-text-set'){var el=map[d.id];if(!el)return;var nodes=[];for(var c=el.firstChild;c;c=c.nextSibling){if(c.nodeType===3)nodes.push(c);}
var first=null;for(var i=0;i<nodes.length;i++){if(nodes[i].nodeValue.trim()){first=nodes[i];break;}}if(!first)return;
var all=nodes.map(function(x){return x.nodeValue;}).join('');var lead=(all.match(/^\s*/)||[''])[0],trail=(all.match(/\s*$/)||[''])[0];
nodes.forEach(function(x){if(x!==first)x.nodeValue='';});first.nodeValue=lead+d.text+trail;}
});
})();</script>`;

// When sections are ticked in the Content column, every other section of the page is dimmed so the chosen ones stand out.
const FOCUS_SCRIPT = `<script>(function(){
var st=document.createElement('style');st.textContent='[data-studio-dim]{opacity:.4!important;filter:grayscale(.35);pointer-events:none!important;user-select:none!important;transition:opacity .25s ease,filter .25s ease}[data-studio-focus]{transition:opacity .25s ease}';document.head.appendChild(st);
var current=[];
var lastY=0,sT=null;window.addEventListener('scroll',function(){lastY=window.scrollY;clearTimeout(sT);sT=setTimeout(function(){window.parent.postMessage({type:'studio-scroll',y:lastY},'*');},120);},{passive:true});
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function sectionOf(el){return (el.tagName==='SECTION'?el:(el.closest&&el.closest('section')))||el;}
function find(item){var el=null;
if(item.domId)el=document.getElementById(item.domId);
if(!el&&item.name){var lbl=norm(item.name);var c=document.querySelectorAll('h1,h2,h3,h4,section,[id],[aria-label]');
for(var pass=0;pass<2&&!el;pass++){for(var i=0;i<c.length&&!el;i++){var n=norm(/^H[1-4]$/.test(c[i].tagName)?c[i].textContent:(c[i].getAttribute('aria-label')||c[i].id));
if(n&&(pass===0?n===lbl:(n.length>2&&(n.indexOf(lbl)>-1||lbl.indexOf(n)>-1))))el=c[i];}}}
return el?sectionOf(el):null;}
function clear(){var d=document.querySelectorAll('[data-studio-dim]');for(var i=0;i<d.length;i++)d[i].removeAttribute('data-studio-dim');}
function apply(){clear();if(!current.length)return;var targets=[];
for(var i=0;i<current.length;i++){var t=find(current[i]);if(t&&targets.indexOf(t)<0)targets.push(t);}
if(!targets.length)return;
var all=document.querySelectorAll('section');
for(var j=0;j<all.length;j++){var sec=all[j],keep=false;
for(var k=0;k<targets.length;k++){if(sec===targets[k]||sec.contains(targets[k])||targets[k].contains(sec)){keep=true;break;}}
if(!keep)sec.setAttribute('data-studio-dim','');}}
window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='studio-restore-scroll'){var y=Number(d.y)||0;[300,900,1800,3200].forEach(function(ms){setTimeout(function(){if(Math.abs(window.scrollY-y)>4)window.scrollTo(0,y);},ms);});}
if(d&&d.type==='studio-focus-sections'){current=Array.isArray(d.sections)?d.sections:[];apply();}});
new MutationObserver(function(){if(current.length){clearTimeout(window.__studioFocusT);window.__studioFocusT=setTimeout(apply,120);}}).observe(document.documentElement,{childList:true,subtree:true});
})();</script>`;

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
  const [sectionEdit, setSectionEdit] = useState(null); // the section opened with its pen: { name, domId, html, head, ... }
  const scrollRef = useRef(0); // where the visitor was in the page, kept across reloads (a saved change reloads the preview)
  const focusRef = useRef([]);
  const sendFocus = useCallback(() => { try { iframeRef.current?.contentWindow?.postMessage({ type: 'studio-focus-sections', sections: focusRef.current }, '*'); } catch { /* the frame may be reloading */ } }, []);
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

  // Clicking a section in the Content column scrolls the website to that part of the page.
  useEffect(() => {
    const onScroll = (event) => {
      try { iframeRef.current?.contentWindow?.postMessage({ type: 'preview-scroll-to-section', label: event.detail?.name ?? event.detail, domId: event.detail?.domId || null, order: event.detail?.order ?? null }, '*'); } catch { /* the frame may be reloading */ }
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
      if (event.data?.type === 'studio-text-deselected') useTemplateStudioStore.getState().setSelectedText(null);
      if (event.data?.type === 'studio-section-edit' && revisionPreview?.status !== 'ready') setSectionEdit({ name: String(event.data.name || ''), domId: String(event.data.domId || ''), index: event.data.index, html: String(event.data.html || ''), head: String(event.data.head || ''), htmlClass: String(event.data.htmlClass || ''), bodyClass: String(event.data.bodyClass || '') });
      if (event.data?.type === 'studio-text-selected' && revisionPreview?.status !== 'ready') useTemplateStudioStore.getState().setSelectedText({ id: event.data.id, text: String(event.data.text || ''), tag: String(event.data.tag || '') });
      if (event.data?.type === 'preview-route-changed') {
        const route = String(event.data.route || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
        const target = pagesRef.current.find((item) => item.route === route);
        if (target) selectPage(target.id);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [selectPage, showRoute, sendTextMode, revisionPreview]);

  const width = DEVICES.find((item) => item.id === device)?.width || '100%';
  const regenerating = job && !['completed', 'failed', 'cancelled'].includes(job.status);
  const sectionName = job && job.pageId && lastRequest && lastRequest.pageId === job.pageId ? String(lastRequest.focusSection || '').trim() : '';

  // An older revision, when one is being looked at, replaces the live site until it is closed.
  const old = revisionPreview?.status === 'ready' ? revisionPreview : null;
  const oldHtml = old ? old.html.split(ASSET_BASE_PLACEHOLDER).join(`${window.location.origin}/api/preview-assets/${old.token}`) : '';
  const raw = old ? oldHtml : state.html;
  const injected = THEME_LISTENER + TEXT_EDIT_SCRIPT + FOCUS_SCRIPT + `<script>(${penScript.toString()})();</script>`;
  const withRuntime = raw && !old ? (raw.includes('<head>') ? raw.replace('<head>', () => `<head>${siteAiRuntime(site?.projectId)}`) : `${siteAiRuntime(site?.projectId)}${raw}`) : raw;
  const html = raw && !old ? (withRuntime.includes('</body>') ? withRuntime.replace('</body>', () => `${injected}</body>`) : withRuntime + injected) : raw;
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
              onLoad={() => { showRoute(routeRef.current); sendTextMode(); setTimeout(sendFocus, 400); try { const savedY = scrollRef.current || Number(readUi().scroll?.[`${useTemplateStudioStore.getState().activeSiteId}:${routeRef.current}`]) || 0; if (savedY > 0) iframeRef.current?.contentWindow?.postMessage({ type: 'studio-restore-scroll', y: savedY }, '*'); } catch { /* the frame may be reloading */ } useTemplateStudioStore.getState().setSelectedText(null); if (cssRef.current) pushCss(cssRef.current); }} className="h-full w-full border-0 bg-white"
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
      {sectionEdit ? <SectionEditModal key={`${sectionEdit.domId}:${sectionEdit.index}:${sectionEdit.name}`} payload={sectionEdit} onClose={() => setSectionEdit(null)} /> : null}
    </section>
  );
}
