import { forwardRef } from 'react';
import { cn } from '../../utils/helpers';

export const Input = forwardRef(({ className, label, error, icon: Icon, ...props }, ref) => {
  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium text-zinc-700 mb-1.5">{label}</label>}
      <div className="relative">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'bg-zinc-50 border border-zinc-200 rounded-lg h-10 w-full text-sm text-zinc-900 placeholder:text-zinc-500',
            'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-colors',
            Icon ? 'pl-9 pr-3' : 'px-3',
            error && 'border-red-500 focus:border-red-500 focus:ring-red-500/20',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </div>
  );
});

Input.displayName = 'Input';
