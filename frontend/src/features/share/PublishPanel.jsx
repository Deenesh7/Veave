import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Lock
} from 'lucide-react';
import { hostingService } from '../../services/hostingService';
import { useAuthStore } from '../../store/authStore';
import { usePublishing } from './usePublishing';
import DomainSection from './DomainSection';
import DnsSetupPicker from './DnsSetupPicker';

const STAGES = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'building', label: 'Building' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'published', label: 'Published' }
];

// What the owner chose in this window is kept per project, so closing and reopening it (or a refresh) does not lose it.
const prefsKey = (projectId) => `veave_publish_prefs_${projectId}`;
const readPrefs = (projectId) => { try { return JSON.parse(localStorage.getItem(prefsKey(projectId)) || 'null'); } catch { return null; } };
const writePrefs = (projectId, value) => { try { localStorage.setItem(prefsKey(projectId), JSON.stringify(value)); } catch { /* storage may be unavailable */ } };

function formatTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

export function PublishPanel({ project, onPublishUpdate, defaultOwnDomain = false }) {
  const projectId = project?._id || project?.id || null;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canUseHosting = Boolean(isAuthenticated);
  const { site, deployment, loading, busy, isPublishing, actionError, publish, unpublish } = usePublishing(projectId, { enabled: canUseHosting });
  const [copied, setCopied] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  // The Veave address is set up and kept by the backend; this window only handles the custom domain.
  const [ownDomain, setOwnDomain] = useState('');
  const [domainState, setDomainState] = useState(null);   // the custom-domain workflow, reported by the domain section
  const [hydrated, setHydrated] = useState(false);
  const [ownWww, setOwnWww] = useState(true);
  // A domain typed into the box means "publish on my domain too"; an empty box means the Veave address only.
  const customOn = ownDomain.trim().length > 0;
  const [dnsMode, setDnsMode] = useState('manual');
  const [dnsAccounts, setDnsAccounts] = useState([]);
  const [domainSupport, setDomainSupport] = useState({ available: true, reason: '' });

  const isLive = site?.status === 'published';
  const failed = deployment?.status === 'failed';

  // Restore the settings: what is published now (the server is the truth), else what the owner last chose here.
  useEffect(() => {
    if (!canUseHosting || !projectId || loading || hydrated) return undefined;
    let cancelled = false;
    (async () => {
      let connection = null;
      try { const res = await hostingService.getDomain(projectId); connection = res?.data?.data ?? null; } catch { /* no domain yet */ }
      if (cancelled) return;
      const draft = readPrefs(projectId);
      if (site) {
      } else if (draft) {
      }
      if (connection?.domain) {
        setOwnDomain(connection.apex && connection.kind === 'apex' ? connection.apex : connection.domain);
        setOwnWww(connection.includeWww !== false);
        const preference = connection.dns?.preference;
        setDnsMode(preference && preference !== 'auto' ? preference : (connection.dns?.mode === 'automatic' && connection.dns?.provider ? connection.dns.provider : 'manual'));
      } else if (!site && draft) {
        setOwnDomain(draft.ownDomain || ''); setOwnWww(draft.ownWww !== false); if (draft.dnsMode) setDnsMode(draft.dnsMode);
      }
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [canUseHosting, projectId, loading, hydrated, site]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the choices as they are made.
  useEffect(() => {
    if (!projectId || !hydrated) return;
    writePrefs(projectId, { ownDomain, ownWww, dnsMode });
  }, [projectId, hydrated, ownDomain, ownWww, dnsMode]);

  useEffect(() => {
    if (!canUseHosting) return;
    hostingService.getConfig().then((res) => {
      const { customDomains } = res.data?.data || {};
      if (customDomains) setDomainSupport({ available: Boolean(customDomains.available), reason: customDomains.reason || '' });
    }).catch(() => {});
  }, [canUseHosting]);

  useEffect(() => {
    if (deployment?.status === 'succeeded') onPublishUpdate?.({ isPublished: true, publicUrl: deployment.url });
  }, [deployment?.status, deployment?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveUrl = site?.url || deployment?.url || '';
  // A finished deployment only counts as "done" while it is the one that is live. After an unpublish (or a newer failed attempt) the
  // old run must not keep showing green steps next to "Not Published".
  const liveDeployment = Boolean(deployment && deployment.status === 'succeeded' && isLive && (!site?.activeVersion || !deployment.version || site.activeVersion === deployment.version));
  const showProgress = Boolean(deployment && (isPublishing || failed || liveDeployment));
  // The step the backend is on. Everything before it is confirmed complete; everything after it has not started.
  const stageIndex = useMemo(() => {
    if (!deployment) return -1;
    if (liveDeployment) return STAGES.length;
    const index = STAGES.findIndex((stage) => stage.id === deployment.stage);
    return index < 0 ? 0 : index;
  }, [deployment, liveDeployment]);

  const handleCopy = async () => {
    if (!liveUrl) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = liveUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const autoReady = dnsMode === 'manual' || dnsAccounts.some((account) => account.provider === dnsMode && account.connected);
  const customValid = !customOn || (ownDomain.trim().length >= 4 && domainSupport.available && autoReady);
  const canPublish = Boolean(projectId) && !busy && !isPublishing && !loading && customValid;
  // "Published" means a visitor can open it: the Veave address answers, or the custom domain passed DNS and HTTPS. Never earlier.
  const domainActive = domainState?.stage === 'active';
  const reachable = (isLive && site?.subdomainEnabled !== false) || domainActive;
  const waitingForDomain = isLive && !reachable && Boolean(domainState?.domain);
  const publishLabel = isLive ? 'Republish' : failed && !isLive ? 'Retry publish' : 'Publish Project';

  if (!canUseHosting) {
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    return (
      <div className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-4 text-xs text-zinc-700 space-y-2.5">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">Log in to publish this project</span>
        </div>
        <p className="text-zinc-500">Publishing gives your site a live address that belongs to your account.</p>
        <a
          href={`/login?redirect=${redirect}`}
          className="inline-flex px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-black text-white font-semibold"
        >
          Log in
        </a>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-4 text-xs text-zinc-600 flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 shrink-0" />
        <span>Save this project first, then you can publish it to a live URL.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="rounded-xl border border-[#DDE2E5] bg-white p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-3 h-3 rounded-full shrink-0 ${
            isPublishing ? 'bg-amber-500 ring-4 ring-amber-100 animate-pulse'
              : reachable ? 'bg-emerald-500 ring-4 ring-emerald-100' : waitingForDomain ? 'bg-amber-400 ring-4 ring-amber-100' : 'bg-zinc-300'
          }`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[#111827]">Publishing Status:</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                isPublishing ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : reachable ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : waitingForDomain ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
              }`}>
                {loading ? 'Checking...' : isPublishing ? 'Publishing' : reachable ? 'Published' : waitingForDomain ? 'Waiting for your domain' : 'Not Published'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {isLive && site?.lastPublishedAt
                ? `Last published ${formatTime(site.lastPublishedAt)}`
                : 'Publish to get a shareable live link on its own address.'}
            </p>
          </div>
        </div>
      </div>

      {/* The two ways to publish: independent switches */}
      <div className="space-y-3" aria-label="Custom domain">
        <section className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-3 space-y-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5 text-zinc-600" /> Custom domain</h3>
            <p className="text-[11px] text-zinc-500">Type your own domain, for example smc.saveetha.com. Veave verifies it, sets up DNS and turns on HTTPS. Leave it empty to publish without one.</p>
          </div>
          {!domainSupport.available && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900" role="status">{domainSupport.reason}</p>}
          <input value={ownDomain} onChange={(event) => setOwnDomain(event.target.value)} disabled={isPublishing || !domainSupport.available} spellCheck={false} autoComplete="off" placeholder="smc.saveetha.com"
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed" aria-label="Your domain" />
          {customOn && domainSupport.available && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[11px] text-zinc-600 cursor-pointer"><input type="checkbox" checked={ownWww} onChange={(event) => setOwnWww(event.target.checked)} disabled={isPublishing} /> Also connect www (root domains only)</label>
              <DnsSetupPicker value={dnsMode} onChange={setDnsMode} onAccounts={setDnsAccounts} disabled={isPublishing} />
              <p className="text-[11px] text-zinc-500">You never enter server addresses. Veave shows each step as it is confirmed; the domain counts as published only after DNS and HTTPS both work.</p>
            </div>
          )}
        </section>
      </div>

      {/* Stage progress */}
      {showProgress && (
        <div className="rounded-xl border border-[#DDE2E5] bg-white p-3">
          <ol className="flex items-center justify-between gap-1">
            {STAGES.map((stage, index) => {
              const done = index < stageIndex;
              const active = !done && deployment.status === 'running' && index === stageIndex;
              const errored = !done && failed && index === stageIndex;
              const caption = errored ? 'Failed' : done ? 'Completed' : active ? 'In progress' : 'Pending';
              return (
                <li key={stage.id} className="flex-1 flex flex-col items-center gap-1 min-w-0" aria-label={`${stage.label}: ${caption}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    errored ? 'bg-rose-100 text-rose-600'
                      : done ? 'bg-emerald-500 text-white'
                      : active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
                  }`}>
                    {errored ? '!' : done ? <Check className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : index + 1}
                  </span>
                  <span className={`text-[10px] truncate ${active || done ? 'text-zinc-800 font-semibold' : errored ? 'text-rose-600 font-semibold' : 'text-zinc-400'}`}>{stage.label}</span>
                  <span className={`text-[9px] truncate ${errored ? 'text-rose-600' : done ? 'text-emerald-600' : active ? 'text-zinc-700' : 'text-zinc-400'}`}>{caption}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Failure */}
      {(failed || actionError) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1.5" role="alert">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">
                {failed ? `Publishing failed${deployment?.error?.stage ? ` while ${deployment.error.stage}` : ''}` : 'Could not complete the request'}
              </p>
              <p className="whitespace-pre-wrap break-words">{actionError || deployment?.error?.message}</p>
              {failed && deployment?.error?.previousVersionPreserved && (
                <p className="text-rose-700/80 mt-1">Your previously published version is still live.</p>
              )}
              {failed && deployment?.error?.details && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-rose-700">Show build output</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-rose-900">{deployment.error.details}</pre>
                </details>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Live URL */}
      {isLive && liveUrl && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <label className="block text-[11px] font-mono font-bold uppercase text-emerald-700/70 mb-1.5">Live URL</label>
          <div className="flex items-center justify-between gap-2 bg-white rounded-lg border border-emerald-200 px-3 py-2">
            <span className="text-xs font-mono text-zinc-700 truncate select-all">{liveUrl}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  copied ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'text-zinc-600 hover:text-[#111827] hover:bg-zinc-100'
                }`}
              >
                {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" /><span>Copied!</span></> : <><Copy className="w-3.5 h-3.5" /><span>Copy</span></>}
              </button>
              <a href={liveUrl} target="_blank" rel="noreferrer" className="p-1 text-zinc-500 hover:text-zinc-800 transition-colors" title="Open website">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
          {deployment?.publicCheck && !deployment.publicCheck.ok && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              Published, but the public URL was not reachable yet ({deployment.publicCheck.error}). DNS or HTTPS may still be propagating.
            </p>
          )}
        </div>
      )}

      {(customOn || domainState?.domain) && <DomainSection projectId={projectId} hideConnectForm onChange={setDomainState} />}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-[#DDE2E5] gap-2">
        {isLive ? (
          confirmUnpublish ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-600">Take the site offline?</span>
              <button
                type="button"
                disabled={busy || isPublishing}
                onClick={async () => { await unpublish(); setConfirmUnpublish(false); onPublishUpdate?.({ isPublished: false }); }}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Unpublish
              </button>
              <button type="button" onClick={() => setConfirmUnpublish(false)} className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer">Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || isPublishing}
              onClick={() => setConfirmUnpublish(true)}
              className="px-3.5 py-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Unpublish
            </button>
          )
        ) : <div />}

        <button
          type="button"
          onClick={() => publish('', { subdomainEnabled: true, customDomainEnabled: customOn, ...(customOn ? { domain: ownDomain.trim(), includeWww: ownWww, dnsMode } : {}) })}
          disabled={!canPublish}
          className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPublishing || busy ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Publishing...</span></>
          ) : (
            <>
              {failed && !isLive ? <RotateCw className="w-3.5 h-3.5 text-zinc-400" /> : <Sparkles className="w-3.5 h-3.5 text-zinc-400" />}
              <span>{publishLabel}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default PublishPanel;
