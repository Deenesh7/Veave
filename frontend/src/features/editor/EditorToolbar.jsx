import { useState } from 'react';
import { useSmartBack } from '../../hooks/useSmartBack';
import { 
  ArrowLeft, 
  Eye, 
  Code2, 
  Columns, 
  Monitor, 
  Tablet, 
  Smartphone, 
  Undo2, 
  Redo2, 
  Download, 
  MessageSquare,
  History,
  RotateCw
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { Separator } from '../../components/ui/Separator';
import { VersionHistory } from './VersionHistory';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { useUIStore } from '../../store/uiStore';
import { projectService } from '../../services/projectService';
import { cn } from '../../utils/helpers';

export function EditorToolbar() {
  const goBack = useSmartBack('/dashboard');
  const [historyOpen, setHistoryOpen] = useState(false);
  const currentProject = useProjectStore((s) => s.currentProject);
  const { viewMode, setViewMode, previewSize, setPreviewSize, history, historyIndex, undo, redo } = useEditorStore();
  const { agentPanelOpen, toggleAgentPanel } = useUIStore();

  const handleExport = async () => {
    if (!currentProject?._id) return;
    try {
      const res = await projectService.exportProject(currentProject._id);
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject.name || 'project'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  return (
    <div className="h-11 bg-zinc-50 border-b border-zinc-200 px-2 flex items-center gap-1 shrink-0">
      <div className="flex items-center gap-2">
        <Tooltip content="Back to Dashboard">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goBack} icon={ArrowLeft} />
        </Tooltip>
        <Separator orientation="vertical" className="h-5 mx-1" />
        <div className="text-sm font-medium text-zinc-700 truncate max-w-[200px]">
          {currentProject?.name || 'Loading...'}
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="flex items-center bg-zinc-200 rounded-md p-0.5">
          <Tooltip content="Preview">
            <button
              onClick={() => setViewMode('preview')}
              className={cn('h-7 w-7 rounded flex items-center justify-center transition-colors', viewMode === 'preview' ? 'bg-zinc-300 text-zinc-900' : 'text-zinc-500 hover:text-zinc-700')}
            >
              <Eye className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip content="Code">
            <button
              onClick={() => setViewMode('code')}
              className={cn('h-7 w-7 rounded flex items-center justify-center transition-colors', viewMode === 'code' ? 'bg-zinc-300 text-zinc-900' : 'text-zinc-500 hover:text-zinc-700')}
            >
              <Code2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip content="Split">
            <button
              onClick={() => setViewMode('split')}
              className={cn('h-7 w-7 rounded flex items-center justify-center transition-colors', viewMode === 'split' ? 'bg-zinc-300 text-zinc-900' : 'text-zinc-500 hover:text-zinc-700')}
            >
              <Columns className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {viewMode !== 'code' && (
          <>
            <Separator orientation="vertical" className="h-5 mx-1" />
            <div className="flex items-center gap-1">
              <Tooltip content="Desktop">
                <Button variant="ghost" size="icon" className={cn('h-7 w-7', previewSize === 'desktop' ? 'text-indigo-400' : 'text-zinc-500')} onClick={() => setPreviewSize('desktop')} icon={Monitor} />
              </Tooltip>
              <Tooltip content="Tablet">
                <Button variant="ghost" size="icon" className={cn('h-7 w-7', previewSize === 'tablet' ? 'text-indigo-400' : 'text-zinc-500')} onClick={() => setPreviewSize('tablet')} icon={Tablet} />
              </Tooltip>
              <Tooltip content="Mobile">
                <Button variant="ghost" size="icon" className={cn('h-7 w-7', previewSize === 'mobile' ? 'text-indigo-400' : 'text-zinc-500')} onClick={() => setPreviewSize('mobile')} icon={Smartphone} />
              </Tooltip>
            </div>
          </>
        )}

        <Separator orientation="vertical" className="h-5 mx-1" />
        
        <div className="flex items-center gap-1">
          <Tooltip content="Undo">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" disabled={historyIndex <= 0} onClick={undo} icon={Undo2} />
          </Tooltip>
          <Tooltip content="Redo">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400" disabled={historyIndex >= history.length - 1} onClick={redo} icon={Redo2} />
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />
        
        <Tooltip content="Version History">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-zinc-400 hover:text-zinc-900" 
            onClick={() => setHistoryOpen(true)} 
            icon={History} 
          />
        </Tooltip>

        <Tooltip content="Export Project (.zip)">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-900" onClick={handleExport} icon={Download} />
        </Tooltip>
        
        <Tooltip content="Toggle AI Assistant">
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn('h-7 w-7 transition-colors', agentPanelOpen ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-400')} 
            onClick={toggleAgentPanel} 
            icon={MessageSquare} 
          />
        </Tooltip>
      </div>

      {/* Version History Modal */}
      {currentProject?._id && (
        <VersionHistory
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          projectId={currentProject._id}
        />
      )}
    </div>
  );
}
