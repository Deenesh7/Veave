import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, UsersRound, User, Lock, Link2, Check } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../../services/collaborationService';
import { useCollabStore } from '../../store/collabStore';
import { Btn, Notice, Spinner, RoleBadge, ConfirmDialog, useFlash, inputClass } from './ui';

const PERMISSION_HELP = {
  viewer: 'Can view the project but not change it.',
  editor: 'Can edit code and use the AI.',
  admin: 'Can also manage sharing and permissions.',
};

// Real project sharing: groups and people with access, backed by /api/projects/:id/shares.
export default function ProjectSharingPanel({ project }) {
  const projectId = project?._id || project?.id;
  const groups = useCollabStore((s) => s.groups);
  const fetchGroups = useCollabStore((s) => s.fetchGroups);
  const [data, setData] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useFlash();
  const [mode, setMode] = useState('group');
  const [groupId, setGroupId] = useState('');
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('editor');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await svc.listShares(projectId);
      setData(res.data.data);
      setForbidden(false);
    } catch (err) {
      if ([403, 404].includes(err.response?.status)) setForbidden(true);
      else setError(apiErrorMessage(err, 'Could not load sharing settings.'));
    }
  }, [projectId]);

  useEffect(() => { load(); fetchGroups(); }, [load, fetchGroups]);

  const adminGroups = groups.filter((g) => g.myStatus === 'active' && ['owner', 'admin'].includes(g.myRole));
  const sharedGroupIds = new Set((data?.shares || []).filter((s) => s.group).map((s) => s.group.id));
  const available = adminGroups.filter((g) => !sharedGroupIds.has(g.id));
  useEffect(() => { if (!groupId || !available.some((g) => g.id === groupId)) setGroupId(available[0]?.id || ''); }, [available.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!projectId) return <p className="text-xs text-zinc-500 py-4">Save the project first to share it.</p>;
  if (!data && !forbidden && !error) return <Spinner label="Loading sharing..." />;
  if (forbidden) {
    return (
      <div className="flex items-start gap-2 text-xs text-zinc-600 bg-zinc-50 border border-[#E2E5E8] rounded-xl p-3">
        <Lock className="w-4 h-4 mt-0.5 shrink-0 text-zinc-400" />
        <span>Only the project owner and project admins can change who has access to this project.</span>
      </div>
    );
  }
  const isOwner = data?.myLevel === 'owner';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await svc.shareProject(projectId, mode === 'group' ? { groupId, permission } : { email, permission });
      setFlash(mode === 'group' ? 'Project shared with the group.' : `Shared with ${email}.`);
      setEmail('');
      await load();
      fetchGroups();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not share the project.'));
    } finally {
      setBusy(false);
    }
  };

  const changePermission = async (share, next) => {
    setError(null);
    try { await svc.updateShare(projectId, share.id, next); setFlash('Access updated.'); await load(); } catch (err) { setError(apiErrorMessage(err)); await load(); }
  };

  const link = `${window.location.origin}/editor/${projectId}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError('Copy failed. Select the link and copy it manually.'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border border-[#E2E5E8] rounded-xl px-3 py-2">
        <Link2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <input readOnly aria-label="Project link" value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 text-[11px] text-zinc-600 bg-transparent outline-none" />
        <button type="button" onClick={copyLink} className="text-[11px] font-semibold text-zinc-700 hover:text-black flex items-center gap-1">{copied ? <><Check className="w-3 h-3" />Copied</> : 'Copy'}</button>
      </div>
      <p className="text-[10px] text-zinc-500 -mt-2">Only people with access (below) can open this link.</p>
      {error && <Notice onClose={() => setError(null)}>{error}</Notice>}
      {flash && <Notice kind="success">{flash}</Notice>}

      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-1 text-[11px] font-semibold">
          {[['group', UsersRound, 'Group'], ['user', User, 'Person']].map(([id, Icon, label]) => (
            <button key={id} type="button" onClick={() => setMode(id)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border ${mode === id ? 'bg-zinc-900 text-white border-zinc-900' : 'border-[#E2E5E8] text-zinc-600 hover:bg-zinc-50'}`}>
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {mode === 'group' ? (
            available.length === 0 ? (
              <p className="flex-1 min-w-[180px] text-[11px] text-zinc-500 py-2">
                {adminGroups.length === 0 ? <>You are not an admin of any group. <Link to="/groups" className="underline font-semibold">Create or manage groups</Link>.</> : 'This project is already shared with all of your groups.'}
              </p>
            ) : (
              <select aria-label="Group" className={`${inputClass} flex-1 min-w-[160px]`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                {available.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )
          ) : (
            <input aria-label="Email" type="email" required className={`${inputClass} flex-1 min-w-[160px]`} placeholder="registered user's email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
          <select aria-label="Permission" className={`${inputClass} w-28`} value={permission} onChange={(e) => setPermission(e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            {isOwner && <option value="admin">Admin</option>}
          </select>
          <Btn type="submit" loading={busy} disabled={mode === 'group' ? !groupId : !email}>Share</Btn>
        </div>
        <p className="text-[10px] text-zinc-500">{PERMISSION_HELP[permission]}</p>
      </form>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-[#111827]">Who has access</span>
          <span className="text-[10px] font-mono text-zinc-400">{(data?.shares?.length || 0) + 1} total</span>
        </div>
        <ul className="divide-y divide-zinc-100 border border-[#E2E5E8] rounded-xl overflow-hidden">
          <li className="flex items-center justify-between gap-2 px-3 py-2.5 bg-zinc-50/60">
            <div className="min-w-0"><p className="text-xs font-semibold truncate">{data?.owner?.name || 'Owner'}</p><p className="text-[10px] text-zinc-500 truncate">{data?.owner?.email}</p></div>
            <RoleBadge role="owner" />
          </li>
          {(data?.shares || []).map((share) => {
            const locked = share.permission === 'admin' && !isOwner;
            return (
              <li key={share.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0 flex items-center gap-2">
                  {share.group ? <UsersRound className="w-3.5 h-3.5 text-zinc-400 shrink-0" /> : <User className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  <div className="min-w-0"><p className="text-xs font-semibold truncate">{share.group ? share.group.name : share.user?.name}</p><p className="text-[10px] text-zinc-500 truncate">{share.group ? 'Group' : share.user?.email}</p></div>
                </div>
                <div className="flex items-center gap-1.5">
                  <select aria-label="Access level" disabled={locked} className="text-[11px] rounded-lg border border-[#E2E5E8] bg-white px-1.5 py-1 disabled:opacity-60" value={share.permission} onChange={(e) => changePermission(share, e.target.value)}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    {(isOwner || share.permission === 'admin') && <option value="admin">Admin</option>}
                  </select>
                  <button type="button" disabled={locked} onClick={() => setRemoving(share)} aria-label="Remove access" className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </li>
            );
          })}
        </ul>
        {(data?.shares || []).length === 0 && <p className="text-[11px] text-zinc-500 mt-2">Only you can open this project. Share it with a group or a person above.</p>}
      </div>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove access?"
        description={removing?.group ? `Members of ${removing.group.name} lose access to this project right away.` : `${removing?.user?.name || 'This person'} loses access to this project right away.`}
        confirmLabel="Remove access"
        onConfirm={async () => { await svc.unshare(projectId, removing.id).catch((e) => { throw new Error(apiErrorMessage(e)); }); setFlash('Access removed.'); await load(); fetchGroups(); }}
      />
    </div>
  );
}
