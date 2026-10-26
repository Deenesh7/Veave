import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, AlertTriangle, CheckCircle2, Crown, Shield, User, Eye, Pencil } from 'lucide-react';

// Small building blocks that follow the dashboard look (white cards, #E2E5E8 borders, zinc-900 actions).

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
      <Loader2 className="w-4 h-4 animate-spin" /> {label || 'Loading...'}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center text-center bg-white border border-dashed border-[#D5DADF] rounded-2xl px-6 py-14">
      {Icon && <div className="w-11 h-11 rounded-xl bg-zinc-100 flex items-center justify-center mb-3"><Icon className="w-5 h-5 text-zinc-500" /></div>}
      <h3 className="text-sm font-semibold text-[#111827]">{title}</h3>
      {text && <p className="text-xs text-zinc-500 mt-1 max-w-sm leading-relaxed">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="pt-2 pb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back}
        <h1 className="text-xl font-bold tracking-tight text-[#111827] truncate">{title}</h1>
        {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

const BUTTONS = {
  primary: 'bg-zinc-900 hover:bg-black text-white',
  outline: 'border border-[#E2E5E8] bg-white hover:bg-zinc-50 text-[#111827]',
  danger: 'bg-red-600 hover:bg-red-700 text-white',
  ghost: 'text-zinc-600 hover:bg-zinc-100',
};

export function Btn({ variant = 'primary', loading, disabled, icon: Icon, children, className = '', ...props }) {
  return (
    <button
      type="button"
      disabled={loading || disabled}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${BUTTONS[variant]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : Icon ? <Icon className="w-3.5 h-3.5" /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#111827] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass = 'w-full px-3 py-2 text-xs rounded-xl border border-[#E2E5E8] bg-white focus:outline-none focus:border-[#52525B] focus:ring-2 focus:ring-zinc-100 disabled:bg-zinc-50';

export function Notice({ kind = 'error', children, onClose }) {
  const Icon = kind === 'error' ? AlertTriangle : CheckCircle2;
  const styles = kind === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${styles}`}>
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="flex-1">{children}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
}

// Auto-clearing success message.
export function useFlash() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  return [message, setMessage];
}

export function Modal({ open, onClose, title, description, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={`relative w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-[#E2E5E8] shadow-2xl p-5`}>
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100">
          <div>
            <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
            {description && <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-zinc-700 p-1 rounded"><X className="w-4 h-4" /></button>
        </div>
        <div className="py-4 space-y-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

// Confirmation for destructive actions. With `requireText`, the user must type that text (e.g. the group name).
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', requireText, danger = true, children }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (open) { setTyped(''); setError(null); setBusy(false); } }, [open]);
  const ready = !requireText || typed.trim() === requireText;
  const run = async () => {
    setBusy(true);
    setError(null);
    try { await onConfirm(typed.trim()); onClose(); } catch (e) { setError(e?.message || 'Action failed.'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}
      footer={<>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ready} onClick={run}>{confirmLabel}</Btn>
      </>}>
      {children}
      {requireText && (
        <Field label={`Type "${requireText}" to confirm`}>
          <input className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Field>
      )}
      {error && <Notice>{error}</Notice>}
    </Modal>
  );
}

const ROLE_STYLE = {
  owner: ['bg-amber-50 text-amber-700 border-amber-200', Crown],
  admin: ['bg-zinc-900 text-white border-zinc-900', Shield],
  member: ['bg-zinc-100 text-zinc-700 border-zinc-200', User],
  viewer: ['bg-zinc-100 text-zinc-600 border-zinc-200', Eye],
  editor: ['bg-emerald-50 text-emerald-700 border-emerald-200', Pencil],
};

export function RoleBadge({ role }) {
  if (!role) return null;
  const [style, Icon] = ROLE_STYLE[role] || ROLE_STYLE.member;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border capitalize ${style}`}>
      <Icon className="w-3 h-3" /> {role}
    </span>
  );
}

const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  revoked: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
};

export function StatusBadge({ status }) {
  return <span className={`inline-flex px-2 py-0.5 text-[10px] font-semibold rounded-full border capitalize ${STATUS_STYLE[status] || STATUS_STYLE.pending}`}>{status}</span>;
}

export function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(date).toLocaleDateString();
}

export function Card({ className = '', children, ...props }) {
  return <div className={`bg-white rounded-xl border border-[#E2E5E8] shadow-sm ${className}`} {...props}>{children}</div>;
}
