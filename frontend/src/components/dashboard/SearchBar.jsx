import React, { useState, useEffect, useMemo } from 'react';
import { Search, FileCode, LayoutTemplate, Palette, BookOpen, ArrowRight, X, Folder } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../store/projectStore';

export default function SearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects || []);

  // Keyboard shortcut listener: Ctrl+K or Cmd+K
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamic items list: Real projects + workspace page links
  const systemItems = [
    { title: 'Templates Library', category: 'Page', path: '/templates', icon: LayoutTemplate },
    { title: 'Design Systems & Tokens', category: 'Page', path: '/design-systems', icon: Palette },
    { title: 'Workspace Files', category: 'Page', path: '/files', icon: Folder },
    { title: 'Documentation & API Guides', category: 'Page', path: '/documentation', icon: BookOpen },
  ];

  const projectItems = useMemo(() => {
    return projects.map((p) => ({
      title: p.name || 'Untitled Project',
      category: 'Project',
      path: `/editor/${p._id}`,
      icon: FileCode,
    }));
  }, [projects]);

  const allItems = useMemo(() => [...projectItems, ...systemItems], [projectItems]);

  const filtered = query.trim() === ''
    ? allItems
    : allItems.filter(
        (i) =>
          i.title.toLowerCase().includes(query.toLowerCase()) ||
          i.category.toLowerCase().includes(query.toLowerCase())
      );

  const handleSelect = (path) => {
    setOpen(false);
    setQuery('');
    navigate(path);
  };

  return (
    <>
      {/* Sidebar search trigger */}
      <button
        onClick={() => setOpen(true)}
        className="w-full h-9 px-3 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 flex items-center justify-between text-xs text-[#64748B] hover:text-[#111827] transition-all shadow-2xs group cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600" />
          <span className="font-medium">Search</span>
        </div>
        <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-[#E2E5E8]">
          Ctrl+K
        </kbd>
      </button>

      {/* Command Palette Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-[#E2E5E8] shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Search Input Bar */}
            <div className="p-3.5 border-b border-[#E2E5E8] flex items-center gap-3">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                type="text"
                autoFocus
                placeholder="Search real projects, pages, and docs..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full text-xs sm:text-sm text-[#111827] placeholder:text-zinc-400 focus:outline-none bg-transparent"
              />
              <button 
                onClick={() => setOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Results */}
            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
              {filtered.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400">
                  No matching projects or pages found.
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelect(item.path)}
                      className="w-full px-3 py-2 rounded-xl text-left flex items-center justify-between hover:bg-zinc-50 transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-600 shrink-0 group-hover:text-[#52525B] group-hover:bg-zinc-50 transition-colors">
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-medium text-[#111827] truncate">
                          {item.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-zinc-300 group-hover:text-zinc-600 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-zinc-50 border-t border-[#E2E5E8] flex items-center justify-between text-[11px] text-zinc-400 font-mono">
              <span>Quick Navigation</span>
              <div className="flex items-center gap-2">
                <span>ESC to close</span>
                <span>•</span>
                <span>↵ to select</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
