import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, FolderOpen, Coins, Calculator, Layers, ArrowDownToLine, ArrowUpFromLine, History, ArrowLeft, Check, ChevronRight, AlertCircle } from 'lucide-react';
import { collaborationService as svc, apiErrorMessage } from '../../services/collaborationService';
import { Modal, Btn, Notice, Spinner, timeAgo } from './ui';

const QUICK = [10, 25, 50, 100, 250, 500];
const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);
const fmt = (n) => Number(n || 0).toLocaleString();
const wholeNumber = (value) => /^\d+$/.test(String(value).trim()) && Number(value) >= 1;

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-[#E2E5E8] bg-zinc-50/70 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"><Icon className="h-3.5 w-3.5 text-amber-600" />{label}</div>
      <div className="mt-1 text-xl font-bold leading-none text-[#0F172A]">{value}</div>
      {hint && <div className="mt-1 truncate text-[10px] text-zinc-500">{hint}</div>}
    </div>
  );
}

function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div role="tablist" className={`grid gap-1 rounded-xl bg-zinc-100 p-1 ${className}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const on = value === option.value;
        return (
          <button key={option.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(option.value)}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all duration-150 ${on ? `bg-white shadow-sm ${option.activeClass || 'text-[#0F172A]'}` : 'text-zinc-500 hover:text-zinc-800'}`}>
            {option.icon ? <option.icon className="h-3.5 w-3.5" /> : null}{option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Credits of a whole group: add credits to its projects (from the admin's own balance) or take them back, for every project, a selection,
 * the same amount each or a different amount each. Everything is read from and written to the server; the server re-checks every rule.
 * `projectId` opens it for one project (the coin next to a project's name).
 */
export default function GroupCreditsDialog({ open, onClose, group, projectId = null, onChanged }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState('main'); // main | history
  const [history, setHistory] = useState(null);
  const [mode, setMode] = useState('add');
  const [scope, setScope] = useState('all');
  const [picked, setPicked] = useState(() => new Set());
  const [split, setSplit] = useState('equal'); // equal | custom
  const [amount, setAmount] = useState('');
  const [custom, setCustom] = useState({});
  const [step, setStep] = useState('form'); // form | review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const keyRef = useRef(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await svc.groupCredits(group.id);
      setData(res.data.data);
      setLoadError(null);
      return res.data.data;
    } catch (err) { setLoadError(apiErrorMessage(err, 'Could not load the group credits.')); return null; }
  }, [group?.id]);

  useEffect(() => {
    if (!open || !group) return;
    setData(null); setLoadError(null); setView('main'); setHistory(null); setMode('add'); setSplit('equal'); setAmount(''); setCustom({});
    setStep('form'); setError(null); setDone(null); keyRef.current = null;
    setScope(projectId ? 'selected' : 'all');
    setPicked(new Set(projectId ? [String(projectId)] : []));
    load();
  }, [open, group?.id, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const projects = data?.projects || [];
  const effective = scope === 'all' ? projects : projects.filter((p) => picked.has(p.id));
  const adding = mode === 'add';

  // One allocation per affected project, and every problem with the input in plain words.
  const plan = useMemo(() => {
    const problems = [];
    const rows = [];
    if (!projects.length) return { rows, total: 0, problems: ['This group has no projects yet.'], perProject: null };
    if (!effective.length) problems.push('Select at least one project.');
    if (split === 'equal') {
      const filled = String(amount).trim() !== '';
      if (filled && !wholeNumber(amount)) problems.push('Enter a whole number of 1 or more.');
      else if (filled && Number(amount) > (data?.limits?.maxEach || 100000)) problems.push(`The most for one project is ${fmt(data.limits.maxEach)}.`);
      else if (filled) effective.forEach((p) => rows.push({ project: p, amount: Number(amount) }));
    } else {
      effective.forEach((p) => {
        const raw = String(custom[p.id] ?? '').trim();
        if (raw === '') return;
        if (!wholeNumber(raw)) problems.push(`"${p.name}": enter a whole number of 1 or more.`);
        else rows.push({ project: p, amount: Number(raw) });
      });
      if (!rows.length && !problems.length && effective.length) problems.push('Enter an amount for at least one project.');
    }
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    if (adding && rows.length && total > (data?.available ?? 0)) problems.push(`You have ${fmt(data.available)} credits available but this needs ${fmt(total)}.`);
    if (!adding) {
      const short = rows.filter((row) => row.amount > row.project.creditBalance);
      if (short.length === 1) problems.push(`"${short[0].project.name}" has only ${fmt(short[0].project.creditBalance)} credits.`);
      else if (short.length > 1) problems.push(`${short.length} of the selected projects have fewer than ${split === 'equal' ? fmt(Number(amount)) : 'the entered'} credits to take back.`);
    }
    return { rows, total, problems, perProject: split === 'equal' && rows.length ? Number(amount) : null };
  }, [projects, effective, split, amount, custom, adding, data]);

  const allocated = data?.totals?.allocated ?? 0;
  const available = data?.available ?? 0;
  const newAllocated = allocated + (adding ? plan.total : -plan.total);
  const newAvailable = available + (adding ? -plan.total : plan.total);
  const valid = plan.rows.length > 0 && plan.problems.length === 0;
  const takeableMax = effective.length ? Math.min(...effective.map((p) => p.creditBalance)) : 0;

  const reset = (patch = {}) => { setStep('form'); setError(null); setDone(null); keyRef.current = null; return patch; };
  const togglePick = (id) => { reset(); setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const allPicked = projects.length > 0 && projects.every((p) => picked.has(p.id));

  const submit = async () => {
    if (busyRef.current || !valid) return;
    busyRef.current = true; setBusy(true); setError(null);
    if (!keyRef.current) keyRef.current = newKey();
    try {
      const res = await svc.changeGroupCredits(group.id, { action: mode, allocations: plan.rows.map((row) => ({ projectId: row.project.id, amount: row.amount })), idempotencyKey: keyRef.current });
      const next = res.data.data;
      setData(next);
      onChanged?.(next.projects);
      setDone(adding
        ? `${fmt(plan.total)} credits added to ${plan.rows.length} project${plan.rows.length === 1 ? '' : 's'}.`
        : `${fmt(plan.total)} credits returned to your balance from ${plan.rows.length} project${plan.rows.length === 1 ? '' : 's'}.`);
      setStep('form'); setAmount(''); setCustom({}); keyRef.current = null; setHistory(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change the credits. Nothing was changed.'));
      setStep('form'); keyRef.current = null;
      load().then((fresh) => fresh && onChanged?.(fresh.projects));
    } finally { busyRef.current = false; setBusy(false); }
  };

  const openHistory = async () => {
    setView('history');
    if (history) return;
    try { setHistory((await svc.groupCreditsHistory(group.id)).data.data || []); } catch (err) { setHistory([]); setError(apiErrorMessage(err, 'Could not load the history.')); }
  };

  if (!group) return null;
  const single = projectId ? projects.find((p) => p.id === String(projectId)) : null;
  const title = view === 'history' ? 'Credit history' : single ? 'Project credits' : 'Group credits';
  const description = view === 'history' ? `Recent credit changes in ${group.name}` : single ? single.name : `Manage the credits of every project in ${group.name}`;
  const accent = adding ? 'emerald' : 'rose';

  return (
    <Modal open={open} onClose={onClose} wide title={title} description={description}>
      {loadError && <Notice>{loadError}</Notice>}
      {!loadError && !data && <Spinner label="Loading credits..." />}

      {data && view === 'history' && (
        <div className="space-y-3">
          <button type="button" onClick={() => setView('main')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-[#0F172A]"><ArrowLeft className="h-3.5 w-3.5" />Back to credits</button>
          {history === null ? <Spinner label="Loading history..." /> : history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#E2E5E8] py-8 text-center text-xs text-zinc-500">No credit changes yet.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {history.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-[#E2E5E8] bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${entry.operation === 'add' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {entry.operation === 'add' ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}{entry.operation === 'add' ? 'Added' : 'Taken back'}
                    </span>
                    <span className="text-sm font-bold text-[#0F172A]">{entry.operation === 'add' ? '+' : '-'}{fmt(entry.total)}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">{entry.actor?.name || 'An admin'} &middot; {timeAgo(entry.at)} &middot; {entry.projects.length} project{entry.projects.length === 1 ? '' : 's'}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600">{entry.projects.map((p) => `${p.name} (${fmt(p.before)} \u2192 ${fmt(p.after)})`).join(', ')}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && view === 'main' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={Layers} label="Projects" value={fmt(data.totals.projects)} hint="in this group" />
            <Stat icon={Wallet} label="Allocated" value={fmt(allocated)} hint="on the projects" />
            <Stat icon={Coins} label="Available" value={fmt(available)} hint="your balance" />
            <Stat icon={Calculator} label="Average" value={fmt(data.totals.average)} hint="per project" />
          </div>

          <Segmented value={mode} onChange={(v) => { setMode(v); reset(); }} options={[
            { value: 'add', label: 'Add credits', icon: ArrowDownToLine, activeClass: 'text-emerald-700' },
            { value: 'take', label: 'Take back credits', icon: ArrowUpFromLine, activeClass: 'text-rose-700' }
          ]} />
          <p className="-mt-2 text-[11px] text-zinc-500">{adding ? 'Credits are taken from your own balance and placed on the projects. Each project spends its own credits first.' : 'Unspent project credits are returned to your own balance.'}</p>

          {!single && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Segmented value={scope} onChange={(v) => { setScope(v); reset(); }} options={[{ value: 'all', label: `All projects (${projects.length})` }, { value: 'selected', label: 'Select projects' }]} />
              <Segmented value={split} onChange={(v) => { setSplit(v); reset(); }} options={[{ value: 'equal', label: 'Same for each' }, { value: 'custom', label: 'Different each' }]} />
            </div>
          )}

          {(scope === 'selected' && !single) || split === 'custom' ? (
            <div className="rounded-xl border border-[#E2E5E8]">
              {scope === 'selected' && !single && (
                <div className="flex items-center justify-between border-b border-[#E2E5E8] bg-zinc-50 px-3 py-2 text-[11px]">
                  <span className="font-semibold text-zinc-600">{picked.size} of {projects.length} selected</span>
                  <button type="button" onClick={() => { reset(); setPicked(allPicked ? new Set() : new Set(projects.map((p) => p.id))); }} className="font-semibold text-[#0F172A] underline-offset-2 hover:underline">{allPicked ? 'Deselect all' : 'Select all'}</button>
                </div>
              )}
              <ul className="max-h-48 divide-y divide-zinc-100 overflow-y-auto">
                {projects.map((p) => {
                  const on = scope === 'all' || single ? effective.some((e) => e.id === p.id) : picked.has(p.id);
                  if (single && p.id !== String(projectId)) return null;
                  return (
                    <li key={p.id} className={`flex items-center gap-3 px-3 py-2 transition ${on ? 'bg-white' : 'bg-zinc-50/60 text-zinc-400'}`}>
                      {scope === 'selected' && !single && (
                        <input type="checkbox" checked={on} onChange={() => togglePick(p.id)} aria-label={`Select ${p.name}`} className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 accent-zinc-900" />
                      )}
                      <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#0F172A]">{p.name}</span><span className="block text-[10px] text-zinc-500">{fmt(p.creditBalance)} credits now</span></span>
                      {split === 'custom' && on && (
                        <input type="number" min="1" step="1" inputMode="numeric" value={custom[p.id] ?? ''} onChange={(e) => { reset(); setCustom((c) => ({ ...c, [p.id]: e.target.value })); }} placeholder="0" aria-label={`Credits for ${p.name}`}
                          className="h-8 w-20 rounded-lg border border-[#E2E5E8] px-2 text-right text-xs font-semibold outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10" />
                      )}
                    </li>
                  );
                })}
              </ul>
              {split === 'custom' && !adding && (
                <div className="border-t border-[#E2E5E8] bg-zinc-50 px-3 py-2 text-right">
                  <button type="button" onClick={() => { reset(); setCustom(Object.fromEntries(effective.filter((p) => p.creditBalance > 0).map((p) => [p.id, String(p.creditBalance)]))); }} className="text-[11px] font-semibold text-[#0F172A] underline-offset-2 hover:underline">Fill with every full balance</button>
                </div>
              )}
            </div>
          ) : null}

          {split === 'equal' && (
            <div>
              <label htmlFor="group-credit-amount" className="mb-1.5 block text-[11px] font-semibold text-zinc-600">{single ? 'Credits' : 'Credits for each project'}</label>
              <div className="relative">
                <input id="group-credit-amount" type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={(e) => { reset(); setAmount(e.target.value); }} placeholder="Enter an amount" autoFocus
                  className="h-11 w-full rounded-xl border border-[#E2E5E8] bg-white px-3 pr-20 text-base font-semibold text-[#0F172A] outline-none transition focus:border-zinc-900 focus:ring-4 focus:ring-zinc-900/10 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400">credits</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK.map((n) => (
                  <button key={n} type="button" onClick={() => { reset(); setAmount(String(n)); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95 ${Number(amount) === n ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm' : 'border-[#E2E5E8] bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50'}`}>{n}</button>
                ))}
                {!adding && takeableMax > 0 && (
                  <button type="button" onClick={() => { reset(); setAmount(String(takeableMax)); }} className="rounded-lg border border-[#E2E5E8] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50 active:scale-95">Max ({fmt(takeableMax)})</button>
                )}
              </div>
            </div>
          )}

          {plan.problems.length > 0 && (plan.rows.length > 0 || String(amount).trim() !== '' || Object.values(custom).some((v) => String(v).trim() !== '') || !projects.length) && (
            <ul className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {plan.problems.slice(0, 4).map((problem) => <li key={problem} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{problem}</li>)}
            </ul>
          )}

          <div className="rounded-2xl border border-[#E2E5E8] bg-zinc-50 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-zinc-500">Projects affected</dt><dd className="text-right font-semibold text-[#0F172A]">{plan.rows.length}</dd>
              <dt className="text-zinc-500">Credits per project</dt><dd className="text-right font-semibold text-[#0F172A]">{plan.perProject !== null ? fmt(plan.perProject) : plan.rows.length ? 'Varies' : '-'}</dd>
              <dt className="text-zinc-500">Total {adding ? 'to add' : 'to take back'}</dt><dd className={`text-right text-sm font-bold ${accent === 'emerald' ? 'text-emerald-700' : 'text-rose-700'}`}>{plan.total ? `${adding ? '+' : '-'}${fmt(plan.total)}` : '-'}</dd>
              <dt className="text-zinc-500">Allocated balance</dt><dd className="text-right font-semibold text-[#0F172A]">{fmt(allocated)}{plan.total ? <> <ChevronRight className="inline h-3 w-3 text-zinc-400" /> {fmt(Math.max(0, newAllocated))}</> : null}</dd>
              <dt className="text-zinc-500">Your balance</dt><dd className="text-right font-semibold text-[#0F172A]">{fmt(available)}{plan.total ? <> <ChevronRight className="inline h-3 w-3 text-zinc-400" /> {fmt(Math.max(0, newAvailable))}</> : null}</dd>
            </dl>
          </div>

          {error && <Notice>{error}</Notice>}
          {done && <Notice kind="success">{done}</Notice>}

          {step === 'review' ? (
            <div className={`rounded-2xl border p-4 ${adding ? 'border-emerald-200 bg-emerald-50/60' : 'border-rose-200 bg-rose-50/60'}`}>
              <p className="text-sm font-bold text-[#0F172A]">{adding ? `Add ${fmt(plan.total)} credits?` : `Take back ${fmt(plan.total)} credits?`}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {adding ? `${fmt(plan.total)} credits will leave your balance and go to ${plan.rows.length} project${plan.rows.length === 1 ? '' : 's'}.` : `${fmt(plan.total)} credits will be removed from ${plan.rows.length} project${plan.rows.length === 1 ? '' : 's'} and returned to your balance. Their AI work will use personal balances once the project credits run out.`}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Btn variant="outline" disabled={busy} onClick={() => setStep('form')}>Back</Btn>
                <Btn variant={adding ? 'primary' : 'danger'} loading={busy} onClick={submit} icon={Check}>{adding ? 'Confirm and add' : 'Confirm and take back'}</Btn>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
              <button type="button" onClick={openHistory} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-[#0F172A]"><History className="h-3.5 w-3.5" />Transaction history</button>
              <Btn disabled={!valid || busy} onClick={() => { setError(null); setDone(null); keyRef.current = newKey(); setStep('review'); }}>
                {adding ? 'Review and add' : 'Review and take back'}
              </Btn>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
