import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Eye, Check, ArrowLeft, Loader2, AlertCircle, LayoutTemplate } from 'lucide-react';
import templateService from '../../services/templateService';

const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'popular', label: 'Most popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'name', label: 'Name (A-Z)' }
];

const errorText = (error) => {
  const failure = error?.response?.data?.error;
  return (typeof failure === 'object' ? failure?.message : failure) || error?.message || 'Something went wrong.';
};

function Swatches({ colors }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {colors.map((color, index) => (
        <span key={index} className="h-3.5 w-3.5 rounded-full border border-zinc-200" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

function TemplateCard({ template, selected, busy, onPreview, onUse }) {
  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white transition-all hover:shadow-md ${selected ? 'border-zinc-900 ring-1 ring-zinc-900' : 'border-[#E5E7EB]'}`}
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden bg-zinc-100">
        <img
          src={template.previewUrl}
          alt={`${template.name} template preview`}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 shadow-xs">
          {template.category}
        </span>
        {selected && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-0.5 text-[10px] font-semibold text-white">
            <Check className="h-3 w-3" /> Selected
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">{template.name}</h3>
          <Swatches colors={template.palette} />
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{template.description}</p>
        <div className="flex flex-wrap gap-1">
          {template.styleTags.map((tag) => (
            <span key={tag} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">{tag}</span>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2 pt-3">
          <button
            type="button"
            onClick={() => onPreview(template)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 cursor-pointer"
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onUse(template)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-black disabled:opacity-60 cursor-pointer"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {selected ? 'Use again' : 'Use Template'}
          </button>
        </div>
      </div>
    </article>
  );
}

function PreviewPanel({ template, detail, loading, error, selected, busy, onBack, onUse }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 sm:px-6">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer">
          <ArrowLeft className="h-3.5 w-3.5" /> All templates
        </button>
      </div>
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-zinc-100">
          <img src={template.previewUrl} alt={`${template.name} large preview`} className="w-full object-cover" />
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{template.category}</span>
            <h3 className="mt-2 text-lg font-semibold text-zinc-900">{template.name}</h3>
            <p className="mt-1 text-sm text-zinc-500">{template.description}</p>
            <p className="mt-1 text-[11px] text-zinc-400">Version {template.version}</p>
          </div>

          {loading && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading details...</div>}
          {error && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</div>}

          {detail && (
            <>
              <section>
                <h4 className="text-xs font-semibold text-zinc-900">Colour palette</h4>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(detail.designTokens.colors).map(([name, value]) => (
                    <li key={name} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600">
                      <span className="h-3 w-3 rounded-full border border-zinc-200" style={{ backgroundColor: value }} /> {name} <span className="font-mono text-zinc-400">{value}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4 className="text-xs font-semibold text-zinc-900">Pages</h4>
                <ul className="mt-2 space-y-1">
                  {detail.pages.map((page) => (
                    <li key={page.path} className="text-xs text-zinc-600">
                      <span className="font-mono text-zinc-900">{page.path}</span> {page.title}
                      {page.sections?.length ? <span className="text-zinc-400"> ({page.sections.join(', ')})</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4 className="text-xs font-semibold text-zinc-900">Typography and layout</h4>
                <p className="mt-1 text-xs text-zinc-500">{detail.typography.scale}</p>
                <p className="mt-1 text-xs text-zinc-500">{detail.layout.summary}.</p>
              </section>
              <section>
                <h4 className="text-xs font-semibold text-zinc-900">Includes</h4>
                <div className="mt-2 flex flex-wrap gap-1">
                  {detail.features.map((feature) => (
                    <span key={feature} className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{feature}</span>
                  ))}
                </div>
              </section>
            </>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => onUse(template)}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-60 cursor-pointer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {selected ? 'Keep this template' : 'Use Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplateGalleryModal({ isOpen, onClose, selectedId = null, onUse }) {
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('featured');
  const [previewing, setPreviewing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    setLoading(true);
    setError(null);
    templateService.list({ q: debouncedQuery || undefined, category: category || undefined, sort })
      .then((res) => {
        if (!active) return;
        setTemplates(res.data.templates || []);
        setCategories(res.data.categories || []);
      })
      .catch((err) => active && setError(errorText(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [isOpen, debouncedQuery, category, sort]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (previewing) setPreviewing(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, previewing, onClose]);

  useEffect(() => {
    if (!previewing) { setDetail(null); setDetailError(null); return undefined; }
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    templateService.get(previewing.id, previewing.version)
      .then((res) => active && setDetail(res.data.template))
      .catch((err) => active && setDetailError(errorText(err)))
      .finally(() => active && setDetailLoading(false));
    return () => { active = false; };
  }, [previewing]);

  const use = useCallback(async (template) => {
    setBusyId(template.id);
    setError(null);
    try {
      const res = await templateService.select(template.id, template.version);
      onUse(res.data.selection);
      setPreviewing(null);
    } catch (err) {
      const message = errorText(err);
      if (previewing) setDetailError(message); else setError(message);
    } finally {
      setBusyId(null);
    }
  }, [onUse, previewing]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Template gallery"
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-zinc-700" />
            <h2 className="text-base font-semibold text-zinc-900">Template gallery</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close template gallery" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </header>

        {previewing ? (
          <PreviewPanel
            template={previewing}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            selected={selectedId === previewing.id}
            busy={busyId === previewing.id}
            onBack={() => setPreviewing(null)}
            onUse={use}
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-3 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative flex-1">
                  <span className="sr-only">Search templates</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by name, style or category"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                  Sort by
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500"
                  >
                    {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Template categories">
                {[{ name: '', label: 'All' }, ...categories.map((item) => ({ name: item.name, label: `${item.name} (${item.count})` }))].map((item) => (
                  <button
                    key={item.name || 'all'}
                    type="button"
                    role="tab"
                    aria-selected={category === item.name}
                    onClick={() => setCategory(item.name)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${category === item.name ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
                </div>
              )}
              {loading && templates.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates...</div>
              ) : templates.length === 0 ? (
                <div className="py-16 text-center text-sm text-zinc-500">
                  No templates match your search.
                  {(query || category) && (
                    <button type="button" onClick={() => { setQuery(''); setCategory(''); }} className="ml-2 font-semibold text-zinc-900 underline cursor-pointer">Clear filters</button>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      selected={selectedId === template.id}
                      busy={busyId === template.id}
                      onPreview={setPreviewing}
                      onUse={use}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
