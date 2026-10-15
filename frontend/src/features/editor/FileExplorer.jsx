import { useState } from 'react';
import { PanelLeftClose, ChevronRight, Folder, FolderOpen, FileCode, FileText, FileJson, Image as ImageIcon, File } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { buildFileTree, getFileExtension } from '../../utils/fileUtils';
import { Button } from '../../components/ui/Button';
import { cn, getFileLanguage } from '../../utils/helpers';

const getIconForFile = (filename) => {
  const ext = getFileExtension(filename);
  if (['jsx', 'js', 'ts', 'tsx'].includes(ext)) return <FileCode className="w-3.5 h-3.5" />;
  if (['json', 'md', 'txt'].includes(ext)) return <FileText className="w-3.5 h-3.5" />;
  if (ext === 'json') return <FileJson className="w-3.5 h-3.5" />;
  if (['png', 'jpg', 'svg'].includes(ext)) return <ImageIcon className="w-3.5 h-3.5" />;
  return <File className="w-3.5 h-3.5" />;
};

function FileTreeNode({ node, depth = 0 }) {
  const [isExpanded, setIsExpanded] = useState(node.name === 'src' || depth === 0);
  const { activeFile, openFile } = useEditorStore();

  const isFolder = node.type === 'folder';
  const paddingLeft = depth * 12 + 8;

  if (isFolder) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 h-7 cursor-pointer hover:bg-zinc-200/50 rounded-md mx-1 transition-colors group select-none text-zinc-400 hover:text-zinc-700"
          style={{ paddingLeft }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <ChevronRight className={cn('w-3.5 h-3.5 transition-transform duration-200', isExpanded && 'rotate-90')} />
          {isExpanded ? <FolderOpen className="w-3.5 h-3.5 text-indigo-400" /> : <Folder className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-400" />}
          <span className="text-xs font-medium truncate">{node.name}</span>
        </div>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child, i) => (
              <FileTreeNode key={`${child.path}-${i}`} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = activeFile === node.path;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 h-7 cursor-pointer mx-1 transition-colors select-none rounded-md',
        isActive ? 'bg-indigo-500/10 text-indigo-300' : 'hover:bg-zinc-200/50 text-zinc-400 hover:text-zinc-700'
      )}
      style={{ paddingLeft: paddingLeft + 20 }}
      onClick={() => openFile({ path: node.path, content: node.content, language: getFileLanguage(node.path) })}
    >
      <div className={cn(isActive ? 'text-indigo-400' : 'text-zinc-500')}>
        {getIconForFile(node.name)}
      </div>
      <span className="text-xs truncate">{node.name}</span>
    </div>
  );
}

export function FileExplorer() {
  const { showFileExplorer, toggleFileExplorer } = useEditorStore();
  const currentProject = useProjectStore((s) => s.currentProject);

  if (!showFileExplorer) return null;

  const files = currentProject?.files || [];
  const tree = buildFileTree(files);

  return (
    <div className="w-60 bg-zinc-50/50 border-r border-zinc-200 flex flex-col h-full shrink-0">
      <div className="h-9 px-3 flex items-center justify-between border-b border-zinc-200 shrink-0">
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Explorer</span>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-500 hover:text-zinc-700" onClick={toggleFileExplorer} icon={PanelLeftClose} />
      </div>
      
      <div className="flex-1 overflow-y-auto py-2 overflow-x-hidden">
        {tree.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">
            No files in project
          </div>
        ) : (
          tree.map((node, i) => <FileTreeNode key={`root-${i}`} node={node} />)
        )}
      </div>
    </div>
  );
}
