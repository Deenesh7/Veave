import { create } from 'zustand';
import { templateSiteService, apiMessage } from '../services/templateSiteService';
import { useBillingStore } from './billingStore';

// Template work spends the same credits as every other AI task: the balance shown in the app is re-read whenever it may have changed.
const refreshCredits = () => { try { useBillingStore.getState().refreshOverview(); } catch { /* best effort */ } };

const STORAGE_KEY = 'veave_template_studio';
const TERMINAL = ['completed', 'failed', 'cancelled'];

const remember = (state) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ siteId: state.activeSiteId, pageId: state.activePageId })); } catch { /* storage may be unavailable */ }
};
const remembered = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; } };

let pollRun = 0; // every poll loop has a number; starting a new one (or stopping) retires the old one, so two never run together
let toastTimer = null;

const WIDTH_KEY = 'veave_template_studio_content_width';
export const CONTENT_MIN = 300;
export const CONTENT_MAX = 640;
const initialContentWidth = () => {
  try { const saved = Number(localStorage.getItem(WIDTH_KEY)); if (saved >= CONTENT_MIN && saved <= CONTENT_MAX) return saved; } catch { /* ignore */ }
  return 360;
};

export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACH = 8;
export const PLACEMENTS = [['', 'Let the page decide'], ['hero', 'Hero image'], ['about', 'About section'], ['gallery', 'Gallery'], ['project', 'Project cover'], ['background', 'Background image'], ['section', 'A section I name below']];
// The same choices for dropdowns: a label and a short explanation of what each one does.
export const PLACEMENT_OPTIONS = [
  { value: '', label: 'Let the page decide', hint: 'The AI picks the best spot for this photo' },
  { value: 'hero', label: 'Hero image', hint: 'The large picture at the top of the page' },
  { value: 'about', label: 'About section', hint: 'Next to the introduction or story' },
  { value: 'gallery', label: 'Gallery', hint: 'Shown with other photos in a grid' },
  { value: 'project', label: 'Project cover', hint: 'The cover image of a project or work card' },
  { value: 'background', label: 'Background image', hint: 'Behind a section, under the text' },
  { value: 'section', label: 'A section I name', hint: 'Describe the section in the instruction box' }
];

// What a file is, so the same file picked twice (or retried) is recognised before it is sent.
const fileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;
let uploadRun = null;
let watching = false;

const COLLAPSE_KEY = 'veave_template_studio_sites_collapsed';
const initialCollapsed = () => {
  try { const saved = localStorage.getItem(COLLAPSE_KEY); if (saved !== null) return saved === '1'; } catch { /* ignore */ }
  // On smaller screens the website gets the room by default.
  return typeof window !== 'undefined' && window.innerWidth < 1500;
};

