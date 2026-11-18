import React, { useEffect, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminService, adminError } from '../../services/adminService';
import { toast } from '../../store/toastStore';
import { Async, Badge, Btn, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Page, Pagination, Select, Stat, StatusBadge, Table, TableSkeleton, Td, Th, useAsync, ago, dateOnly, dateTime, fmt } from './ui';
import { BarChart, LineChart, RankedBars } from './charts';
import { useAdmin } from './AdminLayout';

/* ------------------------------ Subscriptions & plans ------------------------------ */

export function PlansPage() {
  const state = useAsync(() => adminService.plans(), []);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [tab, setTab] = useState('Plans');
  return (
    <Page title="Subscriptions & Plans" subtitle="Plan allowances and limits. Manual credit changes stay separate from payments.">
      <div className="flex gap-1 border-b border-[#E2DCCF]">{['Plans', 'Plan-related credit history'].map((name) => <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === name ? 'border-[#2F4A35] font-medium text-[#2F4A35]' : 'border-transparent text-[#7A7366]'}`}>{name}</button>)}</div>
      {tab === 'Plans' ? (
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton rows={3} />}>
          {({ plans }) => (
            <div className="grid gap-4 lg:grid-cols-3">
              {plans.map((plan) => (
                <Card key={plan.name} title={<span className="flex items-center gap-2">{plan.name}{plan.customised ? <Badge tone="amber">Customised</Badge> : null}</span>}>
                  <p className="font-serif text-3xl">{plan.price ? `₹${fmt(plan.price)}` : 'Free'}<span className="text-sm text-[#7A7366]">{plan.price ? ' / month' : ''}</span></p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    {[['Credits per cycle', fmt(plan.credits)], ['Monthly credits', fmt(plan.monthlyCredits)], ['Yearly credits', fmt(plan.yearlyCredits)], ['Monthly tokens', fmt(plan.monthlyTokens)], ['Projects', fmt(plan.maxProjects)], ['Storage', `${fmt(plan.storageGB)} GB`]].map(([label, value]) => <div key={label} className="flex justify-between"><dt className="text-[#7A7366]">{label}</dt><dd className="font-medium">{value}</dd></div>)}
                  </dl>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-[#F5F1E8] p-2"><p className="text-lg font-semibold">{fmt(plan.users)}</p>users</div><div className="rounded-lg bg-[#E8F0E8] p-2"><p className="text-lg font-semibold">{fmt(plan.activeSubscriptions)}</p>active</div><div className="rounded-lg bg-[#F7E9E5] p-2"><p className="text-lg font-semibold">{fmt(plan.expiredSubscriptions)}</p>expired</div></div>
                  <div className="mt-3 flex gap-2"><Btn size="sm" variant="primary" onClick={() => setEditing(plan)}>Edit allowances</Btn><Btn size="sm" onClick={() => setViewing(plan)}>View users</Btn></div>
                </Card>
              ))}
            </div>
          )}
        </Async>
      ) : <PlanTransactions />}
      <PlanEditor plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload(); }} />
      {viewing ? <PlanUsers plan={viewing} onClose={() => setViewing(null)} /> : null}
    </Page>
  );
}

function PlanEditor({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (plan) setForm({ credits: plan.credits, monthlyCredits: plan.monthlyCredits, yearlyCredits: plan.yearlyCredits, monthlyTokens: plan.monthlyTokens, maxProjects: plan.maxProjects, storageGB: plan.storageGB }); }, [plan]);
  const save = async () => {
    setBusy(true);
    try { await adminService.updatePlan(plan.name, form); toast.success(`${plan.name} updated.`); onSaved(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  const fields = [['credits', 'Credits per cycle'], ['monthlyCredits', 'Monthly credits'], ['yearlyCredits', 'Yearly credits'], ['monthlyTokens', 'Monthly tokens'], ['maxProjects', 'Project limit'], ['storageGB', 'Storage (GB)']];
  return (
    <Modal open={Boolean(plan)} onClose={busy ? undefined : onClose} title={`Edit ${plan?.name || ''}`} footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={save}>Save</Btn></>}>
      <p className="mb-3 rounded-lg bg-[#F5F1E8] p-3 text-xs text-[#5B554A]">New limits apply to every account on this plan straight away. Nobody's current credit balance is changed, and the price is set in billing, not here.</p>
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key, label]) => <Field key={key} label={label}><Input type="number" min="0" value={form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: event.target.value === '' ? '' : Number(event.target.value) })} /></Field>)}</div>
    </Modal>
  );
}

function PlanUsers({ plan, onClose }) {
  const [page, setPage] = useState(1);
  const state = useAsync(() => adminService.planUsers(plan.name, { page }), [plan.name, page]);
  return (
    <Modal open onClose={onClose} title={`Users on ${plan.name}`} wide>
      <Async state={state} errorFallback={(error) => adminError(error)}>
        {({ users, total, pages }) => (users.length ? <><Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Subscription</Th><Th>Renews</Th><Th className="text-right">Credits</Th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><Td><Link className="font-medium text-[#2F4A35] hover:underline" to={`/admin/users/${user.id}`}>{user.name}</Link></Td><Td>{user.email}</Td><Td><StatusBadge status={user.subscriptionStatus} /></Td><Td>{user.renewsAt ? dateOnly(user.renewsAt) : '—'}</Td><Td className="text-right tabular-nums">{fmt(user.balance)}</Td></tr>)}</tbody></Table><Pagination page={page} pages={pages} total={total} onPage={setPage} label="users" /></> : <EmptyState title="No users on this plan" />)}
      </Async>
    </Modal>
  );
}

function PlanTransactions() {
  const [page, setPage] = useState(1);
  const state = useAsync(() => adminService.planTransactions({ page }), [page]);
  return (
    <Card pad={false} title="Monthly allocations, plan changes and purchases">
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
        {({ transactions, total, pages }) => (transactions.length ? <div className="px-3 pb-3"><Table><thead><tr><Th>Date</Th><Th>User</Th><Th>Type</Th><Th className="text-right">Change</Th><Th className="text-right">Balance</Th><Th>Reason</Th></tr></thead><tbody>{transactions.map((row) => <tr key={row.transactionId}><Td className="whitespace-nowrap">{dateTime(row.createdAt)}</Td><Td>{row.user.email}</Td><Td><Badge tone={row.amount > 0 ? 'green' : 'red'}>{row.type.replace(/_/g, ' ').toLowerCase()}</Badge></Td><Td className="text-right tabular-nums">{row.amount > 0 ? '+' : ''}{row.amount}</Td><Td className="text-right tabular-nums">{row.newBalance ?? '—'}</Td><Td>{row.reason}</Td></tr>)}</tbody></Table><Pagination page={page} pages={pages} total={total} onPage={setPage} label="transactions" /></div> : <EmptyState title="No plan-related transactions yet">Plan changes, credit purchases and monthly allocations will appear here.</EmptyState>)}
      </Async>
    </Card>
  );
}

/* ------------------------------ Analytics ------------------------------ */

export function AnalyticsPage() {
  const [range, setRange] = useState({ days: '30', from: '', to: '' });
  const params = range.from || range.to ? { from: range.from, to: range.to } : { days: range.days };
  const state = useAsync(() => adminService.analytics(params), [range.days, range.from, range.to]);
  const [exporting, setExporting] = useState('');
  const exportReport = async (report) => {
    setExporting(report);
    try { await adminService.download(adminService.analyticsExportUrl({ ...params, report }), `${report}.csv`); }
    catch (error) { toast.error(adminError(error, 'The export failed.')); } finally { setExporting(''); }
  };
  return (
    <Page title="Analytics" subtitle="Credits, generation activity and subscriptions for the period you choose."
      actions={<><Select value={range.from || range.to ? 'custom' : range.days} onChange={(event) => setRange(event.target.value === 'custom' ? { ...range, from: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) } : { days: event.target.value, from: '', to: '' })} className="w-auto" aria-label="Period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="custom">Custom range</option></Select>
        {range.from || range.to ? <><Input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} className="w-auto" aria-label="From" /><Input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} className="w-auto" aria-label="To" /></> : null}</>}>
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-[#EFEBE1]" />)}</div>}>
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Distributed" value={fmt(data.credits.distributed)} hint="In this period" />
              <Stat label="Consumed" value={fmt(data.credits.consumed)} tone="red" hint="In this period" />
              <Stat label="Remaining with users" value={fmt(data.credits.remaining)} tone="blue" hint="Right now" />
              <Stat label="Average per user" value={fmt(data.credits.averageConsumptionPerUser)} tone="amber" hint="Credits consumed" />
              <Stat label="Accounts" value={fmt(data.credits.users)} tone="purple" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="User growth" action={<Btn size="sm" onClick={() => exportReport('growth')} busy={exporting === 'growth'}><Download className="h-3.5 w-3.5" />CSV</Btn>}><LineChart data={data.userGrowth} series={[{ key: 'total', label: 'Total users', color: '#2F4A35' }, { key: 'users', label: 'New users', color: '#C08A2B' }]} /></Card>
              <Card title="Daily credit consumption" action={<Btn size="sm" onClick={() => exportReport('consumption')} busy={exporting === 'consumption'}><Download className="h-3.5 w-3.5" />CSV</Btn>}><LineChart data={data.dailyCredits} series={[{ key: 'credits', label: 'Credits used', color: '#A4493A' }]} /></Card>
              <Card title="Monthly credit consumption"><BarChart data={data.monthlyCredits} xKey="month" yKey="credits" color="#A4493A" /></Card>
              <Card title="Daily website generations" action={<Btn size="sm" onClick={() => exportReport('generations')} busy={exporting === 'generations'}><Download className="h-3.5 w-3.5" />CSV</Btn>}><LineChart data={data.generations} series={[{ key: 'websites', label: 'Websites created', color: '#2F4A35' }, { key: 'completed', label: 'Jobs completed', color: '#2F4E78' }, { key: 'failed', label: 'Jobs failed', color: '#A4493A' }]} /></Card>
              <Card title="Monthly website generations"><BarChart data={data.monthlyGenerations} xKey="month" yKey="websites" color="#2F4A35" /></Card>
              <Card title="Subscription distribution" action={<Btn size="sm" onClick={() => exportReport('subscriptions')} busy={exporting === 'subscriptions'}><Download className="h-3.5 w-3.5" />CSV</Btn>}><RankedBars rows={data.subscriptions} labelKey="plan" valueKey="users" suffix=" users" color="#2F4E78" /></Card>
              <Card title="Most popular templates" action={<Btn size="sm" onClick={() => exportReport('templates')} busy={exporting === 'templates'}><Download className="h-3.5 w-3.5" />CSV</Btn>}><RankedBars rows={data.popularTemplates} labelKey="name" valueKey="websites" suffix=" sites" /></Card>
              <Card title="Most active users" action={<Btn size="sm" onClick={() => exportReport('users')} busy={exporting === 'users'}><Download className="h-3.5 w-3.5" />CSV</Btn>} pad={false}>
                {data.mostActiveUsers.length ? <div className="px-3 pb-3"><Table><thead><tr><Th>User</Th><Th>Plan</Th><Th className="text-right">Credits used</Th></tr></thead><tbody>{data.mostActiveUsers.map((user) => <tr key={user.userId}><Td><Link className="font-medium text-[#2F4A35] hover:underline" to={`/admin/users/${user.userId}`}>{user.name || user.email}</Link></Td><Td>{user.plan}</Td><Td className="text-right tabular-nums">{fmt(user.credits)}</Td></tr>)}</tbody></Table></div> : <EmptyState title="No usage in this period" />}
              </Card>
            </div>
          </>
        )}
      </Async>
    </Page>
  );
}

/* ------------------------------ Notifications ------------------------------ */

const NOTE_TYPES = ['NEW_USER', 'UNUSUAL_CREDIT_USAGE', 'GENERATION_FAILED', 'TEMPLATE_PUBLISHED', 'SECURITY', 'SYSTEM_ERROR', 'RESOURCE_WARNING', 'LOW_CREDITS'];

export function NotificationsPage() {
  const { refreshUnread } = useAdmin();
  const [filters, setFilters] = useState({ status: '', type: '', severity: '' });
  const [page, setPage] = useState(1);
  const state = useAsync(() => adminService.notifications({ ...filters, page, limit: 20 }), [filters.status, filters.type, filters.severity, page]);
  const set = (key) => (event) => { setFilters((f) => ({ ...f, [key]: event.target.value })); setPage(1); };
  const mark = async (body) => { try { await adminService.markRead(body); await state.reload(); refreshUnread(); } catch (error) { toast.error(adminError(error)); } };
  const tone = { info: 'blue', warning: 'amber', critical: 'red' };
  return (
    <Page title="Notifications" subtitle="Sign-ups, unusual credit use, failed generations, security events and system warnings."
      actions={<Btn onClick={() => mark({ all: true })} disabled={!state.data?.unread}>Mark all as read</Btn>}>
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-[#E2DCCF] p-3">
          <Select value={filters.status} onChange={set('status')} className="w-auto" aria-label="Read state"><option value="">Read and unread</option><option value="unread">Unread</option><option value="read">Read</option></Select>
          <Select value={filters.type} onChange={set('type')} className="w-auto" aria-label="Type"><option value="">All types</option>{NOTE_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ').toLowerCase()}</option>)}</Select>
          <Select value={filters.severity} onChange={set('severity')} className="w-auto" aria-label="Severity"><option value="">Any severity</option><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></Select>
          {state.data ? <span className="ml-auto self-center text-xs text-[#7A7366]">{fmt(state.data.unread)} unread</span> : null}
        </div>
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
          {({ notifications, total, pages }) => (notifications.length === 0 ? <EmptyState title="You are all caught up">New events will show up here.</EmptyState> : (
            <div className="px-3 pb-3">
              <ul className="divide-y divide-[#EFEBE1]">
                {notifications.map((item) => (
                  <li key={item._id} className={`flex items-start gap-3 px-2 py-3 ${item.readAt ? 'opacity-70' : ''}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-transparent' : 'bg-[#A4493A]'}`} aria-label={item.readAt ? 'Read' : 'Unread'} />
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{item.title}</p><Badge tone={tone[item.severity]}>{item.severity}</Badge><Badge>{item.type.replace(/_/g, ' ').toLowerCase()}</Badge></div>{item.message ? <p className="mt-0.5 text-sm text-[#5B554A]">{item.message}</p> : null}<p className="mt-0.5 text-xs text-[#7A7366]">{ago(item.createdAt)}{item.data?.userId ? <> · <Link className="underline" to={`/admin/users/${item.data.userId}`}>View user</Link></> : null}{item.data?.templateId ? <> · <Link className="underline" to="/admin/templates">Templates</Link></> : null}</p></div>
                    {!item.readAt ? <Btn size="sm" variant="ghost" onClick={() => mark({ ids: [item._id] })}>Mark read</Btn> : null}
                  </li>
                ))}
              </ul>
              <Pagination page={page} pages={pages} total={total} onPage={setPage} label="notifications" />
            </div>
          ))}
        </Async>
      </Card>
    </Page>
  );
}

