import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import EditorLayout from './layouts/EditorLayout';
import VeaveDashboard from './pages/VeaveDashboard';
import PromptEnginePage from './pages/PromptEnginePage';
import RecentPage from './pages/RecentPage';
import FilesPage from './pages/FilesPage';
import SharedPage from './pages/SharedPage';
import DesignSystemsPage from './pages/DesignSystemsPage';
import DocumentationPage from './pages/DocumentationPage';
import Settings from './pages/Settings';
import BillingPage from './pages/BillingPage';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Editor from './pages/Editor';
import TemplateStudio from './features/template-studio/TemplateStudio';
import ProtectedRoute from './components/common/ProtectedRoute';
import NotFound from './pages/NotFound';
import GroupsPage from './pages/GroupsPage';
import GroupDetailPage from './pages/GroupDetailPage';
import InvitationsPage from './pages/InvitationsPage';
import SharedProjectsPage from './pages/SharedProjectsPage';
import UpgradePlanModal from './components/common/UpgradePlanModal';
import AdminLayout from './features/admin/AdminLayout';
import DashboardPage from './features/admin/DashboardPage';
import { UsersPage, UserDetailPage } from './features/admin/UsersPage';
import TemplatesPage from './features/admin/TemplatesPage';
import CreditsPage from './features/admin/CreditsPage';
import { PlansPage, AnalyticsPage, NotificationsPage, AdminsPage } from './features/admin/MorePages';

function HomeRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />;
}

export default function App() {
  return (
    <>
    <UpgradePlanModal />
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
    </>
  );
}
