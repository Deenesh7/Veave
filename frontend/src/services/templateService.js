import api from './api';

// Template Gallery API. The server decides which templates this account may see and use.
export const templateService = {
  list: (params = {}) => api.get('/templates', { params }),
  get: (id, version) => api.get(`/templates/${encodeURIComponent(id)}`, { params: version ? { version } : {} }),
  select: (id, version) => api.post(`/templates/${encodeURIComponent(id)}/select`, version ? { version } : {})
};

export default templateService;
