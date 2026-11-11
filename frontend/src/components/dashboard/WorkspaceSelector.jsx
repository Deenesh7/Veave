import React from 'react';
import { useAuthStore } from '../../store/authStore';

// The workspace name and plan shown next to the logo. It is a plain label: there is only one workspace per account.
export default function WorkspaceSelector() {
  const { user } = useAuthStore();
  const workspaceName = user?.name ? `${user.name}'s Workspace` : 'Personal Workspace';

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 select-none">
      <span className="font-semibold text-sm text-[#111827] tracking-tight">
        {workspaceName}
      </span>
      <span className="text-[10px] font-mono font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded border border-[#E2E5E8]">
        Free
      </span>
    </div>
  );
}
