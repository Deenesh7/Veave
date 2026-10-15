import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import FilterDropdown from './FilterDropdown';
import ViewToggle from './ViewToggle';

export default function RecentToolbar({
  searchQuery,
  onSearchChange,
  currentFilter,
  onSelectFilter,
  sortBy,
  onSelectSort,
  viewMode,
  onToggleView,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  const sortOptions = [
    { label: 'Last Updated', value: 'recent' },
    { label: 'Alphabetical (A-Z)', value: 'name' },
    { label: 'Created Date', value: 'created' },
  ];

  useEffect(() => {
    function handleClickOutside(e) {
      if (sortRef.current && !sortRef.current.contains(e.target)) {
        setSortOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 select-none">
      {/* Search Icon Button / Inline Search input */}
      {searchOpen ? (
        <div className="flex items-center gap-1.5 bg-white border border-[#E2E5E8] rounded-lg px-2.5 py-1 text-xs shadow-2xs">
          <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search recents..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-28 sm:w-36 text-xs text-[#111827] focus:outline-none bg-transparent"
          />
          <button
            onClick={() => {
              setSearchOpen(false);
              onSearchChange('');
            }}
            className="text-zinc-400 hover:text-zinc-700 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSearchOpen(true)}
          title="Search recents"
          className="p-1.5 rounded-lg border border-[#E2E5E8] bg-white text-zinc-500 hover:text-[#111827] hover:bg-zinc-50 transition-colors shadow-2xs"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Filter Button Dropdown */}
      <FilterDropdown
        currentFilter={currentFilter}
        onSelectFilter={onSelectFilter}
      />

      {/* Last Updated Sorting Dropdown */}
      <div className="relative" ref={sortRef}>
        <button
          onClick={() => setSortOpen(!sortOpen)}
          className="px-3 py-1.5 rounded-lg border border-[#E2E5E8] bg-white text-xs font-semibold text-[#111827] hover:bg-zinc-50 flex items-center gap-1.5 transition-colors shadow-2xs"
        >
          <span>{sortOptions.find((o) => o.value === sortBy)?.label || 'Last Updated'}</span>
          <ChevronDown className="w-3 h-3 text-zinc-400" />
        </button>

        {sortOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-xl border border-[#E2E5E8] shadow-lg py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onSelectSort(opt.value);
                  setSortOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-xs font-medium text-[#111827] hover:bg-zinc-50 flex items-center justify-between"
              >
                <span>{opt.label}</span>
                {sortBy === opt.value && <Check className="w-3 h-3 text-[#52525B]" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid / List View Toggle */}
      <ViewToggle viewMode={viewMode} onChange={onToggleView} />
    </div>
  );
}
