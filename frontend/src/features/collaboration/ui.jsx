import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, AlertTriangle, CheckCircle2, Crown, Shield, User, Eye, Pencil, ChevronDown, Check } from 'lucide-react';

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

export const roleLabel = (role) => (role === 'member' ? 'Staff' : role ? role.charAt(0).toUpperCase() + role.slice(1) : '');

export function RoleBadge({ role }) {
  if (!role) return null;
  const [style, Icon] = ROLE_STYLE[role] || ROLE_STYLE.member;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${style}`}>
      <Icon className="w-3 h-3" /> {roleLabel(role)}
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

const ROLE_OPTIONS = {
  member: { label: 'Staff', hint: 'Can work on shared projects', icon: User },
  admin: { label: 'Admin', hint: 'Can manage members and projects', icon: Shield },
};

// Styled dropdown for choosing a group role (stored values: 'member' = Staff, 'admin').
export function RoleSelect({ value, onChange, options = ['member', 'admin'], label, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = ROLE_OPTIONS[value] || ROLE_OPTIONS.member;
  const CurrentIcon = current.icon;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full min-w-[120px] inline-flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-xl border border-[#E2E5E8] bg-white text-[#111827] hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-100 transition-colors"
      >
        <span className="inline-flex items-center gap-1.5"><CurrentIcon className="w-3.5 h-3.5 text-zinc-500" />{current.label}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute right-0 z-30 mt-1.5 w-60 p-1 bg-white rounded-xl border border-[#E2E5E8] shadow-lg">
          {options.map((opt) => {
            const o = ROLE_OPTIONS[opt];
            const Icon = o.icon;
            const selected = opt === value;
            return (
              <li key={opt} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => { setOpen(false); if (!selected) onChange(opt); }}
                  className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${selected ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
                >
                  <Icon className="w-4 h-4 mt-0.5 text-zinc-500 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-[#111827]">{o.label}</span>
                    <span className="block text-[11px] text-zinc-500">{o.hint}</span>
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 mt-0.5 text-zinc-900 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
