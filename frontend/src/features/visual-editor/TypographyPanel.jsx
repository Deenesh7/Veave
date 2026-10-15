import React from 'react';
import { 
  Type, 
  ChevronDown, 
  ChevronUp, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  AlignJustify,
  Italic,
  Underline,
  Strikethrough,
  CaseSensitive
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { NiceSelect } from './NiceSelect';

function normalizeFontFamily(raw) {
  if (!raw) return "'Inter', sans-serif";
  const clean = raw.toLowerCase().replace(/['"]/g, '');
  if (clean.includes('inter')) return "'Inter', sans-serif";
  if (clean.includes('geist')) return "'Geist', sans-serif";
  if (clean.includes('space grotesk')) return "'Space Grotesk', sans-serif";
  if (clean.includes('roboto')) return "'Roboto', sans-serif";
  if (clean.includes('system') || clean.includes('apple-system') || clean.includes('segoe')) {
    return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
  return "'Inter', sans-serif";
}

function normalizeFontWeight(raw) {
  if (!raw) return '400';
  if (raw === 'normal') return '400';
  if (raw === 'bold') return '700';
  return String(raw);
}

export function TypographyPanel({ onApplyStyle, onApplyText }) {
  const { 
    selectedElement, 
    collapsedSections, 
    toggleSection,
    updateElementStyle,
    updateElementText 
  } = useVisualEditorStore();

  const isCollapsed = collapsedSections.typography;
  const styles = selectedElement?.computedStyles || {};

  // Parse font size and unit (e.g. "14px" -> 14, "px")
  const rawFontSize = styles.fontSize || '14px';
  const sizeMatch = String(rawFontSize).match(/^([\d.]+)(px|rem|em|pt)?$/);
  const sizeNum = sizeMatch ? sizeMatch[1] : '14';
  const sizeUnit = sizeMatch && sizeMatch[2] ? sizeMatch[2] : 'px';

  const fonts = [
    { label: 'Inter', value: "'Inter', sans-serif" },
    { label: 'Geist', value: "'Geist', sans-serif" },
    { label: 'Space Grotesk', value: "'Space Grotesk', sans-serif" },
    { label: 'Roboto', value: "'Roboto', sans-serif" },
    { label: 'System', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
  ];

  const weights = [
    { label: 'Thin (100)', value: '100' },
    { label: 'Light (300)', value: '300' },
    { label: 'Regular (400)', value: '400' },
    { label: 'Medium (500)', value: '500' },
    { label: 'Semibold (600)', value: '600' },
    { label: 'Bold (700)', value: '700' },
    { label: 'Extra Bold (800)', value: '800' },
    { label: 'Black (900)', value: '900' }
  ];

  const currentFont = normalizeFontFamily(styles.fontFamily);
  const currentWeight = normalizeFontWeight(styles.fontWeight);

  const handleTextChange = (e) => {
    const val = e.target.value;
    updateElementText(val);
    if (onApplyText) onApplyText(val);
  };

  const handleFontChange = (e) => {
    const val = e.target.value;
    updateElementStyle('fontFamily', val);
    if (onApplyStyle) onApplyStyle('fontFamily', val);
  };

  const handleWeightChange = (val) => {
    updateElementStyle('fontWeight', val);
    if (onApplyStyle) onApplyStyle('fontWeight', val);
  };

  const handleSizeChange = (e) => {
    const val = e.target.value;
    const combined = `${val}${sizeUnit}`;
    updateElementStyle('fontSize', combined);
    if (onApplyStyle) onApplyStyle('fontSize', combined);
  };

  const handleUnitChange = (e) => {
    const unit = e.target.value;
    const combined = `${sizeNum}${unit}`;
    updateElementStyle('fontSize', combined);
    if (onApplyStyle) onApplyStyle('fontSize', combined);
  };

  const handleAlignChange = (align) => {
    updateElementStyle('textAlign', align);
    if (onApplyStyle) onApplyStyle('textAlign', align);
  };

  const handleToggleItalic = () => {
    const current = styles.fontStyle === 'italic';
    const next = current ? 'normal' : 'italic';
    updateElementStyle('fontStyle', next);
    if (onApplyStyle) onApplyStyle('fontStyle', next);
  };

  const handleToggleUnderline = () => {
    const current = styles.textDecorationLine === 'underline' || styles.textDecoration?.includes('underline');
    const next = current ? 'none' : 'underline';
    updateElementStyle('textDecorationLine', next);
    if (onApplyStyle) onApplyStyle('textDecorationLine', next);
  };

  const handleToggleStrikethrough = () => {
    const current = styles.textDecorationLine === 'line-through' || styles.textDecoration?.includes('line-through');
    const next = current ? 'none' : 'line-through';
    updateElementStyle('textDecorationLine', next);
    if (onApplyStyle) onApplyStyle('textDecorationLine', next);
  };

  const handleToggleUppercase = () => {
    const current = styles.textTransform === 'uppercase';
    const next = current ? 'none' : 'uppercase';
    updateElementStyle('textTransform', next);
    if (onApplyStyle) onApplyStyle('textTransform', next);
  };

  return (
    <div className="border-b border-zinc-200/80 select-none">
      {/* Section Header */}
      <button
        type="button"
        onClick={() => toggleSection('typography')}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Type className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-bold">Typography</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
        )}
      </button>

      {/* Collapsible Content */}
      {!isCollapsed && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* 1. Value (Live editable words / text) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Words / Text Content
              </label>
              {selectedElement?.text && (
                <span className="text-[10px] font-mono text-zinc-400">
                  {selectedElement.text.length} chars
                </span>
              )}
            </div>
            <textarea
              rows={Math.min(4, Math.max(2, Math.ceil((selectedElement?.text || '').length / 32)))}
              value={selectedElement?.text || ''}
              onChange={handleTextChange}
              placeholder="Type any words, heading, or paragraph..."
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-900 font-medium focus:outline-none focus:border-zinc-500 shadow-2xs leading-relaxed resize-y font-sans"
            />
          </div>

          {/* 2. Font Family */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Font
            </label>
            <NiceSelect
              value={currentFont}
              onChange={handleFontChange}
              options={fonts}
            />
          </div>

          {/* 3. Font Weight (Select + Numeric display 500) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Weight
              </label>
              <span className="text-[10px] font-mono font-bold text-zinc-600 bg-zinc-50 px-1.5 py-0.2 rounded border border-zinc-200">
                {currentWeight}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NiceSelect
                value={currentWeight}
                onChange={(e) => handleWeightChange(e.target.value)}
                options={weights}
                className="flex-1"
              />
              <input
                type="number"
                min="100"
                max="900"
                step="100"
                value={currentWeight}
                onChange={(e) => handleWeightChange(e.target.value)}
                className="w-16 px-2 py-1.5 text-xs text-center font-mono font-bold bg-zinc-50 border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:border-zinc-500"
                title="Numeric Weight"
              />
            </div>
          </div>

          {/* 4. Font Size & Unit */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Size
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="8"
                max="140"
                value={sizeNum}
                onChange={handleSizeChange}
                className="flex-1 px-2.5 py-1.5 text-xs font-mono font-semibold bg-white border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
              />
              <NiceSelect
                value={sizeUnit}
                onChange={handleUnitChange}
                options={[
                  { label: 'px', value: 'px' },
                  { label: 'rem', value: 'rem' },
                  { label: 'em', value: 'em' }
                ]}
                className="w-20"
              />
            </div>
          </div>

          {/* 5. Style Toggles (Italic, Underline, Strikethrough, Uppercase) */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Style
            </label>
            <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg border border-zinc-200">
              <button
                type="button"
                onClick={handleToggleItalic}
                className={`flex-1 py-1 rounded flex items-center justify-center text-xs transition-colors cursor-pointer ${
                  styles.fontStyle === 'italic'
                    ? 'bg-white text-zinc-600 shadow-2xs font-bold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
                title="Italic"
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleToggleUnderline}
                className={`flex-1 py-1 rounded flex items-center justify-center text-xs transition-colors cursor-pointer ${
                  styles.textDecorationLine === 'underline' || styles.textDecoration?.includes('underline')
                    ? 'bg-white text-zinc-600 shadow-2xs font-bold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
                title="Underline"
              >
                <Underline className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleToggleStrikethrough}
                className={`flex-1 py-1 rounded flex items-center justify-center text-xs transition-colors cursor-pointer ${
                  styles.textDecorationLine === 'line-through' || styles.textDecoration?.includes('line-through')
                    ? 'bg-white text-zinc-600 shadow-2xs font-bold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
                title="Strikethrough"
              >
                <Strikethrough className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleToggleUppercase}
                className={`flex-1 py-1 rounded flex items-center justify-center text-xs transition-colors cursor-pointer ${
                  styles.textTransform === 'uppercase'
                    ? 'bg-white text-zinc-600 shadow-2xs font-bold'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
                title="Uppercase"
              >
                <CaseSensitive className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 6. Alignment Toggles */}
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
              Align
            </label>
            <div className="flex items-center bg-zinc-100 p-1 rounded-lg border border-zinc-200">
              {[
                { align: 'left', icon: AlignLeft, title: 'Align Left' },
                { align: 'center', icon: AlignCenter, title: 'Align Center' },
                { align: 'right', icon: AlignRight, title: 'Align Right' },
                { align: 'justify', icon: AlignJustify, title: 'Justify' }
              ].map(({ align, icon: Icon, title }) => (
                <button
                  key={align}
                  type="button"
                  onClick={() => handleAlignChange(align)}
                  className={`flex-1 py-1 rounded flex items-center justify-center text-xs transition-colors cursor-pointer ${
                    styles.textAlign === align
                      ? 'bg-white text-zinc-600 shadow-2xs font-bold'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                  title={title}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TypographyPanel;
