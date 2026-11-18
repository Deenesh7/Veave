import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Clock, Shield, UserCog } from 'lucide-react';
import { RoleBadge, timeAgo } from './ui';

// Lists projects with who owns them, which group they come through and the caller's access level.
// With `onAssignAdmin` (group pages) an Admin column shows each project's admins and lets managers change them.
export default function ProjectsTable({ projects, showGroup = true, onAssignAdmin = null, showAdmins = false, onSelect = null }) {
  const navigate = useNavigate();
  const admin = showAdmins || Boolean(onAssignAdmin);
  const cols = admin
    ? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_110px_90px]'
    : 'sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_110px_90px]';
  return (
    <div className="bg-white rounded-xl border border-[#E2E5E8] shadow-sm overflow-hidden">
      <div className={`hidden sm:grid ${cols} gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-50 border-b border-[#E2E5E8]`}>
        <span>Project</span><span>{showGroup ? 'Group' : 'Shared via'}</span><span>Owner</span>{admin && <span>Admin</span>}<span>Updated</span><span>Access</span>
      </div>
      <ul className="divide-y divide-zinc-100">
        {projects.map((project) => (
          <li key={project._id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => (onSelect ? onSelect(project) : navigate(`/editor/${project._id}`))}
              onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') { if (onSelect) onSelect(project); else navigate(`/editor/${project._id}`); } }}
              className={`w-full cursor-pointer text-left grid grid-cols-1 ${cols} gap-1 sm:gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors items-center`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="truncate text-sm font-semibold text-[#111827]">{project.name}</span>
              </span>
              <span className="truncate text-xs text-zinc-600">
                {project.groups?.length ? project.groups.map((g) => g.name).join(', ') : project.sharedDirectly ? 'Shared with you directly' : '-'}
              </span>
              <span className="truncate text-xs text-zinc-600">{project.owner?.name || 'You'}</span>
              {admin && (
                <span className="flex min-w-0 items-center gap-1.5">
                  {project.admins?.length ? (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-zinc-200 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-white" title={project.admins.map((a) => a.name).join(', ')}>
                      <Shield className="h-3 w-3 shrink-0" /><span className="truncate">{project.admins[0].name}{project.admins.length > 1 ? ` +${project.admins.length - 1}` : ''}</span>
                    </span>
                  ) : <span className="text-xs text-zinc-400">None</span>}
                  {onAssignAdmin && (
                    <button type="button" title="Assign project admins" aria-label={`Assign admins of ${project.name}`} onClick={(e) => { e.stopPropagation(); onAssignAdmin(project); }}
                      className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E2E5E8] text-zinc-600 transition hover:border-zinc-900 hover:bg-zinc-100"><UserCog className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="w-3 h-3" />{timeAgo(project.updatedAt)}</span>
              <span><RoleBadge role={project.access} /></span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
