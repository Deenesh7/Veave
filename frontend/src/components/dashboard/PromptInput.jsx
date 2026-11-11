import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const PromptInput = forwardRef(function PromptInput(
  { value, onChange, onSubmit, onKeyDown, placeholder },
  ref
) {
  const localRef = useRef(null);

  useImperativeHandle(ref, () => localRef.current);

  // Auto-grow textarea height based on content
  useEffect(() => {
    if (localRef.current) {
      localRef.current.style.height = 'auto';
      localRef.current.style.height = `${Math.min(
        240,
        Math.max(44, localRef.current.scrollHeight)
      )}px`;
    }
  }, [value]);

  const handleKeyDown = (e) => {
    if (onKeyDown) {
      onKeyDown(e);
      if (e.defaultPrevented) return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <textarea
      ref={localRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder || 'Ask Veave to build anything, or type / for commands...'}
      rows={1}
      className="block w-full bg-transparent border-0 p-0 text-[15px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 caret-zinc-900 focus:outline-none focus:ring-0 resize-none overflow-y-auto"
    />
  );
});

export default PromptInput;
