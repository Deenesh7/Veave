import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePreview } from '../../hooks/usePreview';
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
  inspectionEnabled = true
}) {
  const { iframeRef, previewHtml, previewUrl, previewBuildId, statusLabel, buildPreview } = usePreview({
    files,
    validation,
    previewKey,
    onPreviewError: (error) => onPreviewError?.({ ...error, previewKey }),
    onPreviewRendered
  });
  const [isBuilding, setIsBuilding] = useState(false);
  const [currentRoute, setCurrentRoute] = useState('/');
  const [historyStack, setHistoryStack] = useState(['/']);
  const [selectedElement, setSelectedElement] = useState(null);

  const filesFingerprint = useMemo(
    () => JSON.stringify((files || []).map(({ path, content }) => ({ path, content }))),
    [files]
  );

  useEffect(() => {
    let cancelled = false;
    setIsBuilding(true);
    const timer = setTimeout(async () => {
      await buildPreview(files);
      if (!cancelled) setIsBuilding(false);
    }, 60);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesFingerprint, previewKey, buildPreview]);

  // Reset route history when preview builds anew
  useEffect(() => {
    setCurrentRoute('/');
    setHistoryStack(['/']);
    setSelectedElement(null);
  }, [previewKey, previewBuildId]);

  // Listen for iframe events: text edits, element selection, and route changes
  useEffect(() => {
    const handleWindowMessage = (e) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type === 'visual-text-edited') {
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
            <button
              type="button"
              onClick={handleNavigateBack}
              className="p-1 -ml-1 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer"
              title="Go back inside the preview website"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <span>{isBuilding ? 'Preparing preview...' : statusLabel}</span>
          </div>

          {/* Visual Edit Quick Jump CTA in Status Bar */}
          {onOpenVisualEdit && (
            <button
              type="button"
              onClick={() => onOpenVisualEdit('editor')}
              disabled={isOpeningVisualEditor}
              className="flex items-center gap-1 text-[11px] font-semibold text-zinc-600 hover:text-zinc-900 transition-colors cursor-pointer"
              title="Open Visual Editor"
            >
              <Sliders className="w-3 h-3" />
              <span>Visual Edit</span>
            </button>
          )}
        </div>

        {/* The Live Sandboxed Iframe */}
        <div className="relative flex-1 w-full h-full min-h-0 bg-white group/preview">
          {/* Animated "Coming out of page in top left" Back Button */}
          <div
            className={`absolute top-3.5 left-3.5 z-30 transition-all duration-300 ease-out transform ${
              canGoBack
                ? 'opacity-100 translate-x-0 translate-y-0 scale-100 pointer-events-auto'
                : 'opacity-0 -translate-x-6 -translate-y-2 scale-90 pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={handleNavigateBack}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/95 hover:bg-white text-zinc-800 hover:text-zinc-950 shadow-[0_6px_20px_rgba(0,0,0,0.12)] border border-zinc-200/90 backdrop-blur-md font-medium text-xs transition-all hover:scale-105 active:scale-95 cursor-pointer group"
              title="Go back to previous page"
            >
              <span className="w-5 h-5 rounded-full bg-zinc-100 group-hover:bg-zinc-200 text-zinc-700 flex items-center justify-center transition-colors">
                <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-0.5" />
              </span>
              <span className="font-semibold text-xs text-zinc-800">Back</span>
              {currentRoute && currentRoute !== '/' && (
                <span className="text-[10px] text-zinc-400 font-mono max-w-[120px] truncate border-l border-zinc-200 pl-1.5">
                  {currentRoute}
                </span>
              )}
            </button>
          </div>

          <iframe
            key={`${previewKey}:${previewBuildId}:${previewUrl ? 'built' : 'legacy'}`}
            ref={iframeRef}
            src={previewUrl || undefined}
            srcDoc={previewUrl ? undefined : previewHtml}
            title="Veave AI Live Preview"
            onLoad={syncInspectionMode}
            sandbox={`allow-scripts allow-modals allow-popups allow-forms${previewUrl ? ' allow-same-origin' : ''}`}
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

              {/* Floating Pill Toolbar */}
              <div className={`absolute flex items-center gap-1.5 bg-zinc-900/95 text-white px-2 py-1 rounded-xl shadow-xl border border-zinc-700/80 pointer-events-auto backdrop-blur-md select-none text-xs animate-in fade-in zoom-in-95 duration-100 ${
                selectedElement.rect.top < 45 ? 'top-full mt-2' : '-top-9'
              } ${
                selectedElement.rect.left > 600 ? 'right-0' : 'left-0'
              }`}>
                <span className="font-mono font-bold text-[10px] text-zinc-300 uppercase px-1 py-0.2 rounded bg-zinc-800">
                  {selectedElement.tagName}
                </span>
                {selectedElement.text && (
                  <span className="max-w-[110px] truncate text-zinc-200 text-[11px]">
                    "{selectedElement.text}"
                  </span>
                )}
                <div className="h-3 w-px bg-zinc-700 mx-0.5" />
                <button
                  type="button"
                  onClick={handleEditInVisualEditor}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-zinc-600 hover:bg-zinc-700 text-white font-medium text-[10px] transition-colors cursor-pointer"
                  title="Open Visual Editor to customize styling and layout"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={handleAskAi}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-[10px] transition-colors cursor-pointer"
                  title="Ask AI in conversation panel to change this element"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Ask AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedElement(null)}
                  className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer ml-0.5"
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
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
