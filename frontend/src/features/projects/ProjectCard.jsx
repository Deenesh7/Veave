import { useNavigate } from 'react-router-dom';
import { MoreVertical, ExternalLink, Trash2, Clock, Code2, ArrowUpRight } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { DropdownMenu } from '../../components/ui/DropdownMenu';
import { Button } from '../../components/ui/Button';
import { formatDate } from '../../utils/helpers';

export function ProjectCard({ project, onDelete }) {
  const navigate = useNavigate();

  const handleOpen = () => navigate(`/editor/${project._id}`);

  const menuItems = [
    { label: 'Open in Editor', icon: ExternalLink, onClick: handleOpen },
    { divider: true },
    { label: 'Delete Project', icon: Trash2, onClick: () => onDelete(project._id), danger: true },
  ];

  const fileCount = project.files?.length || 0;

  return (
    <Card 
      onClick={handleOpen}
      className="group cursor-pointer bg-white border border-zinc-200 hover:border-zinc-300 hover:shadow-lg transition-all duration-300 rounded-2xl overflow-hidden flex flex-col relative -translate-y-0 hover:-translate-y-1"
    >
      {/* Mock Browser Preview Header Banner */}
      <div className="h-32 bg-gradient-to-br from-zinc-50 via-zinc-100 to-indigo-50/40 border-b border-zinc-100 relative p-3 flex flex-col justify-between overflow-hidden">
        {/* Browser dots */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-300/80 group-hover:bg-red-400/80 transition-colors" />
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-300/80 group-hover:bg-amber-400/80 transition-colors" />
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-300/80 group-hover:bg-emerald-400/80 transition-colors" />
          </div>
          <span className="text-[10px] font-mono text-zinc-400 bg-white/80 px-2 py-0.5 rounded-full border border-zinc-200/60 shadow-2xs">
            React + Tailwind
          </span>
        </div>

        {/* Abstract UI wireframe thumbnail */}
        <div className="space-y-1.5 px-2 opacity-60 group-hover:opacity-100 transition-opacity">
          <div className="h-2 w-1/3 bg-zinc-300/80 rounded-full" />
          <div className="h-2 w-2/3 bg-zinc-200/80 rounded-full" />
          <div className="flex gap-1.5 pt-1">
            <div className="h-6 w-1/4 bg-white rounded border border-zinc-200/80 shadow-2xs" />
            <div className="h-6 w-1/4 bg-white rounded border border-zinc-200/80 shadow-2xs" />
            <div className="h-6 w-1/4 bg-white rounded border border-zinc-200/80 shadow-2xs" />
            <div className="h-6 w-1/4 bg-white rounded border border-zinc-200/80 shadow-2xs" />
          </div>
        </div>

        {/* Hover open badge */}
        <div className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
          <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-md">
            <ArrowUpRight className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Project Details */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h3 className="font-semibold text-zinc-900 group-hover:text-indigo-600 transition-colors truncate flex-1 text-base">
              {project.name}
            </h3>
            
            <div 
              className="shrink-0 -mr-1.5 -mt-1"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu
                trigger={
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-700">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                }
                items={menuItems}
                align="right"
              />
            </div>
          </div>

          <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed min-h-[32px]">
            {project.description || 'AI-generated React component project.'}
          </p>
        </div>

        {/* Footer Meta */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-100 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 font-medium text-zinc-600">
            <Code2 className="w-3.5 h-3.5 text-indigo-500" />
            <span>{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-zinc-400" />
            <span>{formatDate(project.updatedAt || project.createdAt)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
