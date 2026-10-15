import React, { useMemo } from 'react';
import { FileTreeItem } from './FileTreeItem';
import { buildFileTree } from '../../utils/fileUtils';

// Helper to filter tree by search query
function filterTreeNodes(nodes, query) {
  if (!query) return nodes;
  const q = query.toLowerCase();

  const filtered = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
        filtered.push(node);
      }
    } else if (node.type === 'folder') {
      const matchingChildren = filterTreeNodes(node.children || [], query);
      if (matchingChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        filtered.push({
          ...node,
          children: matchingChildren
        });
      }
    }
  }
  return filtered;
}

export function FileTree({
  files = [],
  searchQuery = '',
  activeFilePath,
  unsavedMap = {},
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  onContextMenu
}) {
  const tree = useMemo(() => {
    const rawTree = buildFileTree(files);
    if (!searchQuery.trim()) return rawTree;
    return filterTreeNodes(rawTree, searchQuery.trim());
  }, [files, searchQuery]);

  if (tree.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-[#7D8491]">
        {searchQuery ? `No files matching "${searchQuery}"` : 'No files in project'}
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          activeFilePath={activeFilePath}
          unsavedMap={unsavedMap}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          onSelectFile={onSelectFile}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export default FileTree;
