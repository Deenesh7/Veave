import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { create } from 'zustand';
import { Bell, CreditCard, LayoutDashboard, LayoutTemplate, LineChart, Users, UsersRound, WalletCards } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useAuthStore } from '../../store/authStore';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorState } from './ui';

const AdminContext = createContext({ admin: null, unread: 0, refreshUnread: () => {} });
export const useAdmin = () => useContext(AdminContext);

export const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/admin/credits', label: 'Credit Management', icon: WalletCards },
  { to: '/admin/plans', label: 'Subscriptions & Plans', icon: CreditCard },
  { to: '/admin/analytics', label: 'Analytics', icon: LineChart },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell, badge: true },
  { to: '/admin/admins', label: 'Admin Management', icon: UsersRound }
];

// Unread notification count, shared with the main sidebar (the admin pages now live inside the same app shell).
export const useAdminUnread = create((set) => ({ unread: 0, setUnread: (unread) => set({ unread }) }));

/**
 * Guard for the admin pages, rendered inside the main app shell (same header and sidebar as the rest of Veave). Access is decided by
 * the server: /api/admin/me answers 403 for anyone who is not an ADMIN, so editing local state or the stored user cannot open this
 * area (and every admin API call is checked again on the server).
 */
export default function AdminLayout() {
  const token = useAuthStore((s) => s.token) || localStorage.getItem('veave_token');
  const [state, setState] = useState({ status: 'loading', admin: null, unread: 0 });
  const setUnread = useAdminUnread((s) => s.setUnread);
  const { pathname } = useLocation();

  const load = async () => {
    try {
      const { user, unread } = await adminService.me();
      setState({ status: 'ready', admin: user, unread });
      setUnread(unread);
    } catch (error) {
      const code = error?.response?.status;
      setState({ status: code === 403 ? 'forbidden' : code === 401 ? 'login' : 'error', admin: null, unread: 0 });
    }
  };
  useEffect(() => { if (token) load(); else setState({ status: 'login', admin: null, unread: 0 }); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  // The unread badge follows the notification list.
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const id = setInterval(() => adminService.unreadCount().then(({ unread }) => setUnread(unread)).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [state.status, setUnread]);

  if (state.status === 'loading') return <div className="flex min-h-[50vh] items-center justify-center"><Spinner size="lg" /></div>;
  if (state.status === 'login') return <Navigate to={`/login?redirect=${encodeURIComponent(pathname)}`} replace />;
  if (state.status === 'forbidden') return <Navigate to="/dashboard" replace />;
  if (state.status === 'error') return <ErrorState message="The admin dashboard could not be loaded." onRetry={load} />;

  const refreshUnread = () => adminService.unreadCount().then(({ unread }) => setUnread(unread)).catch(() => {});
  return (
    <AdminContext.Provider value={{ admin: state.admin, unread: state.unread, refreshUnread }}>
      <Outlet />
    </AdminContext.Provider>
  );
}
