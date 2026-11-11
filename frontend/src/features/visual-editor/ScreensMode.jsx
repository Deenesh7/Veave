import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  Monitor,
  Tablet,
  Smartphone,
  RotateCw,
  ArrowLeft,
} from 'lucide-react';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

// Real CSS viewport sizes the site is rendered at. The frames are scaled down visually to fit the screen.
const DEVICES = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: 1280, height: 800, radius: 'rounded-md', bezel: 10 },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: 768, height: 1024, radius: 'rounded-[18px]', bezel: 14 },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: 375, height: 812, radius: 'rounded-[28px]' },
];

const GAP = 40;       // space between frames (screen px)
const PADDING = 32;   // space around the canvas (screen px)
const LABEL_HEIGHT = 36;
const STAND_HEIGHT = 40; // monitor neck + base under the desktop screen

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const update = () => setSize({ width: ref.current.clientWidth, height: ref.current.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function ScreensMode({ previewHtml }) {
  const [reloadKeys, setReloadKeys] = useState({ desktop: 0, tablet: 0, mobile: 0 });
  const [loaded, setLoaded] = useState({ desktop: false, tablet: false, mobile: false });

  const stageRef = useRef(null);
  const frameRefs = useRef({});
  const { width: stageWidth, height: stageHeight } = useElementSize(stageRef);

  const visible = DEVICES;

  // Scale that makes every frame fit the stage.
  const fitScale = useMemo(() => {
    if (!stageWidth || !stageHeight) return 0.5;
    const bezels = visible.reduce((sum, d) => sum + (d.bezel || 0) * 2, 0);
    const availableWidth = stageWidth - PADDING * 2 - GAP * (visible.length - 1) - bezels;
    const availableHeight = stageHeight - PADDING * 2 - LABEL_HEIGHT - STAND_HEIGHT;
    const totalWidth = visible.reduce((sum, d) => sum + d.width, 0);
    const tallest = Math.max(...visible.map((d) => d.height));
    return Math.max(0.2, Math.min(1, availableWidth / totalWidth, availableHeight / tallest));
  }, [stageWidth, stageHeight]);
  const scale = fitScale;

  // A new preview means every frame is loading again.
  useEffect(() => {
    setLoaded({ desktop: false, tablet: false, mobile: false });
  }, [previewHtml]);

  const reload = (id) => {
    setLoaded((prev) => ({ ...prev, [id]: false }));
    setReloadKeys((prev) => ({ ...prev, [id]: prev[id] + 1 }));
  };

  // Step back inside the site shown in a frame (the preview keeps its own navigation history).
  const goBack = (id) => {
    try {
      const win = frameRefs.current[id]?.contentWindow;
      if (!win) return;
      if (win.__veaveHistory && typeof win.__veaveHistory.back === 'function' && win.__veaveHistory.back()) return;
      win.postMessage({ type: 'preview-navigate-back', route: '/' }, '*');
    } catch (err) {
      console.warn('Could not go back inside the screen:', err);
    }
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-zinc-100">
      {/* Canvas: all three screens, scaled to fit */}
      <div ref={stageRef} className="flex-1 min-h-0 overflow-auto">
        <div
          className="min-w-full min-h-full w-max flex items-start justify-center"
          style={{ padding: PADDING, gap: GAP }}
        >
          {visible.map((device) => {
            const Icon = device.icon;
            const width = Math.round(device.width * scale);
            const height = Math.round(device.height * scale);
            const bezel = device.bezel || 0;
            const isDesktop = device.id === 'desktop';
            const isTablet = device.id === 'tablet';
            return (
              <section key={device.id} className="shrink-0" style={{ width: width + bezel * 2 }}>
                <div className="flex items-center justify-between mb-2" style={{ height: LABEL_HEIGHT - 8 }}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 min-w-0">
                    <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>{device.label}</span>
                    <span className="font-mono text-[10px] font-normal text-zinc-400 truncate">
                      {device.width} × {device.height}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => goBack(device.id)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-800 hover:bg-white cursor-pointer"
                      title={`Go back inside the ${device.label.toLowerCase()} screen`}
                      aria-label={`Go back inside the ${device.label.toLowerCase()} screen`}
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reload(device.id)}
                      className="p-1 rounded-md text-zinc-400 hover:text-zinc-800 hover:bg-white cursor-pointer"
                      title={`Reload the ${device.label.toLowerCase()} screen`}
                      aria-label={`Reload the ${device.label.toLowerCase()} screen`}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* The desktop sits in a monitor: dark bezel, a slightly thicker chin and a stand */}
                <div
                  className={
                    isDesktop
                      ? 'bg-zinc-800 rounded-xl shadow-md ring-1 ring-black/20'
                      : isTablet
                      ? 'relative bg-zinc-800 rounded-[32px] shadow-lg ring-1 ring-black/25'
                      : ''
                  }
                  style={isDesktop ? { padding: `${bezel}px ${bezel}px ${bezel + 8}px` } : isTablet ? { padding: bezel } : undefined}
                >
                  {/* Tablet: front camera in the top bezel, subtle edge highlight */}
                  {isTablet && (
                    <>
                      <span className="absolute top-[5px] left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-zinc-600 ring-1 ring-zinc-900" aria-hidden="true" />
                      <span className="absolute inset-0 rounded-[32px] ring-1 ring-inset ring-white/10 pointer-events-none" aria-hidden="true" />
                    </>
                  )}
                  <div
                    className={`relative bg-white overflow-hidden ${device.radius} ${isDesktop || isTablet ? '' : 'border border-zinc-300 shadow-sm'}`}
                    style={{ width, height }}
                  >
                    <CanvasLoadingOverlay
                      isVisible={!loaded[device.id]}
                      size="sm"
                      title={`Loading ${device.label.toLowerCase()}...`}
                      subtitle=""
                    />
                    <iframe
                      key={`${device.id}-${reloadKeys[device.id]}`}
                      ref={(el) => { frameRefs.current[device.id] = el; }}
                      srcDoc={previewHtml}
                      title={`${device.label} screen`}
                      onLoad={() => setLoaded((prev) => ({ ...prev, [device.id]: true }))}
                      sandbox="allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox allow-forms"
                      className="border-0 absolute top-0 left-0 origin-top-left bg-white"
                      style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}
                    />
                    {isTablet && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 rounded-full bg-zinc-900/40 pointer-events-none" aria-hidden="true" />
                    )}
                  </div>
                </div>

                {isDesktop && (
                  <div className="flex flex-col items-center" aria-hidden="true">
                    <div className="w-[12%] min-w-[44px] h-6 bg-gradient-to-b from-zinc-400 to-zinc-300" style={{ clipPath: 'polygon(14% 0, 86% 0, 100% 100%, 0 100%)' }} />
                    <div className="w-[26%] min-w-[96px] h-2.5 rounded-full bg-gradient-to-b from-zinc-300 to-zinc-400 shadow" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ScreensMode;
