import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, 
  Code2, 
  Eye, 
  Sliders, 
  LayoutGrid,
  Sparkles, 
  Share2, 
  Save, 
  MoreHorizontal, 
  Circle, 
  Check, 
  Download, 
  Command, 
  Bot 
} from 'lucide-react';

export function CodeToolbar({
  projectName = 'Student Attendance',
  isDirty = false,
  isSaving = false,
  onBack,
  onSwitchMode,
  onToggleAi,
  isAiOpen = false,
  onShare,
  onSave,
  onExport,
  onOpenCommandPalette
}) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-13 bg-white border-b border-[#E2E5E8] px-3 sm:px-4 flex items-center justify-between gap-3 shrink-0 select-none z-30 text-zinc-900 shadow-2xs font-sans overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
      {/* 1. LEFT: Back Button, Brand, Project Name, Status */}
      <div className="flex items-center gap-2.5 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
          title="Back to Studio / Dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Brand */}
        <div className="flex items-center gap-1.5 font-extrabold text-xs text-zinc-900 tracking-tight">
          <div className="w-6.5 h-6.5 rounded-xl bg-zinc-600 flex items-center justify-center text-white shadow-xs">
            <Code2 className="w-3.5 h-3.5" />
          </div>
          <span className="hidden sm:inline font-black text-[#111827]">VEAVE</span>
        </div>

        <span className="text-zinc-300">/</span>

        {/* Project Name */}
        <span className="text-xs font-bold text-zinc-800 truncate max-w-[140px] sm:max-w-[200px]">
          {projectName}
        </span>

        {/* Saved Status Badge */}
        <div className="hidden sm:flex items-center gap-1.5 ml-1">
          {isDirty ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full shadow-2xs">
              <Circle className="w-1.5 h-1.5 fill-amber-500 text-amber-500" />
              <span>Unsaved changes</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full shadow-2xs">
              <Check className="w-3 h-3 text-emerald-600" />
              <span>Saved</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. CENTER: Editor Actions (Visual Edit | Preview | Screens | Code) */}
      <div className="flex items-center shrink-0">
        <div className="flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 shadow-2xs">
          {/* Visual Edit Mode */}
          <button
            type="button"
            onClick={() => onSwitchMode?.('editor')}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-white/60 transition-all cursor-pointer"
            title="Switch to Visual Component Editor"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden sm:inline">Visual Edit</span>
          </button>

          {/* Preview Mode */}
          <button
            type="button"
            onClick={() => onSwitchMode?.('preview')}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-white/60 transition-all cursor-pointer"
            title="Switch to Website Preview Mode"
          >
            <Eye className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden sm:inline">Preview</span>
          </button>

          {/* Screens Mode */}
          <button
            type="button"
            onClick={() => onSwitchMode?.('screens')}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-white/60 transition-all cursor-pointer"
            title="Switch to Multi-Screen Comparison"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden sm:inline">Screens</span>
          </button>

          {/* Code Mode (ACTIVE) */}
          <button
            type="button"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold bg-white text-zinc-900 shadow-xs cursor-default"
            title="Code Workspace (Active)"
          >
            <Code2 className="w-3.5 h-3.5 text-zinc-600" />
            <span>Code</span>
          </button>
        </div>
      </div>

      {/* 3. RIGHT: Ask AI, Share, Save, More options */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Ask AI Button */}
        <button
          type="button"
          onClick={onToggleAi}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-2xs ${
            isAiOpen
              ? 'bg-zinc-600 text-white border-zinc-600 shadow-xs'
              : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300'
          }`}
          title="Open AI Coding Assistant"
        >
          <Bot className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Ask AI</span>
        </button>

        {/* Share Button */}
        <button
          type="button"
          onClick={onShare}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="Share Project"
        >
          <Share2 className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden xl:inline">Share</span>
        </button>

        {/* Save Button */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !isDirty}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            isDirty
              ? 'bg-zinc-900 hover:bg-black text-white shadow-xs'
              : 'bg-zinc-100 text-zinc-400 border border-zinc-200/60 cursor-default'
          }`}
          title="Save file changes (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{isSaving ? 'Saving...' : 'Save'}</span>
        </button>

        {/* More Options Dropdown */}
        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            onClick={() => setMoreMenuOpen(!moreMenuOpen)}
            className="p-1.5 rounded-xl bg-white hover:bg-zinc-50 border border-zinc-200 text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer shadow-2xs"
            title="More Options"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {moreMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-zinc-200 rounded-2xl shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs text-zinc-700 ring-1 ring-black/5">
              <button
                type="button"
                onClick={() => {
                  onOpenCommandPalette?.();
                  setMoreMenuOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50 flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Command className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="font-medium text-zinc-800">Quick Open</span>
                </div>
                <kbd className="text-[10px] font-mono text-zinc-400">Ctrl+P</kbd>
              </button>

              <button
                type="button"
                onClick={() => {
                  onExport?.();
                  setMoreMenuOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50 flex items-center gap-2 cursor-pointer font-medium text-zinc-800"
              >
                <Download className="w-3.5 h-3.5 text-zinc-400" />
                <span>Export Project ZIP</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onShare?.();
                  setMoreMenuOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50 flex items-center gap-2 cursor-pointer font-medium text-zinc-800 sm:hidden"
              >
                <Share2 className="w-3.5 h-3.5 text-zinc-400" />
                <span>Share Project</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default CodeToolbar;
