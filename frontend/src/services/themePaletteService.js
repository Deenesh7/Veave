import api from './api';

export const themePaletteService = {
  getPalettes: () => api.get('/theme-palettes'),
  getPalette: (id) => api.get(`/theme-palettes/${id}`),
  createPalette: (data) => api.post('/theme-palettes', data),
  updatePalette: (id, data) => api.put(`/theme-palettes/${id}`, data),
  deletePalette: (id) => api.delete(`/theme-palettes/${id}`),
  setDefaultPalette: (id) => api.patch(`/theme-palettes/${id}/default`),
};

export default themePaletteService;
