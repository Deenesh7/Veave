import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Clock } from 'lucide-react';
import { RoleBadge, timeAgo } from './ui';

// Lists projects with who owns them, which group they come through and the caller's access level.
export default function ProjectsTable({ projects, showGroup = true }) {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-xl border border-[#E2E5E8] shadow-sm overflow-hidden">
      <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_110px_90px] gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-50 border-b border-[#E2E5E8]">
        <span>Project</span><span>{showGroup ? 'Group' : 'Shared via'}</span><span>Owner</span><span>Updated</span><span>Access</span>
      </div>
      <ul className="divide-y divide-zinc-100">
        {projects.map((project) => (
          <li key={project._id}>
            <button
              type="button"
              onClick={() => navigate(`/editor/${project._id}`)}
              className="w-full text-left grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_110px_90px] gap-1 sm:gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors items-center"
            >
              <span className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="truncate text-sm font-semibold text-[#111827]">{project.name}</span>
              </span>
              <span className="truncate text-xs text-zinc-600">
                {project.groups?.length ? project.groups.map((g) => g.name).join(', ') : project.sharedDirectly ? 'Shared with you directly' : '-'}
              </span>
              <span className="truncate text-xs text-zinc-600">{project.owner?.name || 'You'}</span>
              <span className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="w-3 h-3" />{timeAgo(project.updatedAt)}</span>
              <span><RoleBadge role={project.access} /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
