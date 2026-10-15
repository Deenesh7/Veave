import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Palette, ChevronDown, Check, Sparkles } from 'lucide-react';
import useThemePaletteStore from '../../store/themePaletteStore';

const BASE_DESIGN_SYSTEMS = [
  { id: 'Base', name: 'Base', desc: 'Default clean Tailwind primitives', badge: 'Standard' },
  { id: 'Primary', name: 'Primary', desc: 'Refined shades of blue and purple', badge: 'Theme' },
  { id: 'Modern', name: 'Modern', desc: 'Deep indigo & purple balanced geometry', badge: 'Popular' },
  { id: 'Minimal', name: 'Minimal', desc: 'High contrast monochrome inspired by Linear', badge: 'Sleek' },
  { id: 'Enterprise', name: 'Enterprise', desc: 'Authoritative cobalt slate for dense data', badge: 'Robust' },
];

export default function DesignSystemSelector({ selected, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { palettes, fetchPalettes } = useThemePaletteStore();

  useEffect(() => {
    fetchPalettes().catch(() => {});
  }, []);

  const allSystems = useMemo(() => {
    const list = [...BASE_DESIGN_SYSTEMS];
    if (palettes && palettes.length > 0) {
      palettes.forEach((p) => {
        list.push({
          id: p._id,
          name: p.name,
          desc: `${p.colors?.primary || '#4F46E5'} · ${p.typography?.headingFont || 'Inter'}`,
          badge: p.isDefault ? 'Default' : 'Custom',
          palette: p
        });
      });
    } else {
      list.push({ id: 'Custom', name: 'Custom', desc: 'Tailored tokens synced from Design Studio', badge: 'Synced' });
    }
    return list;
  }, [palettes]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const current = allSystems.find((d) => d.id === selected) || allSystems[1]; // Default to Primary / Modern

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all shadow-2xs cursor-pointer border ${
          isOpen || selected
            ? 'bg-zinc-100 border-zinc-300 text-zinc-900 shadow-xs'
            : 'bg-white border-[#E2E5E8] text-[#64748B] hover:text-[#111827] hover:border-zinc-300'
        }`}
        title="Select active design system"
      >
        <Palette className="w-3.5 h-3.5 text-[#4F46E5]" />
        <span>Design System: <strong className="text-zinc-900 font-bold">{current.name}</strong></span>
        <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-zinc-800' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl border border-[#E2E5E8] shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-2.5 py-1 text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
            Available Design Systems
          </div>

          <div className="space-y-1 mt-1 max-h-60 overflow-y-auto">
            {allSystems.map((ds) => {
              const isSelected = ds.id === selected;
              return (
                <button
                  key={ds.id}
                  type="button"
                  onClick={() => {
                    onSelect(ds.id, ds.palette || null);
                    setIsOpen(false);
                  }}
                  className={`w-full p-2 text-left rounded-xl flex items-start justify-between transition-colors ${
                    isSelected ? 'bg-zinc-50/70 border border-zinc-200/60 text-[#111827]' : 'hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-zinc-900">{ds.name}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-zinc-100 text-zinc-500 font-mono">
                        {ds.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">{ds.desc}</p>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#52525B] shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
