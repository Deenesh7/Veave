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
        220,
        Math.max(40, localRef.current.scrollHeight)
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
      className="w-full bg-transparent text-sm text-[#111827] placeholder:text-zinc-400 focus:outline-none resize-none leading-relaxed"
    />
  );
});

export default PromptInput;
