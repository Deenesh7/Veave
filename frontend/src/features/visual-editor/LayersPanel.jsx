import React, { useState } from 'react';
import { 
  Layers, 
  ChevronRight, 
  ChevronDown, 
  X, 
  Search, 
  Eye, 
  EyeOff, 
  Box, 
  Type, 
  Image as ImageIcon, 
  Sliders 
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

function getTagIcon(tag) {
  const t = (tag || '').toLowerCase();
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label', 'a'].includes(t)) {
    return Type;
  }
  if (t === 'img') return ImageIcon;
  return Box;
}

export function LayerItem({ item, depth = 0, onSelectNode, selectedId }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  const isSelected = selectedId === item.elementId;

  const Icon = getTagIcon(item.tagName);

  return (
    <div>
      <div
        onClick={() => onSelectNode(item)}
        className={`group flex items-center justify-between px-2.5 py-1 text-xs rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-zinc-600 text-white font-bold'
            : 'hover:bg-zinc-100 text-zinc-700'
        }`}
        style={{ paddingLeft: `${Math.max(10, depth * 16 + 10)}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="p-0.5 text-zinc-400 hover:text-zinc-700 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="w-4" />
          )}

          <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-zinc-400'}`} />

          <span className="truncate text-[11px] font-mono">
            {item.tagName}
          </span>

          {item.text && (
            <span className={`text-[10px] truncate max-w-[90px] ${isSelected ? 'text-zinc-100' : 'text-zinc-400'}`}>
              "{item.text}"
            </span>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {item.children.map((child, idx) => (
            <LayerItem
              key={child.elementId || idx}
              item={child}
              depth={depth + 1}
              onSelectNode={onSelectNode}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function LayersPanel({ onSelectElementById }) {
  const { isLayersOpen, setLayersOpen, layersTree, selectedElement } = useVisualEditorStore();
  const [filterText, setFilterText] = useState('');

  if (!isLayersOpen) return null;

  // Fallback tree if iframe hasn't provided one yet
  const treeData = layersTree && layersTree.length > 0 ? layersTree : [
    {
      tagName: 'Page',
      elementId: 'root',
      children: [
        {
          tagName: 'header',
          elementId: 'header-1',
          text: 'Navigation',
          children: [
            { tagName: 'div', elementId: 'logo-1', text: 'Veave' },
            { tagName: 'nav', elementId: 'nav-1', text: 'Links' }
          ]
        },
        {
          tagName: 'main',
          elementId: 'main-1',
          children: [
            { tagName: 'section', elementId: 'hero-1', text: 'Hero Section' },
            { tagName: 'section', elementId: 'features-1', text: 'Feature Grid' }
          ]
        },
        {
          tagName: 'footer',
          elementId: 'footer-1',
          text: 'Site Footer'
        }
      ]
    }
  ];

  const handleSelectNode = (node) => {
    if (onSelectElementById && node.elementId) {
      onSelectElementById(node.elementId);
    }
  };

  return (
    <aside className="w-64 h-full bg-white border-r border-[#E2E5E8] flex flex-col shrink-0 select-none shadow-sm z-20 animate-in slide-in-from-left duration-200">
      {/* Header */}
      <div className="h-12 border-b border-[#E2E5E8] px-3 flex items-center justify-between bg-zinc-50/50">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-zinc-600" />
          <span className="font-bold text-xs text-zinc-900">Layers & Elements</span>
        </div>
        <button
          type="button"
          onClick={() => setLayersOpen(false)}
          className="p-1 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
          title="Close Layers Panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-zinc-100">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-xs">
          <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter elements..."
            className="w-full bg-transparent focus:outline-none text-zinc-800 text-[11px]"
          />
        </div>
      </div>

      {/* Elements Tree List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {treeData.map((rootNode, idx) => (
          <LayerItem
            key={rootNode.elementId || idx}
            item={rootNode}
            depth={0}
            onSelectNode={handleSelectNode}
            selectedId={selectedElement?.elementId}
          />
        ))}
      </div>
    </aside>
  );
}

export default LayersPanel;
