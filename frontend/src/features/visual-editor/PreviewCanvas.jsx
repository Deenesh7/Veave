import React, { useRef } from 'react';
import { useVisualEditorStore } from './visualEditorStore';
import { WebsiteFrame } from './WebsiteFrame';
import { VIEWPORT_SIZES } from '../../utils/constants';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';
import { ArrowLeft } from 'lucide-react';

export function PreviewCanvas({
  previewHtml,
  isBuilding = false,
  onIframeReady,
  onTextEdited
}) {
  const { viewport, activeRoute, setActiveRoute } = useVisualEditorStore();
  const iframeRef = useRef(null);

  const viewportConfig = VIEWPORT_SIZES[viewport] || VIEWPORT_SIZES.desktop;
  const isConstrained = viewport !== 'desktop';

  const canGoBack = Boolean(activeRoute && activeRoute !== '/' && activeRoute !== 'Home');

  const handleNavigateBack = () => {
    setActiveRoute('Home');
    try {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'preview-navigate-back',
          route: '/',
          forceRoot: true
        }, '*');
      }
    } catch (err) {}
  };

  const handleOuterScroll = () => {
    const { selectedElement, setSelectedElement, setHoveredElement } = useVisualEditorStore.getState();
    if (selectedElement) {
      setSelectedElement(null);
      setHoveredElement(null);
      try {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: 'clear-inspect-selection' }, '*');
        }
      } catch (e) {}
    }
  };

  return (
    <main onScroll={handleOuterScroll} className="flex-1 canvas-grid-pattern overflow-auto flex flex-col items-center justify-start p-4 sm:p-6 relative min-h-0 h-full select-none">
      {/* Device Viewport Canvas Container */}
      <div
        className={`relative transition-all duration-300 ease-in-out origin-top mx-auto flex flex-col rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.07)] border border-zinc-200/90 bg-white ${
          isConstrained ? 'my-auto' : 'w-full h-full'
        }`}
        style={{
          width: viewportConfig.width === 1280 ? '100%' : `${viewportConfig.width}px`,
          maxWidth: '1440px',
          height: isConstrained
            ? viewport === 'mobile'
              ? '760px'
              : '920px'
            : '100%',
          minHeight: '520px',
        }}
      >
        {/* Browser Mock Chrome Bar */}
        <div className="h-9 bg-zinc-50 border-b border-zinc-200/80 px-3.5 flex items-center justify-between shrink-0 select-none">
          {/* Traffic lights */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
          </div>

          {/* Browser Address Pill */}
          <div className="flex-1 max-w-sm mx-auto px-3 py-0.5 rounded-lg bg-white border border-zinc-200/60 text-[11px] font-mono text-zinc-600 text-center truncate shadow-2xs flex items-center justify-center gap-1.5">
            <span className="text-zinc-400">https://my-app.veave.dev</span>
            <span className="font-semibold text-zinc-800">
              {activeRoute === 'Home' || activeRoute === '/' ? '/' : (activeRoute.startsWith('/') ? activeRoute : `/${activeRoute}`)}
            </span>
          </div>

          <div className="text-[11px] font-mono text-zinc-400 font-semibold">
            {viewportConfig.width}px
          </div>
        </div>

        {/* Status Bar */}
        <div role="status" className="px-3.5 py-1 text-[11px] text-zinc-600 bg-zinc-50 border-b border-zinc-200 shrink-0 flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={handleNavigateBack}
              className="p-1 -ml-1 rounded hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer"
              title="Go back inside the preview website"
            >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <span>{isBuilding ? 'Preparing preview...' : 'Visual Editor'}</span>
        </div>

        {/* Website Frame with isolated iframe */}
        <div className="relative flex-1 w-full h-full min-h-0 bg-white group/canvas">
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
              title="Go back to Home"
            >
              <span className="w-5 h-5 rounded-full bg-zinc-100 group-hover:bg-zinc-200 text-zinc-700 flex items-center justify-center transition-colors">
                <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-0.5" />
              </span>
              <span className="font-semibold text-xs text-zinc-800">Back</span>
              {activeRoute && activeRoute !== '/' && activeRoute !== 'Home' && (
                <span className="text-[10px] text-zinc-400 font-mono max-w-[120px] truncate border-l border-zinc-200 pl-1.5">
                  {activeRoute}
                </span>
              )}
            </button>
          </div>

          <WebsiteFrame
            previewHtml={previewHtml}
            isBuilding={isBuilding}
            onIframeReady={(el) => {
              iframeRef.current = el;
              if (onIframeReady) onIframeReady(el);
            }}
            onTextEdited={onTextEdited}
          />

          {/* Initial project compilation loading overlay */}
          {!previewHtml && (
            <CanvasLoadingOverlay
              isVisible={true}
              title="Loading canvas..."
              subtitle="Connecting design canvas & real-time DOM inspector"
              size="lg"
            />
          )}
        </div>
      </div>
    </main>
  );
}

export default PreviewCanvas;
