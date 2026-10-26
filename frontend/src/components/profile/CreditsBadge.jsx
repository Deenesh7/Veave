import React from 'react';
import { Zap } from 'lucide-react';

export function CreditsBadge({ credits = 50 }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white text-zinc-700 border border-[#DDE2E5] shadow-2xs select-none">
      <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
      <span>{credits} credits</span>
    </span>
  );
}

export default CreditsBadge;
