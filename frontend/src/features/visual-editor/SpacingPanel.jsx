import React, { useState } from 'react';
import { 
  Maximize2, 
  ChevronDown, 
  ChevronUp, 
  Link, 
  Unlink 
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

function parsePx(val) {
  if (!val) return 0;
  return parseInt(val, 10) || 0;
}

export function SpacingPanel({ onApplyStyle }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle 
  } = useVisualEditorStore();

  const [linkPadding, setLinkPadding] = useState(true);
  const [linkMargin, setLinkMargin] = useState(true);

  const isCollapsed = collapsedSections.spacing;
  const styles = selectedElement?.computedStyles || {};

  // Padding values
  const pt = parsePx(styles.paddingTop);
  const pr = parsePx(styles.paddingRight);
  const pb = parsePx(styles.paddingBottom);
  const pl = parsePx(styles.paddingLeft);

  // Margin values
  const mt = parsePx(styles.marginTop);
  const mr = parsePx(styles.marginRight);
  const mb = parsePx(styles.marginBottom);
  const ml = parsePx(styles.marginLeft);

  const handlePaddingChange = (side, val) => {
    const px = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    if (linkPadding) {
      updateElementStyle('paddingTop', px);
      updateElementStyle('paddingRight', px);
      updateElementStyle('paddingBottom', px);
      updateElementStyle('paddingLeft', px);
      if (onApplyStyle) {
        onApplyStyle('paddingTop', px);
        onApplyStyle('paddingRight', px);
        onApplyStyle('paddingBottom', px);
        onApplyStyle('paddingLeft', px);
      }
    } else {
      const propMap = {
        top: 'paddingTop',
        right: 'paddingRight',
        bottom: 'paddingBottom',
        left: 'paddingLeft'
      };
      updateElementStyle(propMap[side], px);
      if (onApplyStyle) onApplyStyle(propMap[side], px);
    }
  };

  const handleMarginChange = (side, val) => {
    const num = parseInt(val, 10) || 0;
    const px = `${num}px`;
    if (linkMargin) {
      updateElementStyle('marginTop', px);
      updateElementStyle('marginRight', px);
      updateElementStyle('marginBottom', px);
      updateElementStyle('marginLeft', px);
      if (onApplyStyle) {
        onApplyStyle('marginTop', px);
        onApplyStyle('marginRight', px);
        onApplyStyle('marginBottom', px);
        onApplyStyle('marginLeft', px);
      }
    } else {
      const propMap = {
        top: 'marginTop',
        right: 'marginRight',
        bottom: 'marginBottom',
        left: 'marginLeft'
      };
      updateElementStyle(propMap[side], px);
      if (onApplyStyle) onApplyStyle(propMap[side], px);
    }
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Header */}
      <button
        type="button"
        onClick={() => toggleSection('spacing')}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Maximize2 className="w-3.5 h-3.5 text-zinc-500" />
          <span>Spacing (Padding & Margin)</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>

      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          {/* Visual Box Model Diagram */}
          <div className="relative p-4 rounded-xl border border-zinc-200/80 bg-zinc-50/50 flex flex-col items-center">
            {/* Margin label */}
            <span className="absolute top-1.5 left-2 text-[9px] font-bold uppercase tracking-wider text-amber-600/80">
              Margin
            </span>

            {/* Margin Inputs Box */}
            <div className="w-full flex flex-col items-center gap-1">
              <input
                type="number"
                value={mt}
                onChange={(e) => handleMarginChange('top', e.target.value)}
                placeholder="0"
                className="w-12 h-6 text-center text-[11px] font-mono bg-white border border-amber-300/80 rounded text-zinc-800 shadow-2xs"
                title="Margin Top"
              />

              <div className="w-full flex items-center justify-between gap-1">
                <input
                  type="number"
                  value={ml}
                  onChange={(e) => handleMarginChange('left', e.target.value)}
                  placeholder="0"
                  className="w-12 h-6 text-center text-[11px] font-mono bg-white border border-amber-300/80 rounded text-zinc-800 shadow-2xs"
                  title="Margin Left"
                />

                {/* Inner Padding Box */}
                <div className="flex-1 max-w-[140px] p-2 bg-zinc-50/60 border border-zinc-200/80 rounded-lg flex flex-col items-center gap-1 relative">
                  <span className="text-[9px] font-bold uppercase text-zinc-600/80">
                    Padding
                  </span>
                  <input
                    type="number"
                    value={pt}
                    onChange={(e) => handlePaddingChange('top', e.target.value)}
                    placeholder="0"
                    className="w-11 h-5 text-center text-[11px] font-mono bg-white border border-zinc-300 rounded text-zinc-800 shadow-2xs"
                    title="Padding Top"
                  />
                  <div className="w-full flex items-center justify-between">
                    <input
                      type="number"
                      value={pl}
                      onChange={(e) => handlePaddingChange('left', e.target.value)}
                      placeholder="0"
                      className="w-10 h-5 text-center text-[11px] font-mono bg-white border border-zinc-300 rounded text-zinc-800 shadow-2xs"
                      title="Padding Left"
                    />
                    <div className="w-7 h-5 rounded bg-zinc-200/60 flex items-center justify-center text-[9px] font-bold text-zinc-800">
                      El
                    </div>
                    <input
                      type="number"
                      value={pr}
                      onChange={(e) => handlePaddingChange('right', e.target.value)}
                      placeholder="0"
                      className="w-10 h-5 text-center text-[11px] font-mono bg-white border border-zinc-300 rounded text-zinc-800 shadow-2xs"
                      title="Padding Right"
                    />
                  </div>
                  <input
                    type="number"
                    value={pb}
                    onChange={(e) => handlePaddingChange('bottom', e.target.value)}
                    placeholder="0"
                    className="w-11 h-5 text-center text-[11px] font-mono bg-white border border-zinc-300 rounded text-zinc-800 shadow-2xs"
                    title="Padding Bottom"
                  />
                </div>

                <input
                  type="number"
                  value={mr}
                  onChange={(e) => handleMarginChange('right', e.target.value)}
                  placeholder="0"
                  className="w-12 h-6 text-center text-[11px] font-mono bg-white border border-amber-300/80 rounded text-zinc-800 shadow-2xs"
                  title="Margin Right"
                />
              </div>

              <input
                type="number"
                value={mb}
                onChange={(e) => handleMarginChange('bottom', e.target.value)}
                placeholder="0"
                className="w-12 h-6 text-center text-[11px] font-mono bg-white border border-amber-300/80 rounded text-zinc-800 shadow-2xs"
                title="Margin Bottom"
              />
            </div>
          </div>

          {/* Padding Controls Row */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Padding Values (px)
              </span>
              <button
                type="button"
                onClick={() => setLinkPadding(!linkPadding)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  linkPadding ? 'bg-zinc-50 text-zinc-600 font-bold' : 'text-zinc-400 hover:text-zinc-700'
                }`}
                title={linkPadding ? 'Padding is linked (uniform)' : 'Padding is unlinked (individual sides)'}
              >
                {linkPadding ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                <span>{linkPadding ? 'Linked' : 'Custom'}</span>
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {['top', 'right', 'bottom', 'left'].map((side) => {
                const valMap = { top: pt, right: pr, bottom: pb, left: pl };
                return (
                  <div key={side} className="text-center">
                    <span className="block text-[9px] text-zinc-400 uppercase font-bold mb-0.5">
                      {side[0].toUpperCase()}
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="128"
                      value={valMap[side]}
                      onChange={(e) => handlePaddingChange(side, e.target.value)}
                      className="w-full py-1 text-xs text-center font-mono bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Margin Controls Row */}
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Margin Values (px)
              </span>
              <button
                type="button"
                onClick={() => setLinkMargin(!linkMargin)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  linkMargin ? 'bg-amber-50 text-amber-700 font-bold' : 'text-zinc-400 hover:text-zinc-700'
                }`}
                title={linkMargin ? 'Margin is linked (uniform)' : 'Margin is unlinked (individual sides)'}
              >
                {linkMargin ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                <span>{linkMargin ? 'Linked' : 'Custom'}</span>
              </button>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {['top', 'right', 'bottom', 'left'].map((side) => {
                const valMap = { top: mt, right: mr, bottom: mb, left: ml };
                return (
                  <div key={side} className="text-center">
                    <span className="block text-[9px] text-zinc-400 uppercase font-bold mb-0.5">
                      {side[0].toUpperCase()}
                    </span>
                    <input
                      type="number"
                      value={valMap[side]}
                      onChange={(e) => handleMarginChange(side, e.target.value)}
                      className="w-full py-1 text-xs text-center font-mono bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-amber-500 shadow-2xs"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SpacingPanel;
