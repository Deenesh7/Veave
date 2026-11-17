import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import Dropdown from '../../components/ui/Dropdown';

export const ink = 'text-[#2B2823]';
export const muted = 'text-[#7A7366]';
export const line = 'border-[#E2DCCF]';
export const inputClass = 'rounded-lg border border-[#D9D2C2] bg-white px-3 py-2 text-sm text-[#2B2823] placeholder:text-[#A39C8C] focus:border-[#5E7B5F] focus:outline-none focus:ring-1 focus:ring-[#5E7B5F] disabled:opacity-60';

export const fmt = (value) => Number(value || 0).toLocaleString('en-US');
export const dateTime = (value) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const dateOnly = (value) => (value ? new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export function ago(value) {
  if (!value) return 'Never';
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} d ago`;
  return dateOnly(value);
}

export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

/** Runs an async loader whenever `deps` change; keeps the last result visible while reloading. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const run = useRef(0);
  const load = useCallback(async () => {
    const id = ++run.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await loader();
      if (id === run.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (id === run.current) setState((current) => ({ ...current, loading: false, error }));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={`font-serif text-2xl sm:text-3xl ${ink}`}>{title}</h1>
          {subtitle ? <p className={`mt-1 text-sm ${muted}`}>{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, action, children, className = '', pad = true }) {
  return (
    <section className={`rounded-xl border ${line} bg-white shadow-[0_1px_0_rgba(43,40,35,0.03)] ${className}`}>
      {title || action ? (
        <header className={`flex items-center justify-between gap-2 border-b ${line} px-4 py-3`}>
          <h2 className={`text-sm font-semibold ${ink}`}>{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

const TONES = {
  green: 'bg-[#E8F0E8] text-[#33503A]', red: 'bg-[#F7E9E5] text-[#7A3A2E]', amber: 'bg-[#FBF1DC] text-[#7A5A1E]',
  blue: 'bg-[#E6EEF7] text-[#2F4E78]', grey: 'bg-[#EFEBE1] text-[#5B554A]', purple: 'bg-[#EFE8F6] text-[#563A78]'
};
export const Badge = ({ tone = 'grey', children }) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone] || TONES.grey}`}>{children}</span>;

export function Stat({ label, value, hint, icon: Icon, tone = 'green' }) {
  return (
    <div className={`rounded-xl border ${line} bg-white p-4`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`text-xs font-medium uppercase tracking-wide ${muted}`}>{label}</p>
        {Icon ? <span className={`rounded-lg p-1.5 ${TONES[tone]}`}><Icon className="h-4 w-4" /></span> : null}
      </div>
      <p className={`mt-2 font-serif text-3xl ${ink}`}>{value}</p>
      {hint ? <p className={`mt-1 text-xs ${muted}`}>{hint}</p> : null}
    </div>
  );
}

const BTN = {
  primary: 'bg-[#2F4A35] text-white hover:bg-[#263d2c] disabled:bg-[#9DB09F]',
  secondary: 'border border-[#D9D2C2] bg-white text-[#2B2823] hover:bg-[#F5F1E8] disabled:opacity-50',
  danger: 'bg-[#A4493A] text-white hover:bg-[#8d3d30] disabled:bg-[#D3A39A]',
  ghost: 'text-[#5B554A] hover:bg-[#EFEBE1] disabled:opacity-50'
};
export const Btn = React.forwardRef(function Btn({ variant = 'secondary', size = 'md', busy = false, className = '', children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} type="button" disabled={disabled || busy} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed ${size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'} ${BTN[variant]} ${className}`} {...rest}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}
    </button>
  );
});

export const Field = ({ label, hint, error, children }) => (
  <label className="block space-y-1">
    {label ? <span className={`text-xs font-medium ${ink}`}>{label}</span> : null}
    {children}
    {error ? <span className="block text-xs text-[#A4493A]">{error}</span> : hint ? <span className={`block text-xs ${muted}`}>{hint}</span> : null}
  </label>
);
const width = (className) => (/(^|\s)(sm:)?(w|max-w)-/.test(className) ? '' : 'w-full');
export const Input = React.forwardRef(function Input({ className = '', ...rest }, ref) { return <input ref={ref} className={`${inputClass} ${width(className)} ${className}`} {...rest} />; });
export const Select = ({ className = '', children, ...rest }) => <Dropdown className={`${inputClass} ${width(className)} ${className}`} {...rest}>{children}</Dropdown>;
export const Textarea = ({ className = '', ...rest }) => <textarea className={`${inputClass} ${width(className)} ${className}`} {...rest} />;

