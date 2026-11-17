import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Globe, Layers, HardDrive, Coins, Check, ChevronDown, PlusCircle, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useGenerationJobStore } from '../../store/generationJobStore';
import { toast } from '../../store/toastStore';

const EXCLUDED_PAGE_SIZE = 25;

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
const formatBytes = (bytes) => {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};
const REASONS = {
  'page-budget': 'Not scraped · beyond the page limit',
  'section-cap': 'Not scraped · section already well covered',
  'time-budget': 'Not scraped · crawl time limit reached',
  'robots-disallowed': 'Blocked by the site\'s robots.txt',
};
const reasonLabel = (reason = '') => (reason.startsWith('failed:') ? 'Could not be captured · you can retry' : REASONS[reason] || 'Not scraped');

/** Round checkbox from the specification: solid charcoal with a white check when selected. */
function Check32({ checked, disabled, onChange, label, className = '' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] focus-visible:ring-offset-2 disabled:cursor-not-allowed ${checked ? 'border-[#171717] bg-[#171717] text-white' : 'border-[#D4D4D8] bg-white text-transparent hover:border-[#71717A]'} ${disabled && !checked ? 'opacity-40' : ''} ${className}`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
    </button>
  );
}

function PageRow({ title, path, meta, pill, checked, disabled, onToggle, checkLabel, dimmed = false }) {
  return (
    <li className={`flex min-h-[96px] items-center gap-4 rounded-[18px] border border-[#E4E4E7] bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:min-h-[76px] sm:gap-4 sm:p-4 ${dimmed ? 'opacity-90' : ''}`}>
      <Check32 checked={checked} disabled={disabled} onChange={onToggle} label={checkLabel} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <h3 className="min-w-0 truncate text-[13px] font-bold leading-tight text-[#171717] sm:text-sm" title={title}>{title}</h3>
          <span className="hidden max-w-[40%] shrink-0 truncate rounded-md bg-[#FAFAFA] px-2 py-0.5 font-mono text-[11px] text-[#A1A1AA] sm:inline-block" title={path}>{path === '/' ? '/' : path.replace(/^\//, '')}</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-[#71717A] sm:mt-0.5 sm:text-xs">{meta}</p>
      </div>
      {pill ? <span className="shrink-0 whitespace-nowrap rounded-full border border-[#E4E4E7] bg-white px-3 py-1 text-[11px] font-medium text-[#171717] sm:px-3 sm:py-0.5 sm:text-xs">{pill}</span> : null}
    </li>
  );
}

export default function ClonePlanReview({ approval }) {
  const navigate = useNavigate();
  const decidePlan = useGenerationJobStore((s) => s.decidePlan);
  const scrapeMorePages = useGenerationJobStore((s) => s.scrapeMorePages);
  const planError = useGenerationJobStore((s) => s.planError);
  const plan = approval.plan;
  const scraping = Boolean(approval.request);

  const [deselected, setDeselected] = useState(() => new Set());
  const [toScrape, setToScrape] = useState(() => new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [excludedLimit, setExcludedLimit] = useState(EXCLUDED_PAGE_SIZE);
  const [deciding, setDeciding] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const lastResult = useRef(approval.lastRequest?.id || null);

  // A decision is final; the buttons unlock only if the server sends the plan back (e.g. the approval was refused).
  useEffect(() => { setDeciding(null); }, [approval]);
  // "Scraping" ends when the server reports a newer result than the one we had when the button was pressed. Waiting for the
  // server's `request` flag alone would leave the button stuck whenever a request finishes between two polls.
  const requestedFrom = useRef(null);
  useEffect(() => {
    if (requesting && (approval.lastRequest?.id || null) !== requestedFrom.current) setRequesting(false);
  }, [approval.lastRequest, requesting]);
  useEffect(() => { if (planError) setRequesting(false); }, [planError]);

  // Report the outcome of a "scrape more pages" request once, and refresh which excluded pages are still queued.
  useEffect(() => {
    const result = approval.lastRequest;
    if (!result || result.id === lastResult.current) return;
    lastResult.current = result.id;
    if (result.status === 'done') toast.success(result.message || 'More pages were added.');
    else toast.error(result.message || 'The pages could not be scraped.');
    setToScrape(new Set());
  }, [approval.lastRequest]);

  const pages = plan.pages || [];
  const excluded = plan.excluded || [];
  const selectedPages = useMemo(() => pages.filter((page) => !deselected.has(page.path)), [pages, deselected]);
  const deselectedPages = useMemo(() => pages.filter((page) => deselected.has(page.path)), [pages, deselected]);
  const excludedTotal = deselectedPages.length + (plan.excludedTotal ?? excluded.length);

  const credits = selectedPages.reduce((sum, page) => sum + (page.credits || 0), 0);
  const assetBytes = useMemo(() => {
    const selectedIndexes = new Set(pages.map((page, index) => (deselected.has(page.path) ? -1 : index)).filter((index) => index >= 0));
    return (plan.assetBytesUnattributed || 0) + (plan.assetIndex || []).reduce((sum, [bytes, ...owners]) => (
      !owners.length || owners.some((index) => selectedIndexes.has(index)) ? sum + bytes : sum
    ), 0);
  }, [pages, deselected, plan.assetIndex, plan.assetBytesUnattributed]);

  let host = plan.sourceUrl || '';
  try { host = new URL(plan.sourceUrl).host; } catch { /* show the raw value */ }

  const busy = Boolean(deciding) || scraping || requesting;
  const togglePage = (path) => setDeselected((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const toggleScrape = (path) => setToScrape((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });

  const start = () => {
    if (busy || !selectedPages.length) return;
    setDeciding('approve');
    decidePlan('approve', selectedPages.map((page) => page.path));
  };
  const cancel = () => {
    if (deciding) return;
    setDeciding('cancel');
    decidePlan('cancel');
  };
  const scrapeMore = () => {
    if (busy || !plan.canScrapeMore) return;
    requestedFrom.current = approval.lastRequest?.id || null;
    setRequesting(true);
    scrapeMorePages([...toScrape]);
  };

  if (minimized) {
    return createPortal(
      <button type="button" onClick={() => setMinimized(false)} className="fixed bottom-4 right-4 z-[200] rounded-2xl border border-[#E4E4E7] bg-white px-5 py-3 text-sm font-semibold text-[#171717] shadow-[0_8px_24px_rgba(0,0,0,0.12)] hover:bg-[#FAFAFA]">
        Clone plan waiting for approval · Review
      </button>,
      document.body
    );
  }

  const visibleExcluded = excluded.slice(0, Math.max(0, excludedLimit - deselectedPages.length));
  const shownCount = deselectedPages.length + visibleExcluded.length;
  const hiddenCount = excludedTotal - shownCount;

  const stat = (Icon, label, value) => (
    <div className="flex min-h-[96px] flex-col justify-between rounded-[18px] border border-[#E4E4E7] bg-white p-3.5 sm:h-[84px] sm:p-3.5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-[#71717A] sm:text-xs"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</div>
      <div className="text-lg font-bold leading-none tracking-tight text-[#171717] sm:text-xl">{value}</div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-2 sm:px-6 lg:px-9" role="dialog" aria-modal="true" aria-labelledby="clone-plan-heading">
      <div className="flex h-[78vh] max-h-[760px] w-full max-w-[920px] flex-col overflow-hidden rounded-[20px] border border-[#E4E4E7] bg-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.25)] sm:rounded-[28px]">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[#E4E4E7] px-5 py-4 sm:h-[80px] sm:px-7 sm:py-0">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E4E4E7] text-[#171717] sm:h-10 sm:w-10"><Globe className="h-6 w-6" aria-hidden="true" /></div>
            <div className="min-w-0">
              <h2 id="clone-plan-heading" className="truncate text-base font-bold leading-tight text-[#171717] sm:text-lg">Website Cloning Plan</h2>
              <p className="mt-0.5 truncate text-[11px] text-[#71717A] sm:text-xs">{host}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setMinimized(true); navigate('/dashboard'); }} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#71717A] hover:text-[#171717] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] sm:text-sm">
            Dashboard
          </button>
        </header>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-6 sm:px-7 sm:pb-8 sm:pt-5">
          <div className="space-y-5 sm:space-y-6">
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-3 sm:gap-4">
              {stat(Layers, 'Detected Pages', plural(selectedPages.length, 'page'))}
              {stat(HardDrive, 'Assets Total Size', formatBytes(assetBytes))}
              {stat(Coins, 'Total Credits', plural(credits, 'Credit'))}
            </div>

            {planError ? (
              <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{planError}</p>
            ) : null}

            <ul className="flex flex-col gap-2.5" aria-label="Selected pages">
              {selectedPages.map((page) => (
                <PageRow
                  key={page.path}
                  title={page.title}
                  path={page.path}
                  meta={`${plural(page.sections, 'section')} · ~${page.tokens.toLocaleString()} tokens (${page.steps} gen + ${page.refineSteps} refine)`}
                  pill={plural(page.credits, 'credit')}
                  checked
                  disabled={busy || page.path === plan.homePath}
                  onToggle={() => togglePage(page.path)}
                  checkLabel={page.path === plan.homePath ? `${page.title} (required)` : `Exclude ${page.title}`}
                />
              ))}
            </ul>

            <section aria-labelledby="excluded-heading">
              <div className="flex items-center justify-between gap-4">
                <h2 id="excluded-heading" className="text-[13px] font-bold text-[#171717] sm:text-sm">Excluded Pages ({excludedTotal.toLocaleString()})</h2>
                <button type="button" onClick={() => setShowExcluded((v) => !v)} aria-expanded={showExcluded} disabled={!excludedTotal} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#71717A] hover:text-[#171717] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] disabled:opacity-40 sm:text-sm">
                  {showExcluded ? 'Hide' : 'Show'}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showExcluded ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              </div>
              {showExcluded ? (
                <div className="mt-4">
                  <ul className="flex flex-col gap-2.5" aria-label="Excluded pages">
                    {deselectedPages.map((page) => (
                      <PageRow
                        key={page.path}
                        title={page.title}
                        path={page.path}
                        meta={`${plural(page.sections, 'section')} · ~${page.tokens.toLocaleString()} tokens (${page.steps} gen + ${page.refineSteps} refine)`}
                        pill={plural(page.credits, 'credit')}
                        checked={false}
                        disabled={busy}
                        onToggle={() => togglePage(page.path)}
                        checkLabel={`Include ${page.title}`}
                        dimmed
                      />
                    ))}
                    {visibleExcluded.map((item) => (
                      <PageRow
                        key={item.path}
                        title={item.title}
                        path={item.path}
                        meta={reasonLabel(item.reason)}
                        pill={item.scrapeable ? (toScrape.has(item.path) ? 'Queued' : 'Not scraped') : 'Blocked'}
                        checked={toScrape.has(item.path)}
                        disabled={busy || !item.scrapeable || !plan.canScrapeMore}
                        onToggle={() => toggleScrape(item.path)}
                        checkLabel={`Scrape ${item.title}`}
                        dimmed
                      />
                    ))}
                  </ul>
                  {hiddenCount > 0 ? (
                    <button type="button" onClick={() => setExcludedLimit((n) => n + EXCLUDED_PAGE_SIZE)} className="mt-4 w-full rounded-2xl border border-[#E4E4E7] bg-white py-3 text-sm font-medium text-[#171717] hover:bg-[#FAFAFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717]">
                      Show {Math.min(EXCLUDED_PAGE_SIZE, hiddenCount)} more ({hiddenCount.toLocaleString()} remaining)
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        </div>

        {/* Fixed action bar */}
        <footer className="shrink-0 border-t border-[#E4E4E7] bg-white px-5 py-4 sm:flex sm:h-[88px] sm:items-center sm:px-7 sm:py-0">
          <div className="flex w-full flex-col-reverse gap-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-4">
            <button type="button" onClick={cancel} disabled={Boolean(deciding)} className="h-10 justify-self-start rounded-[20px] px-6 text-sm font-medium text-[#71717A] transition-colors hover:bg-[#FAFAFA] hover:text-[#171717] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] disabled:opacity-50 sm:h-[44px] sm:text-[13px]">
              {deciding === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </button>
            <button type="button" onClick={scrapeMore} disabled={busy || !plan.canScrapeMore} title={plan.canScrapeMore ? '' : 'There are no more pages to scrape'} className="inline-flex h-10 items-center justify-center gap-2 rounded-[20px] border border-[#E4E4E7] bg-white px-6 text-sm font-semibold text-[#171717] transition-colors hover:bg-[#FAFAFA] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] disabled:cursor-not-allowed disabled:opacity-50 sm:h-[44px] sm:text-[13px]">
              {scraping || requesting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Scraping pages...</> : <><PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />Scrape more pages{toScrape.size ? ` (${toScrape.size})` : ''}</>}
            </button>
            <button type="button" onClick={start} disabled={busy || !selectedPages.length} aria-busy={deciding === 'approve'} className="inline-flex h-11 items-center justify-center gap-2.5 justify-self-end rounded-[20px] bg-[#171717] px-7 text-sm font-semibold text-white transition-colors hover:bg-[#2b2b2b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#171717] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:h-[44px] sm:text-[13px]">
              {deciding === 'approve' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Starting...</> : <>Start Cloning ({plural(credits, 'Credit')})<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></>}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
