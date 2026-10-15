import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Wand2, Image as ImageIcon, X, Copy, Check,
  Loader2, AlertCircle, ChevronDown, FileCode2, Layers,
  Layout, PaintBucket, ShieldCheck
} from 'lucide-react';
import promptEngineService from '../services/promptEngineService';

/**
 * VEAVE Prompt Engine page
 *
 * Clean professional workspace for the prompt-compilation experience.
 * Not a landing page — it feels like an AI product tool.
 */

const DESIGN_SYSTEMS = [
  { value: 'veave',      label: 'VEAVE',      hint: 'Premium, calm, minimal' },
  { value: 'minimal',    label: 'Minimal',    hint: 'Quiet, high-contrast'   },
  { value: 'enterprise', label: 'Enterprise', hint: 'Navy accent, dense'     }
];

const FRAMEWORKS = [
  { value: 'react',   label: 'React'   },
  { value: 'nextjs',  label: 'Next.js' },
  { value: 'vue',     label: 'Vue'     },
  { value: 'svelte',  label: 'Svelte'  }
];

const MODELS = [
  { value: 'gemini-flash-3.8', label: 'Gemini Flash 3.8 (Default)' },
  { value: 'auto',             label: 'Auto'   },
  { value: 'gemini',           label: 'Gemini 1.5 Pro' },
  { value: 'gpt',              label: 'GPT-4o'    },
  { value: 'claude',           label: 'Claude 3.5 Sonnet' }
];

const EXAMPLES = [
  'Create a student attendance dashboard with student, teacher and parent login.',
  'Create a modern banking dashboard.',
  'Build an e-commerce website for a clothing brand.',
  'Create a SaaS analytics dashboard.',
  'Build a portfolio website for a software engineer.'
];

