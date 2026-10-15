import React from 'react';
import { ChevronRight } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

export function InspectorBreadcrumb({ onSelectAncestor }) {
  const { selectedElement } = useVisualEditorStore();

  if (!selectedElement) {
    return (
      <div className="px-4 py-2 border-b border-zinc-200/80 bg-zinc-50/50 text-[11px] text-zinc-400 font-mono flex items-center gap-1 truncate select-none">
        <span>No element selected</span>
      </div>
    );
  }

  const path = selectedElement.elementPath && selectedElement.elementPath.length > 0
    ? selectedElement.elementPath
    : ['body', 'div', selectedElement.tagName || 'element'];

  // Keep up to last 4 items, prefix with '...' if longer
  const displayPath = path.length > 4 ? ['...', ...path.slice(-3)] : path;

  return (
    <nav 
      aria-label="Element Breadcrumb"
      className="px-4 py-2 border-b border-zinc-200/80 bg-zinc-50/60 flex items-center gap-1 text-[11px] font-mono text-zinc-500 overflow-x-auto select-none scrollbar-none"
    >
      {displayPath.map((item, idx) => {
        const isLast = idx === displayPath.length - 1;
        return (
          <React.Fragment key={idx}>
            {idx > 0 && <ChevronRight className="w-3 h-3 text-zinc-300 shrink-0" />}
            <button
              type="button"
              disabled={isLast || item === '...'}
              onClick={() => {
                if (!isLast && item !== '...' && onSelectAncestor) {
                  onSelectAncestor(item, idx);
                }
              }}
              className={`truncate max-w-[80px] rounded px-1 py-0.5 transition-colors ${
                isLast
                  ? 'font-bold text-zinc-600 bg-zinc-50/80'
                  : item === '...'
                  ? 'text-zinc-400 cursor-default'
                  : 'hover:text-zinc-900 hover:bg-zinc-200/60 cursor-pointer'
              }`}
              title={`Select <${item}>`}
            >
              {item}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export default InspectorBreadcrumb;
