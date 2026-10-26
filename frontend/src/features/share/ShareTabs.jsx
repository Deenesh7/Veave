import React from 'react';
import { Users, Globe, Link2 } from 'lucide-react';

const TABS = [
  { id: 'collaborate', label: 'Collaborate', Icon: Users },
  { id: 'domain', label: 'Domain', Icon: Link2 },
  { id: 'publish', label: 'Publish', Icon: Globe }
];

export function ShareTabs({ activeTab, onTabChange }) {
  return (
    <div className="flex items-center border-b border-[#DDE2E5] mb-5">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTabChange(id)}
          className={`pb-2.5 px-1 mr-6 last:mr-0 text-xs sm:text-sm font-semibold transition-all relative cursor-pointer flex items-center gap-1.5 ${
            activeTab === id
              ? 'text-[#111827] border-b-2 border-[#111827]'
              : 'text-zinc-400 hover:text-zinc-700 border-b-2 border-transparent'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export default ShareTabs;
