import { useRef, useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { X, FileCode } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { useEditor } from '../../hooks/useEditor';
import { cn, getFileLanguage } from '../../utils/helpers';

export function CodePanel() {
  const { 
    activeFile, 
    openFiles, 
    unsavedChanges, 
    setActiveFile, 
    closeFile, 
    updateFileContent,
    getFileContent
  } = useEditor();
  
  const monaco = useMonaco();
  const editorRef = useRef(null);

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme('veave-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#09090b', // zinc-950
          'editor.lineHighlightBackground': '#18181b', // zinc-900
          'editorLineNumber.foreground': '#52525b', // zinc-500
          'editorIndentGuide.background': '#27272a', // zinc-800
          'editorIndentGuide.activeBackground': '#3f3f46', // zinc-700
        },
      });
      monaco.editor.setTheme('veave-dark');
    }
  }, [monaco]);

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white text-zinc-400 h-full min-h-0">
        <FileCode className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm">Select a file from the explorer to edit</p>
      </div>
    );
  }

  const content = getFileContent(activeFile);
  const language = getFileLanguage(activeFile);

  return (
    <div className="flex flex-col h-full bg-white min-h-0 min-w-0">
      {/* Tabs */}
      <div className="h-9 bg-zinc-50 border-b border-zinc-200 flex items-end overflow-x-auto px-2 gap-1 shrink-0 scrollbar-none">
        {openFiles.map((path) => {
          const isActive = activeFile === path;
          const isUnsaved = unsavedChanges[path] !== undefined;
          const filename = path.split('/').pop();

          return (
            <div
              key={path}
              onClick={() => setActiveFile(path)}
              className={cn(
                'h-8 px-3 text-xs flex items-center gap-2 rounded-t-md transition-colors cursor-pointer group min-w-[100px] max-w-[200px] select-none border-t border-x relative',
                isActive 
                  ? 'bg-white border-zinc-200 text-zinc-900 z-10 before:absolute before:-top-px before:inset-x-0 before:h-px before:bg-indigo-500' 
                  : 'bg-zinc-50 border-transparent text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50'
              )}
            >
              <span className="truncate">{filename}</span>
              {isUnsaved && <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />}
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(path);
                }}
                className={cn(
                  'p-0.5 rounded-sm shrink-0 transition-opacity ml-auto',
                  isActive ? 'opacity-100 hover:bg-zinc-200' : 'opacity-0 group-hover:opacity-100 hover:bg-zinc-300'
                )}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor */}
      <div className="flex-1 relative min-h-0 min-w-0">
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={(val) => updateFileContent(activeFile, val)}
          onMount={(editor) => { editorRef.current = editor; }}
          theme="veave-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            wordWrap: 'on',
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            cursorBlinking: 'smooth',
            tabSize: 2,
            formatOnPaste: true,
            smoothScrolling: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            scrollbar: { useShadows: false, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
          }}
        />
      </div>
    </div>
  );
}
