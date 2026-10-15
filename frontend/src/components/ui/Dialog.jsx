import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { Button } from './Button';

export function Dialog({ open, onClose, title, description, children, className }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />
      <div 
        className={cn(
          'relative w-full max-w-lg bg-zinc-50 border border-zinc-200 rounded-xl shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[85vh]',
          className
        )}
      >
        <div className="flex items-center justify-between p-5 border-b border-zinc-200/50">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
            {description && <p className="text-sm text-zinc-400 mt-1">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} icon={X} className="text-zinc-400 hover:text-zinc-900 shrink-0 ml-4" />
        </div>
        <div className="p-5 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
