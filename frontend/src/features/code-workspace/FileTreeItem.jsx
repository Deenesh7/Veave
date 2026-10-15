import React from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileJson, 
  FileText, 
  FileImage, 
  File 
} from 'lucide-react';

function getRestrainedFileIcon(fileName) {
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
    case 'webp':
      return <FileImage className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />;
  }
}

export function FileTreeItem({
  node,
  depth = 0,
  activeFilePath,
  unsavedMap = {},
  onSelectFile,
  onContextMenu,
  expandedFolders,
  onToggleFolder
}) {
  const isFolder = node.type === 'folder';
  const isExpanded = isFolder ? !!expandedFolders[node.path] : false;
  const isActive = !isFolder && activeFilePath === node.path;
  const isDirty = !isFolder && unsavedMap[node.path] !== undefined;

  const paddingLeft = depth * 14 + 10;

  if (isFolder) {
    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => onToggleFolder(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, node);
          }}
          className="group flex items-center gap-1.5 h-7 px-2 cursor-pointer hover:bg-zinc-100/70 transition-colors select-none text-zinc-600 hover:text-zinc-900 rounded-md mx-1"
        >
          <span className="w-3.5 h-3.5 flex items-center justify-center text-zinc-400 group-hover:text-zinc-600 transition-transform duration-150">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </span>

          {isExpanded ? (
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
          )}

          <span className="text-xs font-medium truncate">{node.name}</span>
        </div>

        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                unsavedMap={unsavedMap}
                onSelectFile={onSelectFile}
                onContextMenu={onContextMenu}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      style={{ paddingLeft: `${paddingLeft + 12}px` }}
      onClick={() => onSelectFile(node.path)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, node);
      }}
      className={`group flex items-center justify-between h-7 px-2 pr-3 cursor-pointer transition-colors select-none text-xs rounded-md mx-1 ${
        isActive
          ? 'bg-zinc-50/90 text-zinc-700 font-semibold border-l-2 border-zinc-600'
          : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100/70'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {getRestrainedFileIcon(node.name)}
        <span className="truncate">{node.name}</span>
      </div>

      {isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 ml-1.5"
          title="Unsaved changes"
        />
      )}
    </div>
  );
}

export default FileTreeItem;
