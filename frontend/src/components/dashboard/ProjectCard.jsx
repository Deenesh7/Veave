import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, MoreVertical, ExternalLink, Trash2, Copy, Sparkles, Code2, Share2 } from 'lucide-react';
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

  // Grid View Layout (Default): compact info card, no preview thumbnail
  const creator = project?.owner?.name || project?.creator?.name || project?.createdByName || '';
  const visitUrl = project?.publicUrl || project?.publishedUrl || '';

  return (
    <div
      onClick={handleOpenEditor}
      className="group h-[225px] bg-white rounded-3xl border border-[#E5E7EB] p-5 flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)] hover:border-zinc-300 transition-all duration-200 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h4 title={name} className="text-[17px] font-bold text-[#171717] truncate leading-snug">
            {name}
          </h4>
          {id && <p title={String(id)} className="text-[12px] text-[#737373] truncate mt-0.5 font-mono">ID: {String(id).slice(-5)}</p>}
          {creator && <p className="text-[12px] text-[#737373] truncate">{creator}</p>}
        </div>

        {/* Context Options Button */}
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            aria-label="Project actions"
            className="p-1 -mr-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
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

      {/* Footer */}
      <div className="mt-auto border-t border-[#E5E7EB] pt-3 flex items-center gap-1.5">
        {visitUrl && (
          <a
            href={visitUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="h-8 px-2.5 inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-xl bg-white border border-[#E5E7EB] text-xs font-semibold text-[#171717] hover:bg-zinc-50 transition-colors"
          >
            Visit <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        <button
          onClick={handleOpenVisualEdit}
          title="Visual Edit"
          className={`h-8 ${visitUrl ? "px-2" : "px-3"} inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-xl bg-white border border-[#E5E7EB] text-xs font-semibold text-[#171717] hover:bg-zinc-50 transition-colors`}
        >
          <Sparkles className="w-3.5 h-3.5 text-zinc-500" /> {visitUrl ? <span className="sr-only">Visual Edit</span> : 'Visual Edit'}
        </button>
        <button
          onClick={handleOpenEditor}
          className="ml-auto h-8 px-3.5 shrink-0 rounded-xl bg-black text-white text-xs font-semibold hover:bg-zinc-800 transition-colors"
        >
          Edit
        </button>
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
