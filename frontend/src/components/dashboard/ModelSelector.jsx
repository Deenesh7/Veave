import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Cpu } from 'lucide-react';

// Veave runs a single AI model.
const MODEL_OPTIONS = [
  {
    category: 'Model',
    items: [
      {
        id: 'Veave AI',
        name: 'Veave AI',
        desc: 'Used for creating websites, cloning, and editing',
        badge: 'Default',
        badgeColor: 'bg-zinc-50 text-zinc-700 border border-zinc-200/60 font-semibold'
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
