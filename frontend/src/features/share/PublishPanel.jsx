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

const STAGES = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'building', label: 'Building' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'verifying', label: 'Verifying' },
  { id: 'published', label: 'Published' }
];

const slugFromName = (name) => String(name || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// While typing, keep a trailing hyphen so "my-site" can be entered; it is trimmed when the field loses focus.
const sanitizeSlugInput = (value) => String(value || '')
  .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '').slice(0, 40);

function formatTime(value) {
  if (!value) return '';
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

export function PublishPanel({ project, onPublishUpdate }) {
  const projectId = project?._id || project?.id || null;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canUseHosting = Boolean(isAuthenticated);
  const { site, deployment, loading, busy, isPublishing, actionError, publish, unpublish } = usePublishing(projectId, { enabled: canUseHosting });
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState({ checking: false, available: null, reason: '' });
  const [baseHost, setBaseHost] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [useOwnDomain, setUseOwnDomain] = useState(false);
  const [ownDomain, setOwnDomain] = useState('');
  const [ownWww, setOwnWww] = useState(true);

  const isLive = site?.status === 'published';
  const failed = deployment?.status === 'failed';

  // Prefill the address: the existing one, otherwise derived from the project name.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(site?.slug || slugFromName(project?.name));
  }, [site?.slug, project?.name, slugTouched]);

  useEffect(() => {
    if (!canUseHosting) return;
    hostingService.getConfig().then((res) => {
      const { baseDomain, publicPort } = res.data?.data || {};
      if (baseDomain) setBaseHost(`.${baseDomain}${publicPort ? `:${publicPort}` : ''}`);
    }).catch(() => {});
  }, [canUseHosting]);

  // Debounced availability check.
  useEffect(() => {
    if (!canUseHosting || !projectId || !slug || (site?.slug === slug)) { setSlugState({ checking: false, available: site?.slug === slug ? true : null, reason: '' }); return undefined; }
    setSlugState({ checking: true, available: null, reason: '' });
    const handle = setTimeout(async () => {
      try {
        const res = await hostingService.checkSlug(slug, projectId);
        const data = res.data?.data || {};
        setSlugState({ checking: false, available: Boolean(data.available), reason: data.reason || '' });
      } catch {
        setSlugState({ checking: false, available: null, reason: '' });
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [slug, projectId, site?.slug, canUseHosting]);

  useEffect(() => {
    if (deployment?.status === 'succeeded') onPublishUpdate?.({ isPublished: true, publicUrl: deployment.url });
  }, [deployment?.status, deployment?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveUrl = site?.url || deployment?.url || '';
  const stageIndex = useMemo(() => {
    if (!deployment) return -1;
    if (deployment.status === 'succeeded') return STAGES.length - 1;
    return Math.max(0, STAGES.findIndex((stage) => stage.id === deployment.stage));
  }, [deployment]);

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

  const canPublish = Boolean(projectId) && !busy && !isPublishing && !loading && slugState.available !== false && slug.length >= 3 && (!useOwnDomain || ownDomain.trim().length >= 4);
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
              : isLive ? 'bg-emerald-500 ring-4 ring-emerald-100' : 'bg-zinc-300'
          }`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[#111827]">Publishing Status:</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                isPublishing ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : isLive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
              }`}>
                {loading ? 'Checking...' : isPublishing ? 'Publishing' : isLive ? 'Published' : 'Not Published'}
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

      {/* Address */}
      <div className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-3">
        <label className="block text-[11px] font-mono font-bold uppercase text-zinc-400 mb-1.5">Site address</label>
        <div className="flex items-center bg-white rounded-lg border border-[#DDE2E5] px-3 py-2 gap-1 focus-within:border-zinc-500">
          <Globe className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
          <input
            value={slug}
            onChange={(event) => { setSlugTouched(true); setSlug(sanitizeSlugInput(event.target.value)); }}
            onBlur={() => setSlug((current) => current.replace(/-+$/, ''))}
            disabled={isPublishing}
            spellCheck={false}
            placeholder="my-site"
            className="flex-1 min-w-0 text-xs font-mono text-zinc-800 bg-transparent outline-none disabled:opacity-60"
            aria-label="Site address"
          />
          <span className="text-xs font-mono text-zinc-400 shrink-0">{baseHost}</span>
        </div>
        <div className="min-h-[16px] mt-1.5 text-[11px]">
          {slugState.checking && <span className="text-zinc-400">Checking availability...</span>}
          {!slugState.checking && slugState.available === false && <span className="text-rose-600">{slugState.reason || 'That address is not available.'}</span>}
          {!slugState.checking && slugState.available === true && slug !== site?.slug && <span className="text-emerald-600">Available</span>}
        </div>
      </div>

      {/* Publish target: free address only, or also the user's own domain (verified, DNS and HTTPS handled by the server) */}
      {!site?.status || site.status !== 'published' || useOwnDomain ? (
        <div className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-3 space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={useOwnDomain} onChange={(event) => setUseOwnDomain(event.target.checked)} disabled={isPublishing} /> Also use my own domain
          </label>
          {useOwnDomain && (
            <div className="space-y-1.5">
              <input value={ownDomain} onChange={(event) => setOwnDomain(event.target.value)} disabled={isPublishing} spellCheck={false} placeholder="example.com"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-zinc-900" aria-label="Your domain" />
              <label className="flex items-center gap-2 text-[11px] text-zinc-600 cursor-pointer"><input type="checkbox" checked={ownWww} onChange={(event) => setOwnWww(event.target.checked)} /> Also connect www</label>
              <p className="text-[11px] text-zinc-500">You do not need to enter any server addresses. Veave verifies the domain, sets up DNS when it can, publishes the site and turns on HTTPS.</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Stage progress */}
      {deployment && (isPublishing || failed || deployment.status === 'succeeded') && (
        <div className="rounded-xl border border-[#DDE2E5] bg-white p-3">
          <ol className="flex items-center justify-between gap-1">
            {STAGES.map((stage, index) => {
              const done = deployment.status === 'succeeded' ? true : index < stageIndex;
              const active = deployment.status === 'running' && index === stageIndex;
              const errored = failed && index === stageIndex;
              return (
                <li key={stage.id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    errored ? 'bg-rose-100 text-rose-600'
                      : done ? 'bg-emerald-500 text-white'
                      : active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'
                  }`}>
                    {errored ? '!' : done ? <Check className="w-3 h-3" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : index + 1}
                  </span>
                  <span className={`text-[10px] truncate ${active || done ? 'text-zinc-800 font-semibold' : errored ? 'text-rose-600 font-semibold' : 'text-zinc-400'}`}>{stage.label}</span>
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

      {(isLive || useOwnDomain) && <DomainSection projectId={projectId} />}

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
          onClick={() => publish(slug, useOwnDomain && ownDomain.trim() ? { domain: ownDomain.trim(), includeWww: ownWww } : {})}
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
