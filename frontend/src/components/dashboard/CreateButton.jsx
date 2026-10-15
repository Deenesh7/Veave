import React, { useState, useRef, useEffect } from 'react';
import { Plus, ChevronDown, Layout, Globe, Component, FileCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CreateButton() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAction = (type) => {
    setOpen(false);
    navigate('/', { state: { createType: type } });
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full h-10 px-3.5 bg-zinc-900 hover:bg-black text-white font-semibold rounded-xl text-xs sm:text-sm flex items-center justify-between shadow-xs hover:shadow-sm transition-all active:scale-[0.98]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Create</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-full bg-white rounded-xl border border-[#E2E5E8] shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={() => handleAction('prototype')}
            className="w-full px-3 py-2 text-left flex items-center gap-2.5 rounded-lg hover:bg-zinc-50 text-xs font-medium text-[#111827] transition-colors"
          >
            <Layout className="w-4 h-4 text-[#52525B]" />
            <div>
              <div className="font-semibold">New Prototype</div>
              <div className="text-[10px] text-[#64748B]">From idea or requirement</div>
            </div>
          </button>
          <button
            onClick={() => handleAction('website')}
            className="w-full px-3 py-2 text-left flex items-center gap-2.5 rounded-lg hover:bg-zinc-50 text-xs font-medium text-[#111827] transition-colors"
          >
            <Globe className="w-4 h-4 text-emerald-500" />
            <div>
              <div className="font-semibold">New Website</div>
              <div className="text-[10px] text-[#64748B]">Landing page or web app</div>
            </div>
          </button>
          <button
            onClick={() => handleAction('component')}
            className="w-full px-3 py-2 text-left flex items-center gap-2.5 rounded-lg hover:bg-zinc-50 text-xs font-medium text-[#111827] transition-colors"
          >
            <Component className="w-4 h-4 text-purple-500" />
            <div>
              <div className="font-semibold">New Component</div>
              <div className="text-[10px] text-[#64748B]">Cards, tables, headers</div>
            </div>
          </button>
          <button
            onClick={() => handleAction('code')}
            className="w-full px-3 py-2 text-left flex items-center gap-2.5 rounded-lg hover:bg-zinc-50 text-xs font-medium text-[#111827] transition-colors"
          >
            <FileCode className="w-4 h-4 text-amber-500" />
            <div>
              <div className="font-semibold">Blank Canvas</div>
              <div className="text-[10px] text-[#64748B]">Start from scratch</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
