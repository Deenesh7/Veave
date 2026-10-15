import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { forwardRef } from 'react';

export const Select = forwardRef(({ options, value, onChange, placeholder, className, ...props }, ref) => {
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        value={value}
        onChange={onChange}
        className={cn(
          'appearance-none bg-zinc-50 border border-zinc-200 rounded-lg px-3 pr-10 h-10 w-full text-sm text-zinc-900',
          'focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-colors cursor-pointer',
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-zinc-500">
        <ChevronDown className="h-4 w-4" />
      </div>
    </div>
  );
});

Select.displayName = 'Select';
