import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { 
  FileCode, 
  Copy, 
  Check, 
  Sliders, 
  Code2,
  FolderTree
} from 'lucide-react';
import { useVisualEditorStore } from './visualEditorStore';

export function CodeEditor({ files = [] }) {
  const { setActiveMode, activeCodeFile, setActiveCodeFile } = useVisualEditorStore();
  const [copied, setCopied] = useState(false);

  // Normalize files
  const availableFiles = files && files.length > 0 ? files : [
    {
      path: 'src/App.jsx',
      content: '// src/App.jsx\nexport default function App() {\n  return <div>Loading source code...</div>;\n}'
    }
  ];

  const currentFile = availableFiles.find(f => f.path === activeCodeFile) 
    || availableFiles.find(f => f.path.endsWith(activeCodeFile?.split('/').pop() || ''))
    || availableFiles[0];

  const handleCopy = () => {
    if (!currentFile?.content) return;
    navigator.clipboard.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const inferLanguage = (path) => {
    if (!path) return 'javascript';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.html')) return 'html';
    return 'javascript';
  };

  return (
    <div className="flex-1 w-full h-full bg-[#09090B] flex flex-col min-h-0 select-none">
      {/* Code Header Bar */}
      <div className="h-11 border-b border-zinc-800 px-4 bg-zinc-950 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono mr-2">
            <Code2 className="w-4 h-4 text-zinc-400" />
            <span className="font-bold text-zinc-300">Code View</span>
          </div>

          {/* File Tabs */}
          {availableFiles.map((file) => {
            const isActive = file.path === currentFile?.path;
            const fileName = file.path.split('/').pop();
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setActiveCodeFile(file.path)}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-zinc-800 text-white border border-zinc-700 shadow-xs'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-zinc-400" />
                <span>{fileName}</span>
              </button>
            );
          })}
        </div>

        {/* Right Actions: Copy & Return to Visual Edit */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors cursor-pointer"
            title="Copy file contents"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode('editor')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-zinc-600 hover:bg-zinc-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Return to Visual Edit</span>
          </button>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="flex-1 w-full h-full min-h-0 relative">
        <Editor
          height="100%"
          language={inferLanguage(currentFile?.path)}
          value={currentFile?.content || ''}
          theme="vs-dark"
          options={{
            readOnly: false,
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            fontFamily: "'Geist Mono', 'Fira Code', Menlo, Monaco, monospace",
          }}
        />
      </div>
    </div>
  );
}

export default CodeEditor;
