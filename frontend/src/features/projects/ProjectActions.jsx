import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Info, Copy, UserRoundCog, Trash2, X, Loader2, AlertTriangle, ExternalLink, Check } from 'lucide-react';
import { projectService } from '../../services/projectService';
import { apiErrorMessage } from '../../services/collaborationService';
import { useProjectStore } from '../../store/projectStore';
import { toast } from '../../store/toastStore';

const NAME_MAX = 100;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-1';
const fieldClass = `w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 disabled:bg-stone-50 disabled:text-stone-500 ${focusRing}`;

const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/* ------------------------------------------------------------------------------------------- dialog shell */

function DialogShell({ title, subtitle, onClose, busy = false, children, footer, tone = 'neutral' }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    panelRef.current?.querySelector('[data-autofocus]')?.focus();
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [busy, onClose]);

  return createPortal(
    // Clicks inside a portal still bubble through React to the project card; stop them so the card does not open.
    <div className="fixed inset-0 z-[210] flex items-end justify-center p-0 sm:items-center sm:p-6" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-stone-900/30" onClick={() => { if (!busy) onClose(); }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-xl border border-stone-200 bg-white shadow-[0_12px_40px_-12px_rgba(28,25,23,0.3)] sm:max-w-[480px] sm:rounded-xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className={`text-[15px] font-semibold ${tone === 'danger' ? 'text-red-700' : 'text-stone-900'}`}>{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-[13px] text-stone-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className={`-mr-1.5 -mt-1 rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 ${focusRing}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-end">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

const SecondaryButton = (props) => (
  <button type="button" {...props} className={`inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-[13px] font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} />
);

function PrimaryButton({ danger = false, busy = false, busyLabel, children, ...rest }) {
  const color = danger ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600' : 'bg-stone-900 hover:bg-stone-700 focus-visible:ring-stone-900';
  return (
    <button type="submit" aria-busy={busy} {...rest} className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13px] font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${color}`}>
      {busy ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />{busyLabel}</> : children}
    </button>
  );
}

const ErrorLine = ({ children }) => (children ? (
  <p role="alert" className="flex items-start gap-2 text-[13px] text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{children}</p>
) : null);

/* ------------------------------------------------------------------------------------------------- info */

function InfoRow({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 text-[13px] sm:grid-cols-[140px_1fr]">
      <dt className="text-stone-500">{label}</dt>
      <dd className="min-w-0 break-words text-stone-900">{children}</dd>
    </div>
  );
}

function useProjectInfo(projectId) {
  const [state, setState] = useState({ loading: true, error: '', info: null });
  const load = useCallback(() => {
    let cancelled = false;
    setState({ loading: true, error: '', info: null });
    projectService.getProjectInfo(projectId)
      .then((res) => { if (!cancelled) setState({ loading: false, error: '', info: res.data?.data || null }); })
      .catch((error) => { if (!cancelled) setState({ loading: false, error: apiErrorMessage(error, 'Could not load the project information.'), info: null }); });
    return () => { cancelled = true; };
  }, [projectId]);
  useEffect(() => load(), [load]);
  return { ...state, reload: load };
}

