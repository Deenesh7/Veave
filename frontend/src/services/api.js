import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('veave_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('veave_token');
      // Do not interrupt user browsing on workspace, dashboard, editor, or design studio pages
      const publicPaths = ['/', '/dashboard', '/workspace', '/shared', '/files', '/templates', '/design-systems', '/documentation'];
      const isPublicPath = 
        publicPaths.includes(window.location.pathname) || 
        window.location.pathname.startsWith('/editor');
      if (!isPublicPath && window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${next}`;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