export const useTemplateStudioStore = create((set, get) => ({
  sitesCollapsed: initialCollapsed(),
  setSitesCollapsed: (value) => { try { localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0'); } catch { /* ignore */ } set({ sitesCollapsed: value }); },
  pagesCollapsed: false,
  setPagesCollapsed: (value) => set({ pagesCollapsed: value }),
  contentCollapsed: false,
  setContentCollapsed: (value) => set({ contentCollapsed: value }),
  appSidebarHidden: false,
  setAppSidebarHidden: (value) => set({ appSidebarHidden: value }),
  sites: [],
  sitesLoaded: false,
  sitesError: null,
  activeSiteId: null,
  site: null,
  pages: [],
  activePageId: null,
  siteLoading: false,
  siteError: null,
  job: null,            // the job being followed (running or just finished)
  jobPageId: null,
  revisions: [],
  revisionsLoading: false,
  revisionPreview: null,   // { number, status: 'loading' | 'ready' | 'error', html, token, route, error } while an older revision is being looked at
  contentWidth: initialContentWidth(),
  setContentWidth: (value) => { const width = Math.min(CONTENT_MAX, Math.max(CONTENT_MIN, Math.round(value))); try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ } set({ contentWidth: width }); },
  pageSections: {},        // { [pageId]: ['Hero title', ...] } what each page shows now
  lastRequest: null,       // the last regeneration that was sent, so a failed one can be retried
  versionsOpen: false,
  versionHistory: { entries: [], versions: [], dirty: false, loaded: false, loading: false, error: null, filter: 'all' },
  branches: [],
  compareState: null,      // { status: 'loading' | 'ready' | 'error', comparison, error, mode: 'site' | 'page' }
  createStep: '',          // what the creation dialog is doing right now (for example "Uploading photos (2/3)")
  drafts: {},              // { [pageId]: instruction text } so what was typed survives moving between pages
  setDraft: (pageId, text) => set((state) => ({ drafts: { ...state.drafts, [pageId]: text } })),
  images: [],              // the site's picture library
  imagesLoaded: false,
  imagesError: null,
  uploads: [],             // [{ key, name, size, preview, status: 'queued' | 'uploading' | 'done' | 'error', progress, error, imageId, reused }]
  selection: {},           // { [pageId]: { [imageId]: { placement, note } } } pictures chosen for the next regeneration of that page
  previewKey: 0,        // bumped whenever the saved site changed, so the preview reloads
  toast: null,          // { type: 'success' | 'error' | 'info', message }
  busy: {},             // { [action]: true } while a request runs

  flash: (type, message) => {
    clearTimeout(toastTimer);
    set({ toast: { type, message } });
    toastTimer = setTimeout(() => set({ toast: null }), type === 'error' ? 7000 : 3500);
  },
  dismissToast: () => { clearTimeout(toastTimer); set({ toast: null }); },
  setBusy: (key, value) => set((state) => ({ busy: { ...state.busy, [key]: value } })),

  /* ------------------------------------------------ sites ------------------------------------------------ */

  init: async () => {
    await get().loadSites();
    const { siteId } = remembered();
    const { sites } = get();
    const target = sites.find((item) => item.id === siteId) || sites[0];
    if (target) await get().selectSite(target.id, { restore: true });
  },

  loadSites: async () => {
    try {
      const res = await templateSiteService.listSites();
      set({ sites: res.data.sites, sitesLoaded: true, sitesError: null });
    } catch (error) {
      set({ sitesLoaded: true, sitesError: apiMessage(error, 'Your sites could not be loaded.') });
    }
  },

  selectSite: async (siteId, { restore = false } = {}) => {
    if (!siteId) return;
    get().stopPolling();
    set({ versionsOpen: false, compareState: null, branches: [], versionHistory: { entries: [], versions: [], dirty: false, loaded: false, loading: false, error: null, filter: 'all' }, activeSiteId: siteId, siteLoading: true, siteError: null, job: null, jobPageId: null, revisions: [], revisionPreview: null, images: [], imagesLoaded: false, imagesError: null, uploads: [] });
    uploadRun = null;
    try {
      const res = await templateSiteService.getSite(siteId);
      if (get().activeSiteId !== siteId) return;
      const { site, pages, activeJob } = res.data;
      const saved = restore ? remembered() : {};
      const pick = pages.find((page) => page.id === saved.pageId) || pages.find((page) => page.id === site.lastPageId) || pages[0] || null;
      set({ site, pages, activePageId: pick?.id || null, siteLoading: false, job: activeJob || null, jobPageId: activeJob?.pageId || null, previewKey: get().previewKey + 1 });
      remember(get());
      if (pick) { get().loadRevisions(pick.id); get().loadSections(pick.id); }
      get().loadImages();
      if (activeJob && !TERMINAL.includes(activeJob.status)) get().followJob(activeJob.id);
    } catch (error) {
      if (get().activeSiteId !== siteId) return;
      const gone = [403, 404].includes(error?.response?.status);
      if (gone) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
      set({ siteLoading: false, siteError: gone ? 'This site no longer exists or is not yours.' : apiMessage(error, 'The site could not be opened.'), site: null, pages: [], activePageId: null, ...(gone ? { activeSiteId: null } : {}) });
      if (gone) get().loadSites();
    }
  },

  createSite: async ({ templateId, templateVersion, name, description, brief, theme, photos = [] }) => {
    get().setBusy('createSite', true);
    set({ createStep: '' });
    try {
      const res = await templateSiteService.createSite({ templateId, templateVersion, name, description, theme: theme || undefined, idempotencyKey: `site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
      await get().loadSites();
      await get().selectSite(res.data.site.id);
      get().flash('success', `${res.data.site.name} was created from the template.`);
      // Photos added in the creation dialog are uploaded to the new site first; the website generation then places them on their pages.
      const used = photos.length ? await get().uploadCreationPhotos(res.data.site.id, photos) : [];
      if (brief && brief.trim()) await get().generateSite(brief.trim(), used);
      return res.data.site;
    } catch (error) {
      get().flash('error', apiMessage(error, 'The site could not be created.'));
      return null;
    } finally { set({ createStep: '' }); get().setBusy('createSite', false); }
  },

  /** Uploads the photos chosen while creating a site, one after another (they share the site's files). Returns [{ path, placement, note }] for those that arrived. */
  uploadCreationPhotos: async (siteId, photos) => {
    const used = [];
    let failed = 0;
    for (let index = 0; index < photos.length; index += 1) {
      set({ createStep: `Uploading photos (${index + 1}/${photos.length})` });
      try {
        const res = await templateSiteService.uploadPhoto(siteId, photos[index].file);
        used.push({ path: res.data.photo.path, placement: photos[index].placement || '', note: photos[index].note || '' });
      } catch { failed += 1; }
    }
    if (failed) get().flash('error', failed === photos.length ? 'The photos could not be uploaded. You can add them later in the Content panel.' : `${failed} photo${failed === 1 ? '' : 's'} could not be uploaded.`);
    get().loadImages();
    return used;
  },

  renameSite: async (siteId, name) => {
    try {
      await templateSiteService.renameSite(siteId, { name });
      await get().loadSites();
      if (get().activeSiteId === siteId) set((state) => ({ site: state.site ? { ...state.site, name } : state.site }));
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The site could not be renamed.')); return false; }
  },

  deleteSite: async (siteId) => {
    try {
      await templateSiteService.deleteSite(siteId);
      if (get().activeSiteId === siteId) {
        get().stopPolling();
        set({ activeSiteId: null, site: null, pages: [], activePageId: null, job: null, revisions: [] });
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
      await get().loadSites();
      const next = get().sites[0];
      if (next && !get().activeSiteId) await get().selectSite(next.id);
      get().flash('success', 'The site was deleted.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The site could not be deleted.')); return false; }
  },

  /* ------------------------------------------------ pages ------------------------------------------------ */

  refreshPages: async () => {
    const siteId = get().activeSiteId;
    if (!siteId) return;
    const res = await templateSiteService.getSite(siteId);
    if (get().activeSiteId !== siteId) return;
    set((state) => ({ site: res.data.site, pages: res.data.pages, activePageId: res.data.pages.some((page) => page.id === state.activePageId) ? state.activePageId : (res.data.pages[0]?.id || null) }));
    remember(get());
  },

  selectPage: (pageId) => {
    if (get().activePageId === pageId) return;
    set({ activePageId: pageId, revisions: [], revisionPreview: null });
    remember(get());
    const siteId = get().activeSiteId;
    if (siteId) get().loadSections(pageId); // also lets the server remember the last page
    get().loadRevisions(pageId);
  },

  addPage: async ({ name, description }) => {
    const siteId = get().activeSiteId;
    get().setBusy('addPage', true);
    try {
      const res = await templateSiteService.addPage(siteId, { name, description });
      await get().refreshPages();
      get().selectPage(res.data.page.id);
      set((state) => ({ previewKey: state.previewKey + 1 }));
      get().flash('success', `${res.data.page.name} was added at ${res.data.page.route}.`);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be added.')); return false; }
    finally { get().setBusy('addPage', false); }
  },

  renamePage: async (pageId, { name, route }) => {
    const siteId = get().activeSiteId;
    try {
      await templateSiteService.updatePage(siteId, pageId, { name, ...(route ? { route } : {}) });
      await get().refreshPages();
      set((state) => ({ previewKey: state.previewKey + 1 }));
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be renamed.')); return false; }
  },

  deletePage: async (pageId) => {
    const siteId = get().activeSiteId;
    try {
      await templateSiteService.deletePage(siteId, pageId);
      const wasActive = get().activePageId === pageId;
      await get().refreshPages();
      if (wasActive) { const first = get().pages[0]; set({ activePageId: first?.id || null, revisions: [] }); remember(get()); if (first) get().loadRevisions(first.id); }
      set((state) => ({ previewKey: state.previewKey + 1 }));
      get().flash('success', 'The page was deleted and its links were removed.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be deleted.')); return false; }
  },

  reorderPages: async (orderedIds) => {
    const siteId = get().activeSiteId;
    const before = get().pages;
    const byId = new Map(before.map((page) => [page.id, page]));
    set({ pages: orderedIds.map((id, index) => ({ ...byId.get(id), order: index })) });  // optimistic
    try {
      const res = await templateSiteService.reorderPages(siteId, orderedIds);
      set({ pages: res.data.pages, previewKey: get().previewKey + 1 });
    } catch (error) {
      set({ pages: before });
      get().flash('error', apiMessage(error, 'The pages could not be reordered.'));
    }
  },

  /* ------------------------------------------------ generation ------------------------------------------------ */

  regenerate: async (instruction, attachments = []) => {
    const { activeSiteId: siteId, activePageId: pageId } = get();
    if (!siteId || !pageId) return false;
    get().setBusy('regenerate', true);
    try {
      const res = await templateSiteService.regeneratePage(siteId, pageId, { instruction, attachments, idempotencyKey: `regen-${pageId}-${Date.now()}` });
      set((state) => ({ lastRequest: { pageId, instruction, attachments }, job: res.data.job, jobPageId: pageId, pages: state.pages.map((page) => (page.id === pageId ? { ...page, status: 'generating', lastError: null } : page)) }));
      get().followJob(res.data.job.id);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be regenerated.')); return false; }
    finally { get().setBusy('regenerate', false); }
  },

  generateSite: async (brief, photos = []) => {
    const siteId = get().activeSiteId;
    get().setBusy('generateSite', true);
    try {
      const res = await templateSiteService.generateSite(siteId, { brief, photos, idempotencyKey: `gen-${siteId}-${Date.now()}` });
      set((state) => ({ job: res.data.job, jobPageId: null, site: state.site ? { ...state.site, brief: brief || state.site.brief } : state.site }));
      await get().refreshPages().catch(() => {});
      get().followJob(res.data.job.id);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The website could not be generated.')); return false; }
    finally { get().setBusy('generateSite', false); }
  },

  /** Writes one page again from the website description and the page's purpose (used for a failed page or one that needs review). */
  retryPage: async (pageId) => {
    const siteId = get().activeSiteId;
    get().setBusy(`retry:${pageId}`, true);
    try {
      const res = await templateSiteService.retryPage(siteId, pageId);
      set({ job: res.data.job, jobPageId: pageId });
      await get().refreshPages().catch(() => {});
      get().followJob(res.data.job.id);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be generated again.')); return false; }
    finally { get().setBusy(`retry:${pageId}`, false); }
  },

  cancelJob: async () => {
    const job = get().job;
    if (!job) return;
    try {
      const res = await templateSiteService.cancelJob(job.id);
      set({ job: res.data.job });
      get().stopPolling();
      await get().refreshPages();
      get().flash('info', 'The generation was cancelled. Nothing was changed.');
    } catch (error) { get().flash('error', apiMessage(error, 'The job could not be cancelled.')); }
  },

  stopPolling: () => { pollRun += 1; },

  /** Follows a job until it ends. Survives short network errors; stops for good when the job is gone or no longer yours. */
  followJob: async (jobId) => {
    pollRun += 1;
    const run = pollRun;
    let failures = 0;
    let permanent = 0;
    let lastSignature = null;
    for (;;) {
      if (run !== pollRun) return;
      try {
        const res = await templateSiteService.getJob(jobId);
        if (run !== pollRun) return;
        failures = 0; permanent = 0;
        const job = res.data?.job;
        if (!job) throw new Error('The server answered without a job.');
        set({ job });
        // Whole-website generation: when another page is saved (or fails), show it: new statuses, and the preview reloads with that page.
        const signature = (job.plan || []).map((entry) => entry.state).join(',');
        if (job.type === 'site-customize' && signature !== lastSignature) {
          const savedBefore = (lastSignature || '').split(',').filter((value) => value === 'completed').length;
          lastSignature = signature;
          await get().refreshPages().catch(() => {});
          refreshCredits(); // pages are charged as they are saved
          if ((job.plan || []).filter((entry) => entry.state === 'completed').length > savedBefore) {
            set((state) => ({ previewKey: state.previewKey + 1 }));
            const pageId = get().activePageId;
            if (pageId) { get().loadRevisions(pageId); get().loadSections(pageId); }
          }
        }
        if (TERMINAL.includes(job.status)) { await get().jobFinished(job); return; }
        set((state) => (job.pageId ? { pages: state.pages.map((page) => (page.id === job.pageId && page.status !== 'generating' ? { ...page, status: 'generating' } : page)) } : {}));
      } catch (error) {
        if (run !== pollRun) return;
        failures += 1;
        if ([401, 403, 404].includes(error?.response?.status)) permanent += 1;
        if (permanent >= 2) { get().flash('error', 'This generation can no longer be followed (it no longer exists or is not yours).'); set({ job: null }); await get().refreshPages().catch(() => {}); return; }
        if (failures >= 12) { get().flash('error', 'Lost contact with the server. Refresh the page to see how the generation ended.'); return; }
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1500 * (failures + 1))));
    }
  },

  jobFinished: async (job) => {
    refreshCredits();
    await get().refreshPages().catch(() => {});
    if (job.status === 'completed') {
      // The instruction is cleared only now, after the backend confirmed the page was saved, and only for the page the job belonged to:
      // the text must still be exactly what was submitted (a different or edited text on that page is the user's new work).
      if (job.type === 'page-regenerate' && job.pageId) {
        set((state) => (String(state.drafts[job.pageId] || '').trim() === String(job.instruction || '').trim() && state.drafts[job.pageId] ? { drafts: { ...state.drafts, [job.pageId]: '' } } : {}));
      }
      set((state) => ({ previewKey: state.previewKey + 1 }));
      const pageId = job.pageId || get().activePageId;
      if (pageId && pageId === get().activePageId) { get().loadRevisions(pageId); get().loadSections(pageId); }
      get().loadImages();
      if (job.pageId) get().flash('success', 'The page was regenerated and saved.');
      else if (job.result?.needsAttention) get().flash('info', `Website generated: ${job.result.completed} of ${job.result.total} pages are ready. ${job.result.needsAttention} need${job.result.needsAttention === 1 ? 's' : ''} attention${job.result.images && (job.result.images.failed || job.result.images.skipped) ? ` (${job.result.images.failed + job.result.images.skipped} picture${job.result.images.failed + job.result.images.skipped === 1 ? '' : 's'} could not be made)` : ''}.`);
      else get().flash('success', `Your website is ready: all ${job.result?.total || ''} pages were generated.`.replace('all  pages', 'all pages'));
    } else if (job.status === 'failed') {
      get().flash('error', job.error || 'The generation failed. The page was not changed.');
    }
  },

  /* ------------------------------------------------ revisions ------------------------------------------------ */

  loadRevisions: async (pageId) => {
    const siteId = get().activeSiteId;
    if (!siteId || !pageId) return;
    set({ revisionsLoading: true });
    try {
      const res = await templateSiteService.listRevisions(siteId, pageId);
      if (get().activePageId === pageId) set({ revisions: res.data.revisions, revisionsLoading: false });
    } catch { if (get().activePageId === pageId) set({ revisionsLoading: false }); }
  },

  loadSections: async (pageId) => {
    const siteId = get().activeSiteId;
    if (!siteId || !pageId) return;
    try {
      const res = await templateSiteService.getPage(siteId, pageId);
      set((state) => ({ pageSections: { ...state.pageSections, [pageId]: res.data.page.sections || [] } }));
    } catch { /* the list is a nicety; the page works without it */ }
  },

  /** Shows an older revision in the preview (read-only; nothing is saved). */
  previewRevision: async (number) => {
    const { activeSiteId: siteId, activePageId: pageId } = get();
    if (!siteId || !pageId) return;
    set({ revisionPreview: { number, status: 'loading', html: '', token: null, route: '/', error: null } });
    try {
      const res = await templateSiteService.previewRevision(siteId, pageId, number);
      if (get().activePageId !== pageId || get().revisionPreview?.number !== number) return;
      const { html, token, route } = res.data.preview;
      set({ revisionPreview: { number, status: 'ready', html, token, route, error: null } });
    } catch (error) {
      if (get().revisionPreview?.number !== number) return;
      set({ revisionPreview: { number, status: 'error', html: '', token: null, route: '/', error: apiMessage(error, 'This revision could not be previewed.') } });
    }
  },
  closeRevisionPreview: () => set({ revisionPreview: null }),

  restoreRevision: async (number) => {
    const { activeSiteId: siteId, activePageId: pageId } = get();
    get().setBusy('restore', true);
    try {
      const res = await templateSiteService.restoreRevision(siteId, pageId, number);
      await get().refreshPages();
      await get().loadRevisions(pageId);
      set((state) => ({ previewKey: state.previewKey + 1, revisionPreview: null }));
      get().flash('success', res.data.unchanged ? `Revision ${number} is already what the page shows.` : `Revision ${number} was restored.`);
    } catch (error) { get().flash('error', apiMessage(error, 'The revision could not be restored.')); }
    finally { get().setBusy('restore', false); }
  },
  /* ------------------------------------------------ website versions, branches, comparison ------------------------------------------------ */

  openVersions: () => { set({ versionsOpen: true }); get().loadVersionHistory(get().versionHistory.filter); get().loadBranches(); },
  closeVersions: () => set({ versionsOpen: false, compareState: null }),

  loadVersionHistory: async (filter = 'all') => {
    const siteId = get().activeSiteId;
    if (!siteId) return;
    set((state) => ({ versionHistory: { ...state.versionHistory, filter, loading: true, error: null } }));
    try {
      const [history, list] = await Promise.all([templateSiteService.history(siteId, filter), templateSiteService.listVersions(siteId, 'all')]);
      if (get().activeSiteId !== siteId) return;
      set({ versionHistory: { entries: history.data.entries, versions: list.data.versions, dirty: list.data.dirty, loaded: true, loading: false, error: null, filter } });
    } catch (error) {
      if (get().activeSiteId === siteId) set((state) => ({ versionHistory: { ...state.versionHistory, loading: false, loaded: true, error: apiMessage(error, 'The version history could not be loaded.') } }));
    }
  },

  loadBranches: async () => {
    const siteId = get().activeSiteId;
    if (!siteId || get().site?.branchOf) { set({ branches: [] }); return; }
    try { const res = await templateSiteService.listBranches(siteId); if (get().activeSiteId === siteId) set({ branches: res.data.branches }); } catch { /* the list is optional */ }
  },

  /** Saves the website as it is now as a named version (always a new one, so it is a deliberate checkpoint). */
  saveVersion: async ({ name, description, protected: protect }) => {
    const siteId = get().activeSiteId;
    get().setBusy('saveVersion', true);
    try {
      await templateSiteService.saveVersion(siteId, { name, description, protected: protect });
      await get().loadVersionHistory(get().versionHistory.filter);
      get().flash('success', 'The version was saved.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The version could not be saved.')); return false; }
    finally { get().setBusy('saveVersion', false); }
  },

  updateVersion: async (versionId, patch) => {
    try { await templateSiteService.updateVersion(get().activeSiteId, versionId, patch); await get().loadVersionHistory(get().versionHistory.filter); return true; }
    catch (error) { get().flash('error', apiMessage(error, 'The version could not be updated.')); return false; }
  },

  deleteVersion: async (versionId) => {
    get().setBusy(`version:${versionId}`, true);
    try { await templateSiteService.deleteVersion(get().activeSiteId, versionId); await get().loadVersionHistory(get().versionHistory.filter); get().flash('success', 'The version was deleted.'); return true; }
    catch (error) { get().flash('error', apiMessage(error, 'The version could not be deleted.')); return false; }
    finally { get().setBusy(`version:${versionId}`, false); }
  },

  verifyVersion: async (versionId) => {
    try { return (await templateSiteService.verifyVersion(get().activeSiteId, versionId)).data; }
    catch (error) { get().flash('error', apiMessage(error, 'The version could not be checked.')); return null; }
  },

  /** Brings an earlier website version back. Nothing is deleted: the restore is saved as a new version. */
  restoreVersion: async (versionId) => {
    const siteId = get().activeSiteId;
    get().setBusy(`version:${versionId}`, true);
    try {
      const res = await templateSiteService.restoreVersion(siteId, versionId);
      set({ revisionPreview: null });
      await get().refreshPages();
      const pageId = get().activePageId;
      if (pageId) { get().loadRevisions(pageId); get().loadSections(pageId); }
      get().loadImages();
      set((state) => ({ previewKey: state.previewKey + 1 }));
      await get().loadVersionHistory(get().versionHistory.filter);
      get().flash(res.data.unchanged ? 'info' : 'success', res.data.unchanged ? 'The website already is exactly that version.' : `Version ${res.data.restoredFrom.number} was restored. Your newer versions are kept.`);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The version could not be restored. Your website was not changed.')); return false; }
    finally { get().setBusy(`version:${versionId}`, false); }
  },

  /** Shows a saved version in the preview (read-only; nothing is changed). */
  previewVersion: async (versionId, label = '') => {
    const siteId = get().activeSiteId;
    set({ revisionPreview: { kind: 'version', versionId, number: label || 'version', label, status: 'loading', html: '', token: null, route: '/', error: null } });
    try {
      const res = await templateSiteService.previewVersion(siteId, versionId);
      if (get().revisionPreview?.versionId !== versionId) return;
      const { html, token, route, number, name } = res.data.preview;
      set({ revisionPreview: { kind: 'version', versionId, number, label: name, status: 'ready', html, token, route, error: null } });
    } catch (error) {
      if (get().revisionPreview?.versionId !== versionId) return;
      set({ revisionPreview: { kind: 'version', versionId, number: label, label, status: 'error', html: '', token: null, route: '/', error: apiMessage(error, 'This version could not be previewed.') } });
    }
  },

  /** a and b: { siteId, id } where id is a version id or 'current'. */
  compareVersions: async (a, b) => {
    set({ compareState: { status: 'loading', comparison: null, error: null, mode: 'site' } });
    try {
      const res = await templateSiteService.compareVersions(a.siteId, { a: a.id, b: b.id, aSite: a.siteId, bSite: b.siteId });
      set({ compareState: { status: 'ready', comparison: res.data.comparison, error: null, mode: 'site' } });
    } catch (error) { set({ compareState: { status: 'error', comparison: null, error: apiMessage(error, 'The versions could not be compared.'), mode: 'site' } }); }
  },

  comparePage: async (pageId, number) => {
    set({ compareState: { status: 'loading', comparison: null, error: null, mode: 'page' } });
    try {
      const res = await templateSiteService.comparePageRevision(get().activeSiteId, pageId, number);
      set({ compareState: { status: 'ready', comparison: res.data.comparison, error: null, mode: 'page' } });
    } catch (error) { set({ compareState: { status: 'error', comparison: null, error: apiMessage(error, 'The revision could not be compared.'), mode: 'page' } }); }
  },
  closeCompare: () => set({ compareState: null }),

  /** Restores one page to an earlier revision of that page (the page-level history). */
  restorePageRevision: async (pageId, number) => {
    const siteId = get().activeSiteId;
    get().setBusy('restore', true);
    try {
      const res = await templateSiteService.restoreRevision(siteId, pageId, number);
      await get().refreshPages();
      if (get().activePageId === pageId) get().loadRevisions(pageId);
      set((state) => ({ previewKey: state.previewKey + 1 }));
      await get().loadVersionHistory(get().versionHistory.filter);
      get().flash('success', res.data.unchanged ? `Revision ${number} is already what the page shows.` : `Revision ${number} was restored.`);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The revision could not be restored.')); return false; }
    finally { get().setBusy('restore', false); }
  },

  createBranch: async (versionId, name) => {
    const siteId = get().activeSiteId;
    get().setBusy('branch', true);
    try {
      const res = await templateSiteService.createBranch(siteId, versionId, name);
      await get().loadSites();
      await get().loadBranches();
      get().flash('success', `The branch "${name}" was created. Main stays unchanged while you edit it.`);
      return res.data.site;
    } catch (error) { get().flash('error', apiMessage(error, 'The branch could not be created.')); return null; }
    finally { get().setBusy('branch', false); }
  },

  promoteBranch: async (branchSiteId) => {
    get().setBusy('promote', true);
    try {
      const res = await templateSiteService.promoteBranch(branchSiteId);
      await get().loadSites();
      get().flash(res.data.unchanged ? 'info' : 'success', res.data.unchanged ? 'Main already matches this branch.' : 'The branch was promoted. Main has a new version; its older versions are kept.');
      return res.data.mainSiteId;
    } catch (error) { get().flash('error', apiMessage(error, 'The branch could not be promoted.')); return null; }
    finally { get().setBusy('promote', false); }
  },

  /* ------------------------------------------------ pictures ------------------------------------------------ */

  loadImages: async () => {
    const siteId = get().activeSiteId;
    if (!siteId) return;
    try {
      const res = await templateSiteService.listImages(siteId);
      if (get().activeSiteId !== siteId) return;
      set((state) => {
        // A picture removed in the meantime cannot stay selected.
        const ids = new Set(res.data.images.map((image) => image.id));
        const selection = Object.fromEntries(Object.entries(state.selection).map(([pageId, chosen]) => [pageId, Object.fromEntries(Object.entries(chosen).filter(([id]) => ids.has(id)))]));
        return { images: res.data.images, imagesLoaded: true, imagesError: null, selection };
      });
    } catch (error) {
      if (get().activeSiteId === siteId) set({ imagesError: apiMessage(error, 'The pictures could not be loaded.'), imagesLoaded: true });
    }
  },

  /** Checks the chosen files, queues them and uploads them one after another (several at once would race on the site's files). */
  uploadFiles: (fileList) => {
    const siteId = get().activeSiteId;
    const files = Array.from(fileList || []);
    if (!siteId || !files.length) return;
    const known = new Set(get().uploads.filter((item) => item.status === 'queued' || item.status === 'uploading').map((item) => item.key));
    const added = [];
    let skipped = 0;
    for (const file of files) {
      const key = fileKey(file);
      if (known.has(key)) { skipped += 1; continue; }      // the same file picked twice
      known.add(key);
      const problem = !PHOTO_TYPES.includes(file.type) ? 'Use a PNG, JPEG, WebP, GIF or AVIF picture.' : file.size > MAX_PHOTO_BYTES ? 'The picture is larger than 8 MB.' : file.size === 0 ? 'The file is empty.' : null;
      added.push({ key, id: `${key}:${Date.now()}`, file, name: file.name, size: file.size, preview: problem ? '' : URL.createObjectURL(file), status: problem ? 'error' : 'queued', progress: 0, error: problem, imageId: null, reused: false });
    }
    if (skipped) get().flash('info', skipped === 1 ? 'That picture is already being uploaded.' : `${skipped} pictures were already being uploaded.`);
    if (!added.length) return;
    set((state) => ({ uploads: [...state.uploads.filter((item) => !added.some((entry) => entry.key === item.key)), ...added] }));
    get().runUploads(siteId);
  },

  runUploads: async (siteId) => {
    if (uploadRun) return;
    uploadRun = siteId;
    const patch = (id, change) => set((state) => ({ uploads: state.uploads.map((item) => (item.id === id ? { ...item, ...change } : item)) }));
    try {
      for (;;) {
        if (get().activeSiteId !== siteId) return;
        const next = get().uploads.find((item) => item.status === 'queued');
        if (!next) break;
        patch(next.id, { status: 'uploading', progress: 0 });
        try {
          const res = await templateSiteService.uploadPhoto(siteId, next.file, { pageId: get().activePageId, onProgress: (value) => patch(next.id, { progress: value }) });
          const photo = res.data.photo;
          patch(next.id, { status: 'done', progress: 1, imageId: photo.id, reused: Boolean(photo.reused) });
          set((state) => ({ images: state.images.some((image) => image.id === photo.id) ? state.images.map((image) => (image.id === photo.id ? photo : image)) : [photo, ...state.images] }));
          // The new picture is ready to use on the page it was added from.
          const pageId = get().activePageId;
          if (pageId) get().toggleImage(photo.id, true);
          if (photo.reused) get().flash('info', `"${photo.name}" is already in the library. It was not uploaded twice.`);
        } catch (error) {
          patch(next.id, { status: 'error', error: apiMessage(error, 'The upload failed. Check your connection and try again.') });
        }
      }
    } finally { uploadRun = null; }
    get().loadImages();
    // Descriptions are written a few seconds after the upload; pick them up.
    get().watchCaptions();
  },

  retryUpload: (id) => { set((state) => ({ uploads: state.uploads.map((item) => (item.id === id && item.file ? { ...item, status: 'queued', error: null, progress: 0 } : item)) })); const siteId = get().activeSiteId; if (siteId) get().runUploads(siteId); },
  dismissUpload: (id) => set((state) => { const gone = state.uploads.find((item) => item.id === id); if (gone?.preview) URL.revokeObjectURL(gone.preview); return { uploads: state.uploads.filter((item) => item.id !== id) }; }),
  clearFinishedUploads: () => set((state) => { state.uploads.filter((item) => item.status === 'done').forEach((item) => item.preview && URL.revokeObjectURL(item.preview)); return { uploads: state.uploads.filter((item) => item.status !== 'done') }; }),

  // Descriptions and AI enhancements finish a little after the upload; follow them without blocking anything else.
  watchCaptions: async () => {
    if (watching) return;
    watching = true;
    try {
      for (let round = 0; round < 120; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await get().loadImages();
        const working = get().images.some((image) => image.captionStatus === 'pending' || image.enhancement?.active);
        const uploading = get().uploads.some((item) => item.status === 'queued' || item.status === 'uploading');
        if (!working && !uploading) { refreshCredits(); return; }
      }
    } finally { watching = false; }
  },

  enhanceImage: async (imageId) => {
    const siteId = get().activeSiteId;
    get().setBusy(`enhance:${imageId}`, true);
    try {
      const res = await templateSiteService.enhanceImage(siteId, imageId);
      set((state) => ({ images: state.images.map((image) => (image.id === imageId ? { ...image, ...res.data.image } : image)) }));
      get().watchCaptions();
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The enhancement could not be started.')); get().loadImages(); return false; }
    finally { get().setBusy(`enhance:${imageId}`, false); }
  },

  /** Use the enhanced photo or keep the original. Pages that show the photo are switched (saved as a revision); nothing is regenerated. */
  chooseEnhancement: async (imageId, choice) => {
    const siteId = get().activeSiteId;
    get().setBusy(`choose:${imageId}`, true);
    try {
      const res = await templateSiteService.chooseEnhancement(siteId, imageId, choice);
      set((state) => ({ images: state.images.map((image) => (image.id === imageId ? { ...image, ...res.data.photo } : image)) }));
      await get().loadImages();
      if (res.data.pages?.length) {
        await get().refreshPages().catch(() => {});
        const pageId = get().activePageId;
        if (pageId) get().loadRevisions(pageId);
        set((state) => ({ previewKey: state.previewKey + 1 }));
      }
      get().flash('success', choice === 'enhanced'
        ? (res.data.pages?.length ? 'The enhanced photo is now on your page. The original is kept.' : 'The enhanced photo will be used on your pages. The original is kept.')
        : (res.data.pages?.length ? 'Your original photo is back on the page.' : 'Keeping your original photo.'));
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'That choice could not be saved.')); return false; }
    finally { get().setBusy(`choose:${imageId}`, false); }
  },

  toggleImage: (imageId, on) => {
    const pageId = get().activePageId;
    if (!pageId) return;
    set((state) => {
      const chosen = { ...(state.selection[pageId] || {}) };
      const image = state.images.find((item) => item.id === imageId);
      if (on === false || (on === undefined && chosen[imageId])) delete chosen[imageId];
      else if (Object.keys(chosen).length >= MAX_ATTACH && !chosen[imageId]) { setTimeout(() => get().flash('error', `You can use up to ${MAX_ATTACH} photos in one regeneration.`), 0); return {}; }
      else chosen[imageId] = chosen[imageId] || { placement: image?.placement || '', note: image?.note || '' };
      return { selection: { ...state.selection, [pageId]: chosen } };
    });
  },
  setImageChoice: (imageId, change) => {
    const pageId = get().activePageId;
    if (!pageId) return;
    set((state) => ({ selection: { ...state.selection, [pageId]: { ...(state.selection[pageId] || {}), [imageId]: { ...(state.selection[pageId]?.[imageId] || { placement: '', note: '' }), ...change } } } }));
  },
  clearSelection: () => { const pageId = get().activePageId; if (pageId) set((state) => ({ selection: { ...state.selection, [pageId]: {} } })); },

  updateImage: async (imageId, data) => {
    const siteId = get().activeSiteId;
    try {
      const res = await templateSiteService.updateImage(siteId, imageId, data);
      set((state) => ({ images: state.images.map((image) => (image.id === imageId ? res.data.image : image)) }));
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The picture could not be saved.')); return false; }
  },

  removeImage: async (imageId) => {
    const siteId = get().activeSiteId;
    get().setBusy(`image:${imageId}`, true);
    try {
      const res = await templateSiteService.deleteImage(siteId, imageId);
      set((state) => ({ images: state.images.filter((image) => image.id !== imageId), selection: Object.fromEntries(Object.entries(state.selection).map(([pageId, chosen]) => [pageId, Object.fromEntries(Object.entries(chosen).filter(([id]) => id !== imageId))])) }));
      get().flash('success', res.data.stillShownOn?.length || res.data.stillShownElsewhere ? 'Removed from the library. Pages that already show it keep it until you change them.' : 'The picture was removed from the library.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The picture could not be removed.')); return false; }
    finally { get().setBusy(`image:${imageId}`, false); }
  },

  replaceImage: async (imageId, file, onProgress) => {
    const siteId = get().activeSiteId;
    if (!PHOTO_TYPES.includes(file.type)) { get().flash('error', 'Use a PNG, JPEG, WebP, GIF or AVIF picture.'); return null; }
    if (file.size > MAX_PHOTO_BYTES) { get().flash('error', 'The picture is larger than 8 MB.'); return null; }
    get().setBusy(`image:${imageId}`, true);
    try {
      const res = await templateSiteService.replaceImage(siteId, imageId, file, { onProgress });
      await get().loadImages();
      await get().refreshPages().catch(() => {});
      const pageId = get().activePageId;
      if (pageId) get().loadRevisions(pageId);
      set((state) => {
        const selection = { ...state.selection };
        for (const [page, chosen] of Object.entries(selection)) if (chosen[imageId]) { const { [imageId]: old, ...rest } = chosen; selection[page] = { ...rest, [res.data.photo.id]: old }; }
        return { selection, previewKey: res.data.replaced ? state.previewKey + 1 : state.previewKey };
      });
      get().flash('success', res.data.replaced ? (res.data.pages.length ? 'The picture was replaced on the pages that showed it. Each change is saved as a revision.' : 'The picture was replaced in the library.') : 'That is the same picture, so nothing changed.');
      return res.data.photo;
    } catch (error) { get().flash('error', apiMessage(error, 'The picture could not be replaced.')); return null; }
    finally { get().setBusy(`image:${imageId}`, false); }
  }
}));
