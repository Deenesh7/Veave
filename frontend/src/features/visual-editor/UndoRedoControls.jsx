import React from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

export function UndoRedoControls({ onUndo, onRedo }) {
  const { undo, redo, canUndo, canRedo } = useVisualEditorStore();

  const handleUndo = () => {
    const action = undo();
    if (action && onUndo) onUndo(action);
  };

  const handleRedo = () => {
    const action = redo();
    if (action && onRedo) onRedo(action);
  };

  const hasUndo = canUndo();
  const hasRedo = canRedo();

  return (
    <div className="flex items-center bg-zinc-100/90 p-0.5 rounded-xl border border-zinc-200/80 shadow-2xs">
      <button
        type="button"
        disabled={!hasUndo}
        onClick={handleUndo}
        className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
          hasUndo
            ? 'text-zinc-700 hover:text-zinc-900 hover:bg-white shadow-2xs cursor-pointer'
            : 'text-zinc-300 cursor-not-allowed'
        }`}
        title="Undo (Ctrl + Z)"
      >
        <Undo2 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        disabled={!hasRedo}
        onClick={handleRedo}
        className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
          hasRedo
            ? 'text-zinc-700 hover:text-zinc-900 hover:bg-white shadow-2xs cursor-pointer'
            : 'text-zinc-300 cursor-not-allowed'
        }`}
        title="Redo (Ctrl + Shift + Z)"
      >
        <Redo2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default UndoRedoControls;
