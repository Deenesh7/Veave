import { create } from 'zustand';
import { projectService } from '../services/projectService';
import { useBillingStore } from './billingStore';

const refreshUsage = () => { try { useBillingStore.getState().refreshOverview(); } catch { /* usage refresh is best effort */ } };

export const useProjectStore = create((set, get) => ({
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await projectService.getProjects();
      const projects = res.data.data || res.data || [];
      set({ projects, isLoading: false });
    } catch (err) {
      set({ projects: [], error: err.message, isLoading: false });
    }
  },

  fetchProject: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await projectService.getProject(id);
      const project = res.data.data || res.data;
      set({ currentProject: project, isLoading: false });
      return project;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  createProject: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await projectService.createProject(data);
      const project = res.data.data || res.data;
      set((state) => ({
        projects: [project, ...state.projects],
        currentProject: project,
        isLoading: false,
      }));
      refreshUsage();
      return project;
    } catch (err) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  updateProject: async (id, data) => {
    try {
      const res = await projectService.updateProject(id, data);
      const updated = res.data.data || res.data;
      set((state) => ({
        projects: state.projects.map((p) => (p._id === id ? updated : p)),
        currentProject: state.currentProject?._id === id 
          ? updated 
          : (state.currentProject ? { ...state.currentProject, ...(data.files ? { files: data.files } : {}) } : updated),
      }));
      return updated;
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  deleteProject: async (id) => {
    try {
      await projectService.deleteProject(id);
      set((state) => ({
        projects: state.projects.filter((p) => p._id !== id),
        currentProject: state.currentProject?._id === id ? null : state.currentProject,
      }));
      refreshUsage();
    } catch (err) {
      set({ error: err.message });
      throw err;
    }
  },

  // The page being viewed belongs to the project: opening another project starts at its home page.
  setCurrentProject: (project) => set((state) => ({ currentProject: project, previewRoute: state.currentProject?._id === project?._id ? state.previewRoute : '/' })),

  updateProjectFiles: (files) =>
    set((state) => ({
      currentProject: state.currentProject ? { ...state.currentProject, files } : null,
    })),
}));
