import { useProjectStore } from '../store/projectStore';

export function useProject() {
  return useProjectStore();
}
