import React from 'react';
import { Monitor, Tablet, Smartphone } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

export function ResponsiveSelector({ compact = false, showInheritance = false }) {
  const { 
    viewport, 
    setViewport, 
    responsiveMode, 
    setResponsiveMode 
  } = useVisualEditorStore();

  const handleSelect = (mode) => {
    setViewport(mode);
    setResponsiveMode(mode);
  };

  const devices = [
    { id: 'desktop', label: 'Desktop', icon: Monitor, width: '100%' },
    { id: 'tablet', label: 'Tablet', icon: Tablet, width: '768px' },
    { id: 'mobile', label: 'Mobile', icon: Smartphone, width: '375px' }
  ];

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center bg-zinc-100/90 p-0.5 rounded-xl border border-zinc-200/80 shadow-2xs">
        {devices.map(({ id, label, icon: Icon, width }) => {
          const isActive = viewport === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-zinc-900 shadow-2xs font-bold'
                  : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-200/50'
              }`}
              title={`${label} Viewport (${width})`}
            >
              <Icon className="w-3.5 h-3.5" />
              {!compact && <span className="hidden sm:inline text-[11px]">{label}</span>}
            </button>
          );
        })}
      </div>

      {showInheritance && (
        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200">
          {responsiveMode === 'desktop' ? 'Desktop' : `${responsiveMode.toUpperCase()} Override`}
        </span>
      )}
    </div>
  );
}

export default ResponsiveSelector;
