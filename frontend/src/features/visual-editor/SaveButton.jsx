import React from 'react';
import { Save, Check, Loader2 } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

// By default the button follows the Visual Edit store. Code mode passes its own `dirty` / `saved` instead, since
// code edits live in the code workspace rather than in the visual editor's history.
export function SaveButton({ onSave, isSaving = false, dirty, saved }) {
  const { isDirty: storeDirty, saveStatus } = useVisualEditorStore();

  const isDirty = dirty !== undefined ? dirty : storeDirty;
  const isSavingActive = isSaving || (dirty === undefined && saveStatus === 'saving');
  const isSaved = saved !== undefined ? !isDirty && saved : !isDirty && saveStatus === 'saved';

  return (
    <div className="flex items-center">
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
        title="Save your changes (Ctrl + S)"
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
