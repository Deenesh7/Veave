import React, { useState, useEffect, useRef } from 'react';
import { Search, FileCode, FileJson, FileText, FileImage, File, CornerDownLeft } from 'lucide-react';

function getFileIcon(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jsx':
    case 'js':
    case 'tsx':
    case 'ts':
    case 'html':
      return <FileCode className="w-4 h-4 text-zinc-600" />;
    case 'css':
    case 'scss':
      return <FileCode className="w-4 h-4 text-sky-500" />;
    case 'json':
      return <FileJson className="w-4 h-4 text-amber-500" />;
    case 'md':
    case 'txt':
      return <FileText className="w-4 h-4 text-zinc-500" />;
    case 'svg':
    case 'png':
    case 'jpg':
      return <FileImage className="w-4 h-4 text-indigo-500" />;
    default:
      return <File className="w-4 h-4 text-zinc-400" />;
  }
}

export function CommandPalette({
  isOpen,
  onClose,
  files = [],
  onSelectFile
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  // Filter files
  const filteredFiles = files.filter((f) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return f.path.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filteredFiles.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredFiles.length) % (filteredFiles.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredFiles[selectedIndex]) {
          onSelectFile(filteredFiles[selectedIndex].path);
          onClose();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredFiles, selectedIndex, onSelectFile, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-zinc-200 gap-3 bg-white">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a file name to open... (e.g. App.jsx)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none font-medium"
            spellCheck={false}
          />
          <kbd className="px-2 py-0.5 rounded-lg bg-zinc-100 border border-zinc-200 text-[10px] font-mono text-zinc-500 font-semibold">
            ESC
          </kbd>
        </div>

        {/* File Result List */}
        <div className="max-h-72 overflow-y-auto py-1.5 scrollbar-thin scrollbar-thumb-zinc-200">
          {filteredFiles.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400">
              No files found matching "{query}"
            </div>
          ) : (
            filteredFiles.map((file, idx) => {
              const isSelected = idx === selectedIndex;
              const fileName = file.path.split('/').pop();
              const dirPath = file.path.split('/').slice(0, -1).join('/');

              return (
                <div
                  key={file.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onSelectFile(file.path);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`px-4 py-2.5 flex items-center justify-between cursor-pointer text-xs transition-colors ${
                    isSelected ? 'bg-zinc-50 text-zinc-900 font-medium' : 'text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {getFileIcon(file.path)}
                    <span className="font-semibold text-zinc-900 truncate">{fileName}</span>
                    {dirPath && (
                      <span className="text-[11px] text-zinc-400 truncate font-mono">
                        {dirPath}/
                      </span>
                    )}
                  </div>

                  {isSelected && (
                    <span className="flex items-center gap-1 text-[10px] text-zinc-600 shrink-0 font-mono font-bold">
                      <span>Open</span>
                      <CornerDownLeft className="w-3 h-3" />
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Hint */}
        <div className="px-4 py-2 border-t border-zinc-100 bg-zinc-50 flex items-center justify-between text-[11px] text-zinc-500">
          <span>Use ↑ ↓ to navigate</span>
          <span>Press ↵ to select</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
