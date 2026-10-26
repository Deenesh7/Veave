import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCw, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Trash2, Plus } from 'lucide-react';
import { hostingService, hostingErrorMessage } from '../../services/hostingService';
import { loadRazorpayScript } from '../../utils/razorpay';
import { useAuthStore } from '../../store/authStore';

const payload = (response) => response?.data?.data ?? response?.data ?? response;
const inr = (value) => `₹${Number(value).toLocaleString('en-IN')}`;
const fmtDate = (value) => { try { return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

function DnsManager({ domain }) {
  const [records, setRecords] = useState(null);
  const [draft, setDraft] = useState({ type: 'A', name: '@', data: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRecords(payload(await hostingService.dnsList(domain))); setError(''); } catch (e) { setError(hostingErrorMessage(e, 'Could not load DNS records.')); }
  }, [domain]);
  useEffect(() => { load(); }, [load]);

  const act = async (name, fn) => { setBusy(name); setError(''); try { await fn(); await load(); } catch (e) { setError(hostingErrorMessage(e, 'DNS update failed.')); } finally { setBusy(''); } };

  return (
    <div className="space-y-2">
      {!records && !error && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading DNS records...</p>}
      {records && (
        <table className="w-full text-[11px] font-mono">
          <thead><tr className="text-zinc-400 text-left"><th className="pr-2">Type</th><th className="pr-2">Name</th><th>Value</th><th /></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={`${r.type}-${r.name}-${r.data}`} className="align-top">
                <td className="pr-2 py-0.5 font-bold">{r.type}</td><td className="pr-2 py-0.5">{r.name}</td><td className="py-0.5 break-all">{r.data}</td>
                <td className="py-0.5 pl-1">
                  {r.type !== 'NS' && <button type="button" title="Delete all records of this type and name" disabled={!!busy} onClick={() => act('del', () => hostingService.dnsDelete(domain, { type: r.type, name: r.name }))} className="text-zinc-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3 h-3" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-1.5">
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className="rounded-lg border border-zinc-200 px-1.5 py-1 text-[11px] font-mono">
          {RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="@ or www" className="w-20 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-mono" />
        <input value={draft.data} onChange={(e) => setDraft({ ...draft, data: e.target.value })} placeholder="value" className="flex-1 min-w-0 rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-mono" />
        <button type="button" disabled={!draft.data.trim() || !!busy} onClick={() => act('set', async () => { await hostingService.dnsSet(domain, draft); setDraft({ ...draft, data: '' }); })} className="px-2 rounded-lg bg-zinc-900 text-white disabled:opacity-50 cursor-pointer" title="Save record (replaces records with the same type and name)">
          {busy === 'set' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-700 whitespace-pre-wrap" role="alert">{error}</p>}
    </div>
  );
}

function DomainRow({ item, onChanged }) {
  const user = useAuthStore((state) => state.user);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadPrice = async () => {
    setBusy('price'); setError('');
    try { setPrice(payload(await hostingService.renewalPrice(item.domain))); } catch (e) { setError(hostingErrorMessage(e, 'Could not get the renewal price.')); } finally { setBusy(''); }
  };

  const watch = (orderId) => {
    const tick = async () => {
      try {
        const next = payload(await hostingService.getDomainOrder(orderId));
        setStatus(next);
        if (next.done) { onChanged?.(); return; }
      } catch { /* retry */ }
      timer.current = setTimeout(tick, 4000);
    };
    tick();
  };

  const renew = async () => {
    setBusy('renew'); setError('');
    try {
      const order = payload(await hostingService.createRenewal(item.domain, 1));
      if (!(await loadRazorpayScript()) || !window.Razorpay) throw new Error('Could not load the payment checkout.');
      await new Promise((resolve) => {
        const rzp = new window.Razorpay({
          key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
          name: 'Veave AI', description: `Renew ${order.domain} for 1 year`,
          prefill: { name: user?.name || order.user?.name || '', email: user?.email || order.user?.email || '' },
          theme: { color: '#18181b' }, modal: { ondismiss: () => resolve() },
          handler: async (response) => {
            setStatus({ status: 'registering', done: false });
            try { setStatus(payload(await hostingService.verifyDomainOrder(item.projectId, { ...response, agreed: true }))); } catch (e) { setError(hostingErrorMessage(e, 'Payment verification failed.')); }
            watch(order.id); resolve();
          }
        });
        rzp.on('payment.failed', (r) => { setError(r.error?.description || 'Payment was unsuccessful.'); resolve(); });
        rzp.open();
      });
    } catch (e) { setError(hostingErrorMessage(e, 'Renewal failed.')); } finally { setBusy(''); }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono font-semibold truncate">{item.domain}</p>
          <p className={`text-[11px] ${item.expiringSoon ? 'text-amber-700 font-semibold' : 'text-zinc-500'}`}>
            {item.expiresAt ? `Expires ${fmtDate(item.expiresAt)}${item.daysLeft != null ? ` (${item.daysLeft} days left)` : ''}` : 'Expiry not available yet'}
          </p>
        </div>
        <button type="button" onClick={() => { setOpen(!open); if (!open && !price) loadPrice(); }} className="text-zinc-500 hover:text-zinc-900 cursor-pointer">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
      </div>

      {open && (
        <div className="space-y-3 pt-2 border-t border-zinc-100">
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono font-bold uppercase text-zinc-500">Renewal</p>
            {busy === 'price' && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Getting the renewal price...</p>}
            {price && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>Renew 1 year for <b>{inr(price.inr)}</b>{price.newExpiresAt ? <span className="text-zinc-500"> (new expiry {fmtDate(price.newExpiresAt)})</span> : null}</span>
                <button type="button" onClick={renew} disabled={!!busy || (status && !status.done)} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-black disabled:opacity-50 cursor-pointer">
                  {busy === 'renew' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />} Renew
                </button>
              </div>
            )}
            {status && !status.done && <p className="text-[11px] text-zinc-600 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Payment received. Renewing... this updates automatically.</p>}
            {status?.done && status.status === 'registered' && <p className="text-[11px] text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Renewed{status.newExpiresAt ? ` until ${fmtDate(status.newExpiresAt)}` : ''}.</p>}
            {status?.done && status.status !== 'registered' && <p className="text-[11px] text-rose-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {status.error || 'Renewal failed.'} {status.refunded ? 'Your payment was refunded.' : 'Contact support for a refund.'}</p>}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono font-bold uppercase text-zinc-500">DNS records</p>
            <DnsManager domain={item.domain} />
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-700 whitespace-pre-wrap" role="alert">{error}</p>}
    </div>
  );
}

export function MyDomains({ refreshKey }) {
  const [items, setItems] = useState(null);
  const load = useCallback(async () => { try { setItems(payload(await hostingService.myDomains()) || []); } catch { setItems([]); } }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!items?.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-mono font-bold uppercase text-zinc-500">Your domains</p>
      {items.map((item) => <DomainRow key={item.domain} item={item} onChanged={load} />)}
    </div>
  );
}

export default MyDomains;
