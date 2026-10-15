import React, { useState } from 'react';
import { Lock, Copy, Check, ChevronDown } from 'lucide-react';

export function ShareLinkRow({
  type = 'preview',
  title = 'Preview',
  url = '',
  accessLevel = 'Anyone with the link',
  onAccessChange,
  options = ['Anyone with the link', 'Only invited users', 'Disabled']
}) {
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement('textarea');
        el.value = url;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  // Truncate URL nicely for display
  const displayUrl = url.replace(/^https?:\/\//, '');

  return (
    <div className="rounded-xl border border-[#DDE2E5] bg-white p-2.5 sm:p-3 hover:bg-zinc-50/60 transition-colors relative">
      <div className="flex items-center justify-between gap-2">
        {/* Left: Lock Icon & Access Details */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0">
            <Lock className="w-3.5 h-3.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none mb-1">
              <span className="text-xs font-semibold text-[#111827]">{title}</span>
              <span className="text-[10px] text-zinc-400 font-normal">·</span>
              <span className="text-[11px] text-zinc-500 font-medium truncate">{accessLevel}</span>
            </div>
            <p className="text-[11px] font-mono text-zinc-400 truncate select-all" title={url}>
              {displayUrl}
            </p>
          </div>
        </div>

        {/* Right: Actions (Copy & Access Dropdown) */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Copy Button with Feedback */}
          <button
            type="button"
            onClick={handleCopy}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
              copied
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
            title="Copy URL"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 animate-in zoom-in-50 duration-150" />
                <span className="text-[11px] font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
              </>
            )}
          </button>

          {/* Access Dropdown Toggle */}
          {options && options.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
                title="Change permissions"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl border border-[#DDE2E5] shadow-xl py-1 z-50 animate-in fade-in zoom-in-95 duration-100 text-xs">
                    <div className="px-2.5 py-1 text-[10px] font-mono uppercase text-zinc-400 font-bold border-b border-zinc-100">
                      Access Permission
                    </div>
                    {options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          onAccessChange?.(opt);
                          setDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-xs transition-colors hover:bg-zinc-50 cursor-pointer ${
                          accessLevel === opt ? 'text-zinc-600 font-semibold bg-zinc-50/50' : 'text-zinc-700'
                        }`}
                      >
                        <span>{opt}</span>
                        {accessLevel === opt && <Check className="w-3 h-3 text-zinc-600" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShareLinkRow;
