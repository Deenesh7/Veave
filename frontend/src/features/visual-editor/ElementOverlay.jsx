import React from 'react';
import { useVisualEditorStore } from './visualEditorStore';

export function ElementOverlay({ iframeRect }) {
  const { selectedElement, hoveredElement } = useVisualEditorStore();

  const selRect = selectedElement?.rect;
  const hovRect = hoveredElement?.rect;

  const isSelInView = selRect && (selRect.top + selRect.height >= 0) && (selRect.top <= 2500);
  const isHovInView = hovRect && (hovRect.top + hovRect.height >= 0) && (hovRect.top <= 2500);

  const isSameAsSelected = selRect && hovRect &&
    Math.abs(selRect.top - hovRect.top) < 2 &&
    Math.abs(selRect.left - hovRect.left) < 2 &&
    Math.abs(selRect.width - hovRect.width) < 2;

  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {/* Hover outline removed per user request */}

      {/* 2. Selected Element Outline (Clear Blue with Handles & Tag) */}
      {isSelInView && (
        <div
          className="absolute border-2 border-zinc-600 pointer-events-none transition-none shadow-[0_0_0_1px_rgba(255,255,255,0.8)]"
          style={{
            top: `${selRect.top}px`,
            left: `${selRect.left}px`,
            width: `${selRect.width}px`,
            height: `${selRect.height}px`,
          }}
        >
          {/* Tag Pill + Name at top boundary */}
          <div className="absolute -top-6 left-0 flex items-center gap-1 pointer-events-none select-none">
            <div className="px-2 py-0.5 rounded bg-zinc-600 text-white text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm">
              <span>{selectedElement.tagName}</span>
              {selectedElement.text && (
                <span className="max-w-[120px] truncate text-zinc-100 font-normal font-sans text-[10px]">
                  "{selectedElement.text}"
                </span>
              )}
            </div>
          </div>

          {/* Dimension readout at bottom */}
          <div className="absolute -bottom-5 right-0 px-1.5 py-0.5 rounded bg-zinc-900/90 text-white text-[9px] font-mono font-semibold pointer-events-none select-none shadow-xs">
            {Math.round(selRect.width)} × {Math.round(selRect.height)}
          </div>

          {/* 8 Resize Handles on Corners and Edges (visual indicators, pointer-events-none so clicks pass directly to canvas) */}
          <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
          <div className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-3 h-3 bg-white border-2 border-zinc-600 rounded-xs pointer-events-none shadow-2xs" />
        </div>
      )}
    </div>
  );
}

export default ElementOverlay;
