import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { adminService, adminError, errorCode } from '../../services/adminService';
import { toast } from '../../store/toastStore';
import { Async, Badge, Btn, Card, ConfirmDialog, EmptyState, Field, Input, Page, Pagination, SearchInput, Select, Stat, Table, TableSkeleton, Td, Textarea, Th, useAsync, useDebounced, dateTime, fmt } from './ui';
import CreditDialog from './CreditDialog';

const TYPES = ['CREDIT_ALLOCATION', 'CREDIT_USAGE', 'CREDIT_DEDUCTION', 'CREDIT_ADJUSTMENT', 'CREDIT_REFUND', 'MONTHLY_CREDIT_ALLOCATION', 'CREDIT_EXPIRY'];
const TABS = ['Transactions', 'Adjust a user', 'Project credits', 'Allocate to many', 'Credit rules'];

export default function CreditsPage() {
  const [tab, setTab] = useState('Transactions');
  const summary = useAsync(() => adminService.creditSummary(), []);
  return (
    <Page title="Credit Management" subtitle="Every credit change is recorded with who made it, why, and the balance before and after.">
      <Async state={summary} errorFallback={(error) => adminError(error)} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#EFEBE1]" />)}</div>}>
        {({ totals }) => (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Distributed" value={fmt(totals.distributed)} hint="Credits given or bought" />
            <Stat label="Consumed" value={fmt(totals.consumed)} hint="Used by generations" tone="red" />
            <Stat label="Deducted by admins" value={fmt(totals.deducted)} tone="amber" />
            <Stat label="Held by users" value={fmt(totals.remaining)} hint={`${fmt(totals.users)} accounts`} tone="blue" />
          </div>
        )}
      </Async>
      <div className="flex flex-wrap gap-1 border-b border-[#E2DCCF]">
        {TABS.map((name) => <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === name ? 'border-[#2F4A35] font-medium text-[#2F4A35]' : 'border-transparent text-[#7A7366] hover:text-[#2B2823]'}`}>{name}</button>)}
      </div>
      {tab === 'Transactions' ? <Transactions onChanged={summary.reload} /> : null}
      {tab === 'Project credits' ? <ProjectCredits onChanged={summary.reload} /> : null}
      {tab === 'Adjust a user' ? <AdjustUser onChanged={() => { summary.reload(); setTab('Transactions'); }} /> : null}
      {tab === 'Allocate to many' ? <Allocate onChanged={summary.reload} /> : null}
      {tab === 'Credit rules' ? <Rules /> : null}
    </Page>
  );
}

function Transactions() {
  const [filters, setFilters] = useState({ q: '', type: '', direction: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  const params = { ...filters, q };
  const state = useAsync(() => adminService.creditTransactions({ ...params, page, limit: 25 }), [q, filters.type, filters.direction, filters.from, filters.to, page]);
  const set = (key) => (event) => { setFilters((f) => ({ ...f, [key]: event.target.value })); setPage(1); };
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try { await adminService.download(adminService.creditExportUrl({ ...params, q: undefined }), 'credit-transactions.csv'); }
    catch (error) { toast.error(adminError(error, 'The export failed.')); } finally { setExporting(false); }
  };
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E2DCCF] p-3">
        <SearchInput value={filters.q} onChange={(value) => { setFilters((f) => ({ ...f, q: value })); setPage(1); }} placeholder="Search user name or email" />
        <Select value={filters.type} onChange={set('type')} className="w-auto" aria-label="Type"><option value="">All types</option>{TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ').toLowerCase()}</option>)}</Select>
        <Select value={filters.direction} onChange={set('direction')} className="w-auto" aria-label="Direction"><option value="">Added and used</option><option value="in">Credits added</option><option value="out">Credits removed</option></Select>
        <Input type="date" value={filters.from} onChange={set('from')} className="w-auto" aria-label="From date" />
        <Input type="date" value={filters.to} onChange={set('to')} className="w-auto" aria-label="To date" />
        <Btn className="ml-auto" onClick={exportCsv} busy={exporting}><Download className="h-4 w-4" />Export CSV</Btn>
      </div>
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
        {({ transactions, total, pages }) => (transactions.length === 0 ? <EmptyState title="No transactions found">Change the filters, or make a credit change to see it here.</EmptyState> : (
          <div className="px-3 pb-3">
            <Table>
              <thead><tr><Th>Transaction</Th><Th>Date</Th><Th>User</Th><Th>Type</Th><Th className="text-right">Before</Th><Th className="text-right">Change</Th><Th className="text-right">After</Th><Th>Reason</Th><Th>Admin</Th></tr></thead>
              <tbody>{transactions.map((row) => (
                <tr key={row.transactionId} className="hover:bg-[#FBF9F4]">
                  <Td className="font-mono text-[11px] text-[#7A7366]" title={row.transactionId}>{row.transactionId.slice(0, 12)}…</Td>
                  <Td className="whitespace-nowrap">{dateTime(row.createdAt)}</Td>
                  <Td><span className="font-medium">{row.user.name || 'Unknown'}</span><br /><span className="text-xs text-[#7A7366]">{row.user.email}</span></Td>
                  <Td><Badge tone={row.amount > 0 ? 'green' : 'red'}>{row.type.replace(/_/g, ' ').toLowerCase()}</Badge></Td>
                  <Td className="text-right tabular-nums">{row.previousBalance ?? '—'}</Td>
                  <Td className={`text-right font-medium tabular-nums ${row.amount > 0 ? 'text-[#33503A]' : 'text-[#7A3A2E]'}`}>{row.amount > 0 ? '+' : ''}{row.amount}</Td>
                  <Td className="text-right tabular-nums">{row.newBalance ?? '—'}</Td>
                  <Td className="max-w-[16rem] truncate" title={row.reason}>{row.reason}</Td>
                  <Td className="text-xs">{row.admin?.email || 'System'}</Td>
                </tr>))}</tbody>
            </Table>
            <Pagination page={page} pages={pages} total={total} onPage={setPage} label="transactions" />
          </div>
        ))}
      </Async>
    </Card>
  );
}

/** Pick a user by name or email. */
function UserPicker({ onPick, placeholder = 'Search a user by name or email' }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const state = useAsync(() => (q.trim().length >= 2 ? adminService.users({ q, limit: 8 }) : Promise.resolve({ users: [] })), [q]);
  return (
    <div className="space-y-2">
      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {q.trim().length >= 2 ? (
        <ul className="divide-y divide-[#EFEBE1] rounded-lg border border-[#E2DCCF] bg-white">
          {(state.data?.users || []).map((user) => (
            <li key={user.id}><button type="button" onClick={() => { onPick(user); setText(''); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#F5F1E8]"><span><span className="font-medium">{user.name}</span> <span className="text-[#7A7366]">{user.email}</span></span><span className="text-xs tabular-nums text-[#5B554A]">{fmt(user.balance)} credits</span></button></li>
          ))}
          {!state.loading && !(state.data?.users || []).length ? <li className="px-3 py-3 text-sm text-[#7A7366]">No users found.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function AdjustUser({ onChanged }) {
  const [user, setUser] = useState(null);
  return (
    <Card title="Add, deduct or adjust a user's credits">
      <div className="max-w-xl space-y-4">
        {user ? (
          <div className="flex items-center justify-between rounded-lg bg-[#F5F1E8] px-3 py-2 text-sm"><span><strong>{user.name}</strong> · {user.email} · {fmt(user.balance)} credits</span><Btn size="sm" variant="ghost" onClick={() => setUser(null)}>Change</Btn></div>
        ) : <UserPicker onPick={setUser} />}
        <Btn variant="primary" disabled={!user} onClick={() => setUser({ ...user, open: true })}>Continue</Btn>
      </div>
      {user?.open ? <CreditDialog open user={user} onClose={() => setUser({ ...user, open: false })} onDone={() => { setUser(null); onChanged(); }} /> : null}
    </Card>
  );
}

/** Credits of one project: a project with a balance of its own pays for the generations in it before its owner does. */
function ProjectCredits({ onChanged }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const list = useAsync(() => adminService.searchProjects({ q }), [q]);
  const [picked, setPicked] = useState(null);
  const detail = useAsync(() => (picked ? adminService.projectCredits(picked) : Promise.resolve(null)), [picked]);
  const [form, setForm] = useState({ action: 'add', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const valid = Number.isInteger(Number(form.amount)) && Number(form.amount) >= (form.action === 'set' ? 0 : 1) && form.amount !== '' && form.reason.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    try {
      await adminService.changeProjectCredits(picked, { action: form.action, amount: Number(form.amount), reason: form.reason.trim(), idempotencyKey: `proj-${picked}-${Date.now()}` });
      toast.success('Project credits updated.');
      setForm({ action: 'add', amount: '', reason: '' }); detail.reload(); list.reload(); onChanged?.();
    } catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  const project = detail.data?.project;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Choose a project">
        <div className="space-y-3">
          <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search by project name, owner name or email" aria-label="Search projects" />
          <ul className="max-h-80 divide-y divide-[#EFEBE1] overflow-y-auto rounded-lg border border-[#E2DCCF] bg-white">
            {(list.data?.projects || []).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setPicked(item.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#F5F1E8] ${picked === item.id ? 'bg-[#F5F1E8]' : ''}`}>
                  <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="block truncate text-xs text-[#7A7366]">{item.owner?.name} · {item.owner?.email}</span></span>
                  <span className="shrink-0 text-xs tabular-nums text-[#5B554A]">{item.creditBalance === null ? 'owner pays' : `${fmt(item.creditBalance)} credits`}</span>
                </button>
              </li>
            ))}
            {!list.loading && !(list.data?.projects || []).length ? <li className="px-3 py-3 text-sm text-[#7A7366]">No projects found.</li> : null}
          </ul>
        </div>
      </Card>
      <Card title={project ? `Credits of ${project.name}` : 'Project credits'}>
        {!picked ? <p className="text-sm text-[#7A7366]">Pick a project to see its balance and give it credits. Generations in the project use these first; when they run out, the owner's own credits are used.</p> : (
          <Async state={detail} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton rows={3} />}>
            {(data) => data && (
              <div className="space-y-4">
                <div className="rounded-lg bg-[#F5F1E8] px-3 py-2 text-sm"><strong>{data.project.name}</strong> · owner {data.project.owner?.email} · <strong>{data.project.creditBalance === null ? 'no balance of its own (the owner pays)' : `${fmt(data.project.creditBalance)} credits`}</strong></div>
                <div className="flex gap-1 rounded-lg border border-[#E2DCCF] bg-[#F3EFE5] p-0.5 text-xs" role="group" aria-label="Action">
                  {[['add', 'Add'], ['deduct', 'Deduct'], ['set', 'Set to']].map(([id, label]) => <button key={id} type="button" onClick={() => setForm({ ...form, action: id })} aria-pressed={form.action === id} className={`flex-1 rounded-md px-2 py-1.5 font-medium ${form.action === id ? 'bg-white shadow-sm' : 'text-[#7A7366]'}`}>{label}</button>)}
                </div>
                <Field label="Credits"><Input type="number" min={form.action === 'set' ? 0 : 1} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
                <Field label="Reason" hint="Saved in the ledger and the audit log; the owner is notified."><Textarea rows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></Field>
                <Btn variant="primary" busy={busy} disabled={!valid} onClick={submit}>Apply</Btn>
                {data.history.length ? (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#7A7366]">Recent changes</p>
                    <ul className="max-h-48 divide-y divide-[#EFEBE1] overflow-y-auto text-xs">{data.history.map((row) => <li key={row.transactionId} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0 truncate" title={row.reason}>{row.reason}</span><span className={`shrink-0 tabular-nums font-medium ${row.amount > 0 ? 'text-[#33503A]' : 'text-[#7A3A2E]'}`}>{row.amount > 0 ? '+' : ''}{row.amount} → {row.newBalance}</span><span className="shrink-0 text-[#7A7366]">{dateTime(row.createdAt)}</span></li>)}</ul>
                  </div>
                ) : null}
              </div>
            )}
          </Async>
        )}
      </Card>
    </div>
  );
}

