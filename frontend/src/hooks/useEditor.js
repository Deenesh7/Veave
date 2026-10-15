import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';

export function useEditor() {
  const store = useEditorStore();
  const currentProject = useProjectStore((state) => state.currentProject);

  const getFileContent = (path) => {
    if (!path) return '';
    if (store.unsavedChanges[path] !== undefined) {
      return store.unsavedChanges[path];
    }
    const file = currentProject?.files?.find((f) => f.path === path);
    return file?.content || '';
  };

  return {
    ...store,
    getFileContent,
  };
}