function ProjectInfoDialog({ project, onClose }) {
  const id = project._id || project.id;
  const { loading, error, info, reload } = useProjectInfo(id);
  const [copied, setCopied] = useState(false);
  const copyId = async () => {
    try { await navigator.clipboard.writeText(String(id)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast.error('Could not copy the project ID.'); }
  };
  const statusTone = { ready: 'bg-emerald-500', generating: 'bg-amber-500', failed: 'bg-red-500', archived: 'bg-stone-400' };

  return (
    <DialogShell title="Project info" subtitle={project.name} onClose={onClose} footer={<SecondaryButton onClick={onClose} data-autofocus>Close</SecondaryButton>}>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-stone-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading project details...</div>
      ) : error ? (
        <div className="space-y-3 py-2"><ErrorLine>{error}</ErrorLine><SecondaryButton onClick={reload}>Try again</SecondaryButton></div>
      ) : info ? (
        <dl className="divide-y divide-stone-100">
          <InfoRow label="Project name">{info.name}</InfoRow>
          <InfoRow label="Project ID">
            <span className="inline-flex items-center gap-2">
              <code className="font-mono text-xs text-stone-700">{info.id}</code>
              <button type="button" onClick={copyId} aria-label="Copy project ID" className={`rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 ${focusRing}`}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </span>
          </InfoRow>
          <InfoRow label="Created by">{info.createdBy?.name}</InfoRow>
          {info.owner && info.owner.id !== info.createdBy?.id ? <InfoRow label="Current owner">{info.owner.name}</InfoRow> : null}
          <InfoRow label="Created">{formatDateTime(info.createdAt)}</InfoRow>
          <InfoRow label="Last modified">{formatDateTime(info.updatedAt)}</InfoRow>
          <InfoRow label="Status">
            <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${statusTone[info.status?.state] || 'bg-stone-400'}`} aria-hidden="true" />{info.status?.label}</span>
          </InfoRow>
          <InfoRow label="Project type">{info.type}</InfoRow>
          <InfoRow label="Source website">
            {info.sourceUrl ? <a href={info.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-700">{info.sourceUrl}<ExternalLink className="h-3 w-3 shrink-0" /></a> : null}
          </InfoRow>
          <InfoRow label="Generated pages">{info.pages}</InfoRow>
          <InfoRow label="Last build">{info.lastBuild ? `${formatDateTime(info.lastBuild.at)} · ${info.lastBuild.type}` : 'No successful build yet'}</InfoRow>
          <InfoRow label="Last deployment">{info.lastDeployment ? `${formatDateTime(info.lastDeployment.at)} · ${info.lastDeployment.version}` : null}</InfoRow>
          <InfoRow label="Published at">
            {info.published?.url ? <a href={info.published.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-700">{info.published.url}<ExternalLink className="h-3 w-3 shrink-0" /></a> : null}
          </InfoRow>
        </dl>
      ) : null}
    </DialogShell>
  );
}

/* --------------------------------------------------------------------------------------------- duplicate */

function DuplicateDialog({ project, onClose }) {
  const id = project._id || project.id;
  const duplicateProject = useProjectStore((s) => s.duplicateProject);
  const [name, setName] = useState(`${project.name || 'Untitled Project'} (Copy)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const invalid = !trimmed ? 'Enter a name for the copy.' : trimmed.length > NAME_MAX ? `Use ${NAME_MAX} characters or fewer.` : '';

  const submit = async (event) => {
    event.preventDefault();
    if (locked.current || invalid) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const copy = await duplicateProject(id, trimmed);
      toast.success(`Created "${copy?.name || trimmed}".`);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'The project could not be duplicated.'));
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Duplicate project" subtitle={project.name} onClose={onClose} busy={busy}
      footer={<>
        <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
        <PrimaryButton form="duplicate-project-form" disabled={busy || Boolean(invalid)} busy={busy} busyLabel="Duplicating...">Duplicate</PrimaryButton>
      </>}>
      <form id="duplicate-project-form" onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="duplicate-name" className="mb-1.5 block text-[13px] font-medium text-stone-900">New project name</label>
          <input id="duplicate-name" data-autofocus className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} maxLength={NAME_MAX + 20} autoComplete="off" onFocus={(e) => e.target.select()} />
          <p className="mt-1.5 text-xs text-stone-500">All pages, files and assets are copied. The copy is a separate project; the original is not changed.</p>
        </div>
        <ErrorLine>{error || (name !== project.name && invalid)}</ErrorLine>
      </form>
    </DialogShell>
  );
}

/* ---------------------------------------------------------------------------------------------- transfer */

function TransferDialog({ project, onClose }) {
  const id = project._id || project.id;
  const transferProject = useProjectStore((s) => s.transferProject);
  const { loading, info } = useProjectInfo(id);
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const target = email.trim().toLowerCase();
  const validEmail = EMAIL.test(target) && target.length <= 254;
  const sameOwner = Boolean(info?.owner?.email) && info.owner.email.toLowerCase() === target;
  const cannotTransfer = info && !info.access?.isOwner;

  const submit = async (event) => {
    event.preventDefault();
    if (locked.current || !validEmail || !confirmed || sameOwner) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await transferProject(id, target);
      toast.success(`"${project.name}" now belongs to ${target}.`);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'The project could not be transferred.'));
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Transfer ownership" subtitle={project.name} onClose={onClose} busy={busy}
      footer={<>
        <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
        <PrimaryButton form="transfer-project-form" disabled={busy || !validEmail || !confirmed || sameOwner || cannotTransfer || loading} busy={busy} busyLabel="Transferring...">Transfer project</PrimaryButton>
      </>}>
      <form id="transfer-project-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-[13px]">
          <div className="text-xs text-stone-500">Current owner</div>
          {loading ? <div className="mt-0.5 text-stone-400">Loading...</div> : <div className="mt-0.5 font-medium text-stone-900">{info?.owner?.name || 'You'}{info?.owner?.email ? <span className="ml-1.5 font-normal text-stone-500">{info.owner.email}</span> : null}</div>}
        </div>
        <div>
          <label htmlFor="transfer-email" className="mb-1.5 block text-[13px] font-medium text-stone-900">New owner's email</label>
          <input id="transfer-email" data-autofocus type="email" inputMode="email" className={fieldClass} value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} placeholder="name@example.com" autoComplete="off" />
          <p className="mt-1.5 text-xs text-stone-500">They need an existing Veave account with room on their plan.</p>
          {email && !validEmail ? <p className="mt-1 text-xs text-red-700">Enter a valid email address.</p> : null}
          {sameOwner ? <p className="mt-1 text-xs text-red-700">That account already owns this project.</p> : null}
        </div>
        <label className="flex items-start gap-2.5 text-[13px] text-stone-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-stone-900" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
          <span>I understand the new owner takes full control of this project, including its hosting and domain. I will keep editor access until they change it.</span>
        </label>
        {cannotTransfer ? <ErrorLine>Only the project owner can transfer ownership.</ErrorLine> : null}
        <ErrorLine>{error}</ErrorLine>
      </form>
    </DialogShell>
  );
}

