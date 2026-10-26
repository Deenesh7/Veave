import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UsersRound, Plus, FolderOpen, Mail } from 'lucide-react';
import { useCollabStore } from '../store/collabStore';
import { useAuthStore } from '../store/authStore';
import { PageHeader, Btn, Card, EmptyState, Spinner, RoleBadge, Notice, StatusBadge } from '../features/collaboration/ui';
import CreateGroupDialog from '../features/collaboration/CreateGroupDialog';

export default function GroupsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { groups, groupsLoading, groupsError, fetchGroups, invitations, fetchInvitations } = useCollabStore();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchGroups();
    fetchInvitations();
  }, [isAuthenticated, fetchGroups, fetchInvitations]);

  if (!isAuthenticated) {
    return <EmptyState icon={UsersRound} title="Log in to use groups" text="Groups let you work on the same projects with your team." action={<Btn onClick={() => navigate('/login?redirect=/groups')}>Log in</Btn>} />;
  }

  return (
    <div>
      <PageHeader
        title="Groups"
        subtitle="Work on shared projects with your team."
        actions={<>
          <Btn variant="outline" icon={Mail} onClick={() => navigate('/invitations')}>
            Invitations{invitations.length ? ` (${invitations.length})` : ''}
          </Btn>
          <Btn icon={Plus} onClick={() => setCreating(true)}>Create group</Btn>
        </>}
      />

      {invitations.length > 0 && (
        <div className="mb-4">
          <Notice kind="success">
            You have {invitations.length} pending invitation{invitations.length > 1 ? 's' : ''}. <Link to="/invitations" className="underline font-semibold">Review them</Link>
          </Notice>
        </div>
      )}
      {groupsError && <div className="mb-4"><Notice>{groupsError}</Notice></div>}

      {groupsLoading && groups.length === 0 ? <Spinner label="Loading groups..." /> : groups.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="You are not in any group yet"
          text="Create a group, invite teammates, then share a project with it so everyone works on the same code."
          action={<Btn icon={Plus} onClick={() => setCreating(true)}>Create your first group</Btn>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Link key={group.id} to={`/groups/${group.id}`} className="group">
              <Card className="p-4 h-full hover:border-zinc-300 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {group.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#111827] truncate">{group.name}</h3>
                      <p className="text-[10px] font-mono text-zinc-400 truncate">{group.groupId}</p>
                    </div>
                  </div>
                  {group.myStatus === 'pending' ? <StatusBadge status="pending" /> : <RoleBadge role={group.myRole} />}
                </div>
                <p className="text-xs text-zinc-500 mt-3 line-clamp-2 min-h-[2rem]">{group.description || 'No description.'}</p>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-zinc-100 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1"><UsersRound className="w-3.5 h-3.5" />{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</span>
                  <span className="flex items-center gap-1"><FolderOpen className="w-3.5 h-3.5" />{group.projectCount} project{group.projectCount === 1 ? '' : 's'}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} onCreated={(group) => navigate(`/groups/${group.id}`)} />
    </div>
  );
}
