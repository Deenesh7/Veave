import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, ArrowLeft } from 'lucide-react';
import { hostingService, hostingErrorMessage } from '../../services/hostingService';
import { loadRazorpayScript } from '../../utils/razorpay';
import { useAuthStore } from '../../store/authStore';
import { usePublishing } from './usePublishing';
import DomainSection from './DomainSection';
import MyDomains from './MyDomains';

const payload = (response) => response?.data?.data ?? response?.data ?? response;
const inr = (value) => `₹${Number(value).toLocaleString('en-IN')}`;

// Same rules as the backend: "+91 98765 43210", "9876543210" or "+91.9876543210" all become "+91.9876543210".
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (/^\+\d{1,3}\.\d{4,14}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length > 6) {
    const cc = digits.startsWith('91') ? 2 : digits.startsWith('1') ? 1 : digits.length > 10 ? digits.length - 10 : 2;
    return `+${digits.slice(0, cc)}.${digits.slice(cc)}`;
  }
  return digits.length === 10 ? `+91.${digits}` : raw;
}

const EMPTY_CONTACT = { firstName: '', lastName: '', email: '', phone: '', organization: '', address1: '', city: '', state: '', postalCode: '', country: 'IN' };
const FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone (e.g. +91 9876543210)'],
  ['address1', 'Address'], ['city', 'City'], ['state', 'State'], ['postalCode', 'PIN / postal code'], ['country', 'Country (2 letters)']
];

