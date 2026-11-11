import api from './api';

// The template workspace API (/api/template-sites, /api/template-jobs). Every call is authenticated by the shared axios client.
const statusRequest = { timeout: 30000 };

export const templateSiteService = {
  listTemplates: () => api.get('/templates'),
  themeLibrary: () => api.get('/templates/theme/library'),
  templateSiteHtml: (id, version) => api.get(`/templates/${id}/site-html`, { params: { version }, timeout: 60000 }),
  templateThemeCss: (id, theme, version) => api.post(`/templates/${id}/theme-css`, { theme }, { params: { version } }),
  getTemplate: (id, version) => api.get(`/templates/${id}`, { params: { version } }),
  listSites: () => api.get('/template-sites'),
  createSite: (data) => api.post('/template-sites', data),
  getSite: (siteId) => api.get(`/template-sites/${siteId}`),
  renameSite: (siteId, data) => api.patch(`/template-sites/${siteId}`, data),
  deleteSite: (siteId) => api.delete(`/template-sites/${siteId}`),

  listPages: (siteId) => api.get(`/template-sites/${siteId}/pages`),
  addPage: (siteId, data) => api.post(`/template-sites/${siteId}/pages`, data),
  getPage: (siteId, pageId) => api.get(`/template-sites/${siteId}/pages/${pageId}`),
  updatePage: (siteId, pageId, data) => api.patch(`/template-sites/${siteId}/pages/${pageId}`, data),
  deletePage: (siteId, pageId) => api.delete(`/template-sites/${siteId}/pages/${pageId}`),
  reorderPages: (siteId, pageIds) => api.patch(`/template-sites/${siteId}/pages/reorder`, { pageIds }),

  listRevisions: (siteId, pageId) => api.get(`/template-sites/${siteId}/pages/${pageId}/revisions`),
  restoreRevision: (siteId, pageId, number) => api.post(`/template-sites/${siteId}/pages/${pageId}/revisions/${number}/restore`),

  // Website versions (the whole site), history, comparison and branches.
  listVersions: (siteId, filter = 'all') => api.get(`/template-sites/${siteId}/versions`, { params: { filter } }),
  history: (siteId, filter = 'all') => api.get(`/template-sites/${siteId}/history`, { params: { filter } }),
  getVersion: (siteId, versionId) => api.get(`/template-sites/${siteId}/versions/${versionId}`),
  saveVersion: (siteId, data) => api.post(`/template-sites/${siteId}/versions`, data),
  updateVersion: (siteId, versionId, data) => api.patch(`/template-sites/${siteId}/versions/${versionId}`, data),
  deleteVersion: (siteId, versionId) => api.delete(`/template-sites/${siteId}/versions/${versionId}`, { params: { confirm: true } }),
  restoreVersion: (siteId, versionId) => api.post(`/template-sites/${siteId}/versions/${versionId}/restore`, {}, { timeout: 120000 }),
  verifyVersion: (siteId, versionId) => api.post(`/template-sites/${siteId}/versions/${versionId}/verify`, {}, { timeout: 120000 }),
  previewVersion: (siteId, versionId) => api.get(`/template-sites/${siteId}/versions/${versionId}/preview`, { timeout: 120000 }),
  compareVersions: (siteId, { a, b, aSite, bSite }) => api.get(`/template-sites/${siteId}/versions/compare`, { params: { a, b, aSite, bSite }, timeout: 120000 }),
  comparePageRevision: (siteId, pageId, number) => api.get(`/template-sites/${siteId}/pages/${pageId}/revisions/${number}/compare`),
  createBranch: (siteId, versionId, name) => api.post(`/template-sites/${siteId}/versions/${versionId}/branch`, { name }, { timeout: 120000 }),
  listBranches: (siteId) => api.get(`/template-sites/${siteId}/branches`),
  promoteBranch: (siteId) => api.post(`/template-sites/${siteId}/promote`, {}, { timeout: 120000 }),
  assetVersions: (siteId, imageId) => api.get(`/template-sites/${siteId}/images/${imageId}/versions`),

  // Pictures: uploaded one request each (so progress and errors are per file), stored once per site, listed as the site's library.
  uploadPhoto: (siteId, file, { pageId = null, onProgress, signal } = {}) => {
    const form = new FormData();
    form.append('photo', file);
    if (pageId) form.append('pageId', pageId);
    return api.post(`/template-sites/${siteId}/uploads`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000, signal,
      onUploadProgress: onProgress ? (event) => onProgress(event.total ? event.loaded / event.total : 0) : undefined
    });
  },
  listImages: (siteId) => api.get(`/template-sites/${siteId}/images`),
  updateImage: (siteId, imageId, data) => api.patch(`/template-sites/${siteId}/images/${imageId}`, data),
  deleteImage: (siteId, imageId) => api.delete(`/template-sites/${siteId}/images/${imageId}`),
  replaceImage: (siteId, imageId, file, { onProgress } = {}) => {
    const form = new FormData();
    form.append('photo', file);
    return api.post(`/template-sites/${siteId}/images/${imageId}/replace`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
      onUploadProgress: onProgress ? (event) => onProgress(event.total ? event.loaded / event.total : 0) : undefined
    });
  },
  getImageFile: (siteId, imageId, { version = 'original' } = {}) => api.get(`/template-sites/${siteId}/images/${imageId}/file`, { params: version === 'enhanced' ? { version } : undefined, responseType: 'blob', timeout: 60000 }),
  // AI enhancement of an uploaded photo: start / retry it, and choose which version the website uses.
  enhanceImage: (siteId, imageId) => api.post(`/template-sites/${siteId}/images/${imageId}/enhance`),
  chooseEnhancement: (siteId, imageId, choice) => api.post(`/template-sites/${siteId}/images/${imageId}/enhancement`, { choice }),
  previewRevision: (siteId, pageId, number) => api.get(`/template-sites/${siteId}/pages/${pageId}/revisions/${number}/preview`, { timeout: 120000 }),
  generateSite: (siteId, data) => api.post(`/template-sites/${siteId}/generate`, data),
  regeneratePage: (siteId, pageId, data) => api.post(`/template-sites/${siteId}/pages/${pageId}/regenerate`, data),
  retryPage: (siteId, pageId) => api.post(`/template-sites/${siteId}/pages/${pageId}/retry`, { idempotencyKey: `retry-${pageId}-${Date.now()}` }),
  getJob: (jobId) => api.get(`/template-jobs/${jobId}`, statusRequest),
  cancelJob: (jobId) => api.post(`/template-jobs/${jobId}/cancel`),

  getPreview: (siteId, { pageId = null, hash = '' } = {}) => api.get(
    pageId ? `/template-sites/${siteId}/pages/${pageId}/preview` : `/template-sites/${siteId}/preview`,
    { params: hash ? { hash } : undefined, timeout: 120000 }
  )
};

/** The message the API gave for a failed call, in plain words. */
export function apiMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data?.error;
  if (typeof data === 'string') return data;
  return data?.message || error?.message || fallback;
}

export default templateSiteService;
