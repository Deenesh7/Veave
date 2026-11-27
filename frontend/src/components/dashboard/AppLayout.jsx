import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useAdminView, isAdminAccount } from '../../store/adminViewStore';
import { Spinner } from '../ui/Spinner';
import TopHeader from './TopHeader';
import Sidebar from './Sidebar';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import PersistentGenerationIndicator from './PersistentGenerationIndicator';
import Toaster from '../common/Toaster';

export default function AppLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The Template Studio fills the whole workspace card edge to edge.
  const fullBleed = useLocation().pathname.startsWith('/template-studio');
  const sidebarHidden = useTemplateStudioStore((s) => s.appSidebarHidden);
  const { pathname } = useLocation();
  const { user, isAuthenticated, fetchProfile } = useAuthStore();
  const [profileTried, setProfileTried] = useState(false);

  // After a reload the user is not in memory yet; load it so the role is known before any page is shown.
  useEffect(() => {
    if (isAuthenticated && !user) fetchProfile().finally(() => setProfileTried(true));
  }, [isAuthenticated, user, fetchProfile]);
  // Keep the account in step with the server, so credits an administrator adds show up without signing in again.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refresh = () => { if (document.visibilityState === 'visible') fetchProfile(); };
    const id = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(id); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [isAuthenticated, fetchProfile]);
  const waitingForRole = isAuthenticated && !user && !profileTried;

  // Administrators only get the admin dashboard, not the site-building workspace.
  const adminMode = useAdminView((s) => s.mode);
  // The admin portal is for the root administrator only. An administrator can switch to the normal user view with the toggle in the sidebar.
  const isAdmin = isAdminAccount(user) && adminMode === 'admin';
  if (isAdmin && !pathname.startsWith('/admin')) return <Navigate to="/admin" replace />;
  // An administrator who lost the role while signed in goes back to the normal app.
  if (user && !isAdmin && pathname.startsWith('/admin')) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#2B2823] font-sans antialiased flex flex-col">
      {/* Fixed Top Header */}
      <TopHeader
        mobileMenuOpen={mobileMenuOpen}
        onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
      />

      {/* Main App Container (with fixed top offset 56px / h-14) */}
      <div className="flex-1 flex pt-14 relative">
        {/* Fixed Left Sidebar (~260px wide) */}
        <Sidebar
          collapsed={sidebarHidden}
          mobileMenuOpen={mobileMenuOpen}
          onCloseMobileMenu={() => setMobileMenuOpen(false)}
        />

        {/* Central Workspace Canvas */}
        <main className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-300 ${sidebarHidden ? 'md:pl-[64px]' : 'md:pl-[260px]'} ${fullBleed ? 'h-[calc(100vh-3.5rem)]' : ''}`}>
          {/* Workspace panel: white, rounded, 16px in from the sidebar, header and window edges.
              Its inner padding is reduced by the same 16px + 1px border so the content keeps its position. */}
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 m-4 bg-[#FBF9F4] border border-[#E2DCCF] rounded-[20px] shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${fullBleed ? 'overflow-hidden' : ''}`}>
          {/* Top spacing above the page content (keeps every page exactly where it was) */}
          {!fullBleed && <div className="h-1 md:h-[30px] shrink-0" aria-hidden="true" />}

          {/* Dynamic Route Content */}
          <div className={fullBleed ? 'flex-1 min-h-0 w-full' : 'flex-1 px-4 pb-16 max-w-7xl w-full mx-auto'}>
            {waitingForRole ? <div className="flex min-h-[40vh] items-center justify-center"><Spinner size="lg" /></div> : <Outlet />}
          </div>
          </div>
        </main>
      </div>

      {/* Global Background AI Generation Persistent Indicator */}
      <PersistentGenerationIndicator />
      <Toaster />
    </div>
  );
}
