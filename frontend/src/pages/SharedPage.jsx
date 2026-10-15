import React from 'react';
import { Share2, Users, UserPlus } from 'lucide-react';

export default function SharedPage() {
  return (
    <div className="w-full py-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-[#E2E5E8]">
        <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Shared with Me</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Prototypes, components, and workspaces shared directly with you by teammates.
        </p>
      </div>

      {/* Empty State: Zero mock data */}
      <div className="bg-white rounded-2xl border border-[#E2E5E8] p-12 sm:p-16 text-center flex flex-col items-center justify-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-zinc-50 text-[#52525B] flex items-center justify-center mb-1">
          <Share2 className="w-6 h-6 stroke-[1.75]" />
        </div>
        <h4 className="text-sm font-bold text-[#111827]">No shared projects yet</h4>
        <p className="text-xs text-[#64748B] max-w-sm leading-relaxed">
          When teammates share prototypes or design system tokens with your email, they will appear here in real time.
        </p>
      </div>
    </div>
  );
}
