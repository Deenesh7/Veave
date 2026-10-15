import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, MoreVertical, ExternalLink, Trash2, Copy, Sparkles, Code2, Share2 } from 'lucide-react';
import ProjectPreview from './ProjectPreview';
import { formatDate } from '../../utils/helpers';
import { ShareModal } from '../../features/share/ShareModal';

export default function ProjectCard({ project, viewMode = 'grid', onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const navigate = useNavigate();

  const id = project?._id || project?.id;
  const name = project?.name || 'Untitled Project';
  const description = project?.description || '';
  const updated = formatDate(project?.updatedAt || project?.createdAt);
  const framework = project?.settings?.framework || 'React';
  const fileCount = project?.files?.length || 0;

  const handleOpenEditor = (e) => {
    e?.stopPropagation();
    if (id) {
      navigate(`/editor/${id}`);
    }
  };

  const handleOpenVisualEdit = (e) => {
    e?.stopPropagation();
    if (id) {
      navigate(`/editor/${id}?mode=visual`);
    }
  };

  // List View Layout
  if (viewMode === 'list') {
    return (
      <div 
        onClick={handleOpenEditor}
        className="w-full bg-white rounded-xl border border-[#E2E5E8] p-3 flex items-center justify-between gap-3 hover:border-zinc-300 hover:shadow-2xs transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-zinc-50 border border-zinc-200/60 text-[#52525B] flex items-center justify-center shrink-0">
            <Code2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-semibold text-[#111827] truncate group-hover:text-[#52525B] transition-colors">
              {name}
            </h4>
            <p className="text-[11px] text-[#64748B] truncate">
              {description ? description : `${framework} · ${fileCount} files`} · {updated}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenVisualEdit}
            className="px-2.5 py-1 text-xs font-bold text-zinc-600 bg-zinc-50 hover:bg-zinc-100 rounded-lg transition-colors flex items-center gap-1"
            title="Open Visual Editor"
          >
            <Sparkles className="w-3 h-3" />
            <span>Visual Edit</span>
          </button>
          <span className="text-[10px] font-mono font-semibold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded border border-[#E2E5E8]">
            {framework}
          </span>
          <button
            onClick={handleOpenEditor}
            className="p-1.5 text-zinc-400 hover:text-[#111827] hover:bg-zinc-100 rounded-lg transition-colors"
            title="Open in Editor"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Grid View Layout (Default)
  return (
    <div
      onClick={handleOpenEditor}
      className="group bg-white rounded-[14px] border border-[#E2E5E8] overflow-hidden hover:border-zinc-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-200 cursor-pointer flex flex-col"
    >
      {/* Visual Thumbnail at Top */}
      <div className="w-full h-44 sm:h-48 border-b border-[#E2E5E8] overflow-hidden relative">
        <div className="w-full h-full transition-transform duration-300 group-hover:scale-[1.02]">
          <ProjectPreview project={project} />
        </div>

        {/* Quick Overlay Action on Hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-3">
          <button
            onClick={handleOpenVisualEdit}
            className="px-3.5 py-1.5 rounded-xl bg-white/95 hover:bg-white text-xs font-bold text-zinc-900 shadow-md flex items-center gap-1.5 hover:scale-105 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-zinc-600" />
            <span>Visual Edit</span>
          </button>
          <button
            onClick={handleOpenEditor}
            className="px-3.5 py-1.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-900 text-xs font-bold text-white shadow-md flex items-center gap-1.5 hover:scale-105 transition-all cursor-pointer"
          >
            <Code2 className="w-3.5 h-3.5 text-zinc-300" />
            <span>Studio</span>
          </button>
        </div>
      </div>

      {/* Card Footer Details */}
      <div className="p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-zinc-50 text-[#52525B] border border-zinc-200/60 flex items-center justify-center shrink-0">
            <Code2 className="w-3.5 h-3.5" />
          </div>

          <div className="min-w-0">
            <h4 className="text-xs sm:text-sm font-semibold text-[#111827] truncate group-hover:text-[#52525B] transition-colors leading-snug">
              {name}
            </h4>
            <p className="text-[11px] text-[#64748B] truncate mt-0.5 font-mono">
              {updated}
            </p>
          </div>
        </div>

        {/* Context Options Button */}
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-1 w-36 bg-white rounded-xl border border-[#E2E5E8] shadow-xl py-1 z-40 animate-in fade-in zoom-in-95 duration-100 text-xs"
            >
              <button
                onClick={(e) => {
                  setMenuOpen(false);
                  handleOpenEditor(e);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-zinc-700 hover:bg-zinc-50"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Editor</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  setShareOpen(true);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-zinc-700 hover:bg-zinc-50"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigator.clipboard?.writeText(`${window.location.origin}/editor/${id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-zinc-700 hover:bg-zinc-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Link</span>
              </button>
              {onDelete && id && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(id);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Share Modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        project={project}
      />
    </div>
  );
}
