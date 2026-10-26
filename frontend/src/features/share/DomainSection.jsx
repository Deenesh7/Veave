import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Loader2, CheckCircle2, AlertTriangle, Copy, Check, RotateCw, Circle } from 'lucide-react';
import { hostingService, hostingErrorMessage } from '../../services/hostingService';

// Unwraps either axios responses ({data:{success,data}}) or already-unwrapped api helpers.
const payload = (response) => response?.data?.data ?? response?.data ?? response;
const POLL_MS = 4000;
const SLOW_POLL_MS = 30000;

function StepIcon({ state }) {
  if (state === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
  if (state === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-700" />;
  if (state === 'action_required') return <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />;
  if (state === 'failed') return <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />;
  return <Circle className="w-3.5 h-3.5 text-zinc-300" />;
}

/**
 * Connects a custom domain. Everything shown here is the real state of the server-side workflow (verification, DNS,
 * deployment, HTTPS, live checks); success is only displayed once the backend's outside-in checks have passed.
 */
export function DomainSection({ projectId }) {
  const [state, setState] = useState({ domain: null });
  const [input, setInput] = useState('');
  const [includeWww, setIncludeWww] = useState(true);
  const [canonical, setCanonical] = useState('none');
  const [preflight, setPreflight] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = payload(await hostingService.getDomain(projectId)) || { domain: null };
      if (alive.current) setState(next);
      return next;
    } catch { return null; }
  }, [projectId]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  useEffect(() => { if (projectId) load(); }, [projectId, load]);

  // Follow the workflow while it is running; check slowly once it is live.
  useEffect(() => {
    clearTimeout(timer.current);
    if (!state.domain || state.state === 'failed') return undefined;
    const delay = state.stage === 'active' ? SLOW_POLL_MS : POLL_MS;
    timer.current = setTimeout(load, delay);
    return () => clearTimeout(timer.current);
  }, [state, load]);

  const run = async (name, fn) => {
    setBusy(name); setError('');
    try { return await fn(); } catch (e) { setError(hostingErrorMessage(e, 'Domain request failed.')); return null; } finally { setBusy(''); }
  };

  const preCheck = () => run('check', async () => setPreflight(payload(await hostingService.checkDomainName(input))));
  const connect = () => run('connect', async () => { setState(payload(await hostingService.connectDomain(projectId, input, { includeWww, canonical: includeWww ? canonical : 'none' })) || { domain: null }); setPreflight(null); });
  const checkAgain = () => run('verify', async () => setState(payload(await hostingService.verifyDomain(projectId))));
  const retry = () => run('retry', async () => setState(payload(await hostingService.retryDomain(projectId))));
  const confirm = () => run('confirm', async () => setState(payload(await hostingService.confirmDomainReplace(projectId))));
  const remove = () => run('remove', async () => { await hostingService.removeDomain(projectId); setState({ domain: null }); setInput(''); setPreflight(null); });
  const copy = (key, value) => { navigator.clipboard?.writeText(value); setCopied(key); setTimeout(() => setCopied(''), 1500); };

  const live = state.stage === 'active';
  const failed = state.state === 'failed';
  const needsAction = state.state === 'action_required';

  return (
    <div className="rounded-xl border border-[#DDE2E5] bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase text-zinc-500">
        <Globe className="w-3.5 h-3.5" /> Custom domain
      </div>

      {!state.domain && (
        <>
          <p className="text-[11px] text-zinc-500">Enter a domain you own. Veave verifies it, sets up DNS where it can, publishes your site and turns on HTTPS.</p>
          <div className="flex gap-2">
            <input value={input} onChange={(e) => { setInput(e.target.value); setPreflight(null); }} placeholder="example.com" spellCheck={false}
              className="flex-1 min-w-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-mono outline-none focus:border-zinc-900" aria-label="Domain name" />
            <button type="button" onClick={preCheck} disabled={!input || !!busy} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
              {busy === 'check' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Check'}
            </button>
            <button type="button" onClick={connect} disabled={!input || !!busy} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-black disabled:opacity-50 cursor-pointer">
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-zinc-600 cursor-pointer">
            <input type="checkbox" checked={includeWww} onChange={(e) => setIncludeWww(e.target.checked)} /> Also connect www
            {includeWww && (
              <select value={canonical} onChange={(e) => setCanonical(e.target.value)} className="ml-2 rounded border border-zinc-200 px-1.5 py-0.5 text-[11px]" aria-label="Preferred address">
                <option value="none">Serve both</option>
                <option value="apex">Redirect www to the root</option>
                <option value="www">Redirect the root to www</option>
              </select>
            )}
          </label>
          {preflight && (
            <p className={`text-[11px] ${preflight.available ? 'text-emerald-700' : 'text-rose-700'}`}>
              {preflight.available
                ? `${preflight.hostname} can be connected. DNS is hosted at ${preflight.dns.providerLabel}${preflight.dns.automatic ? ' and Veave can configure it automatically.' : '; you will be shown the records to add.'}`
                : preflight.reason}
            </p>
          )}
        </>
      )}

      {state.domain && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono font-semibold text-zinc-800 truncate">{state.domain}</span>
            <span className={`text-[11px] font-semibold flex items-center gap-1 ${live ? 'text-emerald-600' : failed ? 'text-rose-600' : needsAction ? 'text-amber-600' : 'text-zinc-600'}`}>
              {live ? <CheckCircle2 className="w-3.5 h-3.5" /> : failed || needsAction ? <AlertTriangle className="w-3.5 h-3.5" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {state.headline}
            </span>
          </div>

          <ol className="space-y-1">
            {(state.steps || []).map((step) => (
              <li key={step.key} className={`flex items-center gap-2 text-[11px] ${step.state === 'pending' ? 'text-zinc-400' : 'text-zinc-700'}`}>
                <StepIcon state={step.state} /> {step.label}
              </li>
            ))}
          </ol>

          {needsAction && state.action && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 space-y-1.5">
              <p className="text-[11px] text-amber-900">{state.action.message}</p>
              {state.action.records?.length > 0 && (
                <table className="w-full text-[11px] font-mono">
                  <thead><tr className="text-zinc-400 text-left"><th className="pr-2">Type</th><th className="pr-2">Name</th><th>Value</th><th /></tr></thead>
                  <tbody>
                    {state.action.records.map((r) => (
                      <tr key={`${r.type}-${r.name}`} className="align-top">
                        <td className="pr-2 py-0.5 font-bold">{r.type}</td>
                        <td className="pr-2 py-0.5">{r.name}</td>
                        <td className="py-0.5 break-all">{r.data}</td>
                        <td className="py-0.5 pl-1">
                          <button type="button" onClick={() => copy(`${r.type}-${r.name}`, r.data)} className="text-zinc-400 hover:text-zinc-800 cursor-pointer" title="Copy value">
                            {copied === `${r.type}-${r.name}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {state.action.conflicts?.length > 0 && (
                <ul className="list-disc pl-4 text-[11px] text-amber-900 space-y-0.5">{state.action.conflicts.map((c) => <li key={`${c.code}-${c.name}`}>{c.message}</li>)}</ul>
              )}
              {state.lastError && <p className="text-[11px] text-amber-800 whitespace-pre-wrap">{state.lastError}</p>}
            </div>
          )}

          {failed && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800 space-y-1" role="alert">
              <p className="font-semibold">Publishing failed{state.failure?.stage ? ` while ${state.failure.stage.replace(/_/g, ' ')}` : ''}</p>
              <p className="whitespace-pre-wrap break-words">{state.failure?.message || state.lastError}</p>
              {state.failure?.recoverable === false && <p>This cannot be retried. Disconnect it and start again.</p>}
            </div>
          )}

          {live && state.health?.problems?.length > 0 && (
            <p className="text-[11px] text-amber-700">A recent check found a problem: {state.health.problems[0]}</p>
          )}
          {live && state.url && <a href={state.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700 underline break-all">Open {state.url}</a>}

          <div className="flex items-center gap-2 flex-wrap">
            {needsAction && state.action?.type === 'confirm-replace' && (
              <button type="button" onClick={confirm} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-black disabled:opacity-50 cursor-pointer">
                {busy === 'confirm' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Replace these records'}
              </button>
            )}
            {(needsAction || (!live && !failed)) && state.action?.type !== 'confirm-replace' && (
              <button type="button" onClick={checkAgain} disabled={!!busy} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 cursor-pointer flex items-center gap-1">
                {busy === 'verify' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><RotateCw className="w-3 h-3" /> Check again</>}
              </button>
            )}
            {failed && state.failure?.recoverable !== false && (
              <button type="button" onClick={retry} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-semibold hover:bg-black disabled:opacity-50 cursor-pointer">
                {busy === 'retry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Retry'}
              </button>
            )}
            <button type="button" onClick={remove} disabled={!!busy} className="ml-auto px-2 py-1 text-xs text-rose-600 hover:text-rose-800 cursor-pointer">Disconnect</button>
          </div>
        </>
      )}

      {error && <p className="text-[11px] text-rose-700 whitespace-pre-wrap" role="alert">{error}</p>}
    </div>
  );
}

export default DomainSection;
