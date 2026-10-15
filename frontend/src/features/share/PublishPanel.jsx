import React, { useState } from 'react';
import { 
  Globe, 
  Copy, 
  Check, 
  ExternalLink, 
  Eye, 
  EyeOff, 
  Lock, 
  Sparkles,
  Loader2,
  CheckCircle2
} from 'lucide-react';

export function PublishPanel({ project, onPublishUpdate }) {
  const isInitiallyPublished = project?.isPublished ?? true;
  const [isPublished, setIsPublished] = useState(isInitiallyPublished);
  const [visibility, setVisibility] = useState(project?.visibility || 'Public');
  const [isPublishing, setIsPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const projectNameSlug = (project?.name || 'untitled-project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'project-name';

  const publicUrl = `https://veave.app/p/${projectNameSlug}`;

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicUrl);
      } else {
        const el = document.createElement('textarea');
        el.value = publicUrl;
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

  const handlePublish = async () => {
    setIsPublishing(true);
    setToastMessage('');
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      setIsPublished(true);
      setToastMessage('Project published successfully');
      onPublishUpdate?.({ isPublished: true, visibility, publicUrl });
      setTimeout(() => setToastMessage(''), 3000);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    setIsPublishing(true);
    setToastMessage('');
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setIsPublished(false);
      setToastMessage('Project unpublished');
      onPublishUpdate?.({ isPublished: false, visibility });
      setTimeout(() => setToastMessage(''), 3000);
    } finally {
      setIsPublishing(false);
    }
  };

  const visibilityOptions = [
    {
      id: 'Public',
      label: 'Public',
      desc: 'Anyone on the internet can discover and view',
      icon: Globe
    },
    {
      id: 'Unlisted',
      label: 'Unlisted',
      desc: 'Anyone with the direct link can view',
      icon: Eye
    },
    {
      id: 'Private',
      label: 'Private',
      desc: 'Only authorized teammates can view',
      icon: Lock
    }
  ];

  return (
    <div className="space-y-4">
      {/* Publishing Status Card */}
      <div className="rounded-xl border border-[#DDE2E5] bg-white p-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${
              isPublished ? 'bg-emerald-500 ring-4 ring-emerald-100 animate-pulse' : 'bg-zinc-300'
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#111827]">
                Publishing Status:
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  isPublished
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                }`}
              >
                {isPublished ? 'Published' : 'Not Published'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {isPublished
                ? 'Your project is live and accessible via the public link below.'
                : 'Publish to generate a shareable web link for clients and users.'}
            </p>
          </div>
        </div>

        {toastMessage && (
          <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 animate-in fade-in duration-150">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{toastMessage}</span>
          </span>
        )}
      </div>

      {/* Public URL Box */}
      <div className="rounded-xl border border-[#DDE2E5] bg-zinc-50/70 p-3">
        <label className="block text-[11px] font-mono font-bold uppercase text-zinc-400 mb-1.5">
          Public URL
        </label>
        <div className="flex items-center justify-between gap-2 bg-white rounded-lg border border-[#DDE2E5] px-3 py-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Globe className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            <span className="text-xs font-mono text-zinc-700 truncate select-all">
              {publicUrl}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                copied
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'text-zinc-600 hover:text-[#111827] hover:bg-zinc-100'
              }`}
              title="Copy Public URL"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {isPublished && (
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1 text-zinc-400 hover:text-zinc-700 transition-colors"
                title="Open public page"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Visibility Options */}
      <div>
        <label className="block text-xs font-semibold text-[#111827] mb-2">
          Visibility Options
        </label>
        <div className="space-y-2">
          {visibilityOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = visibility === opt.id;
            return (
              <div
                key={opt.id}
                onClick={() => setVisibility(opt.id)}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'border-zinc-500 bg-zinc-50/40 ring-1 ring-zinc-500/20'
                    : 'border-[#DDE2E5] bg-white hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-zinc-600 text-white' : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold leading-tight ${isSelected ? 'text-zinc-950' : 'text-[#111827]'}`}>
                      {opt.label}
                    </p>
                    <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                      {opt.desc}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 ml-2">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected ? 'border-zinc-600 bg-zinc-600' : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-[#DDE2E5]">
        {isPublished ? (
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={isPublishing}
            className="px-3.5 py-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Unpublish
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={handlePublish}
          disabled={isPublishing}
          className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-black text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
        >
          {isPublishing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Publishing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
              <span>{isPublished ? 'Publish Changes' : 'Publish Project'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default PublishPanel;
