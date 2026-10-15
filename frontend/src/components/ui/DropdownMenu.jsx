import { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/helpers';

export function DropdownMenu({ trigger, items, align = 'right', className }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-[180px] bg-zinc-50 border border-zinc-200 rounded-lg shadow-xl py-1 animate-fade-in origin-top-right',
            align === 'right' ? 'right-0' : 'left-0',
            className
          )}
        >
          {items.map((item, index) => {
            if (item.divider) {
              return <div key={index} className="border-t border-zinc-200 my-1" />;
            }
            const Icon = item.icon;
            return (
              <button
                key={index}
                onClick={(e) => {
                  setIsOpen(false);
                  if (item.onClick) item.onClick(e);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                  item.danger 
                    ? 'text-red-400 hover:bg-red-500/10' 
                    : 'text-zinc-700 hover:bg-zinc-200 hover:text-zinc-900'
                )}
              >
                {Icon && <Icon className="w-4 h-4" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
