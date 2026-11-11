import React from 'react';
import { 
  ArrowLeft, 
  Eye, 
  LayoutGrid, 
  Code2, 
  Sliders, 
  Share2, 
  Rocket, 
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';
import { UndoRedoControls } from './UndoRedoControls';
import { SaveButton } from './SaveButton';

export function EditorToolbar({
  projectName = 'My Website',
  onBack,
  onSave,
  onShare,
  onPublish,
  onUndo,
  onRedo,
  isSaving = false,
  codeSave = null
}) {
  const { activeMode, setActiveMode } = useVisualEditorStore();

  return (
    <header className="h-14 bg-white border-b border-[#E2E5E8] px-3 sm:px-4 flex items-center justify-between gap-3 shrink-0 select-none relative z-40 shadow-2xs">
      {/* LEFT SIDE: Back Button, Logo, Project Name */}
      <div className="flex items-center gap-2.5 min-w-0 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-xl hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
          title="Back to Dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Brand */}
        <img src="/veave-logo.png" alt="Veave" className="w-10 h-10 object-contain shrink-0" />

        <span className="text-zinc-300 hidden md:inline">/</span>

        {/* Project Name */}
        <span className="text-xs font-semibold text-zinc-800 truncate max-w-[130px] sm:max-w-[170px]">
          {projectName}
        </span>

      </div>

      {/* CENTER: Mode Switcher (Visual Edit | Preview | Screens | Code) */}
      <div className="flex items-center shrink-0">
        <div className="flex items-center bg-zinc-100/90 p-1 rounded-xl border border-zinc-200/80 shadow-2xs">
          {/* Visual Edit Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('editor')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'editor'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Visual Design Editor Mode"
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-600" />
            <span className="hidden lg:inline text-[11px]">Visual Edit</span>
          </button>

          {/* Preview Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('preview')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'preview'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Clean Website Preview Mode"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Preview</span>
          </button>

          {/* Screens Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('screens')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'screens'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Responsive Multi-Screen Comparison"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Screens</span>
          </button>

          {/* Code Mode */}
          <button
            type="button"
            onClick={() => setActiveMode('code')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'code'
                ? 'bg-white text-zinc-900 shadow-xs font-bold'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
            title="Inspect Generated Code"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">Code</span>
          </button>
        </div>
      </div>

      {/* RIGHT SIDE: Undo/Redo and Save (Visual Edit), Save (Code), Share, Publish */}
      <div className="flex items-center gap-2 shrink-0">
        {activeMode === 'editor' && (
          <>
            <UndoRedoControls onUndo={onUndo} onRedo={onRedo} />
            <SaveButton onSave={onSave} isSaving={isSaving} />
          </>
        )}
        {/* Code mode: Save writes the edited files; its own state, since code edits are not Visual Edit changes */}
        {activeMode === 'code' && codeSave && (
          <SaveButton
            onSave={codeSave.onSave}
            isSaving={codeSave.isSaving}
            dirty={codeSave.isDirty}
            saved={codeSave.saved}
          />
        )}

        {/* Share Button */}
        <button
          type="button"
          onClick={onShare}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-2xs transition-colors cursor-pointer"
          title="Share Website Prototype"
        >
          <Share2 className="w-3.5 h-3.5 text-zinc-500" />
          <span className="hidden md:inline">Share</span>
        </button>

        {/* Publish Button */}
        <button
          type="button"
          onClick={onPublish}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-bold shadow-xs transition-all active:scale-95 cursor-pointer"
          title="Publish Live Deployment"
        >
          <Rocket className="w-3.5 h-3.5" />
          <span>Publish</span>
        </button>
      </div>
    </header>
  );
}

export default EditorToolbar;
