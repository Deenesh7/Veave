import api from './api';

export const projectService = {
  getProjects: () => api.get('/projects'),
  // `binary: 'omit'` = lightweight editor view: text files in full, images/fonts listed by size only (fetched on demand).
  getProject: (id, { lite = true } = {}) => api.get(`/projects/${id}`, lite ? { params: { binary: 'omit' } } : undefined),
  createProject: (data) => api.post('/projects', data),
  // Files sent without `content` mean "unchanged" to the server; the response uses the same lightweight view.
  updateProject: (id, data) => api.patch(`/projects/${id}`, data, { params: { binary: 'omit' } }),
  deleteProject: (id) => api.delete(`/projects/${id}`),
  getFiles: (id) => api.get(`/projects/${id}/files`),
  updateFile: (id, path, content) => api.patch(`/projects/${id}/files`, { path, content }),
  getSource: (id) => api.get(`/projects/${id}/source`),
  getHistory: (id) => api.get(`/history/projects/${id}/history`),
  getVersion: (id, versionId) => api.get(`/history/projects/${id}/history/${versionId}`),
  createVersion: (id, label, files) => api.post(`/history/projects/${id}/history`, { label, files }),
  restoreVersion: (id, versionId) => api.post(`/history/projects/${id}/restore/${versionId}`),
  deleteVersion: (id, versionId) => api.delete(`/history/projects/${id}/history/${versionId}`),
  exportProject: (id) => api.get(`/projects/${id}/export`, { responseType: 'blob' }),
};
