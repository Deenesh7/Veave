import React, { useState } from 'react';
import { 
  Layout, 
  ChevronDown, 
  ChevronUp, 
  ArrowRight, 
  ArrowDown, 
  Plus, 
  SlidersHorizontal,
  Maximize2
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { NiceSelect } from './NiceSelect';

function parseUnitValue(raw, fallbackNum = '0') {
  if (!raw || raw === 'auto') return { val: String(fallbackNum), unit: 'px', isAuto: true };
  if (raw === 'fit-content' || raw === 'min-content' || raw === 'max-content') {
    return { val: String(fallbackNum), unit: 'fit', isAuto: true };
  }
  const match = String(raw).match(/^([\d.]+)(px|%|rem|em|vw|vh)?$/);
  if (match) return { val: match[1], unit: match[2] || 'px', isAuto: false };
  const numOnly = String(raw).replace(/[^\d.]/g, '');
  return { val: numOnly || String(fallbackNum), unit: 'px', isAuto: false };
}

function parsePx(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val);
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : Math.round(n);
}

export function LayoutPanel({ onApplyStyle }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle 
  } = useVisualEditorStore();

  const [expandedPadding, setExpandedPadding] = useState(false);
  const [expandedMargin, setExpandedMargin] = useState(false);

  const isCollapsed = collapsedSections.layout;
  const styles = selectedElement?.computedStyles || {};

  // Width & Height with fallbacks from computed boxWidth/boxHeight
  const boxW = styles.boxWidth !== undefined ? String(styles.boxWidth) : '47';
  const boxH = styles.boxHeight !== undefined ? String(styles.boxHeight) : '20';

  const widthParsed = parseUnitValue(styles.width, boxW);
  const heightParsed = parseUnitValue(styles.height, boxH);

  // Sizing mode (fixed, hug, fill)
  const sizingW = styles.sizingW || (styles.width === '100%' ? 'fill' : (styles.width === 'fit-content' || styles.width === 'auto' ? 'hug' : 'fixed'));
  const sizingH = styles.sizingH || (styles.height === '100%' ? 'fill' : (styles.height === 'fit-content' || styles.height === 'auto' ? 'hug' : 'fixed'));

  // Display & Flex
  const display = styles.display || 'block';
  const position = styles.position || 'static';
  const isFlex = display === 'flex' || display === 'inline-flex';
  const flexDirection = styles.flexDirection || 'row';
  const gapNum = parseInt(styles.gap || '0', 10) || 0;

  // Padding
  const pt = parsePx(styles.paddingTop);
  const pr = parsePx(styles.paddingRight);
  const pb = parsePx(styles.paddingBottom);
  const pl = parsePx(styles.paddingLeft);
  const padV = pt;
  const padH = pl;

  // Margin
  const mt = parsePx(styles.marginTop);
  const mr = parsePx(styles.marginRight);
  const mb = parsePx(styles.marginBottom);
  const ml = parsePx(styles.marginLeft);
  const marV = mt;
  const marH = ml;

  const handleDimensionChange = (prop, val, unit) => {
    const combined = unit === 'auto' || unit === 'fit' ? (unit === 'fit' ? 'fit-content' : 'auto') : `${val}${unit}`;
    updateElementStyle(prop, combined);
    if (onApplyStyle) onApplyStyle(prop, combined);
  };

  const handleSizingModeChange = (dim, mode) => {
    const prop = dim === 'W' ? 'width' : 'height';
    const storeProp = dim === 'W' ? 'sizingW' : 'sizingH';
    updateElementStyle(storeProp, mode);

    let val = 'fixed';
    if (mode === 'fixed') {
      val = dim === 'W' ? `${boxW}px` : `${boxH}px`;
    } else if (mode === 'hug') {
      val = 'fit-content';
    } else if (mode === 'fill') {
      val = '100%';
    }
    updateElementStyle(prop, val);
    if (onApplyStyle) onApplyStyle(prop, val);
  };

  const handleEnableAutoLayout = () => {
    updateElementStyle('display', 'flex');
    updateElementStyle('flexDirection', 'row');
    updateElementStyle('alignItems', 'center');
    updateElementStyle('gap', '12px');
    if (onApplyStyle) {
      onApplyStyle('display', 'flex');
      onApplyStyle('flexDirection', 'row');
      onApplyStyle('alignItems', 'center');
      onApplyStyle('gap', '12px');
    }
  };

  const handlePadding2Axis = (axis, val) => {
    const px = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    if (axis === 'vertical') {
      updateElementStyle('paddingTop', px);
      updateElementStyle('paddingBottom', px);
      if (onApplyStyle) {
        onApplyStyle('paddingTop', px);
        onApplyStyle('paddingBottom', px);
      }
    } else {
      updateElementStyle('paddingLeft', px);
      updateElementStyle('paddingRight', px);
      if (onApplyStyle) {
        onApplyStyle('paddingLeft', px);
        onApplyStyle('paddingRight', px);
      }
    }
  };

  const handleMargin2Axis = (axis, val) => {
    const px = `${parseInt(val, 10) || 0}px`;
    if (axis === 'vertical') {
      updateElementStyle('marginTop', px);
      updateElementStyle('marginBottom', px);
      if (onApplyStyle) {
        onApplyStyle('marginTop', px);
        onApplyStyle('marginBottom', px);
      }
    } else {
      updateElementStyle('marginLeft', px);
      updateElementStyle('marginRight', px);
      if (onApplyStyle) {
        onApplyStyle('marginLeft', px);
        onApplyStyle('marginRight', px);
      }
    }
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Header */}
      <button
        type="button"
        onClick={() => toggleSection('layout')}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Layout className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-bold">Layout</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>

      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-3.5">
          {/* 1. Size (W & H with px and fixed/hug/fill) */}
          <div className="space-y-2">
            <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Size
            </span>

            {/* Width: W [47] [px] [fixed] */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-500 w-4">W</span>
              <input
                type="number"
                value={widthParsed.val || boxW}
                onChange={(e) => handleDimensionChange('width', e.target.value, widthParsed.unit)}
                className="flex-1 px-2 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-xl text-zinc-900 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
              <NiceSelect
                value={widthParsed.unit}
                onChange={(e) => handleDimensionChange('width', widthParsed.val || boxW, e.target.value)}
                options={[
                  { label: 'px', value: 'px' },
                  { label: '%', value: '%' },
                  { label: 'rem', value: 'rem' },
                  { label: 'auto', value: 'auto' },
                  { label: 'fit', value: 'fit' }
                ]}
                className="w-18"
              />
              <NiceSelect
                value={sizingW}
                onChange={(e) => handleSizingModeChange('W', e.target.value)}
                options={[
                  { label: 'fixed', value: 'fixed' },
                  { label: 'hug', value: 'hug' },
                  { label: 'fill', value: 'fill' }
                ]}
                className="w-22"
              />
            </div>

            {/* Height: H [20] [px] [fixed] */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-500 w-4">H</span>
              <input
                type="number"
                value={heightParsed.val || boxH}
                onChange={(e) => handleDimensionChange('height', e.target.value, heightParsed.unit)}
                className="flex-1 px-2 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-xl text-zinc-900 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
              <NiceSelect
                value={heightParsed.unit}
                onChange={(e) => handleDimensionChange('height', heightParsed.val || boxH, e.target.value)}
                options={[
                  { label: 'px', value: 'px' },
                  { label: '%', value: '%' },
                  { label: 'rem', value: 'rem' },
                  { label: 'auto', value: 'auto' },
                  { label: 'fit', value: 'fit' }
                ]}
                className="w-18"
              />
              <NiceSelect
                value={sizingH}
                onChange={(e) => handleSizingModeChange('H', e.target.value)}
                options={[
                  { label: 'fixed', value: 'fixed' },
                  { label: 'hug', value: 'hug' },
                  { label: 'fill', value: 'fill' }
                ]}
                className="w-22"
              />
            </div>
          </div>

          {/* Position & Display */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Position
              </label>
              <NiceSelect
                value={position}
                onChange={(e) => {
                  updateElementStyle('position', e.target.value);
                  if (onApplyStyle) onApplyStyle('position', e.target.value);
                }}
                options={[
                  { label: 'Static', value: 'static' },
                  { label: 'Relative', value: 'relative' },
                  { label: 'Absolute', value: 'absolute' },
                  { label: 'Fixed', value: 'fixed' },
                  { label: 'Sticky', value: 'sticky' }
                ]}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Display
              </label>
              <NiceSelect
                value={display}
                onChange={(e) => {
                  updateElementStyle('display', e.target.value);
                  if (onApplyStyle) onApplyStyle('display', e.target.value);
                }}
                options={[
                  { label: 'Block', value: 'block' },
                  { label: 'Flex', value: 'flex' },
                  { label: 'Grid', value: 'grid' },
                  { label: 'Inline', value: 'inline' },
                  { label: 'Inline Block', value: 'inline-block' },
                  { label: 'None', value: 'none' }
                ]}
              />
            </div>
          </div>

          {/* 2. Auto Layout */}
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Auto layout
              </span>
              {isFlex && (
                <span className="text-[10px] font-mono font-bold text-zinc-600 bg-zinc-50 px-1.5 py-0.2 rounded border border-zinc-200">
                  {flexDirection === 'row' ? 'Horizontal' : 'Vertical'}
                </span>
              )}
            </div>

            {!isFlex ? (
              <button
                type="button"
                onClick={handleEnableAutoLayout}
                className="w-full py-1.5 px-3 rounded-lg border border-dashed border-zinc-300 hover:border-zinc-500 hover:bg-zinc-50/50 text-zinc-600 hover:text-zinc-600 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add auto layout</span>
              </button>
            ) : (
              <div className="space-y-2 bg-zinc-50/40 p-2.5 rounded-xl border border-zinc-100">
                {/* Flow Direction */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-12">Flow</span>
                  <div className="flex-1 flex items-center bg-white p-0.5 rounded-lg border border-zinc-200 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => {
                        updateElementStyle('flexDirection', 'row');
                        if (onApplyStyle) onApplyStyle('flexDirection', 'row');
                      }}
                      className={`flex-1 py-1 text-xs rounded font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                        flexDirection === 'row' ? 'bg-zinc-600 text-white font-bold shadow-2xs' : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>Row</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateElementStyle('flexDirection', 'column');
                        if (onApplyStyle) onApplyStyle('flexDirection', 'column');
                      }}
                      className={`flex-1 py-1 text-xs rounded font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                        flexDirection === 'column' ? 'bg-zinc-600 text-white font-bold shadow-2xs' : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      <span>Column</span>
                    </button>
                  </div>
                </div>

                {/* Gap */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-12">Gap</span>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={gapNum}
                    onChange={(e) => {
                      const px = `${e.target.value}px`;
                      updateElementStyle('gap', px);
                      if (onApplyStyle) onApplyStyle('gap', px);
                    }}
                    className="w-20 px-2 py-1 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                  <span className="text-xs text-zinc-500">px</span>
                </div>
              </div>
            )}
          </div>

          {/* 3. Padding (0 px 0 px) */}
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Padding
              </span>
              <button
                type="button"
                onClick={() => setExpandedPadding(!expandedPadding)}
                className="text-[10px] text-zinc-600 hover:text-zinc-800 cursor-pointer"
              >
                {expandedPadding ? 'Compact' : 'Individual'}
              </button>
            </div>

            {!expandedPadding ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200">
                  <span className="text-[10px] text-zinc-400 font-bold uppercase">V</span>
                  <input
                    type="number"
                    min="0"
                    value={padV}
                    onChange={(e) => handlePadding2Axis('vertical', e.target.value)}
                    className="w-full text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                  />
                  <span className="text-[10px] text-zinc-400 font-mono">px</span>
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200">
                  <span className="text-[10px] text-zinc-400 font-bold uppercase">H</span>
                  <input
                    type="number"
                    min="0"
                    value={padH}
                    onChange={(e) => handlePadding2Axis('horizontal', e.target.value)}
                    className="w-full text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                  />
                  <span className="text-[10px] text-zinc-400 font-mono">px</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {['Top', 'Right', 'Bottom', 'Left'].map((side, idx) => {
                  const val = [pt, pr, pb, pl][idx];
                  const prop = `padding${side}`;
                  return (
                    <div key={side} className="flex flex-col items-center bg-zinc-50 p-1 rounded-lg border border-zinc-200">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase">{side[0]}</span>
                      <input
                        type="number"
                        min="0"
                        value={val}
                        onChange={(e) => {
                          const px = `${e.target.value}px`;
                          updateElementStyle(prop, px);
                          if (onApplyStyle) onApplyStyle(prop, px);
                        }}
                        className="w-full text-center text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Margin (0 px 0 px) */}
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Margin
              </span>
              <button
                type="button"
                onClick={() => setExpandedMargin(!expandedMargin)}
                className="text-[10px] text-zinc-600 hover:text-zinc-800 cursor-pointer"
              >
                {expandedMargin ? 'Compact' : 'Individual'}
              </button>
            </div>

            {!expandedMargin ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200">
                  <span className="text-[10px] text-zinc-400 font-bold uppercase">V</span>
                  <input
                    type="number"
                    value={marV}
                    onChange={(e) => handleMargin2Axis('vertical', e.target.value)}
                    className="w-full text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                  />
                  <span className="text-[10px] text-zinc-400 font-mono">px</span>
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-50 px-2 py-1 rounded-lg border border-zinc-200">
                  <span className="text-[10px] text-zinc-400 font-bold uppercase">H</span>
                  <input
                    type="number"
                    value={marH}
                    onChange={(e) => handleMargin2Axis('horizontal', e.target.value)}
                    className="w-full text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                  />
                  <span className="text-[10px] text-zinc-400 font-mono">px</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {['Top', 'Right', 'Bottom', 'Left'].map((side, idx) => {
                  const val = [mt, mr, mb, ml][idx];
                  const prop = `margin${side}`;
                  return (
                    <div key={side} className="flex flex-col items-center bg-zinc-50 p-1 rounded-lg border border-zinc-200">
                      <span className="text-[9px] text-zinc-400 font-bold uppercase">{side[0]}</span>
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => {
                          const px = `${e.target.value}px`;
                          updateElementStyle(prop, px);
                          if (onApplyStyle) onApplyStyle(prop, px);
                        }}
                        className="w-full text-center text-xs font-mono font-semibold bg-transparent focus:outline-none text-zinc-900"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LayoutPanel;
