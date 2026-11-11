import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, AlertTriangle, Plus, X, ChevronDown, ImagePlus } from 'lucide-react';
import { Modal, ConfirmModal, PrimaryButton, GhostButton, Spinner, ErrorNote, Skeleton, inputClass, ink, muted, line } from './ui';
import { GENERATION } from './WebsiteGeneration';
import { useFontLibrary, isDefaultTypography } from './TypographyEditor';
import ThemeEditor, { Section as ThemeSection, DEFAULT_THEME, themePayload } from './ThemeEditor';
import LivePreview from './LivePreview';
import { templateSiteService, apiMessage } from '../../services/templateSiteService';
import { useTemplateStudioStore, PLACEMENT_OPTIONS, PHOTO_TYPES, MAX_PHOTO_BYTES, MAX_ATTACH } from '../../store/templateStudioStore';

const NAME_MAX = 80;
const BRIEF_MAX = 4000;
const DONE = ['completed', 'failed', 'cancelled'];

// A name is filled in for the chosen template, so "Create site" works at once; typing replaces it.
export const suggestedName = (template) => (template?.scratch ? 'My Website' : template?.id === 'studio-editorial-001' ? 'Ember House' : template?.name || '');

// "Create from Scratch" is a real, hidden blank template on the server (a header, a footer and an empty Home page; nothing of any other
// template), so the same pipeline, jobs and revisions apply. It is shown as its own card, never in the template gallery.
export const SCRATCH = { id: 'blank-starter-001', version: '1.0.0', name: 'Create from Scratch', category: 'Blank', pageCount: 1, scratch: true, description: 'Start with a completely blank website and build your own design.' };
const COMMON_PAGES = ['About', 'Services', 'Contact', 'Blog', 'Gallery', 'Pricing', 'FAQ', 'Team', 'Admissions', 'Events'];

// The chosen pages go into the description as the "Pages:" line the planner already reads as a hard list.
export const composeBrief = (brief, pages) => (pages.length ? `${brief.trim()}\n\nPages: Home, ${pages.join(', ')}` : brief.trim());

// The placeholder follows the chosen template, but the description may be about any kind of website.
const EXAMPLES = {
  'studio-editorial-001': 'A calm architecture studio that designs houses from natural materials.',
  'saas-modern-001': 'A project-management app for remote teams, with pricing, features and a demo page.',
  'portfolio-minimal-001': 'A portfolio for a documentary photographer with galleries, about and contact.',
  'business-corporate-001': 'A regional accounting firm with services, team, case studies and contact.'
};
const placeholderFor = (template) => template?.scratch ? 'e.g. "Create a modern engineering college website with admissions, departments, faculty, campus facilities, placements, events and contact information."' : `${EXAMPLES[template?.id] || `A ${String(template?.category || 'business').toLowerCase()} website.`} Or describe any other kind of website, e.g. "A modern engineering college with departments, admissions and placements."`;

// One card shell for every design in the strip: same size, padding, radius, gap and selection badge.
const CARD = 'group relative flex h-[76px] w-[248px] shrink-0 snap-start items-center gap-3 rounded-lg border p-2 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E7B5F]';
const SelectedBadge = () => <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#5E7B5F] text-white shadow"><Check className="h-3 w-3" aria-label="Selected" /></span>;

