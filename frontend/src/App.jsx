import { Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import AuthLayout from './layouts/AuthLayout';
import EditorLayout from './layouts/EditorLayout';
import VeaveDashboard from './pages/VeaveDashboard';
import PromptEnginePage from './pages/PromptEnginePage';
import FilesPage from './pages/FilesPage';
import SharedPage from './pages/SharedPage';
import WorkspacePage from './pages/WorkspacePage';
import TemplatesPage from './pages/TemplatesPage';
import DesignSystemsPage from './pages/DesignSystemsPage';
import DocumentationPage from './pages/DocumentationPage';
import Settings from './pages/Settings';
import BillingPage from './pages/BillingPage';
import UsagePage from './pages/UsagePage';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Editor from './pages/Editor';
import NotFound from './pages/NotFound';
import GroupsPage from './pages/GroupsPage';
import GroupDetailPage from './pages/GroupDetailPage';
import InvitationsPage from './pages/InvitationsPage';
import SharedProjectsPage from './pages/SharedProjectsPage';
import UpgradePlanModal from './components/common/UpgradePlanModal';

export default function App() {
  return (
    <>
    <UpgradePlanModal />
    <Routes>
      {/* Main Veave SaaS Dashboard & Navigation Routes */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<VeaveDashboard />} />
        <Route path="/dashboard" element={<VeaveDashboard />} />
        <Route path="/prompt-engine" element={<PromptEnginePage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/shared" element={<SharedPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/design-systems" element={<DesignSystemsPage />} />
        <Route path="/documentation" element={<DocumentationPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
        <Route path="/invitations" element={<InvitationsPage />} />
        <Route path="/collab/projects" element={<SharedProjectsPage />} />
      </Route>

      {/* Marketing Landing Page */}
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