function Allocate({ onChanged }) {
  const [mode, setMode] = useState('selected');
  const [picked, setPicked] = useState([]);
  const [plans, setPlans] = useState([]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const batch = useRef(`batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const valid = Number.isInteger(Number(amount)) && Number(amount) >= 1 && reason.trim().length >= 3 && (mode === 'all' || picked.length > 0);

  const run = async (confirmed) => {
    setBusy(true);
    try {
      const result = await adminService.allocateCredits({ all: mode === 'all', userIds: picked.map((user) => user.id), plans, amount: Number(amount), reason: reason.trim(), confirm: confirmed, batchKey: batch.current });
      toast.success(`${fmt(result.applied)} user${result.applied === 1 ? '' : 's'} received ${fmt(amount)} credits${result.duplicates ? ` (${result.duplicates} already done)` : ''}${result.failedCount ? `, ${result.failedCount} failed` : ''}.`);
      setConfirm(null); setPicked([]); setAmount(''); setReason(''); batch.current = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      onChanged();
    } catch (error) {
      if (errorCode(error) === 'CONFIRMATION_REQUIRED') setConfirm(adminError(error)); else { toast.error(adminError(error)); setConfirm(null); }
    } finally { setBusy(false); }
  };

  return (
    <Card title="Give credits to several users">
      <div className="max-w-2xl space-y-4">
        <div className="flex gap-2">
          {[['selected', 'Selected users'], ['all', 'All eligible users']].map(([value, label]) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg border px-3 py-1.5 text-sm ${mode === value ? 'border-[#2F4A35] bg-[#E8F0E8] font-medium text-[#33503A]' : 'border-[#D9D2C2] bg-white'}`}>{label}</button>)}
        </div>
        {mode === 'selected' ? (
          <div className="space-y-2">
            <UserPicker onPick={(user) => setPicked((list) => (list.some((item) => item.id === user.id) ? list : [...list, user]))} />
            {picked.length ? <ul className="flex flex-wrap gap-1.5">{picked.map((user) => <li key={user.id}><button type="button" onClick={() => setPicked((list) => list.filter((item) => item.id !== user.id))} className="rounded-full bg-[#EFEBE1] px-2.5 py-1 text-xs hover:bg-[#E3DCCB]" title="Remove">{user.name} ×</button></li>)}</ul> : <p className="text-xs text-[#7A7366]">Search and add the users who should receive credits.</p>}
          </div>
        ) : (
          <div className="space-y-2 rounded-lg bg-[#F5F1E8] p-3 text-sm">
            <p>Every active (not suspended) account that is charged for credits will receive the credits. Optionally limit it to some plans:</p>
            <div className="flex flex-wrap gap-2">{['Free Tier', 'Plus Plan', 'Pro Plan'].map((plan) => <label key={plan} className="flex items-center gap-1.5"><input type="checkbox" checked={plans.includes(plan)} onChange={(event) => setPlans((list) => (event.target.checked ? [...list, plan] : list.filter((item) => item !== plan)))} />{plan}</label>)}</div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Credits per user"><Input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><div className="sm:col-span-2"><Field label="Reason"><Input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: launch week bonus" /></Field></div></div>
        <Btn variant="primary" disabled={!valid} busy={busy && !confirm} onClick={() => run(false)}>Give credits</Btn>
      </div>
      <ConfirmDialog open={Boolean(confirm)} title="Confirm this allocation" danger confirmLabel="Yes, give the credits" busy={busy} onClose={() => setConfirm(null)} onConfirm={() => run(true)}>
        <p className="rounded-lg bg-[#FBF1DC] p-3 text-[#7A5A1E]">{confirm}</p><p>Each user gets a ledger entry, and you can see the whole batch in the audit log. Running the same batch twice does not give credits twice.</p>
      </ConfirmDialog>
    </Card>
  );
}