function contactProblem(c) {
  const labels = { firstName: 'first name', lastName: 'last name', email: 'email', phone: 'phone', address1: 'address', city: 'city', state: 'state', postalCode: 'PIN / postal code', country: 'country' };
  for (const [key, label] of Object.entries(labels)) if (!String(c[key] || '').trim()) return `Please enter your ${label}.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'Enter a valid email address.';
  if (!/^\+\d{1,3}\.\d{4,14}$/.test(normalizePhone(c.phone))) return 'Enter a valid phone number, e.g. +91 9876543210.';
  if (!/^[A-Za-z]{2}$/.test(c.country.trim())) return 'Country must be a 2-letter code, e.g. IN.';
  return '';
}

export function DomainPanel({ project }) {
  const projectId = project?._id || project?.id || null;
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { site } = usePublishing(projectId, { enabled: Boolean(isAuthenticated) });
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [stage, setStage] = useState('search'); // search | contact | review | done
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [order, setOrder] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (user?.email) setContact((c) => (c.email ? c : { ...c, email: user.email, firstName: c.firstName || String(user.name || '').split(' ')[0] || '', lastName: c.lastName || String(user.name || '').split(' ').slice(1).join(' ') }));
  }, [user]);

  const run = async (name, fn) => {
    setBusy(name); setError('');
    try { return await fn(); } catch (e) { setError(hostingErrorMessage(e, 'Domain request failed.')); return null; } finally { setBusy(''); }
  };

  const search = (value = query) => run('search', async () => {
    setOutcome(null); setStage('search'); setAgreed(false); setOrder(null);
    setResult(payload(await hostingService.searchDomain(value)));
  });

  const createOrder = () => run('order', async () => {
    const problem = contactProblem(contact);
    if (problem) throw new Error(problem);
    setOrder(payload(await hostingService.createDomainOrder(projectId, result.domain, { ...contact, phone: normalizePhone(contact.phone), country: contact.country.toUpperCase() })));
    setStage('review');
  });

  // The result appears in the app by itself: poll until registration finishes (or is refunded).
  const watch = (orderId) => {
    const tick = async () => {
      try {
        const next = payload(await hostingService.getDomainOrder(orderId));
        setOutcome(next);
        if (next.done) { setStage('done'); return; }
      } catch { /* keep trying */ }
      timer.current = setTimeout(tick, 4000);
    };
    tick();
  };

  const pay = () => run('pay', async () => {
    if (!(await loadRazorpayScript()) || !window.Razorpay) throw new Error('Could not load the payment checkout. Check your connection.');
    await new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'Veave AI', description: `Domain: ${order.domain} (1 year)`,
        prefill: { name: `${contact.firstName} ${contact.lastName}`.trim(), email: contact.email, contact: contact.phone.replace('.', '') },
        theme: { color: '#18181b' },
        modal: { ondismiss: () => resolve() },
        handler: async (response) => {
          setStage('done'); setOutcome({ domain: order.domain, status: 'registering', amount: order.amount / 100, done: false });
          try { setOutcome(payload(await hostingService.verifyDomainOrder(projectId, { ...response, agreed: true }))); } catch (e) { setError(hostingErrorMessage(e, 'Payment verification failed.')); }
          watch(order.id);
          resolve();
        }
      });
      rzp.on('payment.failed', (r) => { setError(r.error?.description || 'Payment was unsuccessful.'); resolve(); });
      rzp.open();
    });
  });

  if (!isAuthenticated) return <p className="text-xs text-zinc-500">Log in to manage domains.</p>;


  return (
    <div className="space-y-4">
      {stage !== 'done' && (
        <div>
          <label className="block text-[11px] font-mono font-bold uppercase text-zinc-500 mb-1.5">Find a domain</label>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) search(); }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="mybusiness.com"
              className="flex-1 min-w-0 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-mono outline-none focus:border-zinc-900" />
            <button type="submit" disabled={!query.trim() || !!busy} className="px-3.5 py-2 rounded-lg bg-zinc-900 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-black disabled:opacity-50 cursor-pointer">
              {busy === 'search' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search
            </button>
          </form>
        </div>
      )}

      {result && stage === 'search' && (
        result.available ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="w-4 h-4" /> {result.domain} is available</span>
            {result.price && (
              <div className="rounded-lg bg-white border border-emerald-200 p-2.5 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-zinc-500">Registration, 1 year</span><span className="font-bold text-zinc-900">{inr(result.price.inr)}</span></div>
                {result.price.renewalUsd != null && <div className="flex justify-between text-[11px] text-zinc-400"><span>Renews after year 1</span><span>about {inr(Math.ceil(result.price.renewalUsd * (result.price.inr / result.price.usd)))}/yr</span></div>}
              </div>
            )}
            <button type="button" onClick={() => setStage('contact')} disabled={!result.price} className="w-full px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold disabled:opacity-50 cursor-pointer">Buy this domain</button>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700"><XCircle className="w-4 h-4 text-rose-500" /> {result.domain} is not available</p>
            {result.suggestions?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.suggestions.map((name) => (
                  <button key={name} type="button" onClick={() => { setQuery(name); search(name); }} className="px-2 py-1 rounded-full border border-zinc-200 bg-white text-[11px] font-mono hover:border-zinc-900 cursor-pointer">{name}</button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-zinc-500">Already own it? Connect it below.</p>
          </div>
        )
      )}

      {stage === 'contact' && result && (
        <div className="rounded-xl border border-zinc-200 p-3 space-y-2.5">
          <button type="button" onClick={() => setStage('search')} className="text-[11px] text-zinc-500 hover:text-zinc-900 flex items-center gap-1 cursor-pointer"><ArrowLeft className="w-3 h-3" /> Back</button>
          <p className="text-xs font-semibold">Owner details for <span className="font-mono">{result.domain}</span></p>
          <p className="text-[11px] text-zinc-500">Required by domain registries. Use real details; they are listed as the domain's contact.</p>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map(([key, label]) => (
              <input key={key} value={contact[key]} onChange={(e) => setContact({ ...contact, [key]: e.target.value })} placeholder={label}
                className={`rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs outline-none focus:border-zinc-900 ${['email', 'address1'].includes(key) ? 'col-span-2' : ''}`} />
            ))}
          </div>
          <button type="button" onClick={createOrder} disabled={!!busy} className="w-full px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer">
            {busy === 'order' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Continue to payment'}
          </button>
        </div>
      )}

      {stage === 'review' && order && (
        <div className="rounded-xl border border-zinc-200 p-3 space-y-2.5">
          <div className="flex justify-between text-xs"><span className="font-mono font-semibold">{order.domain}</span><span className="font-bold">{inr(order.amount / 100)} / 1 year</span></div>
          <label className="flex items-start gap-2 text-[11px] text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>
              I agree to the domain registration terms and registry policies.
              {(order.agreements || []).map((a) => <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="underline ml-1">{a.title}</a>)}
            </span>
          </label>
          <button type="button" onClick={pay} disabled={!agreed || !!busy} className="w-full px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer">
            {busy === 'pay' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opening payment...</> : <><ShieldCheck className="w-3.5 h-3.5" /> Pay {inr(order.amount / 100)}</>}
          </button>
          <p className="text-[10px] text-zinc-400 text-center">Secure payment by Razorpay. If registration fails you are refunded automatically.</p>
        </div>
      )}

      {stage === 'done' && outcome && (
        outcome.status === 'registered' ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {outcome.domain} is yours.</p>
            <p>Payment of {inr(outcome.amount)} received. {site ? 'We connected it to your site; DNS can take a few minutes to go live.' : 'Publish your project, then connect the domain below.'}</p>
          </div>
        ) : outcome.done ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1" role="alert">
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Domain registration failed</p>
            <p>{outcome.error}</p>
            <p>{outcome.refunded ? `Your payment of ${inr(outcome.amount)} has been refunded.` : `Your refund needs manual action. Contact support with order id ${outcome.id}.`}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" /> Payment received. Registering {outcome.domain}... this updates here automatically.
          </div>
        )
      )}

      {error && <p className="text-[11px] text-rose-700 whitespace-pre-wrap" role="alert">{error}</p>}

      <MyDomains refreshKey={outcome?.status === 'registered' ? outcome.id : 'idle'} />

      {site ? <DomainSection projectId={projectId} /> : <p className="text-[11px] text-zinc-500">Publish the project (Publish tab) to connect a domain you already own.</p>}
    </div>
  );
}

export default DomainPanel;
