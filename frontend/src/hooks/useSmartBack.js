import { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

/**
 * Dynamic "Back": returns to wherever the user actually came from.
 * - If there is in-app history (react-router stores its index in history.state.idx), step back one entry.
 * - Otherwise (deep link, refresh, new tab) use the supplied fallback instead of leaving the app.
 * - A `location.state.from` path, when provided by the caller of navigate(), takes priority.
 */
export function useSmartBack(fallback = '/dashboard') {
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    const from = location.state?.from;
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== location.pathname) {
      navigate(from);
      return;
    }
    const hasAppHistory = (window.history.state?.idx ?? 0) > 0;
    if (hasAppHistory) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location, fallback]);
}

export default useSmartBack;
