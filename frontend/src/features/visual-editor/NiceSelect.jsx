import React from 'react';
import { ChevronDown } from 'lucide-react';
import Dropdown from '../../components/ui/Dropdown';

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
      <Dropdown
        value={value}
        onChange={onChange}
        disabled={disabled}
        title={title}
        className={`w-full bg-white hover:bg-zinc-50/90 border border-zinc-200/90 hover:border-zinc-300 rounded-xl font-medium text-zinc-800 focus:outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/15 shadow-2xs transition-all cursor-pointer select-none ${
          size === 'sm' ? 'px-2 py-1 text-xs ' : 'px-2.5 py-1.5 text-xs '
        }`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="text-zinc-800 py-1.5 bg-white">
            {opt.label}
          </option>
        ))}
      </Dropdown>
    </div>
  );
}

export default NiceSelect;
