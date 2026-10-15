import { create } from 'zustand';

export const useUIStore = create((set) => ({
  sidebarOpen: true,
  agentPanelOpen: true,
  theme: 'dark',
  panelSizes: { preview: 60, agent: 40 },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
  setTheme: (theme) => set({ theme }),
  setPanelSizes: (panelSizes) => set({ panelSizes }),
}));
