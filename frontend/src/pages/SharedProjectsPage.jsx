import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Share2, UsersRound } from 'lucide-react';
import { useCollabStore } from '../store/collabStore';
import { useAuthStore } from '../store/authStore';
import { collaborationService as svc } from '../services/collaborationService';
import ProjectsTable from '../features/collaboration/ProjectsTable';
import { PageHeader, Btn, EmptyState, Spinner } from '../features/collaboration/ui';

const TABS = [
  { id: 'mine', label: 'My Projects' },
  { id: 'shared', label: 'Shared With Me' },
  { id: 'groups', label: 'Group Projects' },
];

export default function SharedProjectsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { sharedProjects, sharedLoading, fetchSharedProjects, groups, fetchGroups } = useCollabStore();
  const [tab, setTab] = useState('shared');
  const [groupProjects, setGroupProjects] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSharedProjects();
    fetchGroups();
  }, [isAuthenticated, fetchSharedProjects, fetchGroups]);

  // Group Projects: everything shared into the groups I belong to, including my own projects shared there.
  useEffect(() => {
    if (tab !== 'groups' || !isAuthenticated) return;
    let cancelled = false;
    setGroupProjects(null);
    Promise.all(groups.filter((g) => g.myStatus === 'active').map((g) => svc.listGroupProjects(g.id).then((res) => (res.data.data || []).map((p) => ({ ...p, groups: [{ id: g.id, name: g.name }] }))).catch(() => [])))
      .then((lists) => { if (!cancelled) setGroupProjects(lists.flat().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))); });
    return () => { cancelled = true; };
  }, [tab, groups, isAuthenticated]);

  if (!isAuthenticated) {
    return <EmptyState icon={Share2} title="Log in to see shared projects" action={<Btn onClick={() => navigate('/login?redirect=/collab/projects')}>Log in</Btn>} />;
  }

  return (
    <div>
      <PageHeader title="Collaborative projects" subtitle="Open a shared project to work on the same code as your team." />
      <div className="flex gap-1 border-b border-[#E2E5E8] mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => (t.id === 'mine' ? navigate('/') : setTab(t.id))}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-zinc-900 text-[#111827]' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'shared' && (sharedLoading && sharedProjects.length === 0 ? <Spinner label="Loading shared projects..." /> : sharedProjects.length === 0 ? (
        <EmptyState icon={Share2} title="Nothing is shared with you yet" text="When a group admin shares a project with a group you are in, it appears here." action={<Btn variant="outline" icon={UsersRound} onClick={() => navigate('/groups')}>Go to groups</Btn>} />
      ) : <ProjectsTable projects={sharedProjects} />)}

      {tab === 'groups' && (groupProjects === null ? <Spinner label="Loading group projects..." /> : groupProjects.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No group projects" text="Projects shared with your groups appear here." action={<Btn variant="outline" icon={UsersRound} onClick={() => navigate('/groups')}>Go to groups</Btn>} />
      ) : <ProjectsTable projects={groupProjects} />)}
    </div>
  );
}
