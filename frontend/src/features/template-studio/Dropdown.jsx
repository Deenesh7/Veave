import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { ink, muted, line } from './ui';

/**
 * A styled select. `options` is [{ value, label, hint? }]. The list opens under the button (or above it when there is no room) and
 * is drawn on top of everything, so it is never clipped by a scrolling panel. Works with the mouse and the keyboard.
 */
export default function Dropdown({ value, onChange, options, label, placeholder = 'Choose…', icon: Icon = null, className = '', compact = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState(null);
  const button = useRef(null);
  const list = useRef(null);
  const selected = options.find((option) => option.value === value);

  const place = () => {
    const rect = button.current.getBoundingClientRect();
    const height = Math.min(280, options.length * 44 + 8);
    const below = window.innerHeight - rect.bottom;
    const up = below < height + 12 && rect.top > below;
    setBox({ left: rect.left, width: rect.width, top: up ? undefined : rect.bottom + 4, bottom: up ? window.innerHeight - rect.top + 4 : undefined, maxHeight: Math.max(120, (up ? rect.top : below) - 16) });
  };
  const show = () => { if (disabled) return; place(); setActive(Math.max(0, options.findIndex((option) => option.value === value))); setOpen(true); };
  const choose = (option) => { onChange(option.value); setOpen(false); button.current?.focus(); };

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!button.current?.contains(event.target) && !list.current?.contains(event.target)) setOpen(false); };
    const reflow = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const onKeyDown = (event) => {
    if (disabled) return;
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); } return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[active]); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={button} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-2 rounded-md border bg-white text-left transition focus:outline-none focus:ring-1 focus:ring-[#5E7B5F] disabled:opacity-50 ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'} ${open ? 'border-[#5E7B5F] ring-1 ring-[#5E7B5F]' : `${line} hover:border-[#B9B2A2]`} ${className}`}
      >
        {Icon ? <Icon className={`h-3.5 w-3.5 shrink-0 ${muted}`} aria-hidden="true" /> : null}
        <span className={`min-w-0 flex-1 truncate ${selected && selected.value !== '' ? ink : muted}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${muted} transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && box ? createPortal(
        <ul
          ref={list} role="listbox" aria-label={label}
          style={{ position: 'fixed', left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight, zIndex: 80 }}
          className={`overflow-auto rounded-lg border ${line} bg-[#FBF9F4] p-1 shadow-xl`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value} role="option" aria-selected={isSelected} data-active={index === active}
                onMouseEnter={() => setActive(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}
                className={`flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 ${index === active ? 'bg-[#EEE9DC]' : ''}`}
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">{isSelected ? <Check className="h-3.5 w-3.5 text-[#5E7B5F]" /> : null}</span>
                <span className="min-w-0">
                  <span className={`block text-xs font-medium ${ink}`}>{option.label}</span>
                  {option.hint ? <span className={`block text-[11px] leading-snug ${muted}`}>{option.hint}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>,
        document.body
      ) : null}
    </>
  );
}
