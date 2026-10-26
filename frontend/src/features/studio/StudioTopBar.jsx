import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import { 
  Sparkles, 
  Monitor, 
  Tablet, 
  Smartphone, 
  Download, 
  Share2, 
  History, 
  RotateCw, 
  Code2, 
  Eye, 
  ChevronDown, 
  Check, 
  Columns,
  Sliders,
  Loader2
} from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useAuthStore } from '../../store/authStore';
import { projectService } from '../../services/projectService';
import { ShareModal } from '../share/ShareModal';
import { ProfileMenu } from '../../components/profile/ProfileMenu';

export function StudioTopBar({
  previewSize,
  setPreviewSize,
  viewMode,
  setViewMode,
  onRefresh,
  onOpenHistory,
  onOpenVisualEdit,
  isOpeningVisualEditor = false,
  isGenerating
}) {
  const navigate = useNavigate();
  const goBack = useSmartBack('/dashboard');
  const { currentProject, projects, setCurrentProject } = useProjectStore();
  const { user } = useAuthStore();
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const projectName = currentProject?.name || 'AI Generated Application';

  const handleExport = async () => {
    if (!currentProject?._id) return;
    setIsExporting(true);
    try {
      const res = await projectService.exportProject(currentProject._id);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleShare = () => {
    setShareOpen(true);
  };

  return (
    <header className="h-14 bg-white border-b border-[#E2E5E8] px-3 sm:px-5 flex items-center justify-between gap-3 shrink-0 select-none z-30 shadow-2xs">
      {/* Left Area: Brand Logo, App Name, Project Dropdown */}
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" onClick={goBack} title="Back to Dashboard" aria-label="Back to Dashboard" className="flex items-center gap-2.5 cursor-pointer">
          <div className="w-7 h-7 rounded-xl bg-zinc-900 flex items-center justify-center text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <span className="font-extrabold text-sm tracking-tight text-[#111827] hidden md:inline">
            Veave
          </span>
        </button>

        <div className="h-4 w-px bg-zinc-200 hidden sm:block mx-0.5" />

        {/* Project Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold text-zinc-800 hover:bg-zinc-100 transition-colors max-w-[180px] sm:max-w-[240px] truncate cursor-pointer"
          >
            <span className="truncate">{projectName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          </button>

          {projectDropdownOpen && (
            <div 
              onClick={(e) => e.stopPropagation()}
              className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-2xl border border-[#E2E5E8] shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase text-zinc-400 font-bold tracking-wider">
                Switch Project
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-zinc-50">
                {projects && projects.length > 0 ? (
                  projects.map((p) => (
                    <button
                      key={p._id}
                      onClick={() => {
                        setCurrentProject(p);
                        setProjectDropdownOpen(false);
                        navigate(`/editor/${p._id}`, { replace: true });
                      }}
                      className="w-full px-3 py-2 text-left text-xs hover:bg-zinc-50 flex items-center justify-between text-zinc-700 transition-colors"
                    >
                      <span className="truncate font-medium">{p.name}</span>
                      {p._id === currentProject?._id && <Check className="w-3.5 h-3.5 text-zinc-600 shrink-0" />}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-zinc-400">No other projects</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Center Area: Viewport Controls & Layout Switcher */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Device Viewport Switcher */}
        <div className="hidden sm:flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/60 shadow-2xs">
          <button
            onClick={() => setPreviewSize('desktop')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              previewSize === 'desktop' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Desktop View (100%)"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Desktop</span>
          </button>

          <button
            onClick={() => setPreviewSize('tablet')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              previewSize === 'tablet' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Tablet View (768px)"
          >
            <Tablet className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Tablet</span>
          </button>

          <button
            onClick={() => setPreviewSize('mobile')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              previewSize === 'mobile' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Mobile View (375px)"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Mobile</span>
          </button>
        </div>

        {/* Mode switcher: Preview | Split | Code */}
        <div className="flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/60 shadow-2xs">
          <button
            onClick={() => setViewMode('preview')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'preview' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Clean Preview (no element inspection)"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Preview</span>
          </button>

          <button
            onClick={() => setViewMode('split')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'split' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Split Code & Preview Mode"
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Split</span>
          </button>

          <button
            onClick={() => setViewMode('code')}
            className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
              viewMode === 'code' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-500 hover:text-zinc-800'
            }`}
            title="Code Editor Mode"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Code</span>
          </button>
        </div>

        {/* Visual Edit / Edit Design Button */}
        <button
          onClick={() => onOpenVisualEdit?.('editor')}
          disabled={isOpeningVisualEditor}
          className="px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300 shadow-2xs active:scale-95 disabled:opacity-75"
          title="Open Full Visual Design Editor (Inspect & customize styling)"
        >
          {isOpeningVisualEditor ? (
            <Loader2 className="w-3.5 h-3.5 text-zinc-600 animate-spin" />
          ) : (
            <Sliders className="w-3.5 h-3.5 text-zinc-600" />
          )}
          <span className="hidden sm:inline">
            {isOpeningVisualEditor ? 'Opening...' : 'Visual Edit'}
          </span>
        </button>

        {/* Refresh Preview */}
        <button
          onClick={onRefresh}
          className="p-2 rounded-xl text-xs font-semibold border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 transition-all cursor-pointer"
          title="Refresh Live Preview"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Area: Export, Share, History, User Avatar */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        <button
          onClick={onOpenHistory}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="View Version History"
        >
          <History className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden md:inline">History</span>
        </button>

        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="Share Project & Collaborate"
        >
          <Share2 className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">Share</span>
        </button>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          title="Download Project ZIP bundle"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        {/* User avatar with Profile Dropdown */}
        <ProfileMenu />
      </div>

      {/* Professional Collaboration and Sharing Modal */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        project={currentProject}
      />
    </header>
  );
}
