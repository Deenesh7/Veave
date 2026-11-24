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
      // Only touch the store when something changed, so a background refresh does not re-render the whole app every time.
      if (user && JSON.stringify(user) !== JSON.stringify(get().user)) {
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
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        localStorage.removeItem('veave_token');
        set({ user: null, token: null, isAuthenticated: false, isLoading: false });
      } else {
        // Backend unreachable (e.g. mid-deploy): keep the saved session instead of signing the user out.
        set({ isLoading: false, isAuthenticated: !!token });
      }
    }
  },

  clearError: () => set({ error: null }),
  setUser: (user) => set({ user }),
}));

// Credits (and the plan) can change on the server at any time: an admin adjusts them, a payment is delivered, a generation is charged.
// The signed-in user is re-read when the tab gets focus and every 30 seconds while it is visible, so the header always shows the real balance.
if (typeof window !== 'undefined') {
  let lastProfileSync = 0;
  const syncProfile = () => {
    const { isAuthenticated, fetchProfile } = useAuthStore.getState();
    if (!isAuthenticated || document.hidden || Date.now() - lastProfileSync < 10000) return;
    lastProfileSync = Date.now();
    fetchProfile();
  };
  window.addEventListener('focus', syncProfile);
  document.addEventListener('visibilitychange', syncProfile);
  setInterval(syncProfile, 30000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('veave:unauthorized', () => {
    if (useAuthStore.getState().isAuthenticated) useAuthStore.setState({ token: null, isAuthenticated: false });
  });
}
