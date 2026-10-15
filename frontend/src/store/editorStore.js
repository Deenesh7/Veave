import { create } from 'zustand';

export const useEditorStore = create((set, get) => ({
  activeFile: null,
  openFiles: [],
  unsavedChanges: {},
  viewMode: 'preview',
  previewSize: 'desktop',
  consoleOutput: [],
  showConsole: false,
  showFileExplorer: true,
  history: [],
  historyIndex: -1,

  setActiveFile: (path) => {
    const state = get();
    const openFiles = state.openFiles.includes(path)
      ? state.openFiles
      : [...state.openFiles, path];
    set({ activeFile: path, openFiles });
  },

  openFile: (file) => {
    const path = typeof file === 'string' ? file : file.path;
    const state = get();
    const openFiles = state.openFiles.includes(path)
      ? state.openFiles
      : [...state.openFiles, path];
    set({ activeFile: path, openFiles });
  },

  closeFile: (path) => {
    const state = get();
    const openFiles = state.openFiles.filter((f) => f !== path);
    const unsavedChanges = { ...state.unsavedChanges };
    delete unsavedChanges[path];
    const activeFile =
      state.activeFile === path
        ? openFiles[openFiles.length - 1] || null
        : state.activeFile;
    set({ openFiles, activeFile, unsavedChanges });
  },

  updateFileContent: (path, content) => {
    set((state) => ({
      unsavedChanges: { ...state.unsavedChanges, [path]: content },
    }));
  },

  saveFile: (path) => {
    set((state) => {
      const content = state.unsavedChanges[path];
      if (content === undefined) return state;
      const unsavedChanges = { ...state.unsavedChanges };
      delete unsavedChanges[path];
      return { unsavedChanges };
    });
  },

  setViewMode: (viewMode) => set({ viewMode }),
  setPreviewSize: (previewSize) => set({ previewSize }),

  addConsoleOutput: (output) => {
    set((state) => {
      const consoleOutput = [
        ...state.consoleOutput,
        { ...output, timestamp: output.timestamp || new Date() },
      ].slice(-200);
      return { consoleOutput };
    });
  },

  clearConsole: () => set({ consoleOutput: [] }),
  toggleConsole: () => set((s) => ({ showConsole: !s.showConsole })),
  toggleFileExplorer: () => set((s) => ({ showFileExplorer: !s.showFileExplorer })),

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      set({ historyIndex: historyIndex - 1 });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      set({ historyIndex: historyIndex + 1 });
    }
  },

  pushHistory: (snapshot) => {
    set((state) => {
      const history = [...state.history.slice(0, state.historyIndex + 1), snapshot];
      return { history, historyIndex: history.length - 1 };
    });
  },

  resetEditor: () =>
    set({
      activeFile: null,
      openFiles: [],
      unsavedChanges: {},
      viewMode: 'preview',
      previewSize: 'desktop',
      consoleOutput: [],
      showConsole: false,
      showFileExplorer: true,
      history: [],
      historyIndex: -1,
    }),
}));
