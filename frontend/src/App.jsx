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

function HomeRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <Navigate to="/template-studio" replace /> : <Landing />;
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
