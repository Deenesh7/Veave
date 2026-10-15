import React, { useRef, useEffect } from 'react';
import Editor, { useMonaco } from '@monaco-editor/react';
import { FileCode, Command } from 'lucide-react';

const VEAVE_LIGHT_THEME = 'veave-ide-light';

function inferMonacoLanguage(path = '') {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jsx':
    case 'tsx':
    case 'js':
    case 'ts':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

export function CodeEditor({
  activeFile,
  content = '',
  onChange,
  onSave,
  onCursorChange,
  onOpenCommandPalette
}) {
  const monaco = useMonaco();
  const editorRef = useRef(null);

  // Register clean light theme blending with VEAVE background
  useEffect(() => {
    if (!monaco) return;

    monaco.editor.defineTheme(VEAVE_LIGHT_THEME, {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '94A3B8', fontStyle: 'italic' },
        { token: 'keyword', foreground: '2563EB', fontStyle: 'bold' },
        { token: 'string', foreground: '16A34A' },
        { token: 'number', foreground: 'D97706' },
        { token: 'type', foreground: '0891B2' },
        { token: 'class', foreground: '2563EB' },
        { token: 'function', foreground: '1D4ED8' },
        { token: 'variable', foreground: '0F172A' },
        { token: 'tag', foreground: 'DC2626' },
        { token: 'attribute.name', foreground: '7C3AED' },
        { token: 'delimiter', foreground: '64748B' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#0F172A',
        'editor.lineHighlightBackground': '#F8FAFC',
        'editorLineNumber.foreground': '#94A3B8',
        'editorLineNumber.activeForeground': '#1E293B',
        'editorIndentGuide.background': '#E2E8F0',
        'editorIndentGuide.activeBackground': '#CBD5E1',
        'editor.selectionBackground': '#E4E4E7',
        'editorCursor.foreground': '#18181B',
        'scrollbarSlider.background': '#CBD5E180',
        'scrollbarSlider.hoverBackground': '#94A3B8',
        'scrollbarSlider.activeBackground': '#64748B',
      },
    });

    monaco.editor.setTheme(VEAVE_LIGHT_THEME);
  }, [monaco]);

  const handleEditorDidMount = (editor, monacoInstance) => {
    editorRef.current = editor;

    // Track cursor movement
    editor.onDidChangeCursorPosition((e) => {
      const position = e.position;
      const selection = editor.getSelection();
      let selectionLength = 0;
      if (selection && !selection.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          selectionLength = model.getValueInRange(selection).length;
        }
      }
      onCursorChange?.({
        line: position.lineNumber,
        col: position.column,
        selectionLength
      });
    });

    // Keyboard shortcut bindings within Monaco instance
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
      onSave?.();
    });

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyP, () => {
      onOpenCommandPalette?.();
    });
  };

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white text-zinc-500 p-6 select-none">
        <div className="w-14 h-14 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-center text-zinc-600 mb-4 shadow-2xs">
          <FileCode className="w-7 h-7" />
        </div>
        <h3 className="text-sm font-bold text-zinc-900 mb-1">No File Open</h3>
        <p className="text-xs text-zinc-500 max-w-xs text-center mb-4 leading-relaxed">
          Select a file from the explorer on the left or press{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-800 font-mono text-[10px]">
            Ctrl + P
          </kbd>{' '}
          to quick open.
        </p>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-xs font-semibold text-white transition-all shadow-xs cursor-pointer"
        >
          <Command className="w-3.5 h-3.5 text-zinc-300" />
          <span>Quick Open File (Ctrl+P)</span>
        </button>
      </div>
    );
  }

  const language = inferMonacoLanguage(activeFile);

  return (
    <div className="flex-1 w-full h-full min-h-0 relative bg-white">
      <Editor
        height="100%"
        width="100%"
        language={language}
        value={content}
        onChange={(value) => onChange?.(value || '')}
        onMount={handleEditorDidMount}
        theme={VEAVE_LIGHT_THEME}
        options={{
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', monospace",
          fontLigatures: true,
          lineHeight: 21,
          lineNumbers: 'on',
          roundedSelection: true,
          scrollBeyondLastLine: false,
          minimap: { enabled: true, maxColumn: 80, scale: 0.8 },
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: 'selection',
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          bracketPairColorization: { enabled: true },
          guides: {
            indentation: true,
            bracketPairs: true
          },
          padding: { top: 12, bottom: 24 }
        }}
      />
    </div>
  );
}

export default CodeEditor;
