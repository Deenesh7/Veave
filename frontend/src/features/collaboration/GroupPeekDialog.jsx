import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Clock, Plus, Coins, UsersRound } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../../services/collaborationService';
import { CreateGroupProjectDialog } from '../../pages/GroupDetailPage';
import GroupCreditsDialog from './GroupCreditsDialog';
import { useCollabStore } from '../../store/collabStore';
import { useAuthStore } from '../../store/authStore';
import { isSupportUser, Modal, inputClass, Btn, ConfirmDialog, Spinner, Notice, RoleBadge, StatusBadge, EmptyState, timeAgo } from './ui';

// The people of ONE project: its owner, its project admins and anyone it was shared with directly (the last needs project-admin rights to read).
function ProjectMembersTable({ project, group }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    const map = new Map();
    const add = (u, role) => { if (u?.id && !map.has(String(u.id))) map.set(String(u.id), { id: String(u.id), name: u.name, email: u.email, role }); };
    add(project.owner, 'Owner');
    (project.admins || []).forEach((a) => add(a, 'Admin'));
    const finish = () => alive && setRows([...map.values()]);
    const label = (p) => (p === 'admin' ? 'Admin' : p === 'editor' ? 'Editor' : 'Viewer');
    const groupMembers = group?.id
      ? svc.listMembers(group.id).then((res) => (res.data.data || []).filter((m) => m.status === 'active').forEach((m) => add({ id: m.userId, name: m.user?.name, email: m.user?.email }, label(project.groupPermission))))
      : Promise.resolve();
    groupMembers.catch(() => {}).then(() => svc.listShares(project._id))
      .then((res) => (res.data.data?.shares || []).filter((x) => x.targetType === 'user' && x.user).forEach((x) => add({ id: x.user.id || x.userId, name: x.user.name, email: x.user.email }, x.permission === 'admin' ? 'Admin' : x.permission === 'editor' ? 'Editor' : 'Viewer')))
      .catch(() => {})
      .finally(finish);
    return () => { alive = false; };
  }, [project._id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div onClick={(e) => e.stopPropagation()} className="cursor-default overflow-x-auto rounded-lg border border-[#E2E5E8] bg-white">
      {rows === null ? <div className="p-3"><Spinner label="Loading members..." /></div> : (
        <table className="w-full text-left text-[11px]">
          <thead className="bg-zinc-50 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><tr><th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Email</th><th className="px-2 py-1.5">Access</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? <tr><td colSpan={4} className="px-2 py-3 text-center text-zinc-500">No members.</td></tr> : rows.map((m, i) => (
              <tr key={m.id}><td className="px-2 py-1.5 text-zinc-400">{i + 1}</td><td className="px-2 py-1.5 font-semibold text-[#111827]">{m.name || 'Unknown'}</td><td className="px-2 py-1.5 text-zinc-600">{m.email || '-'}</td><td className="px-2 py-1.5">{m.role}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * A box over the groups list that shows everything of one group at a glance: its members (what the member icon opens) or its projects
 * (what the folder icon opens). Nothing is changed here; the group page has the management tools.
 */
export default function GroupPeekDialog({ open, onClose, group, kind }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const me = useAuthStore((state) => state.user);
  const myId = String(me?._id || me?.id || '');
  const support = isSupportUser(me);
  const isOwner = group?.myRole === 'owner';
  const [creating, setCreating] = useState(false);
  const [creditFor, setCreditFor] = useState(null); // 'all' or a project
  const openCredits = (project) => setCreditFor(project);
  const canCreate = kind === 'projects' && group?.myStatus === 'active' && ['owner', 'admin'].includes(group?.myRole);
  const [picked, setPicked] = useState(null);
  const [next, setNext] = useState(null);
  const [openMembers, setOpenMembers] = useState(null);
  const canManage = (member) => (support || (isOwner && member.role !== 'admin')) && kind === 'members' && member.role !== 'owner' && member.userId !== myId;
  const adminCount = (rows || []).filter((row) => row.role === 'admin' && row.status !== 'pending').length;
  const applyRole = async () => {
    try { await svc.setMemberRole(group.id, picked.userId, next); } catch (err) { throw new Error(apiErrorMessage(err, 'Could not change the role.')); }
    setRows((list) => list.map((row) => (row.id === picked.id ? { ...row, role: next } : row)));
    setPicked(null);
  };

  useEffect(() => {
    if (!open || !group) return undefined;
    let alive = true;
    setRows(null); setError(null);
    (kind === 'members' ? svc.listMembers(group.id) : svc.listGroupProjects(group.id))
      .then((res) => alive && setRows(res.data.data || []))
      .catch((err) => alive && setError(apiErrorMessage(err, kind === 'members' ? 'Could not load the members.' : 'Could not load the projects.')));
    return () => { alive = false; };
  }, [open, group?.id, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!group) return null;
  const members = kind === 'members';
  const active = (rows || []).filter((row) => row.status !== 'pending');
  const pending = (rows || []).filter((row) => row.status === 'pending');

  return (
    <>
    <Modal open={open} onClose={onClose} wide actions={!members && rows ? (
      <>
        <button type="button" disabled={!support || rows.length === 0} onClick={() => openCredits('all')} title={support ? 'Manage the credits of the whole group' : 'Credits of the whole group'}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 transition enabled:hover:border-amber-400 enabled:hover:bg-amber-100 disabled:cursor-default">
          <Coins className="h-3.5 w-3.5" />{rows.reduce((sum, row) => sum + (Number(row.creditBalance) || 0), 0)}{support && <span className="font-semibold">Manage</span>}
        </button>
        {canCreate && (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700">
            <Plus className="h-3.5 w-3.5" />New project
          </button>
        )}
      </>
    ) : null} title={members ? `Members of ${group.name}` : `Projects in ${group.name}`}
      description={members ? `${rows ? active.length : group.memberCount} member${(rows ? active.length : group.memberCount) === 1 ? '' : 's'}` : `${rows ? rows.length : group.projectCount} project${(rows ? rows.length : group.projectCount) === 1 ? '' : 's'} shared with this group`}>
      {error && <Notice>{error}</Notice>}
      {!error && rows === null && <Spinner label={members ? 'Loading members...' : 'Loading projects...'} />}

      {rows && members && (
        active.length === 0 ? <EmptyState title="No members yet" text="Invite people from the group page." /> : (
          <ul className="grid gap-2">
            {active.map((member) => (
              <li key={member.id} onClick={() => canManage(member) && setPicked(member)} className={`flex items-center gap-3 rounded-xl border border-[#E2E5E8] bg-white p-3 ${canManage(member) ? 'cursor-pointer hover:border-zinc-300 hover:shadow-sm' : ''}`}>
                <span className="w-9 h-9 rounded-full bg-zinc-200 text-zinc-700 flex items-center justify-center text-xs font-bold shrink-0">{(member.user?.name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#111827]">{member.user?.name || 'Unknown'}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{member.user?.email}</span>
                </span>
                <RoleBadge role={member.role} />
              </li>
            ))}
          </ul>
        )
      )}
      {rows && members && pending.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Waiting for approval ({pending.length})</p>
          <ul className="grid gap-2">
            {pending.map((member) => (
              <li key={member.id} className="flex items-center gap-3 rounded-xl border border-dashed border-[#E2E5E8] bg-zinc-50 p-3">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{member.user?.name}</span><span className="block truncate text-[11px] text-zinc-500">{member.user?.email}</span></span>
                <StatusBadge status="pending" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows && !members && (
        rows.length === 0 ? <EmptyState icon={FolderOpen} title="No projects in this group" text="An admin can create a project here or share one of their own." /> : (
          <ul className={`grid gap-3 ${rows.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {rows.map((project) => (
              <li key={project._id}>
                <div role="button" tabIndex={0} onClick={() => navigate(`/editor/${project._id}`)} onKeyDown={(e) => { if (e.target === e.currentTarget && e.key === 'Enter') navigate(`/editor/${project._id}`); }}
                  className="h-full w-full cursor-pointer rounded-xl border border-[#E2E5E8] bg-white p-3 text-left transition hover:border-zinc-300 hover:shadow-md">
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="truncate text-sm font-semibold text-[#111827]">{project.name}</span>
                      {support && (
                        <button type="button" title="Manage this project's credits" onClick={(e) => { e.stopPropagation(); openCredits(project); }}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100">
                          <Coins className="h-3 w-3" />{project.creditBalance ?? 0}
                        </button>
                      )}
                    </span>
                    <span className="relative flex shrink-0 items-center gap-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setOpenMembers(project); }}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${'border-[#E2E5E8] bg-white text-zinc-700 hover:border-zinc-400'}`}>
                        <span className="flex -space-x-1">
                          {[project.owner, ...(project.admins || [])].filter(Boolean).slice(0, 3).map((u, i) => (
                            <span key={`${u.id}-${i}`} title={u.name} className="flex h-4 w-4 items-center justify-center rounded-full border border-white bg-zinc-300 text-[8px] font-bold text-zinc-700">{(u.name || '?').slice(0, 1).toUpperCase()}</span>
                          ))}
                        </span>
                        Members
                      </button>
                      <RoleBadge role={project.access} />
                    </span>
                  </span>
                  {project.description ? <span className="mt-1.5 line-clamp-2 block text-[11px] text-zinc-500">{project.description}</span> : null}
                  <span className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">Owner: {project.owner?.name || 'You'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(project.updatedAt)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )
      )}
    </Modal>

    <Modal open={Boolean(openMembers)} onClose={() => setOpenMembers(null)} title={`Members of ${openMembers?.name || 'project'}`} description="People who can access this project.">
      {openMembers && <ProjectMembersTable key={openMembers._id} project={openMembers} group={group} />}
    </Modal>

    {support && (
      <GroupCreditsDialog open={Boolean(creditFor)} onClose={() => setCreditFor(null)} group={group} projectId={creditFor && creditFor !== 'all' ? creditFor._id : null}
        onChanged={(list) => setRows((current) => (current || []).map((row) => { const fresh = list.find((p) => p.id === String(row._id)); return fresh ? { ...row, creditBalance: fresh.creditBalance } : row; }))} />
    )}

      {canCreate && <CreateGroupProjectDialog open={creating} onClose={() => setCreating(false)} group={group} onDone={() => useCollabStore.getState().fetchGroups()} />}

      <Modal open={Boolean(picked) && !next} onClose={() => setPicked(null)} title={picked?.user?.name || 'Member'} description={picked?.user?.email}>
        <p className="mb-3 text-xs font-semibold text-zinc-500">Choose a role in {group.name}</p>
        <div className="grid gap-2">
          {[['member', 'Staff', 'Can open shared projects'], ['editor', 'Editor', 'Can edit shared projects'], ['admin', 'Admin', `Manages the whole group (${adminCount}/3 admin seats used, owner not counted)`]].map(([value, label, hint]) => {
            const current = picked?.role === value;
            const locked = value === 'admin' && !support;
            const full = value === 'admin' && !current && adminCount >= 3;
            return (
              <button key={value} type="button" disabled={current || full || locked} onClick={() => setNext(value)}
                className={`rounded-xl border p-3 text-left transition ${current ? 'border-zinc-900 bg-zinc-50' : 'border-[#E2E5E8] hover:border-zinc-300'} disabled:cursor-not-allowed ${full || locked ? 'opacity-50' : ''}`}>
                <span className="block text-sm font-semibold text-[#111827]">{label}{current ? ' (current)' : ''}</span>
                <span className="block text-[11px] text-zinc-500">{locked ? 'Only a support admin can assign group admins' : full ? 'Admin limit reached (3 admins besides the owner)' : hint}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(picked && next)} onClose={() => setNext(null)} danger={false}
        title={next === 'admin' ? `Make ${picked?.user?.name} an admin?` : `Change role of ${picked?.user?.name}?`}
        description={next === 'admin'
          ? `Are you sure? ${picked?.user?.name} will become an admin of the whole ${group.name} group and can manage its members and all its websites.`
          : `${picked?.user?.name} will become ${next === 'editor' ? 'an editor' : 'staff'} in ${group.name}.`}
        confirmLabel={next === 'admin' ? 'Yes, make admin' : 'Confirm'}
        onConfirm={applyRole} />
    </>
  );
}
