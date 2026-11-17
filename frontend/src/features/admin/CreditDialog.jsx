import React, { useEffect, useRef, useState } from 'react';
import { adminService, adminError, errorCode } from '../../services/adminService';
import { toast } from '../../store/toastStore';
import { Btn, Field, Input, Modal, Select, Textarea, fmt } from './ui';

const ACTIONS = [
  { value: 'add', label: 'Add credits', hint: 'Allocation' },
  { value: 'deduct', label: 'Deduct credits', hint: 'Deduction' },
  { value: 'set', label: 'Set balance to…', hint: 'Adjustment' },
  { value: 'refund', label: 'Refund credits', hint: 'Refund' }
];

/** Add, deduct, set or refund credits for one user. Each submit has its own idempotency key, so a double click cannot apply twice. */
export default function CreditDialog({ open, user, onClose, onDone }) {
  const [form, setForm] = useState({ action: 'add', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [needConfirm, setNeedConfirm] = useState(null);
  const key = useRef(null);
  useEffect(() => { if (open) { setForm({ action: 'add', amount: '', reason: '' }); setNeedConfirm(null); key.current = null; } }, [open]);

  const amount = Number(form.amount);
  const valid = Number.isInteger(amount) && amount >= (form.action === 'set' ? 0 : 1) && form.reason.trim().length >= 3;
  const preview = !valid ? null : form.action === 'set' ? amount : form.action === 'deduct' ? user.balance - amount : user.balance + amount;

  const submit = async (confirm = false) => {
    if (!key.current) key.current = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setBusy(true);
    try {
      const result = await adminService.adjustCredits({ userId: user.id, action: form.action, amount, reason: form.reason.trim(), confirm, idempotencyKey: key.current });
      toast.success(result.duplicate ? 'This change was already applied.' : `Done. New balance: ${fmt(result.transaction.newBalance)} credits.`);
      onDone?.(result);
    } catch (error) {
      if (errorCode(error) === 'CONFIRMATION_REQUIRED') setNeedConfirm(adminError(error));
      else { toast.error(adminError(error)); key.current = null; }
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={`Credits for ${user?.name || ''}`}
      footer={needConfirm
        ? <><Btn onClick={() => setNeedConfirm(null)} disabled={busy}>Back</Btn><Btn variant="danger" busy={busy} onClick={() => submit(true)}>Yes, apply this change</Btn></>
        : <><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!valid} onClick={() => submit(false)}>Apply</Btn></>}>
      {needConfirm ? (
        <div className="space-y-2 text-sm"><p className="rounded-lg bg-[#FBF1DC] p-3 text-[#7A5A1E]">{needConfirm}</p><p>Review the amount and reason, then confirm. This is recorded in the credit history and the audit log.</p></div>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-[#F5F1E8] px-3 py-2 text-sm">Current balance: <strong>{fmt(user?.balance)}</strong> credits</p>
          <Field label="Action"><Select value={form.action} onChange={(event) => setForm({ ...form, action: event.target.value })}>{ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></Field>
          <Field label={form.action === 'set' ? 'New balance' : 'Credits'} hint={preview !== null ? `Balance after: ${fmt(preview)}` : undefined} error={preview !== null && preview < 0 ? 'The balance cannot go below 0.' : undefined}>
            <Input type="number" min={form.action === 'set' ? 0 : 1} step="1" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} autoFocus />
          </Field>
          <Field label="Reason (shown in the history)"><Textarea rows={3} maxLength={500} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="For example: refund for a failed generation" /></Field>
        </div>
      )}
    </Modal>
  );
}
