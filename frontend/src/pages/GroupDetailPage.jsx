import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UsersRound, FolderOpen, Mail, Settings, Plus, Share2, UserPlus, LogOut, Check, X, Trash2 } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../services/collaborationService';
import { useCollabStore } from '../store/collabStore';
import { useProjectStore } from '../store/projectStore';
import { useTemplateStudioStore } from '../store/templateStudioStore';
import { useAuthStore } from '../store/authStore';
import ProjectsTable from '../features/collaboration/ProjectsTable';
import ProjectAdminDialog from '../features/collaboration/ProjectAdminDialog';
import {
  PageHeader, Btn, Card, EmptyState, Spinner, RoleBadge, StatusBadge, Notice, Modal, ConfirmDialog, Field, inputClass, useFlash, timeAgo, RoleSelect, roleLabel, isSupportUser
} from '../features/collaboration/ui';
import Dropdown from '../components/ui/Dropdown';

const TABS = [
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'members', label: 'Members', icon: UsersRound },
  { id: 'invitations', label: 'Invitations', icon: Mail, adminOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
];

export default function GroupDetailPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const fetchGroups = useCollabStore((s) => s.fetchGroups);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('projects');

  const latest = React.useRef(groupId);
  latest.current = groupId;

  const load = useCallback(async () => {
    try {
      const res = await svc.getGroup(groupId);
      if (latest.current !== groupId) return; // the user already moved to another group
      setGroup(res.data.data);
      setError(null);
    } catch (err) {
      if (latest.current !== groupId) return;
      setError(err.response?.status === 404 ? 'not-found' : apiErrorMessage(err, 'Could not load this group.'));
    } finally {
      if (latest.current === groupId) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { setLoading(true); setGroup(null); setError(null); setTab('projects'); load(); }, [load]);

  if (loading) return <Spinner label="Loading group..." />;
  if (error === 'not-found' || !group) {
    return <EmptyState icon={UsersRound} title="Group not found" text="It may have been deleted, or you are not a member of it." action={<Btn onClick={() => navigate('/groups')}>Back to groups</Btn>} />;
  }
  if (error) return <Notice>{error}</Notice>;

  const isAdmin = ['owner', 'admin'].includes(group.myRole);
  const pending = group.myStatus === 'pending';
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div>
      <PageHeader
        back={<Link to="/groups" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-[#111827] mb-2"><ArrowLeft className="w-3.5 h-3.5" />All groups</Link>}
        title={<span className="flex items-center gap-2">{group.name} <RoleBadge role={group.myRole} /></span>}
        subtitle={group.description || undefined}
      />

      {pending && <div className="mb-4"><Notice kind="success">Your membership is waiting for an admin to approve it. You will get access to the group's projects once approved.</Notice></div>}

      {!pending && (
        <React.Fragment key={group.id}>
          <div className="flex gap-1 border-b border-[#E2E5E8] mb-5 overflow-x-auto">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === id ? 'border-zinc-900 text-[#111827]' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}
              >
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          {tab === 'projects' && <ProjectsTab group={group} isAdmin={isAdmin} />}
          {tab === 'members' && <MembersTab group={group} onChanged={() => { load(); fetchGroups(); }} />}
          {tab === 'invitations' && isAdmin && <InvitationsTab group={group} />}
          {tab === 'settings' && isAdmin && <SettingsTab group={group} onSaved={(g) => { setGroup((prev) => ({ ...prev, ...g })); fetchGroups(); }} />}
        </React.Fragment>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- Projects */

function ProjectsTab({ group, isAdmin }) {
  const myProjects = useProjectStore((s) => s.projects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [adminFor, setAdminFor] = useState(null);
  const [membersFor, setMembersFor] = useState(null);
  const viewer = useAuthStore((s) => s.user);
  const canAssign = isAdmin || isSupportUser(viewer);

  const load = useCallback(async () => {
    try {
      const res = await svc.listGroupProjects(group.id);
      setProjects(res.data.data || []);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the group projects.'));
    }
  }, [group.id]);

  useEffect(() => { load(); if (isAdmin) fetchProjects(); }, [load, isAdmin, fetchProjects]);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Btn icon={Plus} onClick={() => setCreating(true)}>New group project</Btn>
          <Btn variant="outline" icon={Share2} onClick={() => setSharing(true)}>Share an existing project</Btn>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
      {projects === null ? <Spinner label="Loading projects..." /> : projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects shared with this group"
          text={isAdmin ? 'Create a project for the group, or share one of your existing projects. Members only see projects shared here.' : 'An admin has not shared any project with this group yet.'}
        />
      ) : <ProjectsTable projects={projects} showGroup={false} showAdmins onAssignAdmin={canAssign ? setAdminFor : null} onSelect={setMembersFor} />}
      <ProjectMembersDialog project={membersFor} group={group} onClose={() => setMembersFor(null)} />
      <ProjectAdminDialog open={Boolean(adminFor)} onClose={() => setAdminFor(null)} group={group} project={adminFor && projects ? projects.find((p) => p._id === adminFor._id) || adminFor : null} onChanged={load} />

      <CreateGroupProjectDialog open={creating} onClose={() => setCreating(false)} group={group} onDone={load} />
      <ShareExistingDialog open={sharing} onClose={() => setSharing(false)} group={group} projects={myProjects} alreadyShared={(projects || []).map((p) => p._id)} onDone={load} />
    </div>
  );
}

function ProjectMembersDialog({ project, group, onClose }) {
  const navigate = useNavigate();
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const pid = project?._id;
  useEffect(() => {
    if (!pid) return undefined;
    let alive = true;
    setMembers(null); setError(null);
    svc.listMembers(group.id)
      .then((res) => { if (alive) setMembers((res.data.data || []).filter((m) => m.status === 'active')); })
      .catch((err) => { if (alive) setError(apiErrorMessage(err, 'Could not load the members.')); });
    return () => { alive = false; };
  }, [pid, group.id]);
  const adminIds = new Set((project?.admins || []).map((a) => String(a.id)));
  const access = project?.groupPermission || 'viewer';

  return (
    <Modal open={Boolean(project)} onClose={onClose} wide title={project?.name || 'Project'} description={`Members with access to this project through ${group.name}.`}
      footer={<><Btn variant="outline" onClick={onClose}>Close</Btn><Btn onClick={() => navigate(`/editor/${pid}`)}>Open project</Btn></>}>
      {error && <Notice>{error}</Notice>}
      {!error && members === null ? <Spinner label="Loading members..." /> : members && (
        <div className="overflow-x-auto rounded-lg border border-[#E2E5E8]">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Group role</th><th className="px-3 py-2">Project access</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {members.length === 0 ? <tr><td colSpan={5} className="px-3 py-4 text-center text-zinc-500">No members yet.</td></tr> : members.map((m, i) => (
                <tr key={m.userId}>
                  <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
                  <td className="px-3 py-2 font-semibold text-[#111827]">{m.user?.name || '-'}</td>
                  <td className="px-3 py-2 text-zinc-600">{m.user?.email || '-'}</td>
                  <td className="px-3 py-2"><RoleBadge role={m.role} /></td>
                  <td className="px-3 py-2">{String(m.userId) === String(project.owner?.id) ? 'Owner' : adminIds.has(String(m.userId)) ? 'Admin' : roleLabel(access)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export function CreateGroupProjectDialog({ open, onClose, group }) {
  const navigate = useNavigate();
  const setGroupLink = useTemplateStudioStore((state) => state.setGroupLink);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState(group.settings?.defaultProjectPermission || 'editor');
  useEffect(() => { if (open) setName(''); }, [open]);

  // The project is made in Template Studio, where the website is built from a template; it is shared with this group when it is created.
  const submit = (e) => {
    e.preventDefault();
    setGroupLink({ groupId: group.id, groupName: group.name, permission, name: name.trim() });
    onClose();
    navigate('/template-studio');
  };

  return (
    <Modal open={open} onClose={onClose} title="New group project" description={`Next you choose a template in Template Studio. The new website is shared with ${group.name}.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus /></Field>
        <Field label="Member access" hint="Editors can change code and use the AI. Viewers can only look.">
          <Dropdown className={inputClass} value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </Dropdown>
        </Field>
        <div className="flex justify-end gap-2"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn type="submit" disabled={!name.trim()}>Continue to templates</Btn></div>
      </form>
    </Modal>
  );
}

function ShareExistingDialog({ open, onClose, group, projects, alreadyShared, onDone }) {
  const user = useAuthStore((s) => s.user);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const loadingProjects = useProjectStore((s) => s.isLoading);
  const me = String(user?._id || user?.id || '');
  // Your own projects that are not in this group yet. When the account is not loaded yet, nothing is hidden by owner (the server still checks).
  const candidates = useMemo(
    () => (projects || []).filter((p) => !alreadyShared.includes(p._id) && (!me || !p.userId || String(p.userId) === me)),
    [projects, alreadyShared, me]
  );
  const [picked, setPicked] = useState('');
  const [permission, setPermission] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The chosen project is always one that is really in the list: the first one until the owner picks another. (It used to be set once, when
  // the dialog opened; if the list was still loading it stayed empty and the Share button never turned on.)
  const projectId = candidates.some((p) => p._id === picked) ? picked : (candidates[0]?._id || '');
  // The list is read again every time the dialog opens, so a project made a moment ago is there.
  useEffect(() => { if (open) { setPicked(''); setError(null); fetchProjects(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await svc.shareProject(projectId, { groupId: group.id, permission });
      onClose();
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not share the project.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share a project with this group" description="Only the project you pick is shared. Group members never get access to your other projects.">
      {candidates.length === 0 ? (loadingProjects ? <Spinner label="Loading your projects..." /> : <p className="text-xs text-zinc-500">You have no other projects to share. Create one from the dashboard first.</p>) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Project">
            <Dropdown className={inputClass} value={projectId} onChange={(e) => setPicked(e.target.value)}>
              {candidates.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </Dropdown>
          </Field>
          <Field label="Access for group members">
            <Dropdown className={inputClass} value={permission} onChange={(e) => setPermission(e.target.value)}>
              <option value="viewer">Viewer - can look, cannot change</option>
              <option value="editor">Editor - can edit code and use the AI</option>
            </Dropdown>
          </Field>
          {error && <Notice>{error}</Notice>}
          <div className="flex justify-end gap-2"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn type="submit" loading={busy} disabled={!projectId}>Share project</Btn></div>
        </form>
      )}
    </Modal>
  );
}

/* ----------------------------------------------------------------------------------------------- Members */

function MembersTab({ group, onChanged }) {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const support = isSupportUser(me);
  const myId = String(me?._id || me?.id || '');
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirmTransfer, setConfirmTransfer] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const isOwner = group.myRole === 'owner';
  const isAdmin = ['owner', 'admin'].includes(group.myRole);

  const load = useCallback(async () => {
    try {
      const res = await svc.listMembers(group.id);
      setMembers(res.data.data || []);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load members.'));
    }
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setError(null);
    try { await fn(); setFlash(success); await load(); onChanged?.(); } catch (err) { setError(apiErrorMessage(err)); }
  };

  const pending = (members || []).filter((m) => m.status === 'pending');
  const active = (members || []).filter((m) => m.status === 'active');

  return (
    <div className="space-y-4">
      {error && <Notice onClose={() => setError(null)}>{error}</Notice>}
      {flash && <Notice kind="success">{flash}</Notice>}

      {isAdmin && pending.length > 0 && (
        <Card className="p-4">
          <h3 className="text-xs font-bold text-[#111827] mb-3">Waiting for approval ({pending.length})</h3>
          <ul className="divide-y divide-zinc-100">
            {pending.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0"><p className="text-sm font-semibold truncate">{m.user?.name}</p><p className="text-[11px] text-zinc-500 truncate">{m.user?.email}</p></div>
                <div className="flex gap-2">
                  <Btn icon={Check} onClick={() => act(() => svc.approveMember(group.id, m.userId), `${m.user?.name} approved.`)}>Approve</Btn>
                  <Btn variant="outline" icon={X} onClick={() => setConfirmRemove(m)}>Decline</Btn>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {members === null ? <Spinner label="Loading members..." /> : (
        <Card>
          <ul className="divide-y divide-zinc-100">
            {active.map((m) => {
              const isMe = m.userId === myId;
              const canChangeRole = m.role !== 'owner' && !isMe && (support || (m.role !== 'admin' && (isOwner || (group.myRole === 'admin' && m.role === 'member'))));
              const canRemove = isAdmin && m.role !== 'owner' && !isMe && (isOwner || m.role === 'member');
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div role="button" tabIndex={0} onClick={() => setSelected(m)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(m); }} className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer rounded-lg hover:bg-zinc-50">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 text-zinc-700 flex items-center justify-center text-xs font-bold shrink-0">{(m.user?.name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111827] truncate">{m.user?.name}{isMe && <span className="text-zinc-400 font-normal"> (you)</span>}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{m.user?.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRole && (isOwner || support) ? (
                      <RoleSelect
                        options={support ? ['member', 'editor', 'admin'] : ['member', 'editor']}
                        label={`Role of ${m.user?.name}`}
                        value={m.role}
                        onChange={(v) => act(() => svc.setMemberRole(group.id, m.userId, v), `${m.user?.name} is now ${v === 'admin' ? 'an admin' : v === 'editor' ? 'an editor' : 'staff'}.`)}
                      />
                    ) : <RoleBadge role={m.role} />}
                    {isOwner && m.role !== 'owner' && !isMe && <Btn variant="ghost" onClick={() => setConfirmTransfer(m)}>Make owner</Btn>}
                    {canRemove && <Btn variant="ghost" icon={Trash2} onClick={() => setConfirmRemove(m)} aria-label={`Remove ${m.user?.name}`}>Remove</Btn>}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.user?.name || 'Member'} description={selected?.user?.email}>
        {selected && (
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
            <dt className="text-zinc-500">Role</dt><dd><RoleBadge role={selected.role} /></dd>
            <dt className="text-zinc-500">Email</dt><dd className="break-all">{selected.user?.email}</dd>
            <dt className="text-zinc-500">Status</dt><dd className="capitalize">{selected.status}</dd>
            <dt className="text-zinc-500">Joined</dt><dd>{selected.joinedAt ? new Date(selected.joinedAt).toLocaleDateString() : 'Unknown'}</dd>
            <dt className="text-zinc-500">Can do</dt>
            <dd>{{ owner: 'Everything, including deleting the group', admin: 'Manage members and projects', editor: 'Edit shared projects', member: 'Open shared projects' }[selected.role]}</dd>
          </dl>
        )}
      </Modal>

      {group.myRole !== 'owner' && (
        <div><Btn variant="outline" icon={LogOut} onClick={() => setLeaving(true)}>Leave group</Btn></div>
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title={`Remove ${confirmRemove?.user?.name || 'member'}?`}
        description="They lose access to the group and every project shared with it immediately."
        confirmLabel="Remove member"
        onConfirm={async () => { await svc.removeMember(group.id, confirmRemove.userId).catch((e) => { throw new Error(apiErrorMessage(e)); }); setFlash('Member removed.'); await load(); onChanged?.(); }}
      />
      <ConfirmDialog
        open={!!confirmTransfer}
        onClose={() => setConfirmTransfer(null)}
        title={`Transfer ownership to ${confirmTransfer?.user?.name || ''}?`}
        description="They become the owner. You stay in the group as an admin. Only the new owner can undo this."
        confirmLabel="Transfer ownership"
        requireText={group.name}
        onConfirm={async (typed) => { await svc.transferOwnership(group.id, confirmTransfer.userId, typed).catch((e) => { throw new Error(apiErrorMessage(e)); }); setFlash('Ownership transferred.'); await load(); onChanged?.(); }}
      />
      <LeaveDialog open={leaving} onClose={() => setLeaving(false)} group={group} onLeft={() => navigate('/groups')} />
    </div>
  );
}

function LeaveDialog({ open, onClose, group, onLeft }) {
  const fetchGroups = useCollabStore((s) => s.fetchGroups);
  const [needsUnshare, setNeedsUnshare] = useState(null);
  useEffect(() => { if (open) setNeedsUnshare(null); }, [open]);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Leave ${group.name}?`}
      description="You will lose access to the group's projects."
      confirmLabel={needsUnshare ? 'Leave and stop sharing my projects' : 'Leave group'}
      onConfirm={async () => {
        try {
          await svc.leaveGroup(group.id, !!needsUnshare);
          await fetchGroups();
          onLeft();
        } catch (err) {
          if (err.response?.data?.error?.code === 'OWNED_PROJECTS_SHARED') setNeedsUnshare(err.response.data.error.details?.count || true);
          throw new Error(apiErrorMessage(err));
        }
      }}
    >
      {needsUnshare && <Notice>You own projects shared with this group. Confirm again to stop sharing them and leave.</Notice>}
    </ConfirmDialog>
  );
}

/* ----------------------------------------------------------------------------------------------- Invitations */

function InvitationsTab({ group }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [scope, setScope] = useState('group');
  const [projectId, setProjectId] = useState('');
  const [projectPermission, setProjectPermission] = useState('viewer');
  const [groupProjects, setGroupProjects] = useState(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const isOwner = group.myRole === 'owner';

  const load = useCallback(async () => {
    try { setList((await svc.listGroupInvitations(group.id)).data.data || []); } catch (err) { setError(apiErrorMessage(err, 'Could not load invitations.')); }
  }, [group.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let alive = true;
    setGroupProjects(null);
    setProjectId('');
    svc.listGroupProjects(group.id).then((res) => alive && setGroupProjects(res.data.data || [])).catch(() => alive && setGroupProjects([]));
    return () => { alive = false; };
  }, [group.id]);
  const needsProject = scope !== 'group';
  // Only a project of THIS group can be picked, so a choice left over from another group is never sent.
  const projectsHere = groupProjects || [];
  const pickedProject = projectsHere.some((p) => p._id === projectId) ? projectId : (projectsHere[0]?._id || '');

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await svc.inviteToGroup(group.id, { email, role, scope, ...(needsProject ? { projectId: pickedProject, projectPermission } : {}) });
      const d = res.data.data;
      setFlash(d.email?.sent
        ? `Invitation emailed to ${email}.${d.inviteeRegistered ? '' : ' They will need to create an account with that address first.'}`
        : `Invitation created for ${email}, but the email could not be sent (${d.email?.reason || 'unknown reason'}). ${d.inviteeRegistered ? 'They still see it in the app.' : 'Ask them to sign up with that address.'}`);
      setEmail('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send the invitation.'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (inv) => {
    setError(null);
    try { await svc.revokeInvitation(group.id, inv.invitationId); setFlash('Invitation revoked.'); await load(); } catch (err) { setError(apiErrorMessage(err)); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-xs font-bold text-[#111827] mb-3 flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" />Invite by email</h3>
        <form onSubmit={send} className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[220px]"><Field label="Email address"><input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" required /></Field></div>
          <Field label="Invite to">
            <Dropdown className={`${inputClass} w-52`} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="group">Whole group</option>
              <option value="project">Single project only</option>
              <option value="both">Whole group + a project</option>
            </Dropdown>
          </Field>
          {needsProject && (
            <>
              <div className="w-52">
                <Field label="Project">
                  <Dropdown
                    className={inputClass}
                    value={pickedProject}
                    onChange={(e) => setProjectId(e.target.value)}
                    disabled={projectsHere.length === 0}
                    placeholder={groupProjects === null ? 'Loading projects...' : 'No projects in this group'}
                  >
                    {projectsHere.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </Dropdown>
                </Field>
              </div>
              <Field label="Project access">
                <Dropdown className={`${inputClass} w-36`} value={projectPermission} onChange={(e) => setProjectPermission(e.target.value)}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </Dropdown>
              </Field>
            </>
          )}
          {isOwner && scope !== 'project' && (
            <Field label="Group role">
              <RoleSelect value={role} onChange={setRole} options={['member', 'editor']} className="w-44" />
            </Field>
          )}
          <Btn type="submit" loading={busy} disabled={!email || (needsProject && !pickedProject)}>Send invitation</Btn>
        </form>
        {needsProject && groupProjects !== null && projectsHere.length === 0 && (
          <p className="text-[11px] text-amber-700 mt-2">This group has no projects yet. Add one on the Projects tab first, or invite them to the whole group.</p>
        )}
        <p className="text-[11px] text-zinc-500 mt-2">We email the invitation (and notify them in the app if they have an account). The email says whether it is for the whole group, a single project, or both. Their role is set automatically when they accept. Invitations expire after 7 days.</p>
      </Card>
      {error && <Notice onClose={() => setError(null)}>{error}</Notice>}
      {flash && <Notice kind="success">{flash}</Notice>}

      {list === null ? <Spinner /> : list.length === 0 ? <EmptyState icon={Mail} title="No invitations yet" text="Invitations you send appear here with their status." /> : (
        <Card>
          <ul className="divide-y divide-zinc-100">
            {list.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{inv.invitee?.name || inv.inviteeEmail}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{inv.inviteeEmail} · invited by {inv.inviter?.name} · {timeAgo(inv.createdAt)} · {inv.scope === 'project' ? `project ${inv.projectName || ''} only (${inv.projectPermission})` : inv.scope === 'both' ? `whole group as ${roleLabel(inv.role)} + project ${inv.projectName || ''} (${inv.projectPermission})` : `whole group as ${roleLabel(inv.role)}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={inv.status} />
                  {inv.status === 'pending' && <Btn variant="outline" onClick={() => revoke(inv)}>Revoke</Btn>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------------------------- Settings */

function SettingsTab({ group, onSaved }) {
  const navigate = useNavigate();
  const fetchGroups = useCollabStore((s) => s.fetchGroups);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [requireApproval, setRequireApproval] = useState(!!group.settings?.requireApproval);
  const [membersCanInvite, setMembersCanInvite] = useState(!!group.settings?.membersCanInvite);
  const [defaultPerm, setDefaultPerm] = useState(group.settings?.defaultProjectPermission || 'editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const [deleting, setDeleting] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await svc.updateGroup(group.id, { name, description, settings: { requireApproval, membersCanInvite, defaultProjectPermission: defaultPerm } });
      onSaved(res.data.data);
      setFlash('Settings saved.');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save settings.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-5">
        <form onSubmit={save} className="space-y-4">
          <Field label="Group name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
          <Field label="Description"><textarea className={`${inputClass} resize-none`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>
          <label className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
            <span><span className="font-semibold text-[#111827]">Require admin approval</span> after someone accepts an invitation.</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={membersCanInvite} onChange={(e) => setMembersCanInvite(e.target.checked)} />
            <span><span className="font-semibold text-[#111827]">Let members invite people</span> (as plain members).</span>
          </label>
          <Field label="Default access for new group projects">
            <Dropdown className={inputClass} value={defaultPerm} onChange={(e) => setDefaultPerm(e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></Dropdown>
          </Field>
          {error && <Notice>{error}</Notice>}
          {flash && <Notice kind="success">{flash}</Notice>}
          <Btn type="submit" loading={busy}>Save settings</Btn>
        </form>
      </Card>

      {group.myRole === 'owner' && (
        <Card className="p-5 border-red-200">
          <h3 className="text-sm font-bold text-red-700">Danger zone</h3>
          <p className="text-xs text-zinc-500 mt-1 mb-3">Deleting the group removes all memberships and stops sharing every project with it. The projects themselves are kept by their owners.</p>
          <Btn variant="danger" icon={Trash2} onClick={() => setDeleting(true)}>Delete group</Btn>
        </Card>
      )}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this group?"
        description="This cannot be undone."
        confirmLabel="Delete group"
        requireText={group.name}
        onConfirm={async (typed) => { await svc.deleteGroup(group.id, typed).catch((e) => { throw new Error(apiErrorMessage(e)); }); await fetchGroups(); navigate('/groups'); }}
      />
    </div>
  );
}
