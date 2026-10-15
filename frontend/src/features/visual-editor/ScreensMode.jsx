import React, { useState, useEffect, useRef } from 'react';
import { 
  Monitor, 
  Tablet, 
  Smartphone, 
  Sliders, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  ExternalLink,
  Layers,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { MatrixOrb } from '../../components/rare-ui';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

export function ScreensMode({ previewHtml }) {
  const { setActiveMode } = useVisualEditorStore();
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'desktop' | 'tablet' | 'mobile'
  const [zoomScale, setZoomScale] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(true);

  const desktopIframeRef = useRef(null);
  const tabletIframeRef = useRef(null);
  const mobileIframeRef = useRef(null);

  // Navigate back inside the website preview iframe (remembers and restores previous step)
  const handleWebsiteBack = (iframeRef) => {
    try {
      if (iframeRef?.current?.contentWindow) {
        const win = iframeRef.current.contentWindow;
        
        // 1. Direct call to iframe's automatic history manager
        try {
          if (win.__veaveHistory && typeof win.__veaveHistory.back === 'function') {
            const restored = win.__veaveHistory.back();
            if (restored) return;
          }
        } catch (e) {}

        // 2. Fallback postMessage to iframe
        win.postMessage({ type: 'preview-navigate-back', route: '/' }, '*');
      }
    } catch (err) {
      console.warn('Failed to navigate back in website iframe:', err);
    }
  };

  // Reload an individual screen frame
  const handleIframeReload = (iframeRef) => {
    try {
      if (iframeRef?.current) {
        const currentSrc = iframeRef.current.srcDoc;
        iframeRef.current.srcDoc = '';
        setTimeout(() => {
          if (iframeRef.current) iframeRef.current.srcDoc = currentSrc;
        }, 50);
      }
    } catch (e) {}
  };

  // Smooth entrance loading animation
  useEffect(() => {
    setIsRefreshing(true);
    const timer = setTimeout(() => setIsRefreshing(false), 500);
    return () => clearTimeout(timer);
  }, [refreshKey, activeFilter]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((k) => k + 1);
  };

  const isSolo = activeFilter !== 'all';

  // Proportional sizing configuration
  const desktopScale = isSolo ? 0.82 : 0.60;
  const desktopChassisWidth = isSolo ? 1076 : 792;
  const desktopChassisHeight = isSolo ? 720 : 540;

  const tabletScale = isSolo ? 0.80 : 0.64;
  const tabletChassisWidth = isSolo ? 638 : 516;
  const tabletChassisHeight = isSolo ? 850 : 690;

  const mobileScale = isSolo ? 1.0 : 0.86;
  const mobileChassisWidth = isSolo ? 398 : 344;
  const mobileChassisHeight = isSolo ? 840 : 730;


  return (
    <div className="flex-1 w-full h-full overflow-auto select-none flex flex-col font-sans relative canvas-grid-pattern">
      {/* Top Floating Control Bar */}
      <header className="sticky top-0 z-20 px-6 py-3 bg-white/90 backdrop-blur-md border-b border-zinc-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Left: Title & Mode Badge with Live Matrix Orb */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-zinc-50/90 border border-zinc-200/80 flex items-center justify-center shadow-xs overflow-hidden">
            <MatrixOrb state="thinking" size={28} dots={7} color="#18181B" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-zinc-900">
                Responsive Multi-Device Studio
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-zinc-50 text-zinc-600 border border-zinc-200/60 text-[10px] font-bold uppercase tracking-wider">
                {isSolo ? `${activeFilter.toUpperCase()} SCREEN` : 'ALL SCREENS'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 hidden sm:block">
              {isSolo 
                ? `Expanded high-definition ${activeFilter} presentation preview` 
                : 'Side-by-side synchronized rendering across Desktop, Tablet, and Mobile viewports'}
            </p>
          </div>
        </div>

        {/* Center: Device Filter Segmented Control */}
        <div className="flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 shadow-2xs">
          {[
            { id: 'all', label: 'All Screens', icon: Layers },
            { id: 'desktop', label: 'Desktop', icon: Monitor },
            { id: 'tablet', label: 'Tablet', icon: Tablet },
            { id: 'mobile', label: 'Mobile', icon: Smartphone },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-zinc-900 shadow-xs font-bold'
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Zoom controls & Return to Editor */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="hidden md:flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 text-xs">
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.max(0.7, Number((z - 0.1).toFixed(1))))}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-white transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono text-[11px] font-semibold text-zinc-700 min-w-[42px] text-center">
              {Math.round(zoomScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomScale((z) => Math.min(1.3, Number((z + 0.1).toFixed(1))))}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-white transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomScale(1)}
              className="px-2 py-0.5 rounded-md text-[10px] text-zinc-500 hover:text-zinc-800 hover:bg-white font-medium transition-colors border-l border-zinc-200/60 ml-0.5"
              title="Reset Zoom to 100%"
            >
              Reset
            </button>
          </div>

          {/* Refresh all */}
          <button
            type="button"
            onClick={handleRefresh}
            className="p-2 rounded-xl border border-zinc-200/80 bg-white hover:bg-zinc-50 text-zinc-600 transition-all shadow-2xs cursor-pointer active:scale-95"
            title="Reload all responsive frames"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-zinc-600' : ''}`} />
          </button>

          {/* Return to Visual Edit */}
          <button
            type="button"
            onClick={() => setActiveMode('editor')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-600 hover:bg-zinc-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Visual Edit</span>
          </button>
        </div>
      </header>

      {/* Main Multi-Screen Stage Area */}
      <main className="flex-1 p-6 sm:p-10 flex items-start justify-center overflow-auto">
        <div 
          className="flex flex-wrap items-start justify-center gap-10 max-w-[1800px] mx-auto transition-all duration-300 origin-top"
          style={{ transform: `scale(${zoomScale})` }}
        >
          {/* 1. DESKTOP WORKSTATION MOCKUP (1280px) */}
          {(activeFilter === 'all' || activeFilter === 'desktop') && (
            <div className="flex flex-col items-center group transition-all duration-300">
              {/* Header Label Bar: System Name on Left Top */}
              <div 
                className="flex items-center justify-start mb-3 px-2 transition-all duration-300"
                style={{ width: `${desktopChassisWidth}px` }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-2xs">
                    <Monitor className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-900">Desktop Display</h3>
                    <span className="text-[10px] font-mono text-zinc-500">1280 × 850px • Scale: {Math.round(desktopScale * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Realistic Desktop Monitor Chassis */}
              <div 
                className="bg-zinc-900 p-3 rounded-3xl shadow-[0_24px_60px_rgba(0,0,0,0.2)] border border-zinc-800 ring-1 ring-white/10 flex flex-col transition-all duration-300"
                style={{ width: `${desktopChassisWidth}px`, height: `${desktopChassisHeight}px` }}
              >
                {/* Screen Bezel Top Bar (Webcam, Mac window pills & In-Website Back Button) */}
                <div className="h-8 bg-zinc-800/95 rounded-t-xl px-3 flex items-center justify-between shrink-0 select-none border-b border-zinc-700/50">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    </div>

                    {/* Left Top Back Button: Navigates back inside website */}
                    <button
                      type="button"
                      onClick={() => handleWebsiteBack(desktopIframeRef)}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-[10px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs ml-1 border border-zinc-600/70"
                      title="Navigate back inside this website"
                    >
                      <ArrowLeft className="w-3 h-3 text-white" />
                      <span>Back</span>
                    </button>
                  </div>

                  {/* Browser Address Pill */}
                  <div className="w-64 px-2 py-0.5 rounded-md bg-zinc-900/70 border border-zinc-700/50 text-[10px] font-mono text-zinc-400 text-center truncate">
                    https://my-app.veave.dev/desktop
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleIframeReload(desktopIframeRef)}
                      className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors cursor-pointer"
                      title="Reload website"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                    <div className="w-2 h-2 rounded-full bg-zinc-700 ring-1 ring-zinc-600" />
                  </div>
                </div>

                {/* Scaled Sandbox Screen */}
                <div className="relative flex-1 bg-white rounded-b-xl overflow-hidden">
                  <CanvasLoadingOverlay
                    isVisible={isRefreshing}
                    size="md"
                    title="Loading desktop screen..."
                    subtitle="Adapting 1280px viewport"
                  />

                  <iframe
                    ref={desktopIframeRef}
                    key={`desktop-${refreshKey}`}
                    srcDoc={previewHtml}
                    title="Desktop Screen"
                    sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-forms"
                    className="border-0 absolute top-0 left-0 origin-top-left"
                    style={{
                      width: '1280px',
                      height: '850px',
                      transform: `scale(${desktopScale})`,
                    }}
                  />
                </div>
              </div>

              {/* Monitor Stand Base */}
              <div className="w-32 h-4 bg-gradient-to-b from-zinc-700 to-zinc-800 rounded-b-xl shadow-md -mt-1 mx-auto" />
              <div className="w-52 h-2.5 bg-zinc-400/80 rounded-full shadow-lg mx-auto mt-0.5" />
            </div>
          )}

          {/* 2. TABLET WORKSTATION MOCKUP (768px iPad Pro Style) */}
          {(activeFilter === 'all' || activeFilter === 'tablet') && (
            <div className="flex flex-col items-center group transition-all duration-300">
              {/* Header Label Bar: System Name on Left Top */}
              <div 
                className="flex items-center justify-start mb-3 px-2 transition-all duration-300"
                style={{ width: `${tabletChassisWidth}px` }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-2xs">
                    <Tablet className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-900">Tablet iPad</h3>
                    <span className="text-[10px] font-mono text-zinc-500">768 × 1024px • Scale: {Math.round(tabletScale * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Realistic iPad Bezel */}
              <div 
                className="bg-zinc-900 p-3 rounded-[32px] shadow-[0_24px_60px_rgba(0,0,0,0.2)] border border-zinc-800 ring-1 ring-white/10 flex flex-col transition-all duration-300"
                style={{ width: `${tabletChassisWidth}px`, height: `${tabletChassisHeight}px` }}
              >
                {/* Tablet Browser / Bezel Bar with Left Top Back Button */}
                <div className="h-7 px-2.5 flex items-center justify-between shrink-0 select-none bg-zinc-800/90 rounded-t-2xl mb-1 border-b border-zinc-700/40">
                  <button
                    type="button"
                    onClick={() => handleWebsiteBack(tabletIframeRef)}
                    className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-[10px] font-semibold transition-all cursor-pointer active:scale-95 shadow-2xs border border-zinc-600/70"
                    title="Navigate back inside this website"
                  >
                    <ArrowLeft className="w-3 h-3 text-white" />
                    <span>Back</span>
                  </button>

                  {/* Front Camera dot */}
                  <div className="w-2 h-2 rounded-full bg-zinc-700 ring-1 ring-zinc-600" />

                  <button
                    type="button"
                    onClick={() => handleIframeReload(tabletIframeRef)}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors cursor-pointer"
                    title="Reload tablet website"
                  >
                    <RotateCw className="w-3 h-3" />
                  </button>
                </div>

                {/* Scaled Sandbox Screen */}
                <div className="relative flex-1 bg-white rounded-2xl overflow-hidden">
                  <CanvasLoadingOverlay
                    isVisible={isRefreshing}
                    size="md"
                    title="Loading tablet screen..."
                    subtitle="Adapting 768px viewport"
                  />

                  <iframe
                    ref={tabletIframeRef}
                    key={`tablet-${refreshKey}`}
                    srcDoc={previewHtml}
                    title="Tablet Screen"
                    sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-forms"
                    className="border-0 absolute top-0 left-0 origin-top-left"
                    style={{
                      width: '768px',
                      height: '1024px',
                      transform: `scale(${tabletScale})`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. MOBILE SMARTPHONE MOCKUP (375px iPhone Style with Dynamic Island) */}
          {(activeFilter === 'all' || activeFilter === 'mobile') && (
            <div className="flex flex-col items-center group transition-all duration-300">
              {/* Header Label Bar: System Name on Left Top */}
              <div 
                className="flex items-center justify-start mb-3 px-2 transition-all duration-300"
                style={{ width: `${mobileChassisWidth}px` }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-zinc-900 text-white flex items-center justify-center shadow-2xs">
                    <Smartphone className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-900">Mobile Phone</h3>
                    <span className="text-[10px] font-mono text-zinc-500">375 × 812px • Scale: {Math.round(mobileScale * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Realistic Smartphone Chassis */}
              <div 
                className="bg-zinc-900 p-2.5 rounded-[44px] shadow-[0_24px_60px_rgba(0,0,0,0.2)] border border-zinc-800 ring-1 ring-white/10 flex flex-col transition-all duration-300 relative"
                style={{ width: `${mobileChassisWidth}px`, height: `${mobileChassisHeight}px` }}
              >
                {/* Scaled Sandbox Screen with Dynamic Island and Left Top Back Button */}
                <div className="relative flex-1 bg-white rounded-[36px] overflow-hidden">
                  <CanvasLoadingOverlay
                    isVisible={isRefreshing}
                    size="sm"
                    title="Loading mobile screen..."
                    subtitle="Adapting 375px viewport"
                  />

                  {/* Left Top Back Button: Works in website */}
                  <div className="absolute top-2 left-2 z-30 flex items-center">
                    <button
                      type="button"
                      onClick={() => handleWebsiteBack(mobileIframeRef)}
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-black/85 hover:bg-black text-white text-[10px] font-semibold border border-white/20 shadow-md backdrop-blur-xs transition-all cursor-pointer active:scale-95"
                      title="Navigate back inside this website"
                    >
                      <ArrowLeft className="w-3 h-3 text-white" />
                      <span>Back</span>
                    </button>
                  </div>

                  {/* Dynamic Island pill */}
                  <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-24 h-4.5 bg-black rounded-full z-20 shadow-xs flex items-center justify-end px-2">
                    <div className="w-2 h-2 rounded-full bg-zinc-900 ring-1 ring-zinc-800" />
                  </div>

                  {/* Reload button on top right */}
                  <div className="absolute top-2 right-2 z-30 flex items-center">
                    <button
                      type="button"
                      onClick={() => handleIframeReload(mobileIframeRef)}
                      className="p-1 rounded-full bg-black/85 hover:bg-black text-zinc-300 hover:text-white border border-white/20 shadow-md backdrop-blur-xs transition-all cursor-pointer active:scale-95"
                      title="Reload mobile website"
                    >
                      <RotateCw className="w-3 h-3" />
                    </button>
                  </div>

                  <iframe
                    ref={mobileIframeRef}
                    key={`mobile-${refreshKey}`}
                    srcDoc={previewHtml}
                    title="Mobile Screen"
                    sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-forms"
                    className="border-0 absolute top-0 left-0 origin-top-left"
                    style={{
                      width: '375px',
                      height: '812px',
                      transform: `scale(${mobileScale})`,
                    }}
                  />

                  {/* Home Indicator bar */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-zinc-900/60 rounded-full z-20 pointer-events-none" />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default ScreensMode;
