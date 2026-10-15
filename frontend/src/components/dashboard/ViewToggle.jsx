import React from 'react';
import { LayoutGrid, List } from 'lucide-react';

export default function ViewToggle({ viewMode, onChange }) {
  return (
    <div className="inline-flex items-center p-0.5 rounded-lg border border-[#E2E5E8] bg-white shadow-2xs">
      <button
        onClick={() => onChange('grid')}
        title="Grid View"
        className={`p-1.5 rounded-md transition-colors ${
          viewMode === 'grid'
            ? 'bg-zinc-100 text-[#111827] shadow-2xs'
            : 'text-zinc-400 hover:text-[#111827]'
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onChange('list')}
        title="List View"
        className={`p-1.5 rounded-md transition-colors ${
          viewMode === 'list'
            ? 'bg-zinc-100 text-[#111827] shadow-2xs'
            : 'text-zinc-400 hover:text-[#111827]'
        }`}
      >
        <List className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
