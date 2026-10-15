import React from 'react';
import { Check, Circle } from 'lucide-react';

function getFriendlyLanguageName(filePath = '') {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jsx':
      return 'JavaScript React';
    case 'tsx':
      return 'TypeScript React';
    case 'js':
      return 'JavaScript';
    case 'ts':
      return 'TypeScript';
    case 'json':
      return 'JSON';
    case 'css':
      return 'CSS';
    case 'scss':
      return 'SCSS';
    case 'html':
      return 'HTML';
    case 'md':
      return 'Markdown';
    default:
      return 'Plain Text';
  }
}

export function StatusBar({
  activeFilePath,
  isDirty = false,
  isSaving = false,
  cursorPos = { line: 1, col: 1, selectionLength: 0 },
  onSave
}) {
  const langName = getFriendlyLanguageName(activeFilePath);

  return (
    <footer className="h-6.5 bg-white border-t border-zinc-200 px-3 flex items-center justify-between text-[11px] font-mono text-zinc-500 select-none shrink-0 z-20 font-sans shadow-2xs">
      {/* Left items: Ln, Col, Selection */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 hover:text-zinc-800 transition-colors cursor-default font-mono">
          <span>Ln {cursorPos.line || 1}, Col {cursorPos.col || 1}</span>
        </div>

        {cursorPos.selectionLength > 0 && (
          <div className="hover:text-zinc-800 transition-colors cursor-default font-mono">
            <span>({cursorPos.selectionLength} selected)</span>
          </div>
        )}
      </div>

      {/* Right items: Language, UTF-8, LF, Spaces: 2, Saved state */}
      <div className="flex items-center gap-4">
        <span className="hidden sm:inline hover:text-zinc-800 transition-colors cursor-default">
          Spaces: 2
        </span>
        <span className="hidden sm:inline hover:text-zinc-800 transition-colors cursor-default">
          UTF-8
        </span>
        <span className="hidden sm:inline hover:text-zinc-800 transition-colors cursor-default">
          LF
        </span>
        <span className="text-zinc-700 hover:text-zinc-950 font-medium transition-colors cursor-default">
          {langName}
        </span>

        {/* Database Save indicator button */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className={`flex items-center gap-1.5 font-sans font-medium text-[11px] px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
            isSaving
              ? 'text-zinc-600 bg-zinc-50/80 cursor-wait'
              : isDirty
              ? 'text-amber-600 hover:bg-amber-50'
              : 'text-emerald-600 hover:bg-emerald-50'
          }`}
          title={
            isSaving
              ? 'Saving changes to database...'
              : isDirty
              ? 'Unsaved changes (Auto-saving to database or click/Ctrl+S to save now)'
              : 'All changes saved to database'
          }
        >
          {isSaving ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full border-2 border-zinc-600 border-t-transparent animate-spin inline-block" />
              <span>Saving...</span>
            </>
          ) : isDirty ? (
            <>
              <Circle className="w-2 h-2 fill-amber-500 text-amber-500 animate-pulse" />
              <span>Unsaved changes</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Saved to database</span>
            </>
          )}
        </button>
      </div>
    </footer>
  );
}

export default StatusBar;