export function Modal({ open, onClose, title, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-[#FBF9F4] shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <header className={`flex items-center justify-between border-b ${line} px-5 py-3.5`}>
          <h2 className={`font-serif text-lg ${ink}`}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#7A7366] hover:bg-[#EFEBE1]"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className={`flex flex-wrap justify-end gap-2 border-t ${line} px-5 py-3`}>{footer}</footer> : null}
      </div>
    </div>
  );
}

/** A confirmation for destructive or high-impact actions. `requireText` makes the user type a value (e.g. a template id) first. */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', danger = false, requireText = null, busy = false, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const ready = !requireText || typed === requireText;
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={title} footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!ready} onClick={() => onConfirm(typed)}>{confirmLabel}</Btn></>}>
      <div className={`space-y-3 text-sm ${ink}`}>
        {children}
        {requireText ? (
          <Field label={`Type "${requireText}" to confirm`}><Input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus /></Field>
        ) : null}
      </div>
    </Modal>
  );
}

export function Pagination({ page, pages, total, onPage, label = 'results' }) {
  if (!total) return null;
  return (
    <div className={`flex items-center justify-between gap-3 px-1 pt-3 text-xs ${muted}`}>
      <span>{fmt(total)} {label}</span>
      <div className="flex items-center gap-1">
        <Btn size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Btn>
        <span className="px-2">Page {page} of {pages}</span>
        <Btn size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Btn>
      </div>
    </div>
  );
}

export const EmptyState = ({ title = 'Nothing here yet', children }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
    <Inbox className="h-8 w-8 text-[#B9B2A2]" />
    <p className={`text-sm font-medium ${ink}`}>{title}</p>
    {children ? <p className={`max-w-sm text-xs ${muted}`}>{children}</p> : null}
  </div>
);

export const ErrorState = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
    <AlertCircle className="h-7 w-7 text-[#A4493A]" />
    <p className={`max-w-md text-sm ${ink}`}>{message}</p>
    {onRetry ? <Btn onClick={onRetry}>Try again</Btn> : null}
  </div>
);

export const Skeleton = ({ className = 'h-4 w-full' }) => <div className={`animate-pulse rounded bg-[#EFEBE1] ${className}`} />;
export const TableSkeleton = ({ rows = 6 }) => <div className="space-y-2 p-4">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;

/** Wraps data from useAsync: loading skeleton, error with retry, or the content. */
export function Async({ state, children, skeleton = <TableSkeleton />, errorFallback }) {
  if (state.error && !state.data) return <ErrorState message={errorFallback ? errorFallback(state.error) : 'This could not be loaded.'} onRetry={state.reload} />;
  if (!state.data) return skeleton;
  return children(state.data);
}

export const Table = ({ children }) => <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">{children}</table></div>;
export const Th = ({ children, className = '' }) => <th className={`whitespace-nowrap border-b ${line} bg-[#FBF9F4] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide ${muted} ${className}`}>{children}</th>;
export const Td = ({ children, className = '' }) => <td className={`border-b border-[#EFEBE1] px-3 py-2.5 align-middle ${ink} ${className}`}>{children}</td>;

export const SearchInput = ({ value, onChange, placeholder = 'Search…' }) => <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="sm:max-w-xs" aria-label={placeholder} />;

export const StatusBadge = ({ status }) => {
  const map = { active: 'green', suspended: 'red', published: 'green', draft: 'amber', archived: 'grey', read: 'grey', unread: 'blue', ADMIN: 'purple', USER: 'grey', info: 'blue', warning: 'amber', critical: 'red' };
  return <Badge tone={map[status] || 'grey'}>{String(status).charAt(0).toUpperCase() + String(status).slice(1)}</Badge>;
};
