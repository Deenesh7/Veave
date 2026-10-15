import React from 'react';
import { ChevronDown } from 'lucide-react';

export function NiceSelect({
  value,
  onChange,
  options = [],
  className = '',
  size = 'md',
  disabled = false,
  title = ''
}) {
  return (
    <div className={`relative inline-flex items-center w-full ${className}`}>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        title={title}
        className={`w-full appearance-none bg-white hover:bg-zinc-50/90 border border-zinc-200/90 hover:border-zinc-300 rounded-xl font-medium text-zinc-800 focus:outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/15 shadow-2xs transition-all cursor-pointer select-none ${
          size === 'sm' ? 'px-2 py-1 text-xs pr-6' : 'px-2.5 py-1.5 text-xs pr-7'
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="text-zinc-800 py-1.5 bg-white">
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute right-2 pointer-events-none text-zinc-400 flex items-center">
        <ChevronDown className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      </div>
    </div>
  );
}

export default NiceSelect;