/* ------------------------------ Audit logs ------------------------------ */

const show = (value) => (value === undefined ? '' : JSON.stringify(value, null, 2));

export function AuditLogsPage() {
  const [filters, setFilters] = useState({ q: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const state = useAsync(() => adminService.auditLogs({ ...filters, page, limit: 25 }), [filters.q, filters.action, filters.from, filters.to, page]);
  const set = (key) => (event) => { setFilters((f) => ({ ...f, [key]: event.target.value })); setPage(1); };
  return (
    <Page title="Audit Logs" subtitle="A permanent record of sensitive admin actions. Entries cannot be edited or deleted.">
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-[#E2DCCF] p-3">
          <Input value={filters.q} onChange={set('q')} placeholder="Admin email or resource id" className="sm:max-w-xs" aria-label="Search" />
          <Select value={filters.action} onChange={set('action')} className="w-auto" aria-label="Action"><option value="">All actions</option>{(state.data?.actions || []).map((action) => <option key={action} value={action}>{action.replace(/_/g, ' ').toLowerCase()}</option>)}</Select>
          <Input type="date" value={filters.from} onChange={set('from')} className="w-auto" aria-label="From date" />
          <Input type="date" value={filters.to} onChange={set('to')} className="w-auto" aria-label="To date" />
        </div>
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
          {({ logs, total, pages }) => (logs.length === 0 ? <EmptyState title="No audit entries" /> : (
            <div className="px-3 pb-3">
              <Table><thead><tr><Th>When</Th><Th>Admin</Th><Th>Action</Th><Th>Resource</Th><Th /></tr></thead>
                <tbody>{logs.map((row) => <tr key={row._id} className="hover:bg-[#FBF9F4]"><Td className="whitespace-nowrap">{dateTime(row.createdAt)}</Td><Td>{row.actorEmail}</Td><Td><Badge tone={/DELETE|SUSPEND|DEDUCT/.test(row.action) ? 'red' : /PUBLISH|ALLOC|RESTORE/.test(row.action) ? 'green' : 'grey'}>{row.action.replace(/_/g, ' ').toLowerCase()}</Badge></Td><Td className="text-xs text-[#5B554A]">{row.resourceType}{row.resourceId ? ` · ${row.resourceId}` : ''}</Td><Td className="text-right"><Btn size="sm" variant="ghost" onClick={() => setOpen(row)}>Details</Btn></Td></tr>)}</tbody></Table>
              <Pagination page={page} pages={pages} total={total} onPage={setPage} label="entries" />
            </div>
          ))}
        </Async>
      </Card>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? open.action.replace(/_/g, ' ').toLowerCase() : ''} wide>
        {open ? <div className="space-y-3 text-sm"><p><strong>{open.actorEmail}</strong> · {dateTime(open.createdAt)}{open.ip ? ` · ${open.ip}` : ''}</p>{['before', 'after', 'meta'].map((key) => (open[key] !== undefined ? <div key={key}><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#7A7366]">{key === 'before' ? 'Previous value' : key === 'after' ? 'New value' : 'Details'}</p><pre className="max-h-48 overflow-auto rounded-lg bg-[#F5F1E8] p-3 text-xs">{show(open[key])}</pre></div> : null))}</div> : null}
      </Modal>
    </Page>
  );
}

/* ------------------------------ Admin management ------------------------------ */

export function AdminsPage() {
  const { admin } = useAdmin();
  const state = useAsync(() => adminService.admins(), []);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removePassword, setRemovePassword] = useState('');
  const remove = async () => {
    setBusy(true);
    try { await adminService.removeAdmin(removing.id, removePassword); toast.success('Administrator role removed.'); setRemoving(null); setRemovePassword(''); state.reload(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  return (
    <Page title="Admin Management" subtitle="The admin portal belongs to the root administrator alone. Every change here asks for your password and is written to the audit log.">
      <Card title="Administrators" pad={false}>
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton rows={3} />}>
          {({ admins }) => (
            <div className="px-3 pb-3">
              {admins.some((user) => !user.isRoot) ? <p className="mb-2 rounded-lg bg-[#FBF1DC] p-2 text-xs text-[#7A5A1E]">Accounts below that are not Root have the ADMIN role but cannot open the admin portal. Remove the role if they should not have it.</p> : null}
              <Table>
                <thead><tr><Th>Name</Th><Th>Email</Th><Th>Status</Th><Th>Last active</Th><Th /></tr></thead>
                <tbody>{admins.map((user) => (
                  <tr key={user.id}>
                    <Td className="font-medium">{user.name}{user.id === admin?.id ? <span className="ml-1 text-xs text-[#7A7366]">(you)</span> : null}{user.isRoot ? <span className="ml-1 rounded bg-[#E8F0E8] px-1.5 py-0.5 text-[10px] text-[#33503A]">Root</span> : null}</Td>
                    <Td>{user.email}</Td><Td><StatusBadge status={user.status} /></Td><Td>{ago(user.lastActiveAt)}</Td>
                    <Td className="text-right">{user.id !== admin?.id && !user.isRoot ? <Btn size="sm" variant="ghost" onClick={() => setRemoving(user)} aria-label={`Remove ${user.name}`}><Trash2 className="h-3.5 w-3.5 text-[#A4493A]" /></Btn> : null}</Td>
                  </tr>
                ))}</tbody>
              </Table>
            </div>
          )}
        </Async>
      </Card>
      <ConfirmDialog open={Boolean(removing)} title="Remove administrator access?" danger confirmLabel="Remove access" busy={busy || !removePassword} onClose={() => { setRemoving(null); setRemovePassword(''); }} onConfirm={remove}>
        <p>{removing?.name} becomes a normal user.</p>
        <div className="mt-3"><Field label="Your password"><Input type="password" value={removePassword} onChange={(event) => setRemovePassword(event.target.value)} autoComplete="current-password" /></Field></div>
      </ConfirmDialog>
    </Page>
  );
}

/* ------------------------------ Platform settings ------------------------------ */

export function SettingsPage() {
  const state = useAsync(() => adminService.settings(), []);
  const [platform, setPlatform] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state.data) setPlatform(state.data.platform); }, [state.data]);
  const save = async () => {
    setBusy(true);
    try { await adminService.saveSettings('platform', platform); toast.success('Settings saved.'); state.reload(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  return (
    <Page title="Platform Settings" subtitle="Settings that apply to the whole platform. Every change is written to the audit log.">
      <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton rows={3} />}>
        {({ credits }) => platform && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Registration">
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={platform.registrationOpen} onChange={(event) => setPlatform({ ...platform, registrationOpen: event.target.checked })} /><span><span className="font-medium">Allow new registrations</span><br /><span className="text-[#7A7366]">When off, nobody can create an account (email or Google/Apple). Existing users are not affected.</span></span></label>
              <div className="mt-4"><Btn variant="primary" busy={busy} onClick={save}>Save</Btn></div>
            </Card>
            <Card title="Credit rules in effect" action={<Link to="/admin/credits" className="text-xs text-[#2F4A35] underline">Change</Link>}>
              <dl className="space-y-1.5 text-sm">{[['New user credits', credits.newUserCredits], ['Monthly allocation', credits.monthlyAllocation.enabled ? `${credits.monthlyAllocation.amount} credits${credits.monthlyAllocation.plans.length ? ` (${credits.monthlyAllocation.plans.join(', ')})` : ''}` : 'Off'], ['Credit expiry', credits.expiry.enabled ? `After ${credits.expiry.days} days` : 'Off'], ['Confirm changes of', `${credits.largeAdjustmentThreshold}+ credits`], ['Low balance', `${credits.lowBalanceThreshold} or fewer`]].map(([label, value]) => <div key={label} className="flex justify-between"><dt className="text-[#7A7366]">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
            </Card>
          </div>
        )}
      </Async>
    </Page>
  );
}
