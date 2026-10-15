import { forwardRef } from 'react';
import { cn } from '../../utils/helpers';

export const Textarea = forwardRef(({ className, label, error, rows = 3, ...props }, ref) => {
  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-zinc-700 mb-1.5">{label}</label>}
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'bg-zinc-50 border border-zinc-200 rounded-lg w-full text-sm text-zinc-900 placeholder:text-zinc-500 p-3',
          'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-colors resize-none min-h-[80px]',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </div>
  );
});

Textarea.displayName = 'Textarea';
