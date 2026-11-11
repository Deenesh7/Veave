import React from 'react';

export default function QuickActionButton({ icon: Icon, label, onClick, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 h-9 px-3.5 rounded-full border text-xs font-medium shadow-2xs hover:shadow-xs transition-all active:scale-95 group cursor-pointer ${
        active
          ? 'bg-zinc-900 border-zinc-900 text-white'
          : 'bg-white border-[#E5E7EB] text-[#171717] hover:border-zinc-400 hover:bg-zinc-50'
      }`}
    >
      {Icon && (
        <Icon className={`w-3.5 h-3.5 transition-colors shrink-0 ${
          active ? 'text-white' : 'text-zinc-500 group-hover:text-[#52525B]'
        }`} />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
