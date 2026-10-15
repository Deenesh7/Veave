import { create } from 'zustand';

export const useVisualEditorStore = create((set, get) => ({
  // Active selected element inside the preview canvas
  selectedElement: null,
  hoveredElement: null,

  // Mode: 'editor' (Visual Edit) | 'preview' | 'screens' | 'code'
  activeMode: 'editor',
  activeCodeFile: 'src/App.jsx',

  // Viewport device sizing: 'desktop' | 'tablet' | 'mobile'
  viewport: 'desktop',

  // Responsive editing scope: 'desktop' | 'tablet' | 'mobile'
  responsiveMode: 'desktop',

  // Current simulated route / page
  activeRoute: 'Home',
  routes: ['Home'],

  // Layers / Element Tree
  isLayersOpen: false,
  layersTree: [],

  // Collapsible inspector sections state
  collapsedSections: {
    typography: false,
    colors: false,
    border: false,
    layout: false,
    autoLayout: false,
    spacing: false,
    elementSpecific: false,
  },

  // Undo / Redo history
  history: [],
  historyIndex: -1,

  // Unsaved / Saved tracking
  isDirty: false,
  saveStatus: 'idle', // 'idle' | 'saving' | 'saved'

  // Actions
  setSelectedElement: (element) => set({ selectedElement: element }),
  updateSelectedElementRect: (rect) => set((s) => ({
    selectedElement: s.selectedElement ? { ...s.selectedElement, rect } : null
  })),
  setHoveredElement: (element) => set({ hoveredElement: element }),

  setActiveMode: (mode) => set({ activeMode: mode }),
  setActiveCodeFile: (file) => set({ activeCodeFile: file }),
  setViewport: (vp) => set({ viewport: vp }),
  setResponsiveMode: (rm) => set({ responsiveMode: rm }),
  setActiveRoute: (route) => set({ activeRoute: route }),
  addRoute: (route) => set((s) => {
    if (s.routes.includes(route)) return { activeRoute: route };
    return { routes: [...s.routes, route], activeRoute: route };
  }),
  removeRoute: (route) => set((s) => {
    const next = s.routes.filter(r => r !== route);
    return {
      routes: next.length > 0 ? next : ['Home'],
      activeRoute: s.activeRoute === route ? (next[0] || 'Home') : s.activeRoute
    };
  }),

  toggleLayers: () => set((s) => ({ isLayersOpen: !s.isLayersOpen })),
  setLayersOpen: (open) => set({ isLayersOpen: open }),
  setLayersTree: (tree) => set({ layersTree: tree }),

  toggleSection: (section) =>
    set((s) => ({
      collapsedSections: {
        ...s.collapsedSections,
        [section]: !s.collapsedSections[section],
      },
    })),

  // Apply a visual style to the currently selected element
  updateElementStyle: (property, value) => {
    const { selectedElement, history, historyIndex } = get();
    if (!selectedElement) return;

    const prevStyles = { ...(selectedElement.computedStyles || {}) };
    const prevVal = prevStyles[property];
    const newStyles = { ...prevStyles, [property]: value };

    // Record in history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      type: 'style',
      elementId: selectedElement.elementId,
      selector: selectedElement.selector,
      property,
      prevVal,
      newVal: value,
      timestamp: Date.now(),
    });

    set({
      selectedElement: {
        ...selectedElement,
        computedStyles: newStyles,
      },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      saveStatus: 'idle',
    });
  },

  // Apply text change to the currently selected element
  updateElementText: (newText) => {
    const { selectedElement, history, historyIndex } = get();
    if (!selectedElement) return;

    const prevText = selectedElement.text || '';
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      type: 'text',
      elementId: selectedElement.elementId,
      selector: selectedElement.selector,
      prevVal: prevText,
      newVal: newText,
      timestamp: Date.now(),
    });

    set({
      selectedElement: {
        ...selectedElement,
        text: newText,
      },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      saveStatus: 'idle',
    });
  },

  // Apply attribute change (e.g. src, alt, href)
  updateElementAttribute: (attr, value) => {
    const { selectedElement, history, historyIndex } = get();
    if (!selectedElement) return;

    const prevAttrs = { ...(selectedElement.attributes || {}) };
    const prevVal = prevAttrs[attr];
    const newAttrs = { ...prevAttrs, [attr]: value };

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      type: 'attribute',
      elementId: selectedElement.elementId,
      selector: selectedElement.selector,
      sourceFile: selectedElement.sourceFile,
      sourceLine: selectedElement.sourceLine,
      attribute: attr,
      prevVal,
      newVal: value,
      timestamp: Date.now(),
    });

    set({
      selectedElement: {
        ...selectedElement,
        attributes: newAttrs,
      },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      saveStatus: 'idle',
    });
  },

  // Record an arbitrary action (e.g. deletion, badge insertion)
  recordAction: (action) => {
    const { history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({
      ...action,
      timestamp: Date.now(),
    });
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      saveStatus: 'idle',
    });
  },

  // Undo / Redo with live selectedElement state sync
  undo: () => {
    const { history, historyIndex, selectedElement } = get();
    if (historyIndex < 0) return null;
    const action = history[historyIndex];

    let updatedSelected = selectedElement;
    if (selectedElement && selectedElement.elementId === action.elementId) {
      if (action.type === 'style') {
        const nextStyles = { ...(selectedElement.computedStyles || {}) };
        if (action.prevVal !== undefined && action.prevVal !== null) {
          nextStyles[action.property] = action.prevVal;
        } else {
          delete nextStyles[action.property];
        }
        updatedSelected = { ...selectedElement, computedStyles: nextStyles };
      } else if (action.type === 'text') {
        updatedSelected = { ...selectedElement, text: action.prevVal };
      } else if (action.type === 'attribute') {
        const nextAttrs = { ...(selectedElement.attributes || {}) };
        nextAttrs[action.attribute] = action.prevVal;
        updatedSelected = { ...selectedElement, attributes: nextAttrs };
      }
    }

    set({ 
      historyIndex: historyIndex - 1, 
      selectedElement: updatedSelected,
      isDirty: true 
    });
    return action;
  },

  redo: () => {
    const { history, historyIndex, selectedElement } = get();
    if (historyIndex >= history.length - 1) return null;
    const nextAction = history[historyIndex + 1];

    let updatedSelected = selectedElement;
    if (selectedElement && selectedElement.elementId === nextAction.elementId) {
      if (nextAction.type === 'style') {
        const nextStyles = { ...(selectedElement.computedStyles || {}) };
        nextStyles[nextAction.property] = nextAction.newVal;
        updatedSelected = { ...selectedElement, computedStyles: nextStyles };
      } else if (nextAction.type === 'text') {
        updatedSelected = { ...selectedElement, text: nextAction.newVal };
      } else if (nextAction.type === 'attribute') {
        const nextAttrs = { ...(selectedElement.attributes || {}) };
        nextAttrs[nextAction.attribute] = nextAction.newVal;
        updatedSelected = { ...selectedElement, attributes: nextAttrs };
      }
    }

    set({ 
      historyIndex: historyIndex + 1, 
      selectedElement: updatedSelected,
      isDirty: true 
    });
    return nextAction;
  },

  canUndo: () => get().historyIndex >= 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  setSaveStatus: (status) => set({ saveStatus: status, isDirty: status !== 'saved' }),
  resetDirty: () => set({ isDirty: false, saveStatus: 'saved' }),
}));
