import React, { useEffect } from 'react';
import { useVisualEditorStore } from './visualEditorStore';

export function ElementSelector({
  onSelectParent,
  onDeleteSelected,
  onDuplicateSelected,
  onUndo,
  onRedo
}) {
  const { selectedElement, setSelectedElement } = useVisualEditorStore();

  // Keyboard navigation & element manipulation shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts if user is typing inside an input/textarea/select
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable) return;

      // Undo: Ctrl+Z / Cmd+Z (without shift)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (onUndo) onUndo();
        return;
      }

      // Redo: Ctrl+Shift+Z / Cmd+Shift+Z or Ctrl+Y
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (onRedo) onRedo();
        return;
      }

      // Escape -> Select parent element or deselect
      if (e.key === 'Escape') {
        if (onSelectParent && selectedElement) {
          onSelectParent();
        } else {
          setSelectedElement(null);
        }
      }

      // Delete / Backspace -> Delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElement) {
        e.preventDefault();
        if (onDeleteSelected) onDeleteSelected();
      }

      // Ctrl+D or Cmd+D -> Duplicate selected element
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedElement) {
        e.preventDefault();
        if (onDuplicateSelected) onDuplicateSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, onSelectParent, onDeleteSelected, onDuplicateSelected, onUndo, onRedo, setSelectedElement]);

  return null;
}

export default ElementSelector;
