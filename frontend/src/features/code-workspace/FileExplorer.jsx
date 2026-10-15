import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  MoreVertical, 
  FolderPlus, 
  FilePlus, 
  FolderTree, 
  RotateCw,
  FolderGit2
} from 'lucide-react';
import { FileSearch } from './FileSearch';
import { FileTree } from './FileTree';
import { FileContextMenu } from './FileContextMenu';

export function FileExplorer({
  projectName = 'workspace-project',
  files = [],
  activeFilePath,
  unsavedMap = {},
  expandedFolders,
  onToggleFolder,
  onCollapseAll,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onDuplicateFile,
  onDeleteNode,
  onCopyPath
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, node }

  // Modals / Dialog state
  const [newItemModal, setNewItemModal] = useState({ isOpen: false, type: 'file', parentPath: '' });
  const [newItemName, setNewItemName] = useState('');

  const [renameModal, setRenameModal] = useState({ isOpen: false, node: null, newName: '' });
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ isOpen: false, node: null });

  const plusMenuRef = useRef(null);
  const optionsMenuRef = useRef(null);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target)) {
        setPlusMenuOpen(false);
      }
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target)) {
        setOptionsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleOpenContextMenu = (e, node) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node
    });
  };

  const handleStartCreateItem = (type, parentPath = '') => {
    setNewItemModal({ isOpen: true, type, parentPath });
    setNewItemName('');
    setPlusMenuOpen(false);
  };

  const handleConfirmCreateItem = (e) => {
    e?.preventDefault();
    const cleanName = newItemName.trim();
    if (!cleanName) return;

    const fullPath = newItemModal.parentPath
      ? `${newItemModal.parentPath}/${cleanName}`
      : cleanName;

    if (newItemModal.type === 'file') {
      onCreateFile(fullPath);
    } else {
      onCreateFolder(fullPath);
    }
    setNewItemModal({ isOpen: false, type: 'file', parentPath: '' });
    setNewItemName('');
  };

  const handleStartRename = (node) => {
    setRenameModal({ isOpen: true, node, newName: node.name });
  };

  const handleConfirmRename = (e) => {
    e?.preventDefault();
    const cleanName = renameModal.newName.trim();
    if (!cleanName || !renameModal.node) return;

    onRenameNode(renameModal.node, cleanName);
    setRenameModal({ isOpen: false, node: null, newName: '' });
  };

  const handleStartDelete = (node) => {
    setDeleteConfirmModal({ isOpen: true, node });
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmModal.node) {
      onDeleteNode(deleteConfirmModal.node);
    }
    setDeleteConfirmModal({ isOpen: false, node: null });
  };

  // Formatted root project label
  const formattedProjectName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return (
    <aside className="w-64 sm:w-72 bg-[#FAFBFD] border-r border-[#E2E5E8] flex flex-col h-full shrink-0 select-none text-zinc-700 font-sans">
      {/* 1. Header Toolbar */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#E2E5E8] shrink-0 bg-white">
        <span className="text-[10px] font-bold tracking-wider uppercase text-zinc-400">
          Explorer
        </span>

        <div className="flex items-center gap-1">
          {/* "+" New File / Folder Dropdown */}
          <div className="relative" ref={plusMenuRef}>
            <button
              type="button"
              onClick={() => setPlusMenuOpen(!plusMenuOpen)}
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="New File or Folder"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

            {plusMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-zinc-200 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5">
                <button
                  type="button"
                  onClick={() => handleStartCreateItem('file')}
                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-50 flex items-center gap-2 text-zinc-700 cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5 text-zinc-400" />
                  <span>New File</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleStartCreateItem('folder')}
                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-50 flex items-center gap-2 text-zinc-700 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-zinc-400" />
                  <span>New Folder</span>
                </button>
              </div>
            )}
          </div>

          {/* Three-dot Options */}
          <div className="relative" ref={optionsMenuRef}>
            <button
              type="button"
              onClick={() => setOptionsMenuOpen(!optionsMenuOpen)}
              className="p-1 rounded text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors cursor-pointer"
              title="More Explorer Actions"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {optionsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-zinc-200 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-100 ring-1 ring-black/5">
                <button
                  type="button"
                  onClick={() => {
                    onCollapseAll?.();
                    setOptionsMenuOpen(false);
                  }}
                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-50 flex items-center gap-2 text-zinc-700 cursor-pointer"
                >
                  <FolderTree className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Collapse All</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOptionsMenuOpen(false)}
                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-zinc-50 flex items-center gap-2 text-zinc-700 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Refresh Tree</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 2. Search Field */}
      <FileSearch
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
      />

      {/* 3. Project Root Section */}
      <div className="px-3 py-1.5 border-b border-[#E2E5E8] flex items-center gap-2 bg-zinc-50/70">
        <FolderGit2 className="w-3.5 h-3.5 text-zinc-600" />
        <span className="text-[11px] font-bold text-zinc-800 truncate font-mono">
          {formattedProjectName}/
        </span>
      </div>

      {/* 4. Interactive File Tree View */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-zinc-200 scrollbar-track-transparent">
        <FileTree
          files={files}
          searchQuery={searchQuery}
          activeFilePath={activeFilePath}
          unsavedMap={unsavedMap}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          onSelectFile={onSelectFile}
          onContextMenu={handleOpenContextMenu}
        />
      </div>

      {/* Context Menu Popup */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          onClose={() => setContextMenu(null)}
          onOpen={(node) => onSelectFile(node.path)}
          onOpenNewTab={(node) => onSelectFile(node.path)}
          onRename={handleStartRename}
          onDuplicate={(node) => onDuplicateFile(node.path)}
          onDelete={handleStartDelete}
          onCopyPath={(node) => onCopyPath(node.path)}
          onNewFileInside={(node) => handleStartCreateItem('file', node.path)}
          onNewFolderInside={(node) => handleStartCreateItem('folder', node.path)}
        />
      )}

      {/* Create New File / Folder Modal */}
      {newItemModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmCreateItem}
            className="w-full max-w-sm bg-white border border-zinc-200 rounded-2xl shadow-2xl p-5 text-zinc-800 animate-in zoom-in-95 duration-150 ring-1 ring-black/5"
          >
            <h3 className="text-sm font-bold text-zinc-900 mb-1">
              Create New {newItemModal.type === 'file' ? 'File' : 'Folder'}
            </h3>
            <p className="text-xs text-zinc-500 mb-3">
              {newItemModal.parentPath
                ? `Under: ${newItemModal.parentPath}/`
                : 'Under project root/'}
            </p>
            <input
              type="text"
              autoFocus
              placeholder={newItemModal.type === 'file' ? 'e.g. Header.jsx or styles.css' : 'e.g. components or utils'}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 focus:border-zinc-500 focus:bg-white text-zinc-900 text-xs rounded-xl outline-none mb-4 transition-all"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewItemModal({ isOpen: false, type: 'file', parentPath: '' })}
                className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newItemName.trim()}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-zinc-600 hover:bg-zinc-700 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmRename}
            className="w-full max-w-sm bg-white border border-zinc-200 rounded-2xl shadow-2xl p-5 text-zinc-800 animate-in zoom-in-95 duration-150 ring-1 ring-black/5"
          >
            <h3 className="text-sm font-bold text-zinc-900 mb-1">
              Rename {renameModal.node?.type === 'folder' ? 'Folder' : 'File'}
            </h3>
            <p className="text-xs text-zinc-500 mb-3 truncate font-mono">
              {renameModal.node?.path}
            </p>
            <input
              type="text"
              autoFocus
              value={renameModal.newName}
              onChange={(e) => setRenameModal({ ...renameModal, newName: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 focus:border-zinc-500 focus:bg-white text-zinc-900 text-xs rounded-xl outline-none mb-4 transition-all"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameModal({ isOpen: false, node: null, newName: '' })}
                className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renameModal.newName.trim()}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-zinc-600 hover:bg-zinc-700 text-white transition-all shadow-xs cursor-pointer disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-zinc-200 rounded-2xl shadow-2xl p-6 text-zinc-800 animate-in zoom-in-95 duration-150 ring-1 ring-black/5">
            <h3 className="text-sm font-bold text-zinc-900 mb-2">
              Confirm Delete
            </h3>
            <p className="text-xs text-zinc-600 mb-5 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <span className="font-mono text-zinc-900 font-semibold bg-zinc-100 px-1 py-0.5 rounded">
                "{deleteConfirmModal.node?.name}"
              </span>
              ? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal({ isOpen: false, node: null })}
                className="px-3 py-1.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-all shadow-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default FileExplorer;
