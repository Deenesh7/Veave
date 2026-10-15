import React, { useState, useRef, useEffect } from 'react';
import { SlidersHorizontal, ChevronDown, Check } from 'lucide-react';

export default function FilterDropdown({ currentFilter, onSelectFilter }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const filters = [
    'All Categories',
    'Websites',
    'Mobile Apps',
    'Dashboards',
    'Presentations',
  ];

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`px-3 py-1.5 rounded-lg border border-[#E2E5E8] text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs ${
          currentFilter !== 'All Categories'
            ? 'bg-zinc-50 border-zinc-200 text-[#52525B]'
            : 'bg-white text-[#111827] hover:bg-zinc-50'
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
        <span>{currentFilter}</span>
        <ChevronDown className="w-3 h-3 text-zinc-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-[#E2E5E8] shadow-lg py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => {
                onSelectFilter(f);
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-xs font-medium text-[#111827] hover:bg-zinc-50 flex items-center justify-between"
            >
              <span>{f}</span>
              {currentFilter === f && <Check className="w-3.5 h-3.5 text-[#52525B]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
