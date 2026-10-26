import axios from 'axios';
import { getKnownRevision, noteRevisionsFromResponseBody, projectIdForRevisionedWrite } from '../utils/projectRevisions';

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
  // Saves to a project say which revision they were based on (the server enforces it on shared projects).
  const projectId = projectIdForRevisionedWrite(config.method, config.url);
  if (projectId && config.data && typeof config.data === 'object' && config.data.baseRevision === undefined) {
    const known = getKnownRevision(projectId);
    if (known !== null) config.data = { ...config.data, baseRevision: known };
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    noteRevisionsFromResponseBody(response.data);
    return response;
  },
  (error) => {
    const failure = error.response?.data?.error;
    const code = typeof failure === 'object' ? failure?.code : null;
    const limitCode = error.response?.data?.code || code;
    if (limitCode === 'PLAN_LIMIT_REACHED') {
      // Over a plan limit (projects, storage, credits or monthly tokens): offer an upgrade instead of a bare error.
      const message = (typeof failure === 'object' ? failure?.message : failure) || 'You have reached your plan limit.';
      window.dispatchEvent(new CustomEvent('veave:plan-limit', { detail: { message } }));
    } else if (code === 'PROJECT_CONFLICT' || error.response?.status === 428) {
      window.dispatchEvent(new CustomEvent('veave:project-conflict', { detail: { message: failure?.message, currentRevision: failure?.details?.currentRevision } }));
    } else if (code === 'INSUFFICIENT_PROJECT_ACCESS') {
      window.dispatchEvent(new CustomEvent('veave:project-readonly', { detail: { message: failure?.message } }));
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('veave_token');
      // Let the auth store drop its stale "logged in" state so screens stop retrying with a dead token.
      window.dispatchEvent(new Event('veave:unauthorized'));
      // Do not interrupt user browsing on workspace, dashboard, editor, or design studio pages
      const publicPaths = ['/', '/dashboard', '/workspace', '/shared', '/files', '/templates', '/design-systems', '/documentation'];
      const isPublicPath = 
        publicPaths.includes(window.location.pathname) || 
        window.location.pathname.startsWith('/editor');
      // Browsing public pages as a guest is fine, but an action that creates or changes data (creating a project,
      // saving) must not silently continue without an account: send the user to log in.
      const isWrite = String(error.config?.method || 'get').toLowerCase() !== 'get';
      const onAuthPage = window.location.pathname === '/login' || window.location.pathname === '/register';
      if ((!isPublicPath || isWrite) && !onAuthPage) {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${next}&expired=1`;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
