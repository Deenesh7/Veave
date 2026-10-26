import api from './api';

export const hostingService = {
  getConfig: () => api.get('/hosting/config'),
  checkSlug: (slug, projectId) => api.get('/hosting/slug-check', { params: { slug, projectId } }),
  getStatus: (projectId) => api.get(`/hosting/projects/${projectId}`),
  // `options.domain` also connects that custom domain; the server publishes, verifies, configures DNS and HTTPS in the background.
  publish: (projectId, slug, options = {}) => api.post(`/hosting/projects/${projectId}/publish`, { ...(slug ? { slug } : {}), ...options }),
  unpublish: (projectId) => api.post(`/hosting/projects/${projectId}/unpublish`),
  domainAvailable: (domain) => api.get('/hosting/domains/available', { params: { domain } }),
  getDomain: (projectId) => api.get(`/hosting/projects/${projectId}/domain`),
  checkDomainName: (hostname) => api.get('/hosting/domains/check', { params: { hostname } }),
  connectDomain: (projectId, domain, options = {}) => api.post(`/hosting/projects/${projectId}/domain`, { domain, ...options }),
  retryDomain: (projectId) => api.post(`/hosting/projects/${projectId}/domain/retry`),
  confirmDomainReplace: (projectId) => api.post(`/hosting/projects/${projectId}/domain/confirm-replace`),
  domainHealth: (projectId, refresh = false) => api.get(`/hosting/projects/${projectId}/domain/health`, { params: refresh ? { refresh: 'true' } : {} }),
  verifyDomain: (projectId) => api.post(`/hosting/projects/${projectId}/domain/verify`),
  configureDomain: (projectId) => api.post(`/hosting/projects/${projectId}/domain/configure`),
  removeDomain: (projectId) => api.delete(`/hosting/projects/${projectId}/domain`),
  searchDomain: (domain) => api.get('/hosting/domains/search', { params: { domain } }),
  createDomainOrder: (projectId, domain, contact) => api.post(`/hosting/projects/${projectId}/domain/order`, { domain, contact }),
  getDomainOrder: (orderId) => api.get(`/hosting/domain/orders/${orderId}`),
  verifyDomainOrder: (projectId, body) => api.post(`/hosting/projects/${projectId}/domain/order/verify`, body),
  myDomains: () => api.get('/hosting/my-domains'),
  renewalPrice: (domain, period = 1) => api.get(`/hosting/my-domains/${domain}/renewal`, { params: { period } }),
  createRenewal: (domain, period = 1) => api.post(`/hosting/my-domains/${domain}/renewal`, { period }),
  dnsList: (domain) => api.get(`/hosting/my-domains/${domain}/dns`),
  dnsSet: (domain, record) => api.put(`/hosting/my-domains/${domain}/dns`, record),
  dnsDelete: (domain, record) => api.delete(`/hosting/my-domains/${domain}/dns`, { data: record }),
  getDeployment: (deploymentId) => api.get(`/hosting/deployments/${deploymentId}`),
};

export function hostingErrorMessage(error, fallback = 'Something went wrong while publishing.') {
  if (error?.response?.status === 401) return 'Log in to publish this project.';
  return error?.response?.data?.error?.message || error?.message || fallback;
}
