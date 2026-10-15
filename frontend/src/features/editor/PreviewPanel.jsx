import { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { usePreview } from '../../hooks/usePreview';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';
import { VIEWPORT_SIZES } from '../../utils/constants';

export function PreviewPanel() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const { previewSize } = useEditorStore();
  const { iframeRef, previewHtml, previewUrl, previewBuildId, previewError, statusLabel, buildPreview } = usePreview({ files: currentProject?.files, validation: currentProject?.validation });
  const [isBuilding, setIsBuilding] = useState(false);

  const files = currentProject?.files || [];

  // Fingerprint the file set so we only rebuild when content actually changes.
  const filesFingerprint = useMemo(
    () => JSON.stringify(files.map(({ path, content }) => ({ path, content }))),
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
  }, [filesFingerprint, buildPreview]);

  if (!files || files.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white p-8 text-center h-full">
        <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mb-4 border border-zinc-200">
          <span className="text-2xl">✨</span>
        </div>
        <h3 className="text-xl font-semibold text-zinc-900 mb-2">No code to preview yet</h3>
        <p className="text-zinc-500 max-w-sm">Use the AI agent to generate your application, and the preview will appear here.</p>
      </div>
    );
  }

  const size = VIEWPORT_SIZES[previewSize] || VIEWPORT_SIZES.desktop;

  return (
    <div className="flex-1 bg-white overflow-auto flex flex-col items-center p-4 relative min-h-0 h-full">
      <div role={previewError ? 'alert' : 'status'} className={`w-full max-w-7xl mb-2 text-xs ${previewError ? 'text-red-700' : 'text-zinc-600'}`}>
        {isBuilding ? 'Preparing preview...' : statusLabel}
        {previewError && <pre className="whitespace-pre-wrap break-words mt-1">{previewError}</pre>}
      </div>
      <div 
        className="relative transition-all duration-300 ease-in-out origin-top mx-auto"
        style={{ 
          width: size.width === 1280 ? '100%' : `${size.width}px`,
          maxWidth: '1280px',
          height: '100%',
          minHeight: '600px'
        }}
      >
        <iframe
          key={previewBuildId}
          ref={iframeRef}
          src={previewUrl || undefined}
          srcDoc={previewUrl ? undefined : previewHtml}
          title="Live Preview"
          sandbox={`allow-scripts allow-modals allow-popups allow-forms${previewUrl ? ' allow-same-origin' : ''}`}
          className="w-full h-full bg-white rounded-lg shadow-2xl border border-zinc-200 absolute inset-0"
        />
        
        <CanvasLoadingOverlay
          isVisible={isBuilding}
          size="md"
          title="Loading canvas..."
          subtitle="Compiling interface preview"
        />
      </div>
    </div>
  );
}
