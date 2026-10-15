import React, { useMemo, useState } from 'react';
import { 
  Sliders, 
  Trash2, 
  Copy, 
  Check,
  CornerLeftUp, 
  Image as ImageIcon, 
  MousePointerClick, 
  Sparkles,
  Link,
  ChevronDown,
  ChevronUp,
  Code2,
  ExternalLink,
  Tag
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { useProjectStore } from '../../store/projectStore';
import { InspectorBreadcrumb } from './InspectorBreadcrumb';
import { TypographyPanel } from './TypographyPanel';
import { ColorPanel } from './ColorPanel';
import { BorderPanel } from './BorderPanel';
import { LayoutPanel } from './LayoutPanel';
import { AutoLayoutPanel } from './AutoLayoutPanel';
import { SpacingPanel } from './SpacingPanel';

export function InspectorPanel({
  files = [],
  onApplyStyle,
  onApplyText,
  onApplyAttribute,
  onInsertBadge,
  onDeleteElement,
  onDuplicateElement,
  onSelectParent,
  onSelectAncestor
}) {
  const { currentProject } = useProjectStore();
  const { 
    selectedElement, 
    responsiveMode,
    collapsedSections,
    toggleSection,
    updateElementAttribute,
    updateElementStyle,
    setActiveMode,
    setActiveCodeFile
  } = useVisualEditorStore();

  const [copiedPath, setCopiedPath] = useState(false);
  const [badgeMenuOpen, setBadgeMenuOpen] = useState(false);

  // Combine project files
  const allFiles = useMemo(() => {
    if (files && files.length > 0) return files;
    return currentProject?.files || [];
  }, [files, currentProject]);

  const tag = (selectedElement?.tagName || 'div').toLowerCase();
  const isImage = tag === 'img' || Boolean(selectedElement?.attributes?.src) || Boolean(selectedElement?.isImage);
  const isButton = tag === 'button' || tag === 'a' || (selectedElement?.className && typeof selectedElement.className === 'string' && selectedElement.className.includes('button'));
  const isTextElement = ['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a', 'strong', 'em', 'b', 'li', 'blockquote'].includes(tag);
  const hasText = Boolean(selectedElement?.text?.trim());
  const showTypography = isTextElement || isButton || hasText || ['div', 'li', 'a', 'span', 'button'].includes(tag);

  // Resolve where this element originates from in the codebase (Magic Patterns Style)
  const sourceInfo = useMemo(() => {
    if (!selectedElement) return { component: '<App />', file: 'src/App.jsx', line: null };

    let comp = selectedElement.sourceComponent || `<${tag} />`;
    let file = selectedElement.sourceFile || 'src/App.jsx';
    let line = selectedElement.sourceLine || null;

    // Search project files for exact match of element text
    const textToFind = selectedElement.text?.trim();
    if (textToFind && textToFind.length >= 2 && allFiles.length > 0) {
      for (const f of allFiles) {
        if (!f.content) continue;
        const fileLines = f.content.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          if (fileLines[i].includes(textToFind)) {
            file = f.path;
            line = i + 1;
            const baseName = f.path.split('/').pop().replace(/\.[^/.]+$/, '');
            comp = `<${baseName} />`;
            return { component: comp, file, line, found: true };
          }
        }
      }
    }

    // Heuristics based on tag and context if file not found by text
    if (allFiles.length > 0) {
      if (['nav', 'header'].includes(tag) || selectedElement.className?.includes('nav')) {
        const navFile = allFiles.find(f => f.path.toLowerCase().includes('navbar') || f.path.toLowerCase().includes('header'));
        if (navFile) {
          file = navFile.path;
          comp = '<Navbar />';
        }
      } else if (['footer'].includes(tag)) {
        const footFile = allFiles.find(f => f.path.toLowerCase().includes('footer'));
        if (footFile) {
          file = footFile.path;
          comp = '<Footer />';
        }
      }
    }

    return { component: comp, file, line, found: false };
  }, [selectedElement, allFiles, tag]);

  const handleCopyPath = () => {
    if (sourceInfo.file) {
      navigator.clipboard?.writeText(sourceInfo.file);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const handleJumpToCode = () => {
    if (sourceInfo.file && setActiveCodeFile) {
      setActiveCodeFile(sourceInfo.file);
    }
    setActiveMode('code');
  };

  if (!selectedElement) {
    return (
      <aside className="w-[360px] sm:w-[380px] lg:w-[400px] h-full bg-white border-l border-[#E2E5E8] flex flex-col shrink-0 select-none shadow-sm z-20">
        {/* Header */}
        <div className="h-12 border-b border-[#E2E5E8] px-4 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-zinc-50 text-zinc-600 flex items-center justify-center">
              <Sliders className="w-3.5 h-3.5" />
            </div>
            <span className="font-extrabold text-xs text-zinc-900 tracking-tight">Visual Edit</span>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">Inspector</span>
        </div>

        {/* Empty State */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-zinc-50 text-zinc-600 border border-zinc-100 flex items-center justify-center mb-3 shadow-2xs">
            <MousePointerClick className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-zinc-800 mb-1">Select an Element</h4>
          <p className="text-xs text-zinc-500 max-w-[240px] leading-relaxed">
            Hover over any element on the website canvas and click to inspect, re-style, or modify its properties.
          </p>
        </div>
      </aside>
    );
  }

  const attrs = selectedElement.attributes || {};

  const handleAttrChange = (attr, val) => {
    if (onApplyAttribute) {
      onApplyAttribute(attr, val);
    } else {
      updateElementAttribute(attr, val);
    }
  };

  const isElementSpecificCollapsed = collapsedSections.elementSpecific;

  return (
    <aside className="w-[360px] sm:w-[380px] lg:w-[400px] h-full bg-white border-l border-[#E2E5E8] flex flex-col shrink-0 select-none shadow-sm z-20">
      {/* 1. Header with Title & Quick Actions */}
      <div className="h-12 border-b border-[#E2E5E8] px-4 flex items-center justify-between bg-zinc-50/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-zinc-600 text-white flex items-center justify-center shadow-2xs">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <span className="font-extrabold text-xs text-zinc-900 tracking-tight">Visual Edit</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-50 text-zinc-700 font-bold border border-zinc-200">
            &lt;{tag}&gt;
          </span>
        </div>

        {/* Quick Node Actions: Add Badge, Select Parent, Duplicate, Delete */}
        <div className="flex items-center gap-1 relative">
          <div className="relative">
            <button
              type="button"
              onClick={() => setBadgeMenuOpen(!badgeMenuOpen)}
              className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors cursor-pointer"
              title="Add Badge to this element"
            >
              <Tag className="w-3.5 h-3.5" />
            </button>

            {badgeMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-1.5 w-52 bg-white/95 backdrop-blur-md rounded-2xl border border-zinc-200 shadow-2xl ring-1 ring-black/5 p-2 z-50 animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="px-2 py-1 text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                  Add Badge
                </div>
                <div className="space-y-1 mt-1">
                  {[
                    { text: 'NEW', color: 'emerald', bg: 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30' },
                    { text: 'FEATURED', color: 'indigo', bg: 'bg-indigo-500/15 text-indigo-600 border border-indigo-500/30' },
                    { text: 'HOT', color: 'amber', bg: 'bg-amber-500/15 text-amber-600 border border-amber-500/30' },
                    { text: 'PRO', color: 'rose', bg: 'bg-rose-500/15 text-rose-600 border border-rose-500/30' },
                    { text: 'LEADERBOARD', color: 'zinc', bg: 'bg-zinc-800 text-zinc-100 border border-zinc-700' }
                  ].map((item) => (
                    <button
                      key={item.text}
                      type="button"
                      onClick={() => {
                        if (onInsertBadge) onInsertBadge(item.color, item.text);
                        setBadgeMenuOpen(false);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl hover:bg-zinc-50 flex items-center justify-between text-xs text-zinc-700 font-medium transition-colors cursor-pointer"
                    >
                      <span className="capitalize">{item.text.toLowerCase()}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.bg}`}>
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onSelectParent}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Select Parent Element (Escape)"
          >
            <CornerLeftUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDuplicateElement}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Duplicate Element"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDeleteElement}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            title="Delete Selected Element"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Element Breadcrumb Hierarchy */}
      <InspectorBreadcrumb onSelectAncestor={onSelectAncestor} />

      {/* 3. Magic Patterns Component Origin Card */}
      <div className="mx-4 mt-3 mb-1 p-3 bg-gradient-to-br from-indigo-50/80 via-zinc-50/40 to-white rounded-xl border border-indigo-100/90 shadow-2xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-indigo-700 font-bold text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>Component Origin</span>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-100/80 text-indigo-800 font-bold">
            Magic Patterns
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mb-2 bg-white/95 p-2 rounded-lg border border-indigo-100/80">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-indigo-600 text-white flex items-center justify-center font-mono text-xs font-bold shrink-0 shadow-2xs">
              &lt;/&gt;
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-zinc-900 font-mono truncate">
                {sourceInfo.component}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono truncate">
                {sourceInfo.file}{sourceInfo.line ? ` : L${sourceInfo.line}` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleCopyPath}
              className="p-1.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs transition-colors cursor-pointer"
              title="Copy file path"
            >
              {copiedPath ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleJumpToCode}
              className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
              title="Open and edit in Code View"
            >
              <Code2 className="w-3 h-3" />
              <span>Code</span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span className="truncate max-w-[200px] font-mono text-zinc-600">
            Tag: &lt;{tag}&gt;{selectedElement.className ? ` .${selectedElement.className.split(' ')[0]}` : ''}
          </span>
          <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
            Live Synced
          </span>
        </div>
      </div>

      {/* 4. Scrollable Inspector Content */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100">
        {/* Element Specific Quick Controls (Button link, Image src, Presets) */}
        {(isButton || isImage) && (
          <div className="border-b border-zinc-200/80 select-none">
            <button
              type="button"
              onClick={() => toggleSection('elementSpecific')}
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isImage ? <ImageIcon className="w-3.5 h-3.5 text-zinc-600" /> : <Link className="w-3.5 h-3.5 text-zinc-600" />}
                <span>{isImage ? 'Image Attributes & Presets' : 'Button Target & Action'}</span>
              </div>
              {isElementSpecificCollapsed ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </button>

            {!isElementSpecificCollapsed && (
              <div className="px-4 pb-4 pt-1 space-y-3">
                {isImage && (
                  <>
                    {/* Live Preview Thumbnail if src present */}
                    {attrs.src && (
                      <div className="relative w-full h-24 rounded-xl overflow-hidden border border-zinc-200 bg-zinc-100 group shadow-2xs">
                        <img
                          src={attrs.src}
                          alt={attrs.alt || 'Selected'}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-[10px] text-white font-medium bg-black/60 px-2 py-0.5 rounded-full">
                            Current Image
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Image URL Input */}
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Image Source URL (src)
                      </label>
                      <input
                        type="text"
                        value={attrs.src || ''}
                        onChange={(e) => handleAttrChange('src', e.target.value)}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs font-mono"
                      />
                    </div>

                    {/* 1-Click Image Presets */}
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Change Image (1-Click Presets)
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { name: 'Campus', url: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1000&q=80' },
                          { name: 'Tech Lab', url: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=1000&q=80' },
                          { name: 'Library', url: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1000&q=80' },
                          { name: 'Graduation', url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=800&q=80' },
                          { name: 'Modern', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1000&q=80' },
                          { name: 'Research', url: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1000&q=80' },
                        ].map((preset) => {
                          const isActive = attrs.src === preset.url;
                          return (
                            <button
                              key={preset.name}
                              type="button"
                              onClick={() => handleAttrChange('src', preset.url)}
                              className={`relative rounded-lg overflow-hidden border p-1 flex flex-col items-center gap-1 transition-all cursor-pointer ${
                                isActive
                                  ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600'
                                  : 'border-zinc-200 hover:border-zinc-400 bg-white'
                              }`}
                              title={`Switch to ${preset.name} photo`}
                            >
                              <img
                                src={preset.url}
                                alt={preset.name}
                                className="w-full h-11 object-cover rounded-md"
                              />
                              <span className="text-[10px] font-medium text-zinc-700 truncate max-w-full">
                                {preset.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Alt Description */}
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Alt Description
                      </label>
                      <input
                        type="text"
                        value={attrs.alt || ''}
                        onChange={(e) => handleAttrChange('alt', e.target.value)}
                        placeholder="Accessible description"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs"
                      />
                    </div>
                  </>
                )}

                {isButton && (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Link URL / Target (href)
                      </label>
                      <input
                        type="text"
                        value={attrs.href || ''}
                        onChange={(e) => handleAttrChange('href', e.target.value)}
                        placeholder="# or https://..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-zinc-500 shadow-2xs font-mono"
                      />
                    </div>

                    {/* Quick Anchor Presets */}
                    <div>
                      <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                        Quick Destination
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {['#admissions', '#research', '#about', '#contact', '#programs', 'https://veave.dev'].map((link) => (
                          <button
                            key={link}
                            type="button"
                            onClick={() => handleAttrChange('href', link)}
                            className="px-2 py-0.5 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-[10px] font-mono font-medium transition-colors cursor-pointer"
                          >
                            {link}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 1. Typography Section (Value, Font, Weight, Size, Style, Align) */}
        {showTypography && (
          <TypographyPanel onApplyStyle={onApplyStyle} onApplyText={onApplyText} />
        )}

        {/* 2. Colors Section (Text, Fill, Border) */}
        <ColorPanel onApplyStyle={onApplyStyle} />

        {/* 3. Layout Section (Size W/H px fixed, Auto layout, Padding 0 px 0 px, Margin 0 px 0 px) */}
        <LayoutPanel onApplyStyle={onApplyStyle} />

        {/* 4. Border & Radius Section */}
        <BorderPanel onApplyStyle={onApplyStyle} />

        {/* 5. Auto Layout Extended Controls */}
        <AutoLayoutPanel onApplyStyle={onApplyStyle} />

        {/* 6. Spacing Box Model (Margin & Padding visual box) */}
        <SpacingPanel onApplyStyle={onApplyStyle} />
      </div>

      {/* Footer / Scope info */}
      <div className="h-9 border-t border-[#E2E5E8] px-4 flex items-center justify-between text-[10px] text-zinc-400 bg-zinc-50/70 shrink-0 font-mono">
        <span>Scope: {responsiveMode.toUpperCase()}</span>
        <span className="truncate max-w-[160px]">
          {selectedElement.selector || `<${tag}>`}
        </span>
      </div>
    </aside>
  );
}

export default InspectorPanel;
