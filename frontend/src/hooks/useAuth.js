import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const store = useAuthStore();

  useEffect(() => {
    // Only check auth once on mount if token exists but user doesn't
    if (store.token && !store.user && !store.isLoading) {
      store.checkAuth();
    }
  }, []);

  return store;
}