/** The visually distinct "Create from Scratch" card: same shell, dashed green border. */
function ScratchCard({ selected, onSelect }) {
  return (
    <button type="button" onClick={() => onSelect(SCRATCH)} aria-pressed={selected} title={SCRATCH.description}
      className={`${CARD} border-dashed ${selected ? 'border-[#5E7B5F] bg-[#E8F0E8] ring-1 ring-[#5E7B5F]' : 'border-[#8FAA90] bg-transparent hover:bg-[#F3EFE5]'}`}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-[#C9D6C9] bg-white text-[#5E7B5F]"><Plus className="h-5 w-5" /></span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className={`font-serif text-sm font-medium leading-tight ${ink}`}>Create from Scratch</span>
        <span className={`mt-0.5 text-[11px] leading-snug ${muted}`}>Start with a completely blank website</span>
      </span>
      {selected ? <SelectedBadge /> : null}
    </button>
  );
}

/** Photos the owner wants on the website. They are uploaded to the new site and given to the pages they belong to when it is generated. */
function CreationPhotos({ photos, onChange, disabled }) {
  const input = useRef(null);
  const [problem, setProblem] = useState('');
  const add = (list) => {
    const next = [...photos];
    let rejected = '';
    for (const file of Array.from(list || [])) {
      if (next.length >= MAX_ATTACH) { rejected = `At most ${MAX_ATTACH} photos can be added here. Add more later in the Content panel.`; break; }
      if (!PHOTO_TYPES.includes(file.type)) { rejected = 'Use PNG, JPEG, WebP, GIF or AVIF pictures.'; continue; }
      if (file.size > MAX_PHOTO_BYTES) { rejected = 'Each picture must be 8 MB or smaller.'; continue; }
      if (next.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
      next.push({ id: `${file.name}:${file.size}:${Date.now()}:${next.length}`, file, preview: URL.createObjectURL(file), placement: '', note: '' });
    }
    setProblem(rejected);
    onChange(next);
  };
  const remove = (id) => { const gone = photos.find((item) => item.id === id); if (gone) URL.revokeObjectURL(gone.preview); onChange(photos.filter((item) => item.id !== id)); };
  const set = (id, change) => onChange(photos.map((item) => (item.id === id ? { ...item, ...change } : item)));
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Photos <span className="normal-case tracking-normal">(optional)</span></span>
        <button type="button" disabled={disabled || photos.length >= MAX_ATTACH} onClick={() => input.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-[#CFC8B6] bg-white px-2 py-1 text-[11px] font-medium text-[#33503A] transition-colors hover:bg-[#E8F0E8] disabled:opacity-50"><ImagePlus className="h-3 w-3" />Add photos</button>
        <input ref={input} type="file" multiple accept={PHOTO_TYPES.join(',')} className="hidden" aria-label="Choose photos for the website" onChange={(event) => { add(event.target.files); event.target.value = ''; }} />
      </div>
      {photos.length ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((item) => (
            <li key={item.id} className={`relative w-[104px] shrink-0 rounded-md border ${line} bg-white p-1`}>
              <img src={item.preview} alt={item.file.name} className="h-12 w-full rounded object-cover" />
              <button type="button" onClick={() => remove(item.id)} disabled={disabled} aria-label={`Remove ${item.file.name}`} className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#2B2823] text-white"><X className="h-2.5 w-2.5" /></button>
              <select aria-label={`Where ${item.file.name} should go`} value={item.placement} onChange={(event) => set(item.id, { placement: event.target.value })} disabled={disabled} className="mt-1 w-full rounded border border-[#E2DCCF] bg-white px-1 py-0.5 text-[10px]">
                {PLACEMENT_OPTIONS.filter((option) => option.value !== 'section').map((option) => <option key={option.value} value={option.value}>{option.value ? option.label : 'Let AI decide'}</option>)}
              </select>
            </li>
          ))}
        </ul>
      ) : <p className={`text-[11px] ${muted}`}>Add your own photos. With a description, they are placed on the right pages when the website is generated; otherwise they wait in the photo library. They are never replaced.</p>}
      {problem ? <p className="mt-1 text-[11px] text-[#A4493A]" role="alert">{problem}</p> : null}
    </div>
  );
}

/** Scratch only: which pages the website needs. Home is always there; leave empty to let the AI design the sitemap. */
function PagePicker({ pages, onChange }) {
  const [custom, setCustom] = useState('');
  const toggle = (name) => onChange(pages.includes(name) ? pages.filter((item) => item !== name) : [...pages, name]);
  const addCustom = () => {
    const name = custom.replace(/[^\p{L}\p{N}\s&'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name && !pages.some((item) => item.toLowerCase() === name.toLowerCase()) && pages.length < 11) onChange([...pages, name]);
    setCustom('');
  };
  return (
    <ThemeSection title={`Pages${pages.length ? ` (${pages.length + 1})` : ''}`} defaultOpen>
      <p className={`mb-2 text-xs leading-snug ${muted}`}>{pages.length ? 'Exactly these pages (plus Home) are created.' : 'Leave empty and the AI designs the sitemap for your kind of website.'}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pages">
        <span className="rounded-full border border-[#5E7B5F] bg-[#E8F0E8] px-2.5 py-1 text-[11px] text-[#33503A]">Home</span>
        {[...COMMON_PAGES, ...pages.filter((name) => !COMMON_PAGES.includes(name))].map((name) => (
          <button key={name} type="button" onClick={() => toggle(name)} aria-pressed={pages.includes(name)}
            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition ${pages.includes(name) ? 'border-[#5E7B5F] bg-[#E8F0E8] text-[#33503A]' : `${line} bg-white ${ink} hover:border-[#B9B2A2]`}`}>{name}{pages.includes(name) && !COMMON_PAGES.includes(name) ? <X className="h-3 w-3" /> : null}</button>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        <input value={custom} onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} maxLength={40} placeholder="Add another page" aria-label="Add another page" className={`${inputClass} !py-1 !text-xs`} />
        <GhostButton onClick={addCustom} disabled={!custom.trim()}>Add</GhostButton>
      </div>
    </ThemeSection>
  );
}

/** A compact template card for the strip above the preview. The whole card is the button. */
function TemplateCard({ template, selected, onSelect }) {
  return (
    <button type="button" onClick={() => onSelect(template)} aria-pressed={selected} title={template.description}
      className={`${CARD} bg-white ${selected ? 'border-[#5E7B5F] ring-1 ring-[#5E7B5F]' : `${line} hover:border-[#B9B2A2] hover:bg-[#FBF9F4]`}`}>
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-[#E2DCCF] bg-[#EFEBE1]">
        {template.previewUrl ? <img src={template.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover object-top" /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center">
        <span className={`font-serif text-sm font-medium leading-tight ${ink}`}>{template.name}</span>
        <span className={`mt-0.5 text-[11px] leading-snug ${muted}`}>{template.category} · {template.pageCount} pages</span>
      </span>
      {selected ? <SelectedBadge /> : null}
    </button>
  );
}

/** Real progress of the website job that was started by Create site (nothing here is simulated). */
function GenerationProgress({ job, pages, starting, onRetry, onOpen }) {
  const running = Boolean(job && !DONE.includes(job.status));
  const failed = !starting && (!job || job.status === 'failed');
  const done = job?.status === 'completed';
  const plan = job?.plan?.length ? job.plan : pages.map((page) => ({ pageId: page.id, name: page.name, state: page.generation?.state || 'not-started' }));
  const completed = plan.filter((entry) => entry.state === 'completed' || entry.state === 'needs-review').length;
  return (
    <div className="mx-auto max-w-lg space-y-4 py-2" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-[#5E7B5F]" /> : failed ? <AlertTriangle className="mt-0.5 h-5 w-5 text-[#A4493A]" /> : <Spinner className="mt-0.5 h-5 w-5 text-[#5E7B5F]" />}
        <div>
          <p className={`font-serif text-lg ${ink}`}>{done ? 'Your website is ready' : failed ? 'Generation did not finish' : starting ? 'Creating website' : 'Building your website'}</p>
          <p className={`text-sm ${muted}`}>
            {starting ? 'Preparing the selected template…' : failed ? (job?.error || 'The website could not be generated. The site was created and nothing already finished is lost.') : done ? `${completed} of ${plan.length} pages written.` : (job?.stepName || 'Starting…')}
          </p>
        </div>
      </div>
      {plan.length ? (
        <>
          {running ? <p className={`text-xs ${ink}`}>{completed} / {plan.length} pages completed</p> : null}
          <ul className={`divide-y divide-[#EFEBE1] rounded-md border ${line} bg-white`}>
            {plan.map((entry) => {
              const state = GENERATION[entry.state] || GENERATION['not-started'];
              return <li key={entry.pageId} className="flex items-center justify-between px-3 py-2 text-sm"><span className={ink}>{entry.name}</span><span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${state.tone}`}>{entry.state === 'generating' ? <Spinner className="h-2.5 w-2.5" /> : null}{state.label}</span></li>;
            })}
          </ul>
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        {failed ? <PrimaryButton onClick={onRetry}>Try again</PrimaryButton> : null}
        <GhostButton onClick={onOpen}>{done ? 'Open website' : failed ? 'Open site anyway' : 'Continue in Template Studio'}</GhostButton>
      </div>
    </div>
  );
}

export default function NewSiteModal({ open, onClose }) {
  const createSite = useTemplateStudioStore((state) => state.createSite);
  const generateSite = useTemplateStudioStore((state) => state.generateSite);
  const creating = useTemplateStudioStore((state) => Boolean(state.busy.createSite));
  const job = useTemplateStudioStore((state) => state.job);
  const pages = useTemplateStudioStore((state) => state.pages);
  const activeSiteId = useTemplateStudioStore((state) => state.activeSiteId);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [brief, setBrief] = useState('');
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [scratchPages, setScratchPages] = useState([]);
  const [photos, setPhotos] = useState([]);
  const createStep = useTemplateStudioStore((state) => state.createStep);
  const [themeOpen, setThemeOpen] = useState(false);
  const [adjusted, setAdjusted] = useState([]);
  const { library, failed: libraryFailed } = useFontLibrary();
  const [phase, setPhase] = useState('form'); // form | progress
  const [confirmClose, setConfirmClose] = useState(false);
  const [details, setDetails] = useState({}); // template id -> { data, loading, failed }
  const submitting = useRef(false);

  const load = () => {
    setLoading(true);
    setError(null);
    templateSiteService.listTemplates()
      .then((res) => {
        const list = res.data.templates || [];
        setTemplates(list);
        const first = list.find((item) => item.id === 'studio-editorial-001') || list[0];
        setSelected((current) => { if (current || !first) return current; setName(suggestedName(first)); setNameTouched(false); return first; });
      })
      .catch((err) => setError(apiMessage(err, 'The templates could not be loaded.')))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open) { setTheme(DEFAULT_THEME()); setAdjusted([]); setScratchPages([]); setPhotos([]); setPhase('form'); submitting.current = false; load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // The selected template's real definition (colours, typography, pages) for the theme defaults and page list.
  useEffect(() => {
    if (!selected || details[selected.id]) return;
    const id = selected.id;
    setDetails((current) => ({ ...current, [id]: { loading: true } }));
    templateSiteService.getTemplate(id, selected.version)
      .then((res) => setDetails((current) => ({ ...current, [id]: { data: res.data.template } })))
      .catch(() => setDetails((current) => ({ ...current, [id]: { failed: true } })));
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const detail = selected ? details[selected.id] : null;
  const payload = themePayload(theme);
  const trimmed = name.trim();
  const nameError = !trimmed ? 'Enter a name for the site.' : null;
  const scratch = Boolean(selected?.scratch);
  const pagesChosen = scratch ? scratchPages : [];
  const fullBrief = composeBrief(brief, pagesChosen);
  // Pages need a description to be written from; without either, a scratch site is just the blank starter in the chosen theme.
  const needsBrief = scratch && pagesChosen.length > 0 && !brief.trim();
  const canSubmit = Boolean(selected) && !nameError && !needsBrief && !creating && phase === 'form';
  const dirty = phase === 'form' && (brief.trim() || photos.length || pagesChosen.length || (nameTouched && trimmed) || payload);

  const select = (template) => {
    if (selected?.id === template.id) return;
    setSelected(template);
    setTheme(DEFAULT_THEME()); // the new template's own typography, colours and appearance; name and description are kept
    setAdjusted([]);
    setScratchPages([]);
    if (!nameTouched) setName(suggestedName(template));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    const site = await createSite({ templateId: selected.id, templateVersion: selected.version, name: trimmed, brief: fullBrief, theme: payload, photos: photos.map(({ file, placement, note }) => ({ file, placement, note })) });
    submitting.current = false;
    if (!site) return; // the error is shown and every input is kept
    if (brief.trim()) setPhase('progress');
    else finish();
  };

  const finish = () => { setName(''); setNameTouched(false); setBrief(''); setScratchPages([]); setSelected(null); photos.forEach((item) => URL.revokeObjectURL(item.preview)); setPhotos([]); setTheme(DEFAULT_THEME()); setPhase('form'); onClose(); };
  const requestClose = () => {
    if (creating) return;
    if (phase === 'progress') return finish();
    if (dirty) setConfirmClose(true); else onClose();
  };

  const websiteJob = job && job.type === 'site-customize' && job.siteId === activeSiteId ? job : null;
  const starting = creating || (phase === 'progress' && !websiteJob && useTemplateStudioStore.getState().busy.generateSite);

  return (
    <>
      <Modal open={open} onClose={requestClose} title={phase === 'progress' ? 'Creating your website' : 'New site'} size="studio" bare>
        {phase === 'progress' ? (
          <div className="min-h-0 flex-1 overflow-auto p-5"><GenerationProgress job={websiteJob} pages={pages} starting={starting} onRetry={() => generateSite(fullBrief)} onOpen={finish} /></div>
        ) : loading ? (
          <div className="grid flex-1 gap-3 p-5 lg:grid-cols-[68fr_32fr]"><Skeleton className="h-full min-h-[320px]" /><Skeleton className="h-full min-h-[320px]" /></div>
        ) : error ? (
          <div className="p-5"><ErrorNote onRetry={load}>{error}</ErrorNote></div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
            {/* Workspace: live preview (left, 68%) and theme controls (right, 32%). On small screens they stack and the body scrolls. */}
            <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className={`flex min-h-0 min-w-0 flex-col md:border-r ${line}`}>
                <div className={`flex shrink-0 snap-x items-stretch gap-3 overflow-x-auto overflow-y-hidden border-b ${line} bg-[#FBF9F4] px-4 pb-3 pt-4`} role="group" aria-label="Choose a design">
                  <ScratchCard selected={Boolean(selected?.scratch)} onSelect={select} />
                  {templates.map((template) => <TemplateCard key={template.id} template={template} selected={selected?.id === template.id} onSelect={select} />)}
                </div>
                {selected ? <LivePreview template={selected} pages={detail?.data?.pages || []} theme={payload} onTheme={(result) => setAdjusted(result.adjusted || [])} /> : <p className={`p-6 text-sm ${muted}`}>Choose a design to see its website.</p>}
              </div>
              {/* Theme sidebar: fixed width from tablet up, its own scroll area; below tablet it is a collapsible panel under the preview. */}
              <aside className={`min-h-0 min-w-0 border-t ${line} bg-[#FBF9F4] md:border-t-0`} aria-label="Theme customization">
                <button type="button" onClick={() => setThemeOpen((value) => !value)} aria-expanded={themeOpen} className={`flex w-full items-center justify-between px-4 py-3 text-left font-serif text-sm ${ink} md:hidden`}>
                  <span>Customize theme{payload ? ' (customised)' : ''}</span><ChevronDown className={`h-4 w-4 transition ${themeOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className={`${themeOpen ? 'block' : 'hidden'} min-w-0 md:block md:h-full md:overflow-y-auto md:overscroll-contain`}>
                  <ThemeEditor theme={theme} onChange={setTheme} detail={detail?.data} library={library} libraryFailed={libraryFailed} adjusted={adjusted} onReset={() => { setTheme(DEFAULT_THEME()); setAdjusted([]); }}
                    before={scratch ? <PagePicker pages={scratchPages} onChange={setScratchPages} /> : null}>
                    {detail?.failed ? <p className={`px-4 py-2 text-xs ${muted}`}>The template's design details could not be loaded, so colours show no defaults.</p> : null}
                    {detail?.data?.pages?.length ? (
                      <ThemeSection title={`Template pages (${detail.data.pages.length})`}>
                        <ul className="space-y-1 text-xs">{detail.data.pages.map((item) => <li key={item.path} className={`${ink} break-words`}><span className="font-medium">{item.title}</span> <span className={muted}>{item.path}</span></li>)}</ul>
                        <p className={`mt-2 text-xs leading-relaxed ${muted}`}>The theme changes only fonts, colours and appearance, never the pages, images or navigation. A description below rewrites the content for any kind of website.</p>
                      </ThemeSection>
                    ) : null}
                  </ThemeEditor>
                </div>
              </aside>
            </div>

            {/* Site information: always visible, never behind the footer. */}
            <div className={`shrink-0 border-t ${line} bg-[#F7F3EA] px-4 py-3`}>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <label htmlFor="site-name" className={`mb-1 block text-xs font-medium uppercase tracking-wider ${muted}`}>Site name</label>
                  <input id="site-name" value={name} onChange={(event) => { setNameTouched(true); setName(event.target.value); }} maxLength={NAME_MAX} required aria-invalid={Boolean(nameError)} aria-describedby="site-name-help" placeholder="Ember House" className={inputClass} />
                  <p id="site-name-help" className={`mt-1 text-[11px] ${nameError ? 'text-[#A4493A]' : muted}`}>{nameError || `${name.length}/${NAME_MAX}`}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <label htmlFor="site-brief" className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Website description <span className="normal-case tracking-normal">{scratch ? '(recommended)' : '(optional)'}</span></label>
                    <span className={`text-[11px] ${brief.length > BRIEF_MAX * 0.9 ? 'text-[#A4493A]' : muted}`}>{brief.length}/{scratch ? BRIEF_MAX - 480 : BRIEF_MAX}</span>
                  </div>
                  <textarea id="site-brief" value={brief} onChange={(event) => setBrief(event.target.value)} maxLength={scratch ? BRIEF_MAX - 480 : BRIEF_MAX} rows={2} placeholder={placeholderFor(selected)} className={`${inputClass} max-h-28 resize-y leading-relaxed`} />
                  <p className={`mt-1 text-[11px] ${muted}`}>{needsBrief ? <span className="text-[#A4493A]">Describe the website so its pages can be written.</span> : brief.trim() ? (scratch ? 'The AI plans the whole website and writes every page from this description, in your theme.' : 'The whole website is planned and every page written from this description, in your theme.') : scratch ? 'Leave empty to create a blank website in your theme.' : 'Leave empty to start from the template as it is.'}</p>
                </div>
              </div>
            </div>

            <div className="shrink-0 bg-[#F7F3EA] px-4 pb-3"><CreationPhotos photos={photos} onChange={setPhotos} disabled={creating} /></div>

            <div className={`flex shrink-0 flex-wrap items-center justify-end gap-2 border-t ${line} bg-[#FBF9F4] px-4 py-3`}>
              {!selected ? <p className={`mr-auto text-xs ${muted}`}>Choose a design to continue.</p> : payload ? <p className={`mr-auto text-xs ${muted}`}>Your theme is saved with the site.</p> : null}
              <GhostButton onClick={requestClose} disabled={creating}>Cancel</GhostButton>
              <PrimaryButton type="submit" disabled={!canSubmit}>{creating ? <Spinner /> : null}{creating ? (createStep || 'Creating website…') : brief.trim() ? 'Create and generate site' : 'Create site'}</PrimaryButton>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmModal open={confirmClose} title="Discard this site?" message="What you entered will be lost." confirmLabel="Discard" danger onConfirm={() => { setConfirmClose(false); finish(); }} onClose={() => setConfirmClose(false)} />
    </>
  );
}
