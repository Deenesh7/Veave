import React from 'react';

export function PlanBadge({ plan = 'Free Plan' }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-zinc-700 border border-zinc-200/90 shadow-2xs select-none">
      {plan}
    </span>
  );
}

export default PlanBadge;
