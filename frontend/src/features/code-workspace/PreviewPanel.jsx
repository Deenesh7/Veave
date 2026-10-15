import React, { useState, useMemo } from 'react';
import { 
  X, 
  RotateCw, 
  Monitor, 
  Tablet, 
  Smartphone, 
  ExternalLink, 
  Play
} from 'lucide-react';
import { buildPreviewHTML } from '../../utils/codeTransformer';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

const VIEWPORT_SIZES = {
  desktop: 'w-full h-full max-w-full',
  tablet: 'w-[768px] h-[90%] max-h-[1024px] shadow-2xl rounded-2xl border border-zinc-300',
  mobile: 'w-[375px] h-[85%] max-h-[812px] shadow-2xl rounded-3xl border border-zinc-300'
};

export function PreviewPanel({
  isOpen,
  onClose,
  files = [],
  projectName = 'Application Preview'
}) {
  const [viewport, setViewport] = useState('desktop');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setIsRefreshing(true);
      const timer = setTimeout(() => setIsRefreshing(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen, refreshKey]);

  const previewHtml = useMemo(() => {
    if (!files || files.length === 0) return '';
    return buildPreviewHTML(files);
  }, [files, refreshKey]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex flex-col animate-in fade-in duration-150 select-none font-sans">
      {/* 1. Preview Header Bar */}
      <div className="h-13 bg-white border-b border-[#E2E5E8] px-4 sm:px-6 flex items-center justify-between shrink-0 text-zinc-900 shadow-2xs">
        {/* Left: Project title & live badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Sandbox</span>
          </div>
          <span className="text-xs font-bold text-zinc-900 hidden sm:inline">
            {projectName}
          </span>
        </div>

        {/* Center: Device Viewport Switcher */}
        <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200/80 gap-1">
          <button
            type="button"
            onClick={() => setViewport('desktop')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              viewport === 'desktop' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Desktop View"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Desktop</span>
          </button>

          <button
            type="button"
            onClick={() => setViewport('tablet')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              viewport === 'tablet' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Tablet View (768px)"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Tablet</span>
          </button>

          <button
            type="button"
            onClick={() => setViewport('mobile')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              viewport === 'mobile' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Mobile View (375px)"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Mobile</span>
          </button>
        </div>

        {/* Right: Refresh & Close */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="p-1.5 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Refresh Sandbox Preview"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Close Preview (Return to Code)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Interactive Iframe Canvas */}
      <div className="flex-1 overflow-hidden flex items-center justify-center p-4 bg-[#F8FAFC]">
        <div className={`transition-all duration-200 overflow-hidden bg-white relative ${VIEWPORT_SIZES[viewport]}`}>
          <iframe
            key={refreshKey}
            title="Sandbox Runtime Preview"
            srcDoc={previewHtml}
            className="w-full h-full border-none bg-white"
            sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
          />

          <CanvasLoadingOverlay
            isVisible={isRefreshing}
            size="md"
            title="Loading sandbox canvas..."
            subtitle="Bundling React components in sandbox"
          />
        </div>
      </div>
    </div>
  );
}

export default PreviewPanel;
