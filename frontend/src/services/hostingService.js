import api from './api';

export const hostingService = {
  getConfig: () => api.get('/hosting/config'),
  checkSlug: (slug, projectId) => api.get('/hosting/slug-check', { params: { slug, projectId } }),
  getStatus: (projectId) => api.get(`/hosting/projects/${projectId}`),
  // `options.domain` also connects that custom domain; the server publishes, verifies, configures DNS and HTTPS in the background.
  publish: (projectId, slug, options = {}) => api.post(`/hosting/projects/${projectId}/publish`, { ...(slug ? { slug } : {}), ...options }),
  unpublish: (projectId) => api.post(`/hosting/projects/${projectId}/unpublish`),
  getDomain: (projectId) => api.get(`/hosting/projects/${projectId}/domain`),
  checkDomainName: (hostname) => api.get('/hosting/domains/check', { params: { hostname } }),
  connectDomain: (projectId, domain, options = {}) => api.post(`/hosting/projects/${projectId}/domain`, { domain, ...options }),
  retryDomain: (projectId) => api.post(`/hosting/projects/${projectId}/domain/retry`),
  confirmDomainReplace: (projectId) => api.post(`/hosting/projects/${projectId}/domain/confirm-replace`),
  domainHealth: (projectId, refresh = false) => api.get(`/hosting/projects/${projectId}/domain/health`, { params: refresh ? { refresh: 'true' } : {} }),
  verifyDomain: (projectId) => api.post(`/hosting/projects/${projectId}/domain/verify`),
  removeDomain: (projectId) => api.delete(`/hosting/projects/${projectId}/domain`),
  // The owner's DNS provider accounts (Cloudflare, GoDaddy). Secrets are sent once and never come back.
  listDnsAccounts: () => api.get('/hosting/dns-accounts'),
  saveDnsAccount: (provider, fields) => api.put(`/hosting/dns-accounts/${provider}`, fields),
  removeDnsAccount: (provider) => api.delete(`/hosting/dns-accounts/${provider}`),
  getDeployment: (deploymentId) => api.get(`/hosting/deployments/${deploymentId}`),
};

export function hostingErrorMessage(error, fallback = 'Something went wrong while publishing.') {
  if (error?.response?.status === 401) return 'Log in to publish this project.';
  return error?.response?.data?.error?.message || error?.message || fallback;
}
