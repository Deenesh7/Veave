import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { forwardRef } from 'react';
import Dropdown from './Dropdown';

export const Select = forwardRef(({ options, value, onChange, placeholder, className, ...props }, ref) => {
  return (
    <div className="relative w-full">
      <Dropdown
        value={value}
        onChange={onChange}
        className={cn(
          'bg-zinc-50 border border-zinc-200 rounded-lg px-3 h-10 w-full text-sm text-zinc-900',
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
      </Dropdown>
    </div>
  );
});

Select.displayName = 'Select';
