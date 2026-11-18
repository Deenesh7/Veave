import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import EditorLayout from './layouts/EditorLayout';
import VeaveDashboard from './pages/VeaveDashboard';
const PromptEnginePage = lazy(() => import('./pages/PromptEnginePage'));
const RecentPage = lazy(() => import('./pages/RecentPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const SharedPage = lazy(() => import('./pages/SharedPage'));
const DesignSystemsPage = lazy(() => import('./pages/DesignSystemsPage'));
const DocumentationPage = lazy(() => import('./pages/DocumentationPage'));
const Settings = lazy(() => import('./pages/Settings'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
const Editor = lazy(() => import('./pages/Editor'));
const TemplateStudio = lazy(() => import('./features/template-studio/TemplateStudio'));
import ProtectedRoute from './components/common/ProtectedRoute';
import NotFound from './pages/NotFound';
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'));
const InvitationsPage = lazy(() => import('./pages/InvitationsPage'));
const SharedProjectsPage = lazy(() => import('./pages/SharedProjectsPage'));
import UpgradePlanModal from './components/common/UpgradePlanModal';
const AdminLayout = lazy(() => import('./features/admin/AdminLayout'));
const DashboardPage = lazy(() => import('./features/admin/DashboardPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() => import('./features/admin/UsersPage').then((m) => ({ default: m.UserDetailPage })));
const TemplatesPage = lazy(() => import('./features/admin/TemplatesPage'));
const CreditsPage = lazy(() => import('./features/admin/CreditsPage'));
const PlansPage = lazy(() => import('./features/admin/MorePages').then((m) => ({ default: m.PlansPage })));
const AnalyticsPage = lazy(() => import('./features/admin/MorePages').then((m) => ({ default: m.AnalyticsPage })));
const NotificationsPage = lazy(() => import('./features/admin/MorePages').then((m) => ({ default: m.NotificationsPage })));
const AdminsPage = lazy(() => import('./features/admin/MorePages').then((m) => ({ default: m.AdminsPage })));

function HomeRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />;
}

export default function App() {
  return (
    <>
    <UpgradePlanModal />
    <Suspense fallback={<div style={{ minHeight: '100vh' }} aria-busy="true" />}>
    <Routes>
      {/* Main Veave SaaS Dashboard & Navigation Routes */}
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<VeaveDashboard />} />
        <Route path="/prompt-engine" element={<PromptEnginePage />} />
        <Route path="/recent" element={<RecentPage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/shared" element={<SharedPage />} />
        <Route path="/design-systems" element={<DesignSystemsPage />} />
        <Route path="/documentation" element={<DocumentationPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/invitations" element={<InvitationsPage />} />
        <Route path="/collab/projects" element={<SharedProjectsPage />} />
        {/* Template workspace: sites live in the sidebar's Template Studio view; the editor and preview render here */}
        <Route element={<ProtectedRoute />}>
          <Route path="/template-studio" element={<TemplateStudio />} />
        </Route>

      {/* Admin dashboard (inside the main app shell): the server decides who may open it (GET /api/admin/me answers 403 to everyone but ADMIN) */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admins" element={<AdminsPage />} />
      </Route>
      </Route>

      {/* Marketing Landing Page */}
      <Route path="/" element={<HomeRoute />} />
      <Route path="/landing" element={<Landing />} />

      {/* Authentication Routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Code Editor Routes */}
      <Route element={<EditorLayout />}>
        <Route path="/editor/:id" element={<Editor />} />
      </Route>

      {/* 404 Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </>
  );
}
