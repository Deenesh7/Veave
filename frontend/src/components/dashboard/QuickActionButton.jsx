import React from 'react';

export default function QuickActionButton({ icon: Icon, label, onClick, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs font-medium shadow-2xs hover:shadow-xs transition-all active:scale-95 group cursor-pointer ${
        active
          ? 'bg-zinc-900 border-zinc-900 text-white'
          : 'bg-white border-[#E2E5E8] text-[#111827] hover:border-zinc-300 hover:-translate-y-0.5'
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
