import React, { useEffect, useRef } from 'react';
import { 
  FileText, 
  ExternalLink, 
  Edit2, 
  Copy, 
  Trash2, 
  Files, 
  FolderPlus, 
  FilePlus 
} from 'lucide-react';

export function FileContextMenu({
  x,
  y,
  node,
  onClose,
  onOpen,
  onOpenNewTab,
  onRename,
  onDuplicate,
  onDelete,
  onCopyPath,
  onNewFileInside,
  onNewFolderInside
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!node) return null;

  const isFolder = node.type === 'folder';

  // Ensure menu does not spill over screen boundaries
  const adjustedX = Math.min(x, window.innerWidth - 210);
  const adjustedY = Math.min(y, window.innerHeight - 250);

  return (
    <div
      ref={menuRef}
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
      className="fixed z-50 w-52 bg-white border border-zinc-200 rounded-xl shadow-xl py-1 text-xs text-zinc-700 select-none animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 truncate border-b border-zinc-100 mb-1">
        {node.path}
      </div>

      {!isFolder ? (
        <>
          <button
            type="button"
            onClick={() => { onOpen(node); onClose(); }}
            className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-zinc-400" />
            <span>Open</span>
          </button>
          <button
            type="button"
            onClick={() => { onOpenNewTab(node); onClose(); }}
            className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
            <span>Open in Tab</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => { onNewFileInside(node); onClose(); }}
            className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
          >
            <FilePlus className="w-3.5 h-3.5 text-zinc-400" />
            <span>New File Inside...</span>
          </button>
          <button
            type="button"
            onClick={() => { onNewFolderInside(node); onClose(); }}
            className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
            <span>New Folder Inside...</span>
          </button>
        </>
      )}

      <div className="my-1 border-t border-zinc-100" />

      <button
        type="button"
        onClick={() => { onRename(node); onClose(); }}
        className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
      >
        <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
        <span>Rename</span>
      </button>

      <button
        type="button"
        onClick={() => { onDuplicate(node); onClose(); }}
        className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
      >
        <Files className="w-3.5 h-3.5 text-zinc-400" />
        <span>Duplicate</span>
      </button>

      <button
        type="button"
        onClick={() => { onCopyPath(node); onClose(); }}
        className="w-full px-3 py-1.5 hover:bg-zinc-50 flex items-center gap-2.5 text-left text-zinc-800 cursor-pointer transition-colors"
      >
        <Copy className="w-3.5 h-3.5 text-zinc-400" />
        <span>Copy Relative Path</span>
      </button>

      <div className="my-1 border-t border-zinc-100" />

      <button
        type="button"
        onClick={() => { onDelete(node); onClose(); }}
        className="w-full px-3 py-1.5 hover:bg-rose-50 text-rose-600 flex items-center gap-2.5 text-left cursor-pointer transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
        <span>Delete</span>
      </button>
    </div>
  );
}

export default FileContextMenu;
