import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { adminService, adminError } from '../../services/adminService';
import { toast } from '../../store/toastStore';
import { Async, Badge, Btn, Card, ConfirmDialog, EmptyState, Field, Page, Pagination, SearchInput, Select, StatusBadge, Table, Td, Textarea, Th, TableSkeleton, useAsync, useDebounced, ago, dateOnly, dateTime, fmt } from './ui';
import { useAdmin } from './AdminLayout';
import CreditDialog from './CreditDialog';

const PLAN_OPTIONS = ['Free Tier', 'Plus Plan', 'Pro Plan', 'Post Paid Plan'];

export function UsersPage() {
  const [filters, setFilters] = useState({ q: '', role: '', plan: '', status: '', subscription: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q);
  const state = useAsync(() => adminService.users({ ...filters, q, page, limit: 20 }), [q, filters.role, filters.plan, filters.status, filters.subscription, filters.sort, page]);
  const [creditUser, setCreditUser] = useState(null);
  const set = (key) => (event) => { setFilters((f) => ({ ...f, [key]: event.target.value })); setPage(1); };
  return (
    <Page title="Users" subtitle="Search, review and manage every account.">
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-[#E2DCCF] p-3">
          <SearchInput value={filters.q} onChange={(value) => { setFilters((f) => ({ ...f, q: value })); setPage(1); }} placeholder="Search name or email" />
          <Select value={filters.role} onChange={set('role')} className="w-auto" aria-label="Role"><option value="">All roles</option><option value="USER">User</option><option value="ADMIN">Admin</option></Select>
          <Select value={filters.plan} onChange={set('plan')} className="w-auto" aria-label="Plan"><option value="">All plans</option>{PLAN_OPTIONS.map((plan) => <option key={plan}>{plan}</option>)}</Select>
          <Select value={filters.subscription} onChange={set('subscription')} className="w-auto" aria-label="Subscription status"><option value="">Any subscription</option><option value="active">Active</option><option value="trialing">Trialing</option><option value="inactive">Inactive</option><option value="canceled">Canceled</option></Select>
          <Select value={filters.status} onChange={set('status')} className="w-auto" aria-label="Account status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></Select>
          <Select value={filters.sort} onChange={set('sort')} className="w-auto" aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option><option value="active">Last active</option><option value="credits">Most credits</option></Select>
        </div>
        <Async state={state} errorFallback={(error) => adminError(error)} skeleton={<TableSkeleton />}>
          {({ users, total, pages }) => (users.length === 0 ? <EmptyState title="No users match">Try a different search or clear a filter.</EmptyState> : (
            <div className="px-3 pb-3">
              <Table>
                <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Plan</Th><Th className="text-right">Credits</Th><Th>Status</Th><Th>Joined</Th><Th>Last active</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-[#FBF9F4]">
                      <Td><Link to={`/admin/users/${user.id}`} className="font-medium text-[#2F4A35] hover:underline">{user.name}</Link></Td>
                      <Td className="text-[#5B554A]">{user.email}</Td>
                      <Td><StatusBadge status={user.role} /></Td>
                      <Td>{user.plan}</Td>
                      <Td className="text-right tabular-nums">{fmt(user.balance)}</Td>
                      <Td><StatusBadge status={user.status} /></Td>
                      <Td className="whitespace-nowrap text-[#5B554A]">{dateOnly(user.createdAt)}</Td>
                      <Td className="whitespace-nowrap text-[#5B554A]">{ago(user.lastActiveAt)}</Td>
                      <Td className="text-right"><Btn size="sm" variant="secondary" onClick={() => setCreditUser(user)}>Edit credits</Btn></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pages={pages} total={total} onPage={setPage} label="users" />
            </div>
          ))}
        </Async>
      </Card>
      {creditUser ? <CreditDialog open user={creditUser} onClose={() => setCreditUser(null)} onDone={() => { setCreditUser(null); state.reload(); }} /> : null}
    </Page>
  );
}

const TABS = ['Overview', 'Credits', 'Websites', 'Activity', 'Notes'];

export function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { admin } = useAdmin();
  const [tab, setTab] = useState('Overview');
  const state = useAsync(() => adminService.user(id), [id]);
  const [dialog, setDialog] = useState(null);       // 'status' | 'role' | 'credits'
  const [reason, setReason] = useState('');
  const [planChoice, setPlanChoice] = useState('Post Paid Plan');
  const [busy, setBusy] = useState(false);

  const act = async (fn, success) => {
    setBusy(true);
    try { await fn(); toast.success(success); setDialog(null); setReason(''); state.reload(); }
    catch (error) { toast.error(adminError(error)); }
    finally { setBusy(false); }
  };

  return (
    <Page title="User profile" actions={<Btn onClick={() => navigate('/admin/users')}><ArrowLeft className="h-4 w-4" />All users</Btn>}>
      <Async state={state} errorFallback={(error) => adminError(error, 'This user could not be loaded.')} skeleton={<TableSkeleton rows={4} />}>
        {({ user, stats }) => {
          const self = user.id === admin?.id;
          return (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-serif text-2xl">{user.name}</h2><StatusBadge status={user.role} /><StatusBadge status={user.status} />{user.creditsExempt ? <Badge tone="blue">Credits exempt</Badge> : null}</div>
                    <p className="mt-1 text-sm text-[#5B554A]">{user.email}</p>
                    {user.status === 'suspended' ? <p className="mt-2 text-sm text-[#7A3A2E]">Suspended {dateTime(user.suspendedAt)}{user.suspensionReason ? `: ${user.suspensionReason}` : ''}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn variant="primary" onClick={() => setDialog('credits')}>Adjust credits</Btn>
                    <Btn onClick={() => { setPlanChoice(user.plan === 'Post Paid Plan' ? 'Free Tier' : 'Post Paid Plan'); setDialog('plan'); }}>Change plan</Btn>
                    {!self ? (user.status === 'suspended'
                      ? <Btn onClick={() => setDialog('restore')}>Restore account</Btn>
                      : <Btn variant="danger" onClick={() => setDialog('suspend')}>Suspend</Btn>) : null}
                    {!self ? <Btn onClick={() => setDialog('role')}>{user.role === 'ADMIN' ? 'Remove admin role' : 'Make admin'}</Btn> : null}
                  </div>
                </div>
              </Card>
              <div className="flex flex-wrap gap-1 border-b border-[#E2DCCF]">
                {TABS.map((name) => <button key={name} type="button" onClick={() => setTab(name)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === name ? 'border-[#2F4A35] font-medium text-[#2F4A35]' : 'border-transparent text-[#7A7366] hover:text-[#2B2823]'}`}>{name}</button>)}
              </div>
              {tab === 'Overview' ? <Overview user={user} stats={stats} /> : null}
              {tab === 'Credits' ? <UserCredits id={id} reloadKey={state.data} /> : null}
              {tab === 'Websites' ? <UserWebsites id={id} /> : null}
              {tab === 'Activity' ? <UserActivity id={id} /> : null}
              {tab === 'Notes' ? <UserNotes id={id} /> : null}

              <CreditDialog open={dialog === 'credits'} user={user} onClose={() => setDialog(null)} onDone={() => { setDialog(null); state.reload(); }} />
              <ConfirmDialog open={dialog === 'plan'} title="Change this account's plan" confirmLabel="Change plan" busy={busy} onClose={() => setDialog(null)} onConfirm={() => act(() => adminService.setUserPlan(id, planChoice), 'Plan updated.')}>
                <Field label="Plan"><Select value={planChoice} onChange={(event) => setPlanChoice(event.target.value)}>{PLAN_OPTIONS.filter((plan) => plan !== user.plan).map((plan) => <option key={plan}>{plan}</option>)}</Select></Field>
                <p>{planChoice === 'Post Paid Plan' ? `${user.name} gets no credit or token limit and is billed after use. People ${user.name} invites to groups also have no credit limit.` : `${user.name} moves to ${planChoice} and gets that plan's credits.`}</p>
              </ConfirmDialog>
              <ConfirmDialog open={dialog === 'suspend'} title="Suspend this account?" danger confirmLabel="Suspend account" busy={busy} onClose={() => setDialog(null)} onConfirm={() => act(() => adminService.setUserStatus(id, 'suspended', reason), 'Account suspended.')}>
                <p>{user.name} will be signed out of every request and cannot sign in until you restore the account. Their data is kept.</p>
                <Field label="Reason (required)"><Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} /></Field>
              </ConfirmDialog>
              <ConfirmDialog open={dialog === 'restore'} title="Restore this account?" confirmLabel="Restore account" busy={busy} onClose={() => setDialog(null)} onConfirm={() => act(() => adminService.setUserStatus(id, 'active', ''), 'Account restored.')}><p>{user.name} will be able to sign in and use Veave again.</p></ConfirmDialog>
              <ConfirmDialog open={dialog === 'role'} title={user.role === 'ADMIN' ? 'Remove the admin role?' : 'Make this user an admin?'} danger confirmLabel={user.role === 'ADMIN' ? 'Remove admin role' : 'Make admin'} busy={busy} onClose={() => setDialog(null)} onConfirm={() => act(() => adminService.setUserRole(id, user.role === 'ADMIN' ? 'USER' : 'ADMIN'), 'Role updated.')}>
                <p>{user.role === 'ADMIN' ? `${user.name} loses the ADMIN role.` : `${user.name} gets the ADMIN role, but the admin portal can only be used by the root administrator, so this gives no extra access.`}</p>
              </ConfirmDialog>
            </>
          );
        }}
      </Async>
    </Page>
  );
}

const Row = ({ label, children }) => <div className="flex justify-between gap-4 border-b border-[#EFEBE1] py-2 text-sm last:border-0"><dt className="text-[#7A7366]">{label}</dt><dd className="text-right font-medium text-[#2B2823]">{children}</dd></div>;

function Overview({ user, stats }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Account"><dl><Row label="Role">{user.role}</Row><Row label="Status">{user.status}</Row><Row label="Registered">{dateTime(user.createdAt)}</Row><Row label="Last sign-in">{dateTime(user.lastLoginAt)}</Row><Row label="Last active">{ago(user.lastActiveAt)}</Row></dl></Card>
      <Card title="Credits & subscription"><dl><Row label="Credit balance">{fmt(user.balance)}</Row><Row label="Plan">{user.plan}</Row><Row label="Subscription status">{user.subscription.status}</Row><Row label="Billing cycle">{user.subscription.billingCycle}</Row><Row label="Plan allowance">{user.subscription.creditsAllocated ?? '—'}</Row><Row label="Bonus credits">{fmt(user.subscription.bonusCredits)}</Row><Row label="Renews">{user.subscription.renewsAt ? dateOnly(user.subscription.renewsAt) : '—'}</Row></dl></Card>
      <Card title="Usage"><dl><Row label="Template websites">{fmt(stats.websites)}</Row><Row label="Projects">{fmt(stats.projects)}</Row><Row label="Credit transactions">{fmt(stats.transactions)}</Row><Row label="Admin notes">{fmt(stats.notes)}</Row><Row label="Last generation">{stats.lastJob ? `${stats.lastJob.status} · ${ago(stats.lastJob.createdAt)}` : '—'}</Row></dl></Card>
    </div>
  );
}

function UserCredits({ id, reloadKey }) {
  const [page, setPage] = useState(1);
  const state = useAsync(() => adminService.userCredits(id, { page, limit: 15 }), [id, page, reloadKey]);
  return (
    <Card pad={false} title="Credit transaction history">
      <Async state={state} errorFallback={(error) => adminError(error)}>
        {({ transactions, total, pages }) => (transactions.length === 0 ? <EmptyState title="No transactions yet" /> : (
          <div className="px-3 pb-3">
            <Table><thead><tr><Th>Date</Th><Th>Type</Th><Th className="text-right">Before</Th><Th className="text-right">Change</Th><Th className="text-right">After</Th><Th>Reason</Th><Th>By</Th></tr></thead>
              <tbody>{transactions.map((row) => <tr key={row.transactionId}><Td className="whitespace-nowrap">{dateTime(row.createdAt)}</Td><Td><Badge tone={row.amount > 0 ? 'green' : 'red'}>{row.type.replace(/_/g, ' ').toLowerCase()}</Badge></Td><Td className="text-right tabular-nums">{row.previousBalance ?? '—'}</Td><Td className={`text-right font-medium tabular-nums ${row.amount > 0 ? 'text-[#33503A]' : 'text-[#7A3A2E]'}`}>{row.amount > 0 ? '+' : ''}{row.amount}</Td><Td className="text-right tabular-nums">{row.newBalance ?? '—'}</Td><Td className="max-w-xs truncate" title={row.reason}>{row.reason}</Td><Td>{row.admin?.email || 'System'}</Td></tr>)}</tbody></Table>
            <Pagination page={page} pages={pages} total={total} onPage={setPage} label="transactions" />
          </div>
        ))}
      </Async>
    </Card>
  );
}

function UserWebsites({ id }) {
  const state = useAsync(() => adminService.userWebsites(id), [id]);
  return (
    <Async state={state} errorFallback={(error) => adminError(error)}>
      {({ templateSites, projects }) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card pad={false} title={`Template websites (${templateSites.length})`}>{templateSites.length ? <div className="px-3 pb-3"><Table><thead><tr><Th>Name</Th><Th>Template</Th><Th>Status</Th><Th>Created</Th></tr></thead><tbody>{templateSites.map((site) => <tr key={site.id}><Td className="font-medium">{site.name}</Td><Td>{site.templateId} <span className="text-[#7A7366]">v{site.templateVersion}</span></Td><Td><StatusBadge status={site.status} /></Td><Td>{dateOnly(site.createdAt)}</Td></tr>)}</tbody></Table></div> : <EmptyState title="No template websites" />}</Card>
          <Card pad={false} title={`Other projects (${projects.length})`}>{projects.length ? <div className="px-3 pb-3"><Table><thead><tr><Th>Name</Th><Th>Status</Th><Th>Updated</Th></tr></thead><tbody>{projects.map((project) => <tr key={project.id}><Td className="font-medium">{project.name}</Td><Td><StatusBadge status={project.status || 'active'} /></Td><Td>{dateOnly(project.updatedAt)}</Td></tr>)}</tbody></Table></div> : <EmptyState title="No projects" />}</Card>
        </div>
      )}
    </Async>
  );
}

function UserActivity({ id }) {
  const state = useAsync(() => adminService.userActivity(id), [id]);
  return (
    <Card title="Recent activity">
      <Async state={state} errorFallback={(error) => adminError(error)}>
        {({ events }) => (events.length ? <ol className="space-y-3">{events.map((event, index) => <li key={index} className="flex gap-3 text-sm"><Badge tone={event.kind === 'admin' ? 'purple' : event.kind === 'generation' ? 'blue' : 'grey'}>{event.kind}</Badge><span className="flex-1">{event.text}</span><span className="shrink-0 text-xs text-[#7A7366]">{dateTime(event.at)}</span></li>)}</ol> : <EmptyState title="No activity yet" />)}
      </Async>
    </Card>
  );
}

function UserNotes({ id }) {
  const state = useAsync(() => adminService.userNotes(id), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await adminService.addUserNote(id, note); setNote(''); toast.success('Note saved.'); state.reload(); }
    catch (error) { toast.error(adminError(error)); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Add an internal note"><div className="space-y-3"><Textarea rows={5} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder="Only admins can see this." /><Btn variant="primary" busy={busy} disabled={!note.trim()} onClick={save}>Save note</Btn></div></Card>
      <Card title="Notes" className="lg:col-span-2"><Async state={state} errorFallback={(error) => adminError(error)}>{({ notes }) => (notes.length ? <ul className="space-y-3">{notes.map((item) => <li key={item._id} className="rounded-lg bg-[#F5F1E8] p-3 text-sm"><p className="whitespace-pre-wrap">{item.note}</p><p className="mt-1 text-xs text-[#7A7366]">{item.adminName} · {dateTime(item.createdAt)}</p></li>)}</ul> : <EmptyState title="No notes yet" />)}</Async></Card>
    </div>
  );
}
