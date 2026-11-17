import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/** Flattens <option>, <optgroup> and fragments/arrays (what a native <select> accepts) into a plain list. */
function collect(children, out = [], group = null) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) return collect(child.props.children, out, group);
    if (child.type === 'optgroup') {
      out.push({ kind: 'group', label: child.props.label });
      return collect(child.props.children, out, child.props.label);
    }
    if (child.type === 'option') {
      const label = React.Children.toArray(child.props.children).join('');
      out.push({ kind: 'option', value: String(child.props.value ?? label), label, disabled: !!child.props.disabled, hidden: !!child.props.hidden });
    }
  });
  return out;
}

/**
 * A styled replacement for the native <select>: same props (value, onChange(event), disabled, className, <option> children), but the
 * list is a themed menu that never clips inside modals or scrolling panels. className styles the trigger button.
 */
export default function Dropdown({ value, onChange, children, className = '', disabled = false, id, name, title, placeholder, menuClassName = '', ...rest }) {
  const items = useMemo(() => collect(children), [children]);
  const options = items.filter((item) => item.kind === 'option');
  const current = options.find((option) => option.value === String(value ?? ''));
  const shown = current || (placeholder ? null : options.find((option) => !option.hidden));

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);
  const listId = useId();

  const place = useCallback(() => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const room = 260;
    const up = window.innerHeight - rect.bottom < room && rect.top > window.innerHeight - rect.bottom;
    setBox({ left: rect.left, minWidth: rect.width, ...(up ? { bottom: window.innerHeight - rect.top + 4, maxHeight: Math.min(room, rect.top - 12) } : { top: rect.bottom + 4, maxHeight: Math.min(room, window.innerHeight - rect.bottom - 12) }) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    const close = (event) => { if (!menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const visible = options.filter((option) => !option.hidden);
  const openMenu = () => { if (disabled) return; setActive(Math.max(0, visible.findIndex((option) => option.value === String(value ?? '')))); setOpen(true); };
  const choose = (option) => {
    if (option.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (option.value !== String(value ?? '')) onChange?.({ target: { value: option.value, name, id }, currentTarget: { value: option.value, name, id } });
  };
  const step = (delta) => {
    let next = active;
    for (let i = 0; i < visible.length; i += 1) { next = (next + delta + visible.length) % visible.length; if (!visible[next].disabled) break; }
    setActive(next);
  };
  const onKeyDown = (event) => {
    if (disabled) return;
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openMenu(); } return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (visible[active]) choose(visible[active]); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest['aria-label']}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={`inline-flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${shown ? '' : 'opacity-60'}`}>{shown ? shown.label : placeholder || ''}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && box ? createPortal(
        <div
          ref={menu}
          id={listId}
          role="listbox"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          style={{ position: 'fixed', zIndex: 10000, ...box }}
          className={`overflow-y-auto rounded-xl border border-[#E2DCCF] bg-white p-1 text-sm text-[#2B2823] shadow-[0_12px_32px_rgba(43,40,35,0.16)] animate-in fade-in zoom-in-95 duration-100 ${menuClassName}`}
        >
          {items.map((item, index) => {
            if (item.kind === 'group') return <div key={`g${index}`} className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#7A7366]">{item.label}</div>;
            if (item.hidden) return null;
            const position = visible.indexOf(item);
            const selected = item.value === String(value ?? '');
            return (
              <div
                key={`${item.value}-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={item.disabled || undefined}
                data-active={position === active}
                onMouseEnter={() => setActive(position)}
                onClick={() => choose(item)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 ${item.disabled ? 'cursor-not-allowed opacity-40' : position === active ? 'bg-[#EFEBE1]' : ''} ${selected ? 'font-medium' : ''}`}
              >
                <span className="flex-1 truncate">{item.label}</span>
                {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[#2F4A35]" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>,
        document.body
      ) : null}
    </>
  );
}
