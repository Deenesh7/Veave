import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, UsersRound } from 'lucide-react';
import { useCollabStore } from '../store/collabStore';
import { useAuthStore } from '../store/authStore';
import { collaborationService as svc } from '../services/collaborationService';
import ProjectsTable from '../features/collaboration/ProjectsTable';
import { PageHeader, Btn, EmptyState, Spinner } from '../features/collaboration/ui';

// Projects I own that I have shared with others (through groups I belong to).
export default function SharedPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuthStore();
  const { groups, fetchGroups } = useCollabStore();
  const [projects, setProjects] = useState(null);
  const myId = String(user?._id || user?.id || '');

  useEffect(() => {
    if (isAuthenticated) fetchGroups();
  }, [isAuthenticated, fetchGroups]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    setProjects(null);
    Promise.all(
      groups
        .filter((g) => g.myStatus === 'active')
        .map((g) =>
          svc
            .listGroupProjects(g.id)
            .then((res) => (res.data.data || []).map((p) => ({ ...p, groups: [{ id: g.id, name: g.name }] })))
            .catch(() => [])
        )
    ).then((lists) => {
      if (cancelled) return;
      const byId = new Map();
      lists.flat().forEach((p) => {
        if (String(p.owner?.id || '') !== myId && p.access !== 'owner') return;
        const prev = byId.get(p._id);
        if (prev) prev.groups = [...prev.groups, ...p.groups];
        else byId.set(p._id, { ...p });
      });
      setProjects([...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
    });
    return () => { cancelled = true; };
  }, [groups, isAuthenticated, myId]);

  if (!isAuthenticated) {
    return <EmptyState icon={Share2} title="Log in to see shared projects" action={<Btn onClick={() => navigate('/login?redirect=/shared')}>Log in</Btn>} />;
  }

  return (
    <div>
      <PageHeader title="Shared with Others" subtitle="Projects you own that you have shared with your groups." />
      {projects === null ? (
        <Spinner label="Loading shared projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="You haven't shared any projects yet"
          text="Share a project with a group and it will appear here."
          action={<Btn variant="outline" icon={UsersRound} onClick={() => navigate('/groups')}>Go to groups</Btn>}
        />
      ) : (
        <ProjectsTable projects={projects} />
      )}
    </div>
  );
}
