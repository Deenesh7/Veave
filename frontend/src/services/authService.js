import api from './api';

export const authService = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (name, email, password) => api.post('/auth/register', { name, email, password }),
  logout: () => api.post('/auth/logout'),
  getProfile: () => api.get('/auth/profile'),
  googleAuth: (token) => api.post('/auth/google', { token }),
  appleAuth: (token, name) => api.post('/auth/apple', { token, name }),
};
