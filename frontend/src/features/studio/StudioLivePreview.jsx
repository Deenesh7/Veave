import { useProjectStore } from '../../store/projectStore';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePreview, quickFingerprint } from '../../hooks/usePreview';
import CanvasLoadingOverlay from '../../components/common/CanvasLoadingOverlay';
import { VIEWPORT_SIZES } from '../../utils/constants';
import { 
  Monitor, 
  Tablet, 
  Smartphone, 
  ArrowLeft,
  Sliders,
  Sparkles,
  X
} from 'lucide-react';
import { useVisualEditorStore } from '../visual-editor/visualEditorStore';

export function StudioLivePreview({
  files = [],
  validation,
  previewSize = 'desktop',
  onTextUpdate,
  onAskAiForElement,
  onOpenVisualEdit,
  onPreviewError,
  onPreviewRendered,
  isOpeningVisualEditor = false,
  isGenerating = false,
  previewKey = 0,
  projectId = null,
  inspectionEnabled = true,
  onElementSelected,
  clearSelectionToken = 0
}) {
  const { iframeRef, previewHtml, previewUrl, previewBuildId, statusLabel, buildPreview } = usePreview({
    files,
    validation,
    previewKey,
    projectId,
    skipBuiltPreview: inspectionEnabled,
    onPreviewError: (error) => onPreviewError?.({ ...error, previewKey }),
    onPreviewRendered
  });
  const [isBuilding, setIsBuilding] = useState(false);
  const [currentRoute, setCurrentRoute] = useState('/');
  const [historyStack, setHistoryStack] = useState(['/']);
  const [selectedElement, setSelectedElement] = useState(null);

  // Tell the workspace which element is selected (or that the selection was cleared) so the prompt can mention it.
  const selectionKey = selectedElement
    ? (selectedElement.elementId || `${selectedElement.selector}|${selectedElement.text}`)
    : null;
  useEffect(() => {
    onElementSelected?.(selectionKey ? selectedElement : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  // The side panel's "clear selection" button bumps the token: drop the selection (and highlight) in the preview too.
  useEffect(() => {
    if (!clearSelectionToken) return;
    setSelectedElement(null);
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'clear-inspect-selection' }, '*'); } catch (e) {}
  }, [clearSelectionToken, iframeRef]);

  const filesFingerprint = useMemo(() => quickFingerprint(files || []), [files]);

  useEffect(() => {
    let cancelled = false;
    setIsBuilding(true);
    const timer = setTimeout(async () => {
      await buildPreview(files);
      if (!cancelled) setIsBuilding(false);
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesFingerprint, previewKey, buildPreview]);

  const currentRouteRef = useRef('/');
  currentRouteRef.current = currentRoute;

  // Reset route history only for a brand new preview. Rebuilds (for example while the site is still being created)
  // keep the current route so other pages do not bounce back to Home.
  useEffect(() => {
    setCurrentRoute('/');
    setHistoryStack(['/']);
    setSelectedElement(null);
  }, [previewKey]);

  useEffect(() => {
    setSelectedElement(null);
  }, [previewBuildId]);

  // The preview only listens for the inspect-mode message once its scripts have run. A browser-compiled preview
  // finishes loading long before that, so the on-load message is lost and inspect mode stays ON (clicking a button
  // selects it instead of using it). Re-send when the preview reports it has rendered.
  const syncInspectionRef = useRef(null);

  // Listen for iframe events: text edits, element selection, and route changes
  useEffect(() => {
    const handleWindowMessage = (e) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type === 'preview-rendered') {
        syncInspectionRef.current?.();
        const route = currentRouteRef.current;
        if (route && route !== '/') {
          try { iframeRef.current.contentWindow.postMessage({ type: 'preview-restore-route', route }, '*'); } catch (err) {}
        }
      } else if (e.data?.type === 'visual-text-edited') {
        const { oldText, newText } = e.data;
        if (onTextUpdate && oldText && newText) {
          onTextUpdate(oldText, newText);
        }
      } else if (inspectionEnabled && e.data?.type === 'visual-element-selected') {
        setSelectedElement(e.data.element);
      } else if (e.data?.type === 'clear-inspect-selection') {
        setSelectedElement(null);
      } else if (e.data?.type === 'visual-element-rect-updated') {
        setSelectedElement((prev) => prev ? { ...prev, rect: e.data.rect } : null);
      } else if (e.data?.type === 'preview-route-changed') {
        const nextRoute = e.data.route || '/';
        setCurrentRoute(nextRoute);
        useProjectStore.setState({ previewRoute: nextRoute });
        setHistoryStack((prev) => {
          if (prev[prev.length - 1] === nextRoute) return prev;
          return [...prev, nextRoute];
        });
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [onTextUpdate, iframeRef, inspectionEnabled]);

  const syncInspectionMode = useCallback(() => {
    if (!inspectionEnabled) setSelectedElement(null);
    try {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'toggle-inspect-mode',
        enabled: inspectionEnabled
      }, '*');
    } catch (err) {}
  }, [iframeRef, inspectionEnabled]);

  syncInspectionRef.current = syncInspectionMode;

  useEffect(() => {
    syncInspectionMode();
  }, [syncInspectionMode, previewBuildId, previewKey]);

  const canGoBack = Boolean(
    (currentRoute && currentRoute !== '/' && currentRoute !== '') ||
    historyStack.length > 1
  );

  const handleNavigateBack = useCallback(() => {
    const updatedHistory = historyStack.length > 1
      ? historyStack.slice(0, -1)
      : ['/'];
    const targetRoute = updatedHistory[updatedHistory.length - 1] || '/';

    setHistoryStack(updatedHistory);
    setCurrentRoute(targetRoute);

    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'preview-navigate-back',
          route: targetRoute,
          forceRoot: targetRoute === '/'
        }, '*');
      }
    } catch (err) {}
  }, [historyStack, iframeRef]);

  const handleEditInVisualEditor = () => {
    if (selectedElement) {
      try {
        useVisualEditorStore.getState().setSelectedElement(selectedElement);
      } catch (e) {}
    }
    if (onOpenVisualEdit) {
      onOpenVisualEdit('editor');
    }
  };

  const handleAskAi = () => {
    if (!selectedElement) return;
    const tag = selectedElement.tagName || 'element';
    const textDesc = selectedElement.text ? ` "${selectedElement.text}"` : '';
    const prompt = `Change the ${tag}${textDesc} to `;
    if (onAskAiForElement) {
      onAskAiForElement(prompt);
    }
  };

  const handleOuterScroll = () => {
    if (inspectionEnabled && selectedElement) {
      setSelectedElement(null);
      try {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'clear-inspect-selection' }, '*');
        }
      } catch (e) {}
    }
  };

  const size = VIEWPORT_SIZES[previewSize] || VIEWPORT_SIZES.desktop;
  const isConstrained = previewSize !== 'desktop';

  return (
    <div onScroll={handleOuterScroll} className="flex-1 bg-zinc-100/70 overflow-auto flex flex-col items-center justify-start p-3 sm:p-5 relative min-h-0 h-full select-none">
      {/* Main Preview Container Frame */}
      <div
        className={`relative transition-all duration-300 ease-in-out origin-top mx-auto flex flex-col rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-zinc-200/90 bg-white ${
          isConstrained ? 'my-auto' : 'w-full h-full'
        }`}
        style={{
          width: size.width === 1280 ? '100%' : `${size.width}px`,
          maxWidth: '1280px',
          height: isConstrained ? (previewSize === 'mobile' ? '760px' : '900px') : '100%',
          minHeight: '560px'
        }}
      >
        {/* Browser Mock Navigation Bar Header */}
        <div className="h-9 bg-zinc-50 border-b border-zinc-200/80 px-3.5 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>

            {/* Browser Back Arrow Button */}
            <button
              type="button"
              onClick={handleNavigateBack}
              disabled={!canGoBack}
              title={canGoBack ? 'Go back' : 'Back (disabled)'}
              aria-label="Go back"
              className={`p-1 rounded-md transition-all flex items-center justify-center ${
                canGoBack
                  ? 'text-zinc-700 hover:text-zinc-950 hover:bg-zinc-200/80 cursor-pointer active:scale-95'
                  : 'text-zinc-300 cursor-not-allowed opacity-30'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Browser Address Pill */}
          <div className="flex-1 max-w-sm mx-auto px-3 py-0.5 rounded-lg bg-white border border-zinc-200/60 text-[11px] font-mono text-zinc-600 text-center truncate shadow-2xs flex items-center justify-center gap-1.5">
            <span className="text-zinc-400 truncate">
              {previewUrl ? previewUrl.replace(/\/$/, '') : 'preview.app'}
            </span>
            <span className="font-semibold text-zinc-800">
              {currentRoute === '/' ? '/' : currentRoute}
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-400">
            {previewSize === 'desktop' && <Monitor className="w-3.5 h-3.5" />}
            {previewSize === 'tablet' && <Tablet className="w-3.5 h-3.5" />}
            {previewSize === 'mobile' && <Smartphone className="w-3.5 h-3.5" />}
          </div>
        </div>

        <div role="status" className="px-3.5 py-1 text-[11px] text-zinc-600 bg-zinc-50 border-b border-zinc-200 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>{isBuilding ? 'Preparing preview...' : statusLabel}</span>
          </div>
        </div>

        {/* The Live Sandboxed Iframe */}
        <div className="relative flex-1 w-full h-full min-h-0 bg-white group/preview">
          <iframe
            key={`${previewKey}:${previewBuildId}:${previewUrl ? 'built' : 'legacy'}`}
            ref={iframeRef}
            src={previewUrl || undefined}
            srcDoc={previewUrl ? undefined : previewHtml}
            title="Veave AI Live Preview"
            onLoad={syncInspectionMode}
            sandbox={`allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-forms${previewUrl ? ' allow-same-origin' : ''}`}
            className="w-full h-full bg-white border-0 absolute inset-0"
          />

          {/* Floating Element Selection & Quick Action Bar in Studio Preview */}
          {inspectionEnabled && selectedElement && selectedElement.rect && (selectedElement.rect.top + selectedElement.rect.height >= 0) && (selectedElement.rect.top <= 2500) && (
            <div
              className="absolute z-20 pointer-events-none transition-none"
              style={{
                top: `${selectedElement.rect.top}px`,
                left: `${selectedElement.rect.left}px`,
                width: `${selectedElement.rect.width}px`,
                height: `${selectedElement.rect.height}px`,
              }}
            >
              {/* Blue selection box */}
              <div className="absolute inset-0 border-2 border-zinc-600 shadow-[0_0_0_1px_rgba(255,255,255,0.8)] pointer-events-none rounded-xs" />
            </div>
          )}

          {/* Live rebuilding overlay indicator */}
          <CanvasLoadingOverlay
            isVisible={isBuilding}
            size="md"
            title="Loading canvas..."
            subtitle="Syncing changes to live interface"
          />
        </div>
      </div>
    </div>
  );
}

export default StudioLivePreview;
