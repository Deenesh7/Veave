import React from 'react';
import { Search, X } from 'lucide-react';

export function FileSearch({ value, onChange, onClear }) {
  return (
    <div className="px-3 py-2 border-b border-zinc-200 bg-white">
      <div className="relative flex items-center">
        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search files..."
          className="w-full bg-zinc-50 border border-zinc-200 focus:border-zinc-500 focus:bg-white text-zinc-900 placeholder-zinc-400 text-xs rounded-lg pl-8 pr-7 py-1 outline-none transition-colors"
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 text-zinc-400 hover:text-zinc-700 transition-colors p-0.5 rounded cursor-pointer"
            title="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export default FileSearch;
