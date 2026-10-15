import React, { useState } from 'react';
import { Building2, Check, Sparkles } from 'lucide-react';

export function WorkspaceInvite({ workspaceName = 'VEAVE', onWorkspaceInvite }) {
  const [isInvited, setIsInvited] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (isInvited) return;
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsInvited(true);
      if (onWorkspaceInvite) {
        onWorkspaceInvite(workspaceName);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl bg-zinc-50/70 border border-zinc-100/90 p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-600 text-white font-bold text-xs flex items-center justify-center shadow-xs shrink-0 tracking-wider">
          V
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#111827] truncate">
            Invite your workspace: <span className="font-bold text-zinc-700">{workspaceName}</span>
          </p>
          <p className="text-[11px] text-zinc-500 truncate">
            Collaborate seamlessly with everyone in this organization
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={handleInvite}
        disabled={loading || isInvited}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
          isInvited
            ? 'bg-emerald-100/80 text-emerald-800 border border-emerald-200 cursor-default'
            : 'bg-white hover:bg-zinc-50 text-[#111827] border border-[#DDE2E5] shadow-2xs active:scale-95'
        }`}
      >
        {isInvited ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span>Invited</span>
          </>
        ) : loading ? (
          <span>Inviting...</span>
        ) : (
          <span>Invite</span>
        )}
      </button>
    </div>
  );
}

export default WorkspaceInvite;
