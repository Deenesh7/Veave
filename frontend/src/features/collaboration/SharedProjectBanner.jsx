import React, { useCallback, useEffect, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { AlertTriangle, Eye, RefreshCw, Users } from 'lucide-react';
import { collaborationService as svc } from '../../services/collaborationService';
import { getKnownRevision } from '../../utils/projectRevisions';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';

const POLL_MS = 15000;

/**
 * Collaboration status for the open editor project:
 *  - view-only notice for viewers
 *  - "newer changes are available" when a teammate saved a newer revision
 *  - a clear error when a save was rejected because the project changed underneath you
 * Everything is driven by the server (revision probe + 409/403 responses), never by client-side guesses.
 */
export default function SharedProjectBanner() {
  const match = useMatch('/editor/:id');
  const projectId = match?.params?.id;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [probe, setProbe] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [readonlyHit, setReadonlyHit] = useState(false);
  const [reloading, setReloading] = useState(false);

  const check = useCallback(async () => {
    if (!projectId || !isAuthenticated) return;
    try {
      const res = await svc.getProjectRevision(projectId);
      setProbe(res.data.data);
    } catch { /* no access or offline: keep the last known state */ }
  }, [projectId, isAuthenticated]);

  useEffect(() => { setProbe(null); setConflict(null); setReadonlyHit(false); check(); }, [check]);

  useEffect(() => {
    if (!projectId || !isAuthenticated) return undefined;
    const timer = setInterval(() => { if (probe?.shared && document.visibilityState === 'visible') check(); }, POLL_MS);
    const onFocus = () => { if (probe?.shared) check(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [projectId, isAuthenticated, probe?.shared, check]);

  useEffect(() => {
    const onConflict = (e) => setConflict(e.detail || {});
    const onReadonly = () => setReadonlyHit(true);
    window.addEventListener('veave:project-conflict', onConflict);
    window.addEventListener('veave:project-readonly', onReadonly);
    return () => {
      window.removeEventListener('veave:project-conflict', onConflict);
      window.removeEventListener('veave:project-readonly', onReadonly);
    };
  }, []);

  if (!projectId || !probe) return null;

  const known = getKnownRevision(projectId);
  const newerAvailable = probe.shared && known !== null && probe.revision > known;
  const viewOnly = probe.access && !probe.access.canEdit;

  const reload = async () => {
    setReloading(true);
    try { await useProjectStore.getState().fetchProject(projectId); } catch { /* the reload below recovers */ }
    window.location.reload();
  };

  let content = null;
  if (conflict) {
    content = (
      <Pill tone="error" icon={AlertTriangle}>
        {conflict.message || 'Your change was not saved because the project was changed by someone else.'} Reloading discards unsaved edits.
        <Action onClick={reload} busy={reloading}>Reload latest</Action>
      </Pill>
    );
  } else if (viewOnly) {
    content = (
      <Pill tone={readonlyHit ? 'error' : 'info'} icon={Eye}>
        {readonlyHit ? 'This change was not saved: you have view-only access to this project.' : 'View-only access. You can look around but not change this project.'}
        {newerAvailable && <Action onClick={reload} busy={reloading}>Reload latest</Action>}
      </Pill>
    );
  } else if (newerAvailable) {
    content = (
      <Pill tone="warn" icon={Users}>
        {probe.lastEditedBy ? `${probe.lastEditedBy} saved newer changes.` : 'Newer changes were saved by a teammate.'} Reload to get them before you edit.
        <Action onClick={reload} busy={reloading}>Reload latest</Action>
      </Pill>
    );
  }
  return content;
}

const TONES = {
  error: 'bg-red-600 text-white',
  warn: 'bg-amber-500 text-white',
  info: 'bg-zinc-900 text-white',
};

function Pill({ tone, icon: Icon, children }) {
  return (
    <div role="status" className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] max-w-[92vw] flex items-center gap-2 px-3.5 py-2 rounded-full shadow-xl text-xs font-medium ${TONES[tone]}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex items-center gap-2 flex-wrap">{children}</span>
    </div>
  );
}

function Action({ onClick, busy, children }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 font-semibold disabled:opacity-60">
      <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />{children}
    </button>
  );
}
