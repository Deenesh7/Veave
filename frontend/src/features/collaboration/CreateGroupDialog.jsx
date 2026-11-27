import React, { useEffect, useState } from 'react';
import { Modal, Btn, Field, inputClass, Notice } from './ui';
import { useCollabStore } from '../../store/collabStore';
import { collaborationService as svc, apiErrorMessage } from '../../services/collaborationService';

// With `parent`, it creates a sub-group inside that group instead of a new main group.
export default function CreateGroupDialog({ open, onClose, onCreated, parent = null }) {
  const createGroup = useCollabStore((s) => s.createGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [requireApproval, setRequireApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) { setName(''); setDescription(''); setRequireApproval(false); setError(null); } }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = { name, description, settings: { requireApproval } };
      const group = parent ? (await svc.createSubgroup(parent.id, data)).data.data : await createGroup(data);
      onClose();
      onCreated?.(group);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the group.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={parent ? `New sub-group in ${parent.name}` : 'Create website group'}
      description={parent
        ? `People you invite to the sub-group see only its projects, not the rest of ${parent.name}. The owner and admins of ${parent.name} manage it too.`
        : 'You become the group owner. Invite people afterwards, then share projects with the group.'}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={parent ? 'Sub-group name' : 'Website group name'} hint={parent ? `Must be unique inside ${parent.name}.` : 'Must be unique across Veave.'}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder={parent ? 'Physio team' : 'Design Team'} />
        </Field>
        <Field label="Description (optional)">
          <textarea className={`${inputClass} resize-none`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What does this group work on?" />
        </Field>
        <label className="flex items-start gap-2 text-xs text-zinc-600 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} />
          <span><span className="font-semibold text-[#111827]">Require admin approval.</span> People who accept an invitation wait for an admin to approve them before they join.</span>
        </label>
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={busy} disabled={name.trim().length < 2}>{parent ? 'Create sub-group' : 'Create website group'}</Btn>
        </div>
      </form>
    </Modal>
  );
}
