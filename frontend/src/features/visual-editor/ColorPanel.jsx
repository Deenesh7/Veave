import React from 'react';
import { Palette, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

// Helper to convert rgb/rgba to #rrggbb uppercase hex
function rgbToHex(rgbStr, fallback = '#000000') {
  if (!rgbStr) return fallback;
  if (rgbStr.startsWith('#')) return rgbStr.toUpperCase();
  if (rgbStr === 'transparent' || rgbStr === 'rgba(0, 0, 0, 0)') return fallback;
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return fallback;
  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

export function ColorPanel({ onApplyStyle }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle 
  } = useVisualEditorStore();

  const isCollapsed = collapsedSections.colors;
  const styles = selectedElement?.computedStyles || {};

  // Text color (default #A3A099 if dark theme zinc text)
  const textColor = rgbToHex(styles.color, '#A3A099');

  // Fill color (effective background color, default #000000)
  const fillColor = rgbToHex(styles.backgroundColor, '#000000');

  // Border presence check
  const rawBorderWidth = styles.borderWidth || '0px';
  const borderNum = parseInt(rawBorderWidth, 10) || 0;
  const hasBorder = borderNum > 0 && styles.borderStyle !== 'none';
  const borderColor = rgbToHex(styles.borderColor, '#27272A');

  // Opacity: convert 0-1 to percentage 0-100
  const rawOpacity = styles.opacity !== undefined ? parseFloat(styles.opacity) : 1;
  const opacityPercent = Math.round(rawOpacity * 100);

  const handleColorChange = (prop, hex) => {
    updateElementStyle(prop, hex);
    if (onApplyStyle) onApplyStyle(prop, hex);
  };

  const handleAddBorder = () => {
    updateElementStyle('borderWidth', '1px');
    updateElementStyle('borderStyle', 'solid');
    updateElementStyle('borderColor', '#27272A');
    if (onApplyStyle) {
      onApplyStyle('borderWidth', '1px');
      onApplyStyle('borderStyle', 'solid');
      onApplyStyle('borderColor', '#27272A');
    }
  };

  const handleRemoveBorder = () => {
    updateElementStyle('borderWidth', '0px');
    updateElementStyle('borderStyle', 'none');
    if (onApplyStyle) {
      onApplyStyle('borderWidth', '0px');
      onApplyStyle('borderStyle', 'none');
    }
  };

  const handleOpacityChange = (val) => {
    const num = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
    const normalized = (num / 100).toFixed(2);
    updateElementStyle('opacity', normalized);
    if (onApplyStyle) onApplyStyle('opacity', normalized);
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Header */}
      <button
        type="button"
        onClick={() => toggleSection('colors')}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Palette className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-bold">Colors</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>

      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* 1. Text Color */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Text
            </label>
            <div className="flex items-center gap-2">
              <div className="relative w-7 h-7 rounded-lg border border-zinc-300 overflow-hidden shrink-0 shadow-2xs">
                <input
                  type="color"
                  value={textColor.startsWith('#') && textColor.length === 7 ? textColor : '#A3A099'}
                  onChange={(e) => handleColorChange('color', e.target.value)}
                  className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                />
              </div>
              <input
                type="text"
                value={textColor}
                onChange={(e) => handleColorChange('color', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
            </div>
          </div>

          {/* 2. Fill Color (Background) */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Fill
            </label>
            <div className="flex items-center gap-2">
              <div className="relative w-7 h-7 rounded-lg border border-zinc-300 overflow-hidden shrink-0 shadow-2xs">
                <input
                  type="color"
                  value={fillColor.startsWith('#') && fillColor.length === 7 ? fillColor : '#000000'}
                  onChange={(e) => handleColorChange('backgroundColor', e.target.value)}
                  className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                />
              </div>
              <input
                type="text"
                value={fillColor}
                onChange={(e) => handleColorChange('backgroundColor', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
            </div>
          </div>

          {/* 3. Border (Add border or active border control) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Border
              </label>
              {hasBorder && (
                <button
                  type="button"
                  onClick={handleRemoveBorder}
                  className="text-[10px] text-red-500 hover:text-red-700 flex items-center gap-0.5 cursor-pointer"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>

            {!hasBorder ? (
              <button
                type="button"
                onClick={handleAddBorder}
                className="w-full py-1.5 px-3 rounded-lg border border-dashed border-zinc-300 hover:border-zinc-500 hover:bg-zinc-50/50 text-zinc-600 hover:text-zinc-600 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add border</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative w-7 h-7 rounded-lg border border-zinc-300 overflow-hidden shrink-0 shadow-2xs">
                  <input
                    type="color"
                    value={borderColor.startsWith('#') && borderColor.length === 7 ? borderColor : '#27272A'}
                    onChange={(e) => handleColorChange('borderColor', e.target.value)}
                    className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                  />
                </div>
                <input
                  type="text"
                  value={borderColor}
                  onChange={(e) => handleColorChange('borderColor', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-lg text-zinc-900 focus:outline-none focus:border-zinc-500 shadow-2xs"
                />
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={borderNum || 1}
                  onChange={(e) => {
                    const px = `${e.target.value}px`;
                    updateElementStyle('borderWidth', px);
                    if (onApplyStyle) onApplyStyle('borderWidth', px);
                  }}
                  className="w-14 px-2 py-1.5 text-xs font-mono text-center bg-zinc-50 border border-zinc-200 rounded-lg text-zinc-800"
                  title="Border Width in px"
                />
              </div>
            )}
          </div>

          {/* 4. Opacity Slider */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              <span>Opacity</span>
              <span className="font-mono text-zinc-700">{opacityPercent}%</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                value={opacityPercent}
                onChange={(e) => handleOpacityChange(e.target.value)}
                className="flex-1 accent-zinc-600 h-1.5 bg-zinc-200 rounded-lg cursor-pointer"
              />
              <input
                type="number"
                min="0"
                max="100"
                value={opacityPercent}
                onChange={(e) => handleOpacityChange(e.target.value)}
                className="w-14 px-2 py-1 text-xs text-right font-mono bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ColorPanel;
