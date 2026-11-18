import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../../services/collaborationService';
import { Modal, Btn, Notice, Spinner, RoleBadge, EmptyState } from './ui';

/** Pick which members of the group administer one project. Reads and writes the real group members and project shares. */
export default function ProjectAdminDialog({ open, onClose, group, project, onChanged }) {
  const [members, setMembers] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!open || !project) return undefined;
    let alive = true;
    setMembers(null); setError(null); setAdmins((project.admins || []).map((a) => a.id));
    svc.listMembers(group.id)
      .then((res) => alive && setMembers((res.data.data || []).filter((m) => m.status === 'active')))
      .catch((err) => alive && setError(apiErrorMessage(err, 'Could not load the members.')));
    return () => { alive = false; };
  }, [open, group?.id, project?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (member) => {
    if (busyId) return;
    const enable = !admins.includes(member.userId);
    setBusyId(member.userId); setError(null);
    try {
      await svc.setProjectAdmin(group.id, project._id, member.userId, enable);
      setAdmins((list) => (enable ? [...list, member.userId] : list.filter((id) => id !== member.userId)));
      onChanged?.();
    } catch (err) { setError(apiErrorMessage(err, 'Could not change the project admin.')); } finally { setBusyId(null); }
  };

  if (!project) return null;
  const ownerId = project.owner?.id;
  const candidates = (members || []).filter((m) => m.userId !== ownerId);

  return (
    <Modal open={open} onClose={onClose} title="Project admins" description={`Who administers "${project.name}". Admins manage sharing and access for this project.`}
      footer={<Btn variant="outline" onClick={onClose}>Done</Btn>}>
      {error && <Notice>{error}</Notice>}
      {!error && members === null && <Spinner label="Loading members..." />}
      {members && candidates.length === 0 && <EmptyState title="No other members" text="Invite people to the group first, then make them a project admin." />}
      {members && candidates.length > 0 && (
        <ul className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
          {candidates.map((m) => {
            const on = admins.includes(m.userId);
            return (
              <li key={m.id} className={`flex items-center gap-3 rounded-xl border p-3 transition ${on ? 'border-zinc-900 bg-zinc-50' : 'border-[#E2E5E8] bg-white'}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700">{(m.user?.name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#111827]">{m.user?.name}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{m.user?.email}</span>
                </span>
                <RoleBadge role={m.role} />
                <Btn variant={on ? 'outline' : 'primary'} loading={busyId === m.userId} disabled={Boolean(busyId)} icon={on ? ShieldOff : ShieldCheck} onClick={() => toggle(m)}>{on ? 'Remove admin' : 'Make admin'}</Btn>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
