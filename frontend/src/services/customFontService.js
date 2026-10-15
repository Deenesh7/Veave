import api from './api';

export const customFontService = {
  getFonts: () => api.get('/custom-fonts'),
  createFont: (fontData) => api.post('/custom-fonts', fontData),
  deleteFont: (id) => api.delete(`/custom-fonts/${id}`),
};

export default customFontService;
