import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';

// Small shared pieces of the template workspace: the palette is warm off-white with thin neutral lines and one muted green.
export const ink = 'text-[#2B2823]';
export const muted = 'text-[#7A7366]';
export const line = 'border-[#E2DCCF]';

export function PrimaryButton({ className = '', children, ...props }) {
  return (
    <button type="button" {...props} className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

export function GhostButton({ className = '', children, ...props }) {
  return (
    <button type="button" {...props} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border ${line} bg-transparent px-3 py-1.5 text-xs font-medium ${ink} transition hover:bg-[#EFEBE1] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {children}
    </button>
  );
}

export function IconButton({ label, className = '', children, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} {...props} className={`rounded p-1 ${muted} transition hover:bg-[#EAE5D9] hover:text-[#2B2823] disabled:opacity-40 ${className}`}>
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
}

export function PanelHeader({ title, count, action }) {
  return (
    <div className={`flex items-center justify-between border-b ${line} px-4 py-3`}>
      <h2 className={`font-serif text-lg ${ink}`}>{title}{count !== undefined ? <span className={`ml-2 text-xs font-sans ${muted}`}>{count}</span> : null}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className={`font-serif text-base ${ink}`}>{title}</p>
      {children ? <p className={`mt-1 text-xs leading-relaxed ${muted}`}>{children}</p> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div role="alert" className="m-4 rounded-md border border-[#D9B8B0] bg-[#F7E9E5] p-3 text-xs text-[#7A3A2E]">
      <p>{children}</p>
      {onRetry ? <button type="button" onClick={onRetry} className="mt-2 font-medium underline">Try again</button> : null}
    </div>
  );
}

/** A grey placeholder block shown while content loads. */
export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-[#E9E4D7] ${className}`} />;
}

export function Modal({ open, onClose, title, children, wide = false, size = null, bare = false }) {
  // Escape closes the dialog.
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2823]/40 p-2 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full rounded-lg border ${line} bg-[#FBF9F4] shadow-xl ${size === 'studio' ? 'flex h-[min(94vh,980px)] max-w-[1480px] flex-col overflow-hidden' : `max-h-[90vh] overflow-auto ${size === 'xl' ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-md'}`}`}>
        <div className={`sticky top-0 z-10 flex shrink-0 items-center justify-between border-b ${line} bg-[#FBF9F4] px-5 py-3`}>
          <h3 className={`font-serif text-lg ${ink}`}>{title}</h3>
          <IconButton label="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        {bare ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : <div className="p-5">{children}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger = false, busy = false, onConfirm, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className={`text-sm leading-relaxed ${ink}`}>{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
        <button type="button" onClick={onConfirm} disabled={busy} className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${danger ? 'bg-[#A4493A] hover:bg-[#8F3E31]' : 'bg-zinc-900 hover:bg-black'}`}>
          {busy ? <Spinner /> : null}{confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export const inputClass = `w-full rounded-md border ${line} bg-white px-3 py-2 text-sm ${ink} placeholder:text-[#A59E90] focus:border-[#5E7B5F] focus:outline-none focus:ring-1 focus:ring-[#5E7B5F]`;
