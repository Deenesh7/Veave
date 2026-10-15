import React from 'react';
import { X, FileCode, FileJson, FileText, FileImage, File, Sparkles, Search } from 'lucide-react';

function getTabIcon(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jsx':
    case 'js':
    case 'tsx':
    case 'ts':
    case 'html':
      return <FileCode className="w-3.5 h-3.5 text-zinc-600 shrink-0" />;
    case 'css':
    case 'scss':
      return <FileCode className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
    case 'json':
      return <FileJson className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
    case 'md':
    case 'txt':
      return <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
    case 'svg':
    case 'png':
    case 'jpg':
      return <FileImage className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
  }
}

export function EditorTabs({
  openFilePaths = [],
  activeFilePath,
  unsavedMap = {},
  onSelectTab,
  onCloseTab,
  onToggleAi,
  isAiOpen = false,
  onOpenCommandPalette
}) {
  if (openFilePaths.length === 0) return null;

  return (
    <div className="h-9 bg-zinc-100/80 border-b border-zinc-200 flex items-stretch justify-between select-none shrink-0 font-sans">
      {/* Tab Items */}
      <div className="flex-1 flex items-stretch overflow-x-auto scrollbar-none min-w-0">
        {openFilePaths.map((filePath) => {
          const isActive = activeFilePath === filePath;
          const isDirty = unsavedMap[filePath] !== undefined;
          const fileName = filePath.split('/').pop() || filePath;

          return (
            <div
              key={filePath}
              role="tab"
              tabIndex={0}
              onClick={() => onSelectTab(filePath)}
              onMouseDown={(e) => {
                // Middle click closes tab
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(filePath);
                }
              }}
              className={`group relative flex items-center gap-2 px-3 text-xs border-r border-zinc-200 cursor-pointer transition-colors max-w-[200px] min-w-[100px] ${
                isActive
                  ? 'bg-white text-zinc-900 font-semibold border-t-2 border-t-zinc-600 shadow-2xs z-10'
                  : 'bg-zinc-100/50 text-zinc-500 hover:bg-white/80 hover:text-zinc-800 border-t-2 border-t-transparent'
              }`}
            >
              {getTabIcon(fileName)}
              <span className="truncate flex-1 font-mono text-[11px]">{fileName}</span>

              {/* Dirty unsaved dot or close button */}
              <div className="flex items-center justify-center w-4 h-4 ml-1">
                {isDirty ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(filePath);
                    }}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-zinc-200 text-zinc-400 hover:text-zinc-700"
                    title="Close tab (Unsaved changes)"
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 group-hover:hidden" />
                    <X className="w-3 h-3 hidden group-hover:block" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(filePath);
                    }}
                    className="w-3.5 h-3.5 rounded flex items-center justify-center text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Actions Strip */}
      <div className="flex items-center gap-1 px-2 border-l border-zinc-200 bg-zinc-100/70 shrink-0">

        {onToggleAi && (
          <button
            type="button"
            onClick={onToggleAi}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
              isAiOpen
                ? 'bg-zinc-600 text-white shadow-2xs'
                : 'text-zinc-700 bg-zinc-50/80 hover:bg-zinc-100 hover:text-zinc-800'
            }`}
            title="Toggle AI Coding Assistant"
          >
            <Sparkles className="w-3 h-3 text-current" />
            <span className="hidden sm:inline">AI Assistant</span>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-white transition-colors cursor-pointer"
            title="Quick File Search (Ctrl+P)"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default EditorTabs;
