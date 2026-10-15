import React, { useState, useEffect } from 'react';
import { Eye, Sliders, ExternalLink } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { WebsiteFrame } from './WebsiteFrame';
import { VIEWPORT_SIZES } from '../../utils/constants';
import { CanvasLoadingOverlay } from '../../components/common/CanvasLoadingOverlay';

export function PreviewMode({ previewHtml, isBuilding = false }) {
  const { viewport, setActiveMode } = useVisualEditorStore();

  const viewportConfig = VIEWPORT_SIZES[viewport] || VIEWPORT_SIZES.desktop;
  const isConstrained = viewport !== 'desktop';

  return (
    <div className="relative flex-1 w-full h-full canvas-grid-pattern overflow-auto flex flex-col items-center justify-center p-4">
      {/* The clean canvas without inspector or selection handles */}
      <div
        className={`relative transition-all duration-300 mx-auto flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-zinc-200 bg-white ${
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
          minHeight: '540px',
        }}
      >
        <div className="relative flex-1 w-full h-full min-h-0 bg-white">
          <WebsiteFrame previewHtml={previewHtml} isBuilding={isBuilding} />

          {!previewHtml && (
            <CanvasLoadingOverlay
              isVisible={true}
              size="lg"
              title="Loading preview..."
              subtitle="Rendering clean full-screen interactive prototype"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default PreviewMode;