/* ------------------------------------------------------------------------------------------------ delete */

function DeleteDialog({ project, onClose }) {
  const id = project._id || project.id;
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const matches = typed.trim() === String(project.name || '').trim();

  const submit = async (event) => {
    event.preventDefault();
    if (locked.current || !matches) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await deleteProject(id, { confirmName: typed.trim() });
      toast.success(`"${project.name}" was deleted.`);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'The project could not be deleted.'));
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Delete project" subtitle={project.name} tone="danger" onClose={onClose} busy={busy}
      footer={<>
        <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
        <PrimaryButton danger form="delete-project-form" disabled={busy || !matches} busy={busy} busyLabel="Deleting...">Delete project</PrimaryButton>
      </>}>
      <form id="delete-project-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
          <p className="font-medium">This cannot be undone.</p>
          <p className="mt-1 text-red-700">All pages, files, version history, sharing, and any published site and domain for <strong className="font-semibold">{project.name}</strong> will be permanently removed. Running builds are cancelled.</p>
        </div>
        <div>
          <label htmlFor="delete-confirm" className="mb-1.5 block text-[13px] text-stone-700">Type <strong className="font-semibold text-stone-900">{project.name}</strong> to confirm</label>
          <input id="delete-confirm" data-autofocus className={fieldClass} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
        </div>
        <ErrorLine>{error}</ErrorLine>
      </form>
    </DialogShell>
  );
}

/* -------------------------------------------------------------------------------------------------- menu */

const ITEM = 'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors focus:outline-none';

export function ProjectActionsMenu({ project, extraItems = [], className = '' }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  // Anchored to the button with fixed positioning, so a card's overflow or stacking can never clip it.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const { width, height } = menuRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.right - width));
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); buttonRef.current?.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    menuRef.current?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, close]);

  const choose = (action) => { close(); action(); };
  const items = [
    ...extraItems.map((item) => ({ ...item, onSelect: () => item.onClick() })),
    ...(extraItems.length ? [{ divider: true }] : []),
    { label: 'Project Info', icon: Info, onSelect: () => setDialog('info') },
    { label: 'Duplicate', icon: Copy, onSelect: () => setDialog('duplicate') },
    { label: 'Transfer Ownership', icon: UserRoundCog, onSelect: () => setDialog('transfer') },
    { divider: true },
    { label: 'Delete Project', icon: Trash2, danger: true, onSelect: () => setDialog('delete') },
  ];

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 ${focusRing}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Project actions"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[205] w-52 max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-[0_8px_24px_-8px_rgba(28,25,23,0.25)] animate-in fade-in duration-100"
        >
          {items.map((item, index) => {
            if (item.divider) return <div key={`d${index}`} role="separator" className="my-1 h-px bg-stone-100" />;
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => choose(item.onSelect)}
                className={`${ITEM} ${item.danger ? 'text-red-600 hover:bg-red-50 focus:bg-red-50' : 'text-stone-700 hover:bg-stone-50 focus:bg-stone-50'}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}

      {dialog === 'info' ? <ProjectInfoDialog project={project} onClose={() => setDialog(null)} /> : null}
      {dialog === 'duplicate' ? <DuplicateDialog project={project} onClose={() => setDialog(null)} /> : null}
      {dialog === 'transfer' ? <TransferDialog project={project} onClose={() => setDialog(null)} /> : null}
      {dialog === 'delete' ? <DeleteDialog project={project} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export default ProjectActionsMenu;
