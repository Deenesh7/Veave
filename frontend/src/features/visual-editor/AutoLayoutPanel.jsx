import React from 'react';
import { 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  SlidersHorizontal, 
  ArrowRight, 
  ArrowDown,
  Check
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { NiceSelect } from './NiceSelect';

export function AutoLayoutPanel({ onApplyStyle }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle 
  } = useVisualEditorStore();

  const isCollapsed = collapsedSections.autoLayout;
  const styles = selectedElement?.computedStyles || {};

  const isFlexOrGrid = styles.display === 'flex' || styles.display === 'inline-flex' || styles.display === 'grid';
  const flexDirection = styles.flexDirection || 'row';
  const gapNum = parseInt(styles.gap || '0', 10) || 0;
  const paddingNum = parseInt(styles.padding || '0', 10) || 0;
  const alignment = styles.alignItems || 'center';
  const distribution = styles.justifyContent || 'flex-start';

  // Enable Auto Layout on selected element (switches to flexbox container)
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

  const handleApplyDirection = (dir) => {
    updateElementStyle('flexDirection', dir);
    if (onApplyStyle) onApplyStyle('flexDirection', dir);
  };

  const handleApplyGap = (val) => {
    const px = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    updateElementStyle('gap', px);
    if (onApplyStyle) onApplyStyle('gap', px);
  };

  const handleApplyPadding = (val) => {
    const px = `${Math.max(0, parseInt(val, 10) || 0)}px`;
    updateElementStyle('padding', px);
    if (onApplyStyle) onApplyStyle('padding', px);
  };

  const handleApplyAlignment = (val) => {
    updateElementStyle('alignItems', val);
    if (onApplyStyle) onApplyStyle('alignItems', val);
  };

  const handleApplyDistribution = (val) => {
    updateElementStyle('justifyContent', val);
    if (onApplyStyle) onApplyStyle('justifyContent', val);
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors">
        <button
          type="button"
          onClick={() => toggleSection('autoLayout')}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          <span>Auto Layout</span>
        </button>

        <div className="flex items-center gap-1.5">
          {!isFlexOrGrid && (
            <button
              type="button"
              onClick={handleEnableAutoLayout}
              className="p-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-colors"
              title="Add Auto Layout to Container"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => toggleSection('autoLayout')}
            className="p-0.5 text-zinc-400"
          >
            {isCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {!isFlexOrGrid ? (
            <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200/80 text-center">
              <p className="text-xs text-zinc-500 mb-2">
                Auto layout organizes child elements dynamically in rows or columns.
              </p>
              <button
                type="button"
                onClick={handleEnableAutoLayout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Enable Auto Layout</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Direction: Horizontal vs Vertical */}
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                  Flow Direction
                </label>
                <div className="flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                  <button
                    type="button"
                    onClick={() => handleApplyDirection('row')}
                    className={`flex-1 py-1 text-xs rounded font-medium flex items-center justify-center gap-1 transition-colors ${
                      flexDirection === 'row' ? 'bg-white text-zinc-600 font-bold shadow-2xs' : 'text-zinc-600'
                    }`}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    <span>Horizontal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyDirection('column')}
                    className={`flex-1 py-1 text-xs rounded font-medium flex items-center justify-center gap-1 transition-colors ${
                      flexDirection === 'column' ? 'bg-white text-zinc-600 font-bold shadow-2xs' : 'text-zinc-600'
                    }`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    <span>Vertical</span>
                  </button>
                </div>
              </div>

              {/* Gap & Padding */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    Gap
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="128"
                      value={gapNum}
                      onChange={(e) => handleApplyGap(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                    />
                    <span className="text-xs text-zinc-400">px</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    Padding
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="128"
                      value={paddingNum}
                      onChange={(e) => handleApplyPadding(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                    />
                    <span className="text-xs text-zinc-400">px</span>
                  </div>
                </div>
              </div>

              {/* Alignment & Distribution */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    Alignment
                  </label>
                  <NiceSelect
                    value={alignment}
                    onChange={(e) => handleApplyAlignment(e.target.value)}
                    options={[
                      { label: 'Start', value: 'flex-start' },
                      { label: 'Center', value: 'center' },
                      { label: 'End', value: 'flex-end' },
                      { label: 'Stretch', value: 'stretch' }
                    ]}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                    Distribution
                  </label>
                  <NiceSelect
                    value={distribution}
                    onChange={(e) => handleApplyDistribution(e.target.value)}
                    options={[
                      { label: 'Packed (Start)', value: 'flex-start' },
                      { label: 'Center', value: 'center' },
                      { label: 'Space Between', value: 'space-between' },
                      { label: 'Space Around', value: 'space-around' }
                    ]}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AutoLayoutPanel;
