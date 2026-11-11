import React from 'react';
import { useAuthStore } from '../../store/authStore';
import { usePublishing } from './usePublishing';
import DomainSection from './DomainSection';

// Connect a domain you already own to the published site.
export function DomainPanel({ project }) {
  const projectId = project?._id || project?.id || null;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { site } = usePublishing(projectId, { enabled: Boolean(isAuthenticated) });

  if (!isAuthenticated) return <p className="text-xs text-zinc-500">Log in to manage domains.</p>;

  return (
    <div className="space-y-4">
      {site ? <DomainSection projectId={projectId} /> : <p className="text-[11px] text-zinc-500">Publish the project (Publish tab) to connect a domain you already own.</p>}
    </div>
  );
}

export default DomainPanel;
