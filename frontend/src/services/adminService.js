import api from './api';

const qs = (params = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') q.set(key, value); });
  const text = q.toString();
  return text ? `?${text}` : '';
};
const data = (response) => response.data.data;

// Every call goes to /api/admin and the server checks the ADMIN role on each one.
export const adminService = {
  me: () => api.get('/admin/me').then(data),
  dashboard: (params) => api.get(`/admin/dashboard${qs(params)}`).then(data),
  analytics: (params) => api.get(`/admin/analytics${qs(params)}`).then(data),
  analyticsExportUrl: (params) => `/admin/analytics/export${qs(params)}`,

  users: (params) => api.get(`/admin/users${qs(params)}`).then(data),
  user: (id) => api.get(`/admin/users/${id}`).then(data),
  userWebsites: (id) => api.get(`/admin/users/${id}/websites`).then(data),
  userActivity: (id) => api.get(`/admin/users/${id}/activity`).then(data),
  userCredits: (id, params) => api.get(`/admin/users/${id}/credits${qs(params)}`).then(data),
  userNotes: (id) => api.get(`/admin/users/${id}/notes`).then(data),
  addUserNote: (id, note) => api.post(`/admin/users/${id}/notes`, { note }).then(data),
  setUserStatus: (id, status, reason) => api.patch(`/admin/users/${id}/status`, { status, reason }).then(data),
  setUserRole: (id, role) => api.patch(`/admin/users/${id}/role`, { role }).then(data),

  creditSummary: (params) => api.get(`/admin/credits/summary${qs(params)}`).then(data),
  creditTransactions: (params) => api.get(`/admin/credits/transactions${qs(params)}`).then(data),
  creditExportUrl: (params) => `/admin/credits/transactions/export${qs(params)}`,
  searchProjects: (params) => api.get(`/admin/projects${qs(params)}`).then(data),
  projectCredits: (id) => api.get(`/admin/projects/${id}/credits`).then(data),
  changeProjectCredits: (id, body) => api.post(`/admin/projects/${id}/credits`, body).then(data),
  adjustCredits: (body) => api.post('/admin/credits/adjust', body).then(data),
  allocateCredits: (body) => api.post('/admin/credits/allocate', body).then(data),

  templates: (params) => api.get(`/admin/templates${qs(params)}`).then(data),
  template: (id) => api.get(`/admin/templates/${id}`).then(data),
  uploadTemplate: (form, onProgress) => api.post('/admin/templates', form, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0) }).then(data),
  newVersion: (id, form, onProgress) => api.post(`/admin/templates/${id}/versions`, form, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (event) => onProgress?.(event.total ? event.loaded / event.total : 0) }).then(data),
  updateTemplate: (id, version, body) => api.patch(`/admin/templates/${id}/versions/${version}`, body).then(data),
  setTemplateStatus: (id, version, status) => api.post(`/admin/templates/${id}/versions/${version}/status`, { status }).then(data),
  duplicateTemplate: (id, version) => api.post(`/admin/templates/${id}/duplicate`, { version }).then(data),
  deleteTemplate: (id, confirm) => api.delete(`/admin/templates/${id}`, { data: { confirm } }).then(data),
  templatePreview: (id, version) => api.get(`/admin/templates/${id}/preview${qs({ version })}`).then(data),
  addTemplateImage: (id, version, kind, file) => { const form = new FormData(); form.set('kind', kind); form.set('image', file); return api.post(`/admin/templates/${id}/versions/${version}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(data); },
  removeTemplateImage: (id, version, key) => api.delete(`/admin/templates/${id}/versions/${version}/images/${key}`).then(data),
  templateImageBlob: (id, version, key) => api.get(`/admin/templates/${id}/versions/${version}/images/${key}`, { responseType: 'blob' }).then((response) => response.data),

  plans: () => api.get('/admin/plans').then(data),
  updatePlan: (name, body) => api.put(`/admin/plans/${encodeURIComponent(name)}`, body).then(data),
  planUsers: (name, params) => api.get(`/admin/plans/${encodeURIComponent(name)}/users${qs(params)}`).then(data),
  planTransactions: (params) => api.get(`/admin/plans/transactions${qs(params)}`).then(data),

  auditLogs: (params) => api.get(`/admin/audit-logs${qs(params)}`).then(data),

  notifications: (params) => api.get(`/admin/notifications${qs(params)}`).then(data),
  unreadCount: () => api.get('/admin/notifications/unread-count').then(data),
  markRead: (body) => api.post('/admin/notifications/read', body).then(data),

  admins: () => api.get('/admin/admins').then(data),
  // Both need the signed-in root administrator's own password (currentPassword) as a second check.
  addAdmin: (payload) => api.post('/admin/admins', payload).then(data),
  setAdminType: (id, adminRole, currentPassword) => api.patch(`/admin/admins/${id}/type`, { adminRole, currentPassword }).then(data),
  removeAdmin: (id, currentPassword) => api.delete(`/admin/admins/${id}`, { data: { currentPassword } }).then(data),

  settings: () => api.get('/admin/settings').then(data),
  saveSettings: (group, body) => api.put(`/admin/settings/${group}`, body).then(data),

  /** Downloads a CSV through the authenticated client (a plain link could not send the token). */
  download: async (url, fallbackName) => {
    const response = await api.get(url, { responseType: 'blob' });
    const blob = response.data;
    const name = /filename="([^"]+)"/.exec(response.headers['content-disposition'] || '')?.[1] || fallbackName;
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
};

export function adminError(error, fallback = 'Something went wrong. Please try again.') {
  const failure = error?.response?.data?.error;
  if (error?.response?.status === 403 && failure?.code === 'ADMIN_REQUIRED') return 'Administrator access is required.';
  return (typeof failure === 'object' ? failure?.message : failure) || error?.message || fallback;
}
export const errorCode = (error) => error?.response?.data?.error?.code || null;