export default function PromptEnginePage() {
  const [userPrompt, setUserPrompt]         = useState('');
  const [designSystem, setDesignSystem]     = useState('veave');
  const [framework, setFramework]           = useState('react');
  const [model, setModel]                   = useState('gemini-flash-3.8');
  const [referenceImage, setReferenceImage] = useState(null);
  const [imagePreview, setImagePreview]     = useState('');
  const [showAdvanced, setShowAdvanced]     = useState(false);

  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState(null);
  const [copied, setCopied]     = useState(false);
  const [tab, setTab]           = useState('prompt'); // prompt | spec | metadata

  const [providers, setProviders] = useState([]);

  useEffect(() => {
    promptEngineService.providers()
      .then(r => setProviders(r.data?.configured || []))
      .catch(() => setProviders([]));
  }, []);

  const disabled = useMemo(
    () => busy || !userPrompt.trim(),
    [busy, userPrompt]
  );

  const handleImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Reference must be an image (PNG, JPEG, WEBP, GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Reference image must be under 5 MB.');
      return;
    }
    setError('');
    setReferenceImage(file);
    const reader = new FileReader();
    reader.onload = ev => setImagePreview(String(ev.target?.result || ''));
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setReferenceImage(null);
    setImagePreview('');
  };

  const submit = async () => {
    if (disabled) return;
    setBusy(true);
    setError('');
    setResult(null);
    setCopied(false);
    try {
      const res = await promptEngineService.generate({
        userPrompt: userPrompt.trim(),
        designSystem,
        framework,
        model,
        referenceImage
      });
      setResult(res.data);
      setTab('prompt');
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Prompt generation failed'
      );
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!result?.prompt) return;
    try {
      await navigator.clipboard.writeText(result.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-8 sm:mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-50 border border-zinc-200/70 text-[#18181B] text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          <span>VEAVE Prompt Engine</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#111827] tracking-tight">
          Create anything with AI
        </h1>
        <p className="text-sm text-[#6B7280] mt-3 max-w-xl mx-auto">
          Describe what you want to build. VEAVE compiles it into a structured,
          implementation-ready prompt for the UI-generation model.
        </p>
      </div>

      {/* Composer */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] p-5 sm:p-6">
        <textarea
          value={userPrompt}
          onChange={e => setUserPrompt(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          placeholder="Describe what you want to build..."
          rows={4}
          className="w-full resize-none text-sm text-[#111827] placeholder:text-zinc-400 focus:outline-none"
          disabled={busy}
        />

        {/* Reference image preview */}
        {imagePreview && (
          <div className="mt-3 relative inline-block">
            <img
              src={imagePreview}
              alt="Reference"
              className="max-h-28 rounded-lg border border-[#E5E7EB]"
            />
            <button
              onClick={clearImage}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-[#E5E7EB] shadow-sm flex items-center justify-center hover:bg-zinc-50"
              aria-label="Remove reference image"
            >
              <X className="w-3 h-3 text-zinc-500" />
            </button>
          </div>
        )}

        {/* Controls row */}
        <div className="mt-4 pt-4 border-t border-zinc-100 flex flex-wrap items-center gap-2 sm:gap-3">
          <Select
            icon={<PaintBucket className="w-3.5 h-3.5" />}
            value={designSystem}
            onChange={setDesignSystem}
            options={DESIGN_SYSTEMS}
            label="Design System"
          />
          <Select
            icon={<FileCode2 className="w-3.5 h-3.5" />}
            value={framework}
            onChange={setFramework}
            options={FRAMEWORKS}
            label="Framework"
          />
          <Select
            icon={<Wand2 className="w-3.5 h-3.5" />}
            value={model}
            onChange={setModel}
            options={MODELS}
            label="Model"
          />

          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white hover:bg-zinc-50 text-xs font-medium text-[#374151] cursor-pointer transition-colors">
            <ImageIcon className="w-3.5 h-3.5" />
            <span>{referenceImage ? 'Change reference' : 'Reference screenshot'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImage}
            />
          </label>

          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-transparent hover:border-[#E5E7EB] text-xs font-medium text-[#6B7280] hover:text-[#111827] transition-colors"
          >
            <span>Advanced Options</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={submit}
              disabled={disabled}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111827] hover:bg-black disabled:bg-zinc-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-sm"
            >
              {busy
                ? (<><Loader2 className="w-4 h-4 animate-spin" /><span>Compiling…</span></>)
                : (<><Sparkles className="w-4 h-4" /><span>Generate</span></>)}
            </button>
          </div>
        </div>

        {/* Advanced info */}
        {showAdvanced && (
          <div className="mt-4 pt-4 border-t border-zinc-100 text-[11px] text-[#6B7280] space-y-1.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Configured providers:{' '}
                {providers.length
                  ? providers.map(p => `${p.name} (${p.model})`).join(', ')
                  : <span className="text-amber-600">none — configure LLM_PROVIDER + API key</span>}
              </span>
            </div>
            <div>Cmd/Ctrl + Enter to generate.</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Example prompts */}
      {!result && !busy && (
        <div className="mt-6">
          <div className="text-xs font-semibold text-[#6B7280] mb-2">Try one of these</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                onClick={() => setUserPrompt(ex)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-white border border-[#E5E7EB] hover:border-[#27272A] hover:text-[#18181B] text-[#374151] transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <ResultPanel
          result={result}
          tab={tab}
          setTab={setTab}
          onCopy={copyPrompt}
          copied={copied}
        />
      )}
    </div>
  );
}

/* ------------------------------- sub-parts ------------------------------- */

function Select({ icon, value, onChange, options, label }) {
  return (
    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E5E7EB] bg-white hover:bg-zinc-50 text-xs font-medium text-[#374151] cursor-pointer">
      {icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent focus:outline-none pr-1 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}{o.hint ? ` — ${o.hint}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultPanel({ result, tab, setTab, onCopy, copied }) {
  const meta = result.metadata || {};
  const spec = result.spec || {};

  return (
    <div className="mt-8 bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
      {/* Result header */}
      <div className="px-5 py-4 border-b border-[#E5E7EB] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#111827] truncate">{spec.project || 'Compiled Prompt'}</div>
          <div className="text-[11px] text-[#6B7280] mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {meta.provider && <span>Provider: <span className="font-medium text-[#374151]">{meta.provider}</span></span>}
            {meta.model    && <span>Model: <span className="font-medium text-[#374151]">{meta.model}</span></span>}
            {typeof meta.durationMs === 'number' && <span>{meta.durationMs} ms</span>}
            {meta.validated
              ? <span className="text-emerald-600 inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" />Validated</span>
              : <span className="text-amber-600">Warnings: {meta.warnings?.length || 0}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <TabButton active={tab === 'prompt'}   onClick={() => setTab('prompt')}   icon={<Wand2 className="w-3.5 h-3.5" />}   label="Prompt" />
          <TabButton active={tab === 'spec'}     onClick={() => setTab('spec')}     icon={<Layers className="w-3.5 h-3.5" />}  label="UISpec" />
          <TabButton active={tab === 'metadata'} onClick={() => setTab('metadata')} icon={<Layout className="w-3.5 h-3.5" />}  label="Meta"   />
        </div>
      </div>

      {/* Content */}
      {tab === 'prompt' && (
        <div className="relative">
          <button
            onClick={onCopy}
            className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-[#E5E7EB] hover:bg-zinc-50 text-[11px] font-semibold text-[#374151]"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <pre className="p-5 text-[12px] leading-[1.55] text-[#111827] whitespace-pre-wrap font-mono overflow-x-auto max-h-[560px]">
            {result.prompt}
          </pre>
        </div>
      )}

      {tab === 'spec' && (
        <pre className="p-5 text-[12px] leading-[1.55] text-[#111827] whitespace-pre-wrap font-mono overflow-x-auto max-h-[560px]">
          {JSON.stringify(spec, null, 2)}
        </pre>
      )}

      {tab === 'metadata' && (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <MetaBlock title="Pages"       items={meta.pages}      />
          <MetaBlock title="Components"  items={meta.components} />
          <MetaBlock title="Features"    items={meta.features}   />
          <MetaBlock title="Warnings"    items={meta.warnings}   emptyText="No warnings" />
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
        active
          ? 'bg-[#111827] text-white'
          : 'text-[#374151] hover:bg-zinc-100'
      }`}
    >
      {icon}<span>{label}</span>
    </button>
  );
}

function MetaBlock({ title, items, emptyText = 'None' }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="rounded-xl border border-[#E5E7EB] p-3 bg-[#FAFAFA]">
      <div className="text-[11px] font-semibold text-[#111827] mb-1.5">{title} ({list.length})</div>
      {list.length === 0
        ? <div className="text-[11px] text-[#6B7280]">{emptyText}</div>
        : <ul className="text-[11px] text-[#374151] space-y-0.5">
            {list.map((x, i) => <li key={i} className="truncate">• {String(x)}</li>)}
          </ul>}
    </div>
  );
}
