import React, { useState } from 'react';
import { Wand2, X, RotateCcw } from 'lucide-react';
import { useTemplateStudioStore } from '../../store/templateStudioStore';
import { Modal, PrimaryButton, GhostButton, Spinner, inputClass, ink, muted, line } from './ui';

export const GENERATION = {
  'not-started': { label: 'Not Started', tone: 'bg-[#EFEBE1] text-[#7A7366]' },
  queued: { label: 'Queued', tone: 'bg-[#EFEBE1] text-[#2B2823]' },
  generating: { label: 'Generating', tone: 'bg-[#E8F0E8] text-[#33503A]' },
  completed: { label: 'Completed', tone: 'bg-[#E8F0E8] text-[#33503A]' },
  failed: { label: 'Failed', tone: 'bg-[#F7E9E5] text-[#7A3A2E]' },
  'needs-review': { label: 'Needs Review', tone: 'bg-[#FBF1DC] text-[#7A5A1E]' }
};

export const stateOfPage = (page) => page?.generation?.state || (page?.status === 'generating' ? 'generating' : page?.status === 'failed' ? 'failed' : 'not-started');

export function GenerationBadge({ page }) {
  const state = stateOfPage(page);
  const { label, tone } = GENERATION[state] || GENERATION['not-started'];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`} title={page.generation?.error || undefined}>
      {state === 'generating' ? <Spinner className="h-2.5 w-2.5" /> : null}{label}
    </span>
  );
}

/** "Generate Entire Website": the description is typed once (and remembered); then every page is written one after another. */
export default function WebsiteGeneration() {
  const { site, pages, job, busy, generateSite, cancelJob } = useTemplateStudioStore();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const websiteJob = job && job.type === 'site-customize' ? job : null;
  const running = Boolean(websiteJob && !['completed', 'failed', 'cancelled'].includes(websiteJob.status));
  const anyRunning = Boolean(job && !['completed', 'failed', 'cancelled'].includes(job.status));
  if (!site) return null;

  const states = pages.map(stateOfPage);
  const count = (name) => states.filter((value) => value === name).length;
  const total = pages.length;
  const completed = count('completed');
  const generating = pages.find((page) => stateOfPage(page) === 'generating');
  const queued = count('queued');
  const attention = count('failed') + count('needs-review');
  const showProgress = running || queued > 0;
  const percent = total ? Math.round(((completed + (generating ? 0.5 : 0)) / total) * 100) : 0;

  const openDialog = () => { setBrief(site.brief || ''); setOpen(true); };
  const start = async () => { if (brief.trim() && await generateSite(brief.trim())) setOpen(false); };

  return (
    <div className={`border-b ${line} px-3 py-3`}>
      <PrimaryButton className="w-full !py-2" onClick={openDialog} disabled={anyRunning || busy.generateSite}>
        {busy.generateSite ? <Spinner /> : <Wand2 className="h-4 w-4" />}Generate Entire Website
      </PrimaryButton>

      {showProgress ? (
        <div className="mt-3 rounded-md border border-[#CFC8B6] bg-white p-2.5" role="status" aria-live="polite">
          <p className={`text-xs font-medium ${ink}`}>Generating website: {completed} / {total} pages completed</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-[#E9E4D7]"><div className="h-full bg-[#5E7B5F] transition-all duration-500" style={{ width: `${Math.max(3, percent)}%` }} /></div>
          <p className={`mt-1.5 text-[11px] leading-snug ${muted}`}>
            {generating ? <>Now writing <span className={`font-medium ${ink}`}>{generating.name}</span></> : (websiteJob?.stepName || 'Starting…')}
            {queued ? ` · ${queued} remaining` : ''}{attention ? ` · ${attention} need attention` : ''}
          </p>
          {running ? <GhostButton className="mt-2 !px-2 !py-1 text-xs" onClick={cancelJob}><X className="h-3 w-3" />Cancel generation</GhostButton> : null}
        </div>
      ) : attention > 0 ? (
        <p className="mt-2 flex items-center gap-1.5 rounded-md border border-[#E7D6A9] bg-[#FBF1DC] px-2.5 py-1.5 text-[11px] leading-snug text-[#7A5A1E]">
          <RotateCcw className="h-3 w-3 shrink-0" />{attention} page{attention === 1 ? '' : 's'} need{attention === 1 ? 's' : ''} attention. Use Retry on the page below; the other pages stay as they are.
        </p>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="Generate Entire Website">
        <div className="space-y-3">
          <p className={`text-sm leading-relaxed ${ink}`}>Describe your website once. Every page ({total}) is then written in order, in the same style, using this description. You do not need to write anything for each page.</p>
          <div>
            <label htmlFor="website-brief" className={`block text-[11px] font-medium uppercase tracking-wider ${muted}`}>Website description</label>
            <textarea id="website-brief" autoFocus value={brief} onChange={(event) => setBrief(event.target.value)} maxLength={4000} rows={6} className={`${inputClass} mt-1 leading-relaxed`}
              placeholder="e.g. A calm architecture studio in Lisbon that designs quiet houses from natural materials. Warm, honest tone. Show recent work, how we work, and a contact page." />
            <p className={`mt-1 text-right text-[11px] ${muted}`}>{brief.length}/4000</p>
          </div>
          <p className={`text-xs leading-relaxed ${muted}`}>Say which pages you want, for example <span className={ink}>"Pages: Home, About, Admissions, Contact"</span>, and you get exactly those, never more. Without a list the website keeps the template's {total} pages. Mention colours or a style (for example "navy blue and white") and the design follows it.</p>
          <p className={`rounded-md border ${line} bg-[#F3EFE5] p-2.5 text-xs leading-relaxed ${ink}`}>Each page replaces its current content. The previous version of every page is kept in its revisions, so you can restore it. Your photos stay in place. Pages that finish appear in the preview right away, and one failed page never undoes the others.</p>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={start} disabled={!brief.trim() || busy.generateSite}>{busy.generateSite ? <Spinner /> : <Wand2 className="h-4 w-4" />}Generate {total} pages</PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
