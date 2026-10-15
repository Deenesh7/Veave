import React, { useState } from 'react';
import { Square, ChevronDown, ChevronUp, CornerDownLeft, Maximize2 } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { NiceSelect } from './NiceSelect';

function rgbToHex(rgbStr) {
  if (!rgbStr) return '#e2e8f0';
  if (rgbStr.startsWith('#')) return rgbStr;
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#e2e8f0';
  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function BorderPanel({ onApplyStyle }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle 
  } = useVisualEditorStore();

  const [individualCorners, setIndividualCorners] = useState(false);

  const isCollapsed = collapsedSections.border;
  const styles = selectedElement?.computedStyles || {};

  const rawWidth = styles.borderWidth || '0px';
  const widthNum = parseInt(rawWidth, 10) || 0;
  const hasBorder = widthNum > 0 && styles.borderStyle !== 'none';

  const borderStyle = styles.borderStyle || 'solid';
  const borderColor = rgbToHex(styles.borderColor || '#e2e8f0');

  // Border radius parsing
  const rawRadius = styles.borderRadius || '0px';
  const radiusNum = parseInt(rawRadius, 10) || 0;

  const tl = parseInt(styles.borderTopLeftRadius || rawRadius, 10) || 0;
  const tr = parseInt(styles.borderTopRightRadius || rawRadius, 10) || 0;
  const br = parseInt(styles.borderBottomRightRadius || rawRadius, 10) || 0;
  const bl = parseInt(styles.borderBottomLeftRadius || rawRadius, 10) || 0;

  const handleToggleBorder = () => {
    if (hasBorder) {
      updateElementStyle('borderWidth', '0px');
      updateElementStyle('borderStyle', 'none');
      if (onApplyStyle) {
        onApplyStyle('borderWidth', '0px');
        onApplyStyle('borderStyle', 'none');
      }
    } else {
      updateElementStyle('borderWidth', '1px');
      updateElementStyle('borderStyle', 'solid');
      updateElementStyle('borderColor', '#E2E5E8');
      if (onApplyStyle) {
        onApplyStyle('borderWidth', '1px');
        onApplyStyle('borderStyle', 'solid');
        onApplyStyle('borderColor', '#E2E5E8');
      }
    }
  };

  const handleWidthChange = (val) => {
    const pxVal = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    updateElementStyle('borderWidth', pxVal);
    if (onApplyStyle) onApplyStyle('borderWidth', pxVal);
  };

  const handleStyleChange = (val) => {
    updateElementStyle('borderStyle', val);
    if (onApplyStyle) onApplyStyle('borderStyle', val);
  };

  const handleColorChange = (val) => {
    updateElementStyle('borderColor', val);
    if (onApplyStyle) onApplyStyle('borderColor', val);
  };

  const handleUniformRadiusChange = (val) => {
    const pxVal = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    updateElementStyle('borderRadius', pxVal);
    if (onApplyStyle) onApplyStyle('borderRadius', pxVal);
  };

  const handleCornerChange = (corner, val) => {
    const pxVal = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    const propMap = {
      tl: 'borderTopLeftRadius',
      tr: 'borderTopRightRadius',
      br: 'borderBottomRightRadius',
      bl: 'borderBottomLeftRadius'
    };
    updateElementStyle(propMap[corner], pxVal);
    if (onApplyStyle) onApplyStyle(propMap[corner], pxVal);
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Header */}
      <button
        type="button"
        onClick={() => toggleSection('border')}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Square className="w-3.5 h-3.5 text-zinc-500" />
          <span>Border & Radius</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>

      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* Add / Toggle Border Button */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              Border Line
            </span>
            <button
              type="button"
              onClick={handleToggleBorder}
              className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${
                hasBorder
                  ? 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {hasBorder ? 'Active' : '+ Add Border'}
            </button>
          </div>

          {/* Border Controls when Border is active */}
          {hasBorder && (
            <div className="space-y-2.5 bg-zinc-50/70 p-2.5 rounded-xl border border-zinc-200/70 animate-in fade-in duration-150">
              {/* Width & Style */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">
                    Width
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="32"
                      value={widthNum}
                      onChange={(e) => handleWidthChange(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                    />
                    <span className="text-xs text-zinc-400">px</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">
                    Style
                  </label>
                  <NiceSelect
                    value={borderStyle}
                    onChange={(e) => handleStyleChange(e.target.value)}
                    options={[
                      { label: 'Solid', value: 'solid' },
                      { label: 'Dashed', value: 'dashed' },
                      { label: 'Dotted', value: 'dotted' },
                      { label: 'Double', value: 'double' }
                    ]}
                  />
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-[10px] text-zinc-400 font-bold uppercase mb-1">
                  Color
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative w-6 h-6 rounded-lg border border-zinc-300 overflow-hidden shrink-0 shadow-2xs">
                    <input
                      type="color"
                      value={borderColor}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                    />
                  </div>
                  <input
                    type="text"
                    value={borderColor.toUpperCase()}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Corner Radius Section */}
          <div className="pt-2 border-t border-zinc-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Border Radius
              </span>
              <button
                type="button"
                onClick={() => setIndividualCorners(!individualCorners)}
                className={`p-1 rounded text-xs transition-colors ${
                  individualCorners ? 'bg-zinc-50 text-zinc-600 font-bold' : 'text-zinc-400 hover:text-zinc-700'
                }`}
                title="Toggle individual corner controls"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </div>

            {!individualCorners ? (
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="48"
                  value={radiusNum}
                  onChange={(e) => handleUniformRadiusChange(e.target.value)}
                  className="flex-1 accent-zinc-600 h-1.5 bg-zinc-200 rounded-lg cursor-pointer"
                />
                <div className="flex items-center gap-1 w-16">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={radiusNum}
                    onChange={(e) => handleUniformRadiusChange(e.target.value)}
                    className="w-full px-2 py-1 text-xs text-right font-mono bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                  <span className="text-xs text-zinc-400">px</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 bg-zinc-50/70 p-2 rounded-xl border border-zinc-200/70">
                <div>
                  <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Top Left</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tl}
                    onChange={(e) => handleCornerChange('tl', e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                </div>
                <div>
                  <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Top Right</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tr}
                    onChange={(e) => handleCornerChange('tr', e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                </div>
                <div>
                  <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Bottom Left</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={bl}
                    onChange={(e) => handleCornerChange('bl', e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                </div>
                <div>
                  <span className="block text-[9px] text-zinc-400 font-bold uppercase mb-0.5">Bottom Right</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={br}
                    onChange={(e) => handleCornerChange('br', e.target.value)}
                    className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BorderPanel;
