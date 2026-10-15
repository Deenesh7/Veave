import React from 'react';
import { Users, Globe } from 'lucide-react';

export function ShareTabs({ activeTab, onTabChange }) {
  return (
    <div className="flex items-center border-b border-[#DDE2E5] mb-5">
      <button
        type="button"
        onClick={() => onTabChange('collaborate')}
        className={`pb-2.5 px-1 mr-6 text-xs sm:text-sm font-semibold transition-all relative cursor-pointer flex items-center gap-1.5 ${
          activeTab === 'collaborate'
            ? 'text-[#111827] border-b-2 border-[#111827]'
            : 'text-zinc-400 hover:text-zinc-700 border-b-2 border-transparent'
        }`}
      >
        <Users className="w-3.5 h-3.5" />
        <span>Collaborate</span>
      </button>

      <button
        type="button"
        onClick={() => onTabChange('publish')}
        className={`pb-2.5 px-1 text-xs sm:text-sm font-semibold transition-all relative cursor-pointer flex items-center gap-1.5 ${
          activeTab === 'publish'
            ? 'text-[#111827] border-b-2 border-[#111827]'
            : 'text-zinc-400 hover:text-zinc-700 border-b-2 border-transparent'
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>Publish</span>
      </button>
    </div>
  );
}

export default ShareTabs;