function Rules() {
  const state = useAsync(() => adminService.settings(), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state.data) setForm(state.data.credits); }, [state.data]);
  const save = async () => {
    setBusy(true);
    try { await adminService.saveSettings('credits', form); toast.success('Credit rules saved.'); state.reload(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  if (!form) return <Async state={state} errorFallback={(error) => adminError(error)}>{() => null}</Async>;
  const num = (value) => (value === '' ? '' : Number(value));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="New users"><Field label="Credits for each new account" hint="Applies to accounts created from now on. Existing balances are never changed."><Input type="number" min="0" value={form.newUserCredits} onChange={(event) => setForm({ ...form, newUserCredits: num(event.target.value) })} /></Field></Card>
      <Card title="Monthly allocation">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.monthlyAllocation.enabled} onChange={(event) => setForm({ ...form, monthlyAllocation: { ...form.monthlyAllocation, enabled: event.target.checked } })} />Give credits to users every month</label>
          <Field label="Credits per user each month"><Input type="number" min="0" value={form.monthlyAllocation.amount} onChange={(event) => setForm({ ...form, monthlyAllocation: { ...form.monthlyAllocation, amount: num(event.target.value) } })} /></Field>
          <div className="flex flex-wrap gap-3 text-sm"><span className="text-[#7A7366]">Plans (none = all):</span>{['Free Tier', 'Plus Plan', 'Pro Plan'].map((plan) => <label key={plan} className="flex items-center gap-1.5"><input type="checkbox" checked={form.monthlyAllocation.plans.includes(plan)} onChange={(event) => setForm({ ...form, monthlyAllocation: { ...form.monthlyAllocation, plans: event.target.checked ? [...form.monthlyAllocation.plans, plan] : form.monthlyAllocation.plans.filter((item) => item !== plan) } })} />{plan}</label>)}</div>
          <p className="text-xs text-[#7A7366]">Runs automatically once per calendar month and never twice for the same user and month.</p>
        </div>
      </Card>
      <Card title="Credit expiry">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.expiry.enabled} onChange={(event) => setForm({ ...form, expiry: { ...form.expiry, enabled: event.target.checked } })} />Expire granted credits that are not used</label>
          <Field label="Expire after (days)" hint="Admin-granted and monthly credits older than this are removed, never more than the user still has."><Input type="number" min="1" value={form.expiry.days} onChange={(event) => setForm({ ...form, expiry: { ...form.expiry, days: num(event.target.value) } })} /></Field>
        </div>
      </Card>
      <Card title="Safety and alerts">
        <div className="space-y-3">
          <Field label="Confirm changes of at least (credits)" hint="A single change this large asks for confirmation."><Input type="number" min="1" value={form.largeAdjustmentThreshold} onChange={(event) => setForm({ ...form, largeAdjustmentThreshold: num(event.target.value) })} /></Field>
          <Field label="Unusual usage alert (credits in one charge)"><Input type="number" min="1" value={form.unusualUsageCredits} onChange={(event) => setForm({ ...form, unusualUsageCredits: num(event.target.value) })} /></Field>
          <Field label="Low balance means (credits or fewer)"><Input type="number" min="0" value={form.lowBalanceThreshold} onChange={(event) => setForm({ ...form, lowBalanceThreshold: num(event.target.value) })} /></Field>
        </div>
      </Card>
      <div className="lg:col-span-2"><Btn variant="primary" busy={busy} onClick={save}>Save credit rules</Btn></div>
    </div>
  );
}
