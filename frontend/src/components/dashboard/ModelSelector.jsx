import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Zap, Cpu, Sparkles, Sliders } from 'lucide-react';

const MODEL_OPTIONS = [
  {
    category: 'Default',
    items: [
      {
        id: 'GPT-6 Luna',
        name: 'GPT-6 Luna',
        desc: 'Long-context model for complete multi-page website cloning',
        badge: 'Clone Recommended',
        badgeColor: 'bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold'
      },
      {
        id: 'Gemini Flash 3.8',
        name: 'Gemini Flash 3.8',
        desc: 'Google DeepMind high-speed UI synthesis & crisp layout generation',
        badge: 'Default Model',
        badgeColor: 'bg-zinc-50 text-zinc-700 border border-zinc-200/60 font-semibold'
      },
      {
        id: 'Auto',
        name: 'Auto',
        desc: 'Automatically choose the best model for your prompt',
        badge: 'Smart Route',
        badgeColor: 'bg-zinc-100 text-zinc-700'
      },
    ]
  },
  {
    category: 'Available Models',
    items: [
      {
        id: 'GPT',
        name: 'GPT-4o',
        desc: 'Best for general UI generation & component layout',
        badge: 'High Fidelity',
        badgeColor: 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
      },
      {
        id: 'Claude',
        name: 'Claude Sonnet 5.5',
        desc: 'Best for multi-page cloning, long contexts & architecture',
        badge: 'Deep Logic',
        badgeColor: 'bg-amber-50 text-amber-700 border border-amber-200/50'
      },
      {
        id: 'Gemini',
        name: 'Gemini 1.5 Pro',
        desc: 'Best for multimodal workflows & large code contexts',
        badge: 'Multimodal',
        badgeColor: 'bg-indigo-50 text-indigo-700 border border-indigo-200/50'
      },
    ]
  },
  {
    category: 'Performance Tuning',
    items: [
      {
        id: 'Fast',
        name: 'Fast',
        desc: 'Optimized for sub-second rapid prototyping & mockups',
        badge: 'Lightning',
        badgeColor: 'bg-yellow-50 text-yellow-700 border border-yellow-200/50'
      },
      {
        id: 'Balanced',
        name: 'Balanced',
        desc: 'Great balance of speed & visual component accuracy',
        badge: 'Optimal',
        badgeColor: 'bg-cyan-50 text-cyan-700 border border-cyan-200/50'
      },
      {
        id: 'High Quality',
        name: 'High Quality',
        desc: 'Maximum polish, pixel-perfect spacing, rich animations',
        badge: 'Studio Grade',
        badgeColor: 'bg-purple-50 text-purple-700 border border-purple-200/50'
      },
    ]
  }
];

export default function ModelSelector({ selectedModel, onSelectModel }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allItems = MODEL_OPTIONS.flatMap((g) => g.items);
  const current = allItems.find((m) => m.id === selectedModel) || allItems[0];

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111827] hover:text-black px-2.5 py-1 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 transition-colors shadow-2xs cursor-pointer"
        title="Choose AI Model"
      >
        <Cpu className="w-3.5 h-3.5 text-[#52525B]" />
        <span>{current.name}</span>
        <ChevronDown className={`w-3 h-3 text-zinc-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-zinc-800' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-[#E2E5E8] shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150 max-h-[380px] overflow-y-auto">
          {MODEL_OPTIONS.map((group) => (
            <div key={group.category} className="mb-2 last:mb-0">
              <div className="px-2.5 py-1 text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                {group.category}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isSelected = item.id === selectedModel;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectModel(item.id);
                        setIsOpen(false);
                      }}
                      className={`w-full p-2 text-left rounded-xl flex items-start justify-between transition-colors ${
                        isSelected ? 'bg-zinc-50/70 border border-zinc-200/60 text-[#111827]' : 'hover:bg-zinc-50 text-zinc-700'
                      }`}
                    >
                      <div className="pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-900">{item.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-medium ${item.badgeColor}`}>
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">{item.desc}</p>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-[#52525B] shrink-0 mt-0.5" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
