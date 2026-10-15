import React from 'react';
import { Layers, Sparkles, Check } from 'lucide-react';

export default function ContextChip({ label, active, onClick }) {
  const icon = label === 'Design System' ? Layers : Sparkles;
  const Icon = icon;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all select-none ${
        active
          ? 'bg-zinc-50 text-[#52525B] border border-zinc-200/80 shadow-2xs font-semibold'
          : 'bg-zinc-100/70 text-[#64748B] hover:text-[#111827] hover:bg-zinc-100 border border-[#E2E5E8]'
      }`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      <span>{label}</span>
      {active && <Check className="w-2.5 h-2.5 stroke-[3] ml-0.5" />}
    </button>
  );
}
