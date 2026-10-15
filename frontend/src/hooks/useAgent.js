import { useAgentStore } from '../store/agentStore';

export function useAgent() {
  return useAgentStore();
}
