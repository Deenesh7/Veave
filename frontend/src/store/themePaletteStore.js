import { create } from 'zustand';
import { themePaletteService } from '../services/themePaletteService';

export const useThemePaletteStore = create((set, get) => ({
  palettes: [],
  activePalette: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchPalettes: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await themePaletteService.getPalettes();
      const list = res.data.data || [];
      const currentActive = get().activePalette;
      
      // Determine active palette: current selection if still valid, or default palette, or first in list
      let active = list.find((p) => p.isDefault) || list[0] || null;
      if (currentActive) {
        const match = list.find((p) => p._id === currentActive._id);
        if (match) active = match;
      }

      set({ palettes: list, activePalette: active, isLoading: false });
      return list;
    } catch (err) {
      set({
        error: err.response?.data?.error || err.message || 'Failed to fetch palettes',
        isLoading: false
      });
      return [];
    }
  },

  createPalette: async (paletteData) => {
    set({ isSaving: true, error: null });
    try {
      const res = await themePaletteService.createPalette(paletteData);
      const newPalette = res.data.data;
      
      set((state) => {
        const updated = [newPalette, ...state.palettes];
        // If it was marked default, unmark others in memory
        if (newPalette.isDefault) {
          updated.forEach((p) => {
            if (p._id !== newPalette._id) p.isDefault = false;
          });
        }
        return {
          palettes: updated,
          activePalette: newPalette,
          isSaving: false,
        };
      });

      return newPalette;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create palette';
      set({ error: msg, isSaving: false });
      throw new Error(msg);
    }
  },

  deletePalette: async (id) => {
    set({ isSaving: true, error: null });
    try {
      await themePaletteService.deletePalette(id);
      set((state) => {
        const remaining = state.palettes.filter((p) => p._id !== id);
        let nextActive = state.activePalette;
        if (state.activePalette?._id === id) {
          nextActive = remaining[0] || null;
        }
        return {
          palettes: remaining,
          activePalette: nextActive,
          isSaving: false,
        };
      });
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to delete palette';
      set({ error: msg, isSaving: false });
      throw new Error(msg);
    }
  },

  updatePalette: async (id, updatedData) => {
    set({ isSaving: true, error: null });
    try {
      const res = await themePaletteService.updatePalette(id, updatedData);
      const updatedPalette = res.data.data;
      set((state) => ({
        palettes: state.palettes.map((p) => (p._id === id ? updatedPalette : p)),
        activePalette: state.activePalette?._id === id ? updatedPalette : state.activePalette,
        isSaving: false,
      }));
      return updatedPalette;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update palette';
      set({ error: msg, isSaving: false });
      throw new Error(msg);
    }
  },

  setActivePalette: async (palette, persistDefault = false) => {
    set({ activePalette: palette });
    if (persistDefault && palette?._id) {
      try {
        await themePaletteService.setDefaultPalette(palette._id);
        set((state) => ({
          palettes: state.palettes.map((p) => ({
            ...p,
            isDefault: p._id === palette._id,
          })),
        }));
      } catch (err) {
        console.error('Failed to set active default palette:', err);
      }
    }
  },

  clearError: () => set({ error: null }),
}));

export default useThemePaletteStore;
