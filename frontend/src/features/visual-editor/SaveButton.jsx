import React from 'react';
import { Save, Check, CircleDot, Loader2 } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

export function SaveButton({ onSave, isSaving = false }) {
  const { isDirty, saveStatus } = useVisualEditorStore();

  const isSavingActive = isSaving || saveStatus === 'saving';
  const isSaved = !isDirty && saveStatus === 'saved';

  return (
    <div className="flex items-center gap-2">
      {/* Unsaved / Saved Status Pill */}
      {isSavingActive ? (
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-50 text-zinc-700 border border-zinc-200/80 text-[11px] font-semibold">
          <Loader2 className="w-3 h-3 text-zinc-600 animate-spin" />
          <span>Saving to database...</span>
        </span>
      ) : isDirty ? (
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80 text-[11px] font-semibold">
          <CircleDot className="w-3 h-3 text-amber-500 animate-pulse" />
          <span>Unsaved changes</span>
        </span>
      ) : isSaved ? (
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[11px] font-semibold">
          <Check className="w-3 h-3 text-emerald-600" />
          <span>Saved to database</span>
        </span>
      ) : null}

      {/* Save Button */}
      <button
        type="button"
        disabled={isSavingActive || !isDirty}
        onClick={onSave}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-2xs ${
          isDirty
            ? 'bg-zinc-600 hover:bg-zinc-700 text-white cursor-pointer active:scale-95'
            : isSaved
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
            : 'bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-default'
        }`}
        title="Visual changes save automatically to database (or press Ctrl + S)"
      >
        {isSavingActive ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isSaved ? (
          <Check className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <Save className="w-3.5 h-3.5" />
        )}
        <span>{isSavingActive ? 'Saving...' : isSaved ? 'Saved' : 'Save'}</span>
      </button>
    </div>
  );
}

export default SaveButton;
