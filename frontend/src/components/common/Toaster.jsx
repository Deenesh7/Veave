import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!toasts.length) return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[300] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.kind === 'error' ? AlertCircle : CheckCircle2;
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="flex items-start gap-2.5 rounded-lg border border-stone-200 bg-white px-3.5 py-3 text-[13px] text-stone-800 shadow-[0_8px_24px_-8px_rgba(28,25,23,0.25)] animate-in fade-in slide-in-from-bottom-2 duration-150">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${t.kind === 'error' ? 'text-red-600' : 'text-emerald-600'}`} aria-hidden="true" />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-stone-400 hover:text-stone-700"><X className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
