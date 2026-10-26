import { create } from 'zustand';
import { authService } from '../services/authService';

export const useAuthStore = create((set, get) => ({
  user: null,
  token: localStorage.getItem('veave_token'),
  isAuthenticated: !!localStorage.getItem('veave_token'),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authService.login(email, password);
      const { user, token } = res.data.data || res.data;
      localStorage.setItem('veave_token', token);
      set({ user, token, isAuthenticated: true, isLoading: false });
      return user;
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Login failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  register: async (name, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await authService.register(name, email, password);
      const { user, token } = res.data.data || res.data;
      localStorage.setItem('veave_token', token);
      set({ user, token, isAuthenticated: true, isLoading: false });
      return user;
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Registration failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem('veave_token');
    authService.logout().catch(() => {});
    set({ user: null, token: null, isAuthenticated: false, error: null });
  },

  loginWithToken: async (token) => {
    localStorage.setItem('veave_token', token);
    set({ token, isAuthenticated: true, isLoading: true, error: null });
    try {
      const res = await authService.getProfile();
      const user = res.data.data || res.data;
      set({ user, isAuthenticated: true, isLoading: false });
      return user;
    } catch (err) {
      localStorage.removeItem('veave_token');
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
      throw err;
    }
  },

  fetchProfile: async () => {
    try {
      const res = await authService.getProfile();
      const user = res.data.data || res.data;
      if (user) {
        set({ user });
      }
      return user;
    } catch (e) {
      console.warn('Failed to fetch profile from db:', e);
      return null;
    }
  },

  checkAuth: async () => {
    const token = get().token || localStorage.getItem('veave_token');
    set({ isLoading: true });
    try {
      const res = await authService.getProfile();
      const user = res.data.data || res.data;
      if (user) {
        set({ user, isAuthenticated: !!token, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    } catch {
      if (token) {
        localStorage.removeItem('veave_token');
      }
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
  setUser: (user) => set({ user }),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('veave:unauthorized', () => {
    if (useAuthStore.getState().isAuthenticated) useAuthStore.setState({ token: null, isAuthenticated: false });
  });
}
