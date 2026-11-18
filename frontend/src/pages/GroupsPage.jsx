import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UsersRound, Plus, FolderOpen, Mail } from 'lucide-react';
import { useCollabStore } from '../store/collabStore';
import { useAuthStore } from '../store/authStore';
import { PageHeader, Btn, Card, EmptyState, Spinner, RoleBadge, Notice, StatusBadge } from '../features/collaboration/ui';
import CreateGroupDialog from '../features/collaboration/CreateGroupDialog';
import GroupPeekDialog from '../features/collaboration/GroupPeekDialog';

export default function GroupsPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { groups, groupsLoading, groupsError, fetchGroups, invitations, fetchInvitations } = useCollabStore();
  const [creating, setCreating] = useState(false);
  const [peek, setPeek] = useState(null); // { group, kind: 'members' | 'projects' }

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
          <Btn icon={Plus} onClick={() => setCreating(true)}>Create website group</Btn>
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
          title="You are not in any website group yet"
          text="Create a website group, invite teammates, then share a project with it so everyone works on the same code."
          action={<Btn icon={Plus} onClick={() => setCreating(true)}>Create your first website group</Btn>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            // The whole box opens the group. The two counters open a box with the members or the projects instead (and do not open the group).
            <Card
              key={group.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/groups/${group.id}`)}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); navigate(`/groups/${group.id}`); } }}
              className="h-full cursor-pointer p-4 transition-all hover:border-zinc-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {group.name.slice(0, 1).toUpperCase()}
                  </div>
                  <h3 className="text-sm font-bold text-[#111827] truncate">{group.name}</h3>
                </div>
                {group.myStatus === 'pending' ? <StatusBadge status="pending" /> : <RoleBadge role={group.myRole} />}
              </div>
              <p className="text-xs text-zinc-500 mt-3 line-clamp-2 min-h-[2rem]">{group.description || 'No description.'}</p>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-100 text-[11px] text-zinc-600">
                {[['members', UsersRound, group.memberCount, 'member'], ['projects', FolderOpen, group.projectCount, 'project']].map(([kind, Icon, count, noun]) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={group.myStatus === 'pending'}
                    onClick={(event) => { event.stopPropagation(); setPeek({ group, kind }); }}
                    title={`Show the ${kind} of this group`}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition hover:bg-zinc-100 hover:text-[#111827] disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <Icon className="w-3.5 h-3.5" />{count} {noun}{count === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <GroupPeekDialog open={Boolean(peek)} onClose={() => setPeek(null)} group={peek?.group} kind={peek?.kind} />
      <CreateGroupDialog open={creating} onClose={() => setCreating(false)} onCreated={(group) => navigate(`/groups/${group.id}`)} />
    </div>
  );
}
