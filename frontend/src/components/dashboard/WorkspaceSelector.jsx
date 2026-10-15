import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Plus, Building2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

export default function WorkspaceSelector() {
  const { user } = useAuthStore();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const workspaceName = user?.name ? `${user.name}'s Workspace` : 'Personal Workspace';

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-100/80 transition-colors text-left group"
        aria-expanded={open}
      >
        <span className="font-semibold text-sm text-[#111827] tracking-tight">
          {workspaceName}
        </span>
        <span className="text-[10px] font-mono font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded border border-[#E2E5E8]">
          Free
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-xl border border-[#E2E5E8] shadow-lg py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider font-mono">
            Active Workspace
          </div>
          <div className="w-full px-3 py-2 text-left flex items-center justify-between bg-zinc-50/70 text-xs text-[#111827]">
            <div className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-[#52525B]" />
              <span className="font-semibold">{workspaceName}</span>
              <span className="text-[10px] font-mono px-1 rounded bg-zinc-100 text-zinc-500 border border-[#E2E5E8]">
                Free
              </span>
            </div>
            <Check className="w-3.5 h-3.5 text-[#52525B]" />
          </div>
          <div className="my-1 border-t border-[#E2E5E8]" />
          <button 
            onClick={() => setOpen(false)}
            className="w-full px-3 py-2 text-left text-xs font-semibold text-[#52525B] hover:bg-zinc-50/50 flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create new workspace</span>
          </button>
        </div>
      )}
    </div>
  );
}
