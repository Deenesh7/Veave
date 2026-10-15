import React, { useState } from 'react';
import { ChevronDown, Check, ShieldCheck, Globe, Users } from 'lucide-react';

export function AccessSelector({ value = 'Only those invited', onChange }) {
  const [open, setOpen] = useState(false);

  const options = [
    {
      id: 'Only those invited',
      label: 'Only those invited',
      desc: 'Only users directly invited have access',
      icon: ShieldCheck
    },
    {
      id: 'Anyone with the link',
      label: 'Anyone with the link',
      desc: 'Anyone who receives the URL can view',
      icon: Globe
    },
    {
      id: 'Anyone in the workspace',
      label: 'Anyone in the workspace',
      desc: 'All members of Veave workspace can access',
      icon: Users
    }
  ];

  const currentOption = options.find((o) => o.id === value) || options[0];

  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-[#111827] mb-1.5">
        Who has access
      </label>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full h-9 px-3 text-xs bg-white rounded-xl border border-[#DDE2E5] hover:border-zinc-300 text-left flex items-center justify-between transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 truncate">
            <currentOption.icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="font-medium text-[#111827] truncate">{currentOption.label}</span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-xl border border-[#DDE2E5] shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
              {options.map((opt) => {
                const Icon = opt.icon;
                const isSelected = value === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChange?.(opt.id);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-start justify-between gap-2 hover:bg-zinc-50 transition-colors cursor-pointer ${
                      isSelected ? 'bg-zinc-50/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isSelected ? 'text-zinc-600' : 'text-zinc-400'}`} />
                      <div>
                        <div className={`font-semibold ${isSelected ? 'text-zinc-700' : 'text-[#111827]'}`}>
                          {opt.label}
                        </div>
                        <div className="text-[11px] text-zinc-500 font-normal">
                          {opt.desc}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AccessSelector;
