import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, UsersRound, FolderOpen, Mail, Settings, Plus, Share2, UserPlus, LogOut, Check, X, Trash2 } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../services/collaborationService';
import { useCollabStore } from '../store/collabStore';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import ProjectsTable from '../features/collaboration/ProjectsTable';
import {
  PageHeader, Btn, Card, EmptyState, Spinner, RoleBadge, StatusBadge, Notice, Modal, ConfirmDialog, Field, inputClass, useFlash, timeAgo
} from '../features/collaboration/ui';

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

  const load = useCallback(async () => {
    try {
      const res = await svc.getGroup(groupId);
      setGroup(res.data.data);
      setError(null);
    } catch (err) {
      setError(err.response?.status === 404 ? 'not-found' : apiErrorMessage(err, 'Could not load this group.'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

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
        subtitle={`${group.groupId}${group.description ? ` · ${group.description}` : ''}`}
      />

      {pending && <div className="mb-4"><Notice kind="success">Your membership is waiting for an admin to approve it. You will get access to the group's projects once approved.</Notice></div>}

      {!pending && (
        <>
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
        </>
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
      ) : <ProjectsTable projects={projects} showGroup={false} />}

      <CreateGroupProjectDialog open={creating} onClose={() => setCreating(false)} group={group} onDone={load} />
      <ShareExistingDialog open={sharing} onClose={() => setSharing(false)} group={group} projects={myProjects} alreadyShared={(projects || []).map((p) => p._id)} onDone={load} />
    </div>
  );
}

function CreateGroupProjectDialog({ open, onClose, group, onDone }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [permission, setPermission] = useState(group.settings?.defaultProjectPermission || 'editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setName(''); setError(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await svc.createGroupProject(group.id, { name, permission });
      onClose();
      onDone?.();
      navigate(`/editor/${res.data.data._id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the project.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New group project" description={`Creates a project you own and shares it with ${group.name}.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Project name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus /></Field>
        <Field label="Member access" hint="Editors can change code and use the AI. Viewers can only look.">
          <select className={inputClass} value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </Field>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2"><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn type="submit" loading={busy} disabled={!name.trim()}>Create and open</Btn></div>
      </form>
    </Modal>
  );
}

function ShareExistingDialog({ open, onClose, group, projects, alreadyShared, onDone }) {
  const user = useAuthStore((s) => s.user);
  const candidates = useMemo(
    () => (projects || []).filter((p) => !alreadyShared.includes(p._id) && (!p.userId || String(p.userId) === String(user?._id || user?.id))),
    [projects, alreadyShared, user]
  );
  const [projectId, setProjectId] = useState('');
  const [permission, setPermission] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setProjectId(candidates[0]?._id || ''); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {candidates.length === 0 ? <p className="text-xs text-zinc-500">You have no other projects to share. Create one from the dashboard first.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Project">
            <select className={inputClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {candidates.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Access for group members">
            <select className={inputClass} value={permission} onChange={(e) => setPermission(e.target.value)}>
              <option value="viewer">Viewer - can look, cannot change</option>
              <option value="editor">Editor - can edit code and use the AI</option>
            </select>
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
  const myId = String(me?._id || me?.id || '');
  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const [confirmRemove, setConfirmRemove] = useState(null);
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
              const canChangeRole = m.role !== 'owner' && !isMe && (isOwner || (group.myRole === 'admin' && m.role === 'member'));
              const canRemove = isAdmin && m.role !== 'owner' && !isMe && (isOwner || m.role === 'member');
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 text-zinc-700 flex items-center justify-center text-xs font-bold shrink-0">{(m.user?.name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111827] truncate">{m.user?.name}{isMe && <span className="text-zinc-400 font-normal"> (you)</span>}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{m.user?.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canChangeRole && isOwner ? (
                      <select
                        aria-label={`Role of ${m.user?.name}`}
                        className="text-xs rounded-lg border border-[#E2E5E8] bg-white px-2 py-1"
                        value={m.role}
                        onChange={(e) => act(() => svc.setMemberRole(group.id, m.userId, e.target.value), `${m.user?.name} is now ${e.target.value === 'admin' ? 'an admin' : 'a member'}.`)}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
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
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const isOwner = group.myRole === 'owner';

  const load = useCallback(async () => {
    try { setList((await svc.listGroupInvitations(group.id)).data.data || []); } catch (err) { setError(apiErrorMessage(err, 'Could not load invitations.')); }
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await svc.inviteToGroup(group.id, { email, role });
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
          {isOwner && (
            <Field label="Role">
              <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select>
            </Field>
          )}
          <Btn type="submit" loading={busy} disabled={!email}>Send invitation</Btn>
        </form>
        <p className="text-[11px] text-zinc-500 mt-2">We email the invitation (and notify them in the app if they have an account). They join only after they accept. Invitations expire after 7 days.</p>
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
                  <p className="text-[11px] text-zinc-500 truncate">{inv.inviteeEmail} · invited by {inv.inviter?.name} · {timeAgo(inv.createdAt)} · as {inv.role}</p>
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
            <select className={inputClass} value={defaultPerm} onChange={(e) => setDefaultPerm(e.target.value)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
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
