import { collaborationService } from '../services/collaborationService';
import { create } from 'zustand';
import { templateSiteService, apiMessage, calmMessage } from '../services/templateSiteService';
import { validatePhotoFile, isVideoFile, isNetworkFailure, normalizeSections } from '../features/template-studio/panelLogic';
import { useBillingStore } from './billingStore';

// Template work spends the same credits as every other AI task: the balance shown in the app is re-read whenever it may have changed.
const refreshCredits = () => { try { useBillingStore.getState().refreshOverview(); } catch { /* best effort */ } };

const STORAGE_KEY = 'veave_template_studio';
const TERMINAL = ['completed', 'failed', 'cancelled'];

const remember = (state) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ siteId: state.activeSiteId, pageId: state.activePageId })); } catch { /* storage may be unavailable */ }
};
// What was typed (page instructions and the notes on chosen pictures) survives a refresh; kept per site.
const WORK_KEY = (siteId) => `veave_studio_work_${siteId}`;
const loadWork = (siteId) => { try { const saved = JSON.parse(localStorage.getItem(WORK_KEY(siteId)) || '{}') || {}; return { drafts: saved.drafts || {}, selection: saved.selection || {} }; } catch { return { drafts: {}, selection: {} }; } };
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
// What the page panel, the library and the section pop-up accept: pictures, and MP4 / WebM videos that play behind a section.
export const MEDIA_TYPES = [...PHOTO_TYPES, 'video/mp4', 'video/webm'];
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
let uploadAbort = null; // aborts the upload that is running (when its row is dismissed or the site changes)
const sectionRequests = new Map(); // `${siteId}:${pageId}` -> the request in flight
const sectionTickets = new Map();  // the newest request number per page; older answers are ignored
let sectionTicket = 0;
let watching = false;

// How the owner arranged the workspace (folded columns, preview device, ticked sections, scroll): kept across a page refresh.
const UI_KEY = 'veave_template_studio_ui';
export const readUi = () => { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; } };
export const writeUi = (patch) => { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch { /* storage may be unavailable */ } };

const COLLAPSE_KEY = 'veave_template_studio_sites_collapsed';
const initialCollapsed = () => {
  try { const saved = localStorage.getItem(COLLAPSE_KEY); if (saved !== null) return saved === '1'; } catch { /* ignore */ }
  // On smaller screens the website gets the room by default.
  return typeof window !== 'undefined' && window.innerWidth < 1500;
};

let textSaveTimer = null;

// What the owner typed, as opposed to what is sent: the studio adds "In section 02 ("Name"): " in front and the page / section context
// behind the typed text. Both sides are reduced to the typed words (spacing ignored) before they are compared.
const norm = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const CONTEXT_MARK = /\n\n(?:PAGE CONTEXT|SECTION(?: \d+)? CONTENT|\(The owner|This applies to the text)/;
const SENT_LEAD = /^In section \d+ \("[^"]*"\)(?:(?:, | and )section \d+ \("[^"]*"\))*: /;
const DRAFT_LEAD = /^Sections? \d{2,3}(?:, \d{2,3})*: /;
export const typedPartOf = (sent) => { const text = String(sent || ''); const at = text.search(CONTEXT_MARK); return norm((at >= 0 ? text.slice(0, at) : text).replace(SENT_LEAD, '')); };
export const typedOfDraft = (draft) => norm(String(draft || '').replace(DRAFT_LEAD, ''));

export const useTemplateStudioStore = create((set, get) => ({
  // Set when a group's "New project" sent the user here: the site created next is shared with that group ({ groupId, groupName, permission, name }).
  groupLink: null,
  setGroupLink: (groupLink) => set({ groupLink }),
  sitesCollapsed: initialCollapsed(),
  setSitesCollapsed: (value) => { try { localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0'); } catch { /* ignore */ } set({ sitesCollapsed: value }); },
  pagesCollapsed: readUi().pagesCollapsed === true,
  setPagesCollapsed: (value) => { writeUi({ pagesCollapsed: Boolean(value) }); set({ pagesCollapsed: value }); },
  contentCollapsed: readUi().contentCollapsed === true,
  setContentCollapsed: (value) => { writeUi({ contentCollapsed: Boolean(value) }); set({ contentCollapsed: value }); },
  // A text clicked in the preview: { id, text (as shown now), saved (as last saved in the code), tag, status: 'idle' | 'saving' | 'saved' | 'error', error }.
  selectedText: null,
  setSelectedText: (item) => {
    // Picking another text (or none) never loses an edit that was not saved yet.
    const pending = get().selectedText;
    if (pending && pending.text.replace(/\s+/g, ' ').trim() !== pending.saved && (!item || item.id !== pending.id)) get().saveSelectedText();
    clearTimeout(textSaveTimer);
    set({ selectedText: item ? { ...item, saved: item.text, status: 'idle', error: null } : null });
  },
  // Typing in the Content column: the preview changes at once, and the code is saved shortly after typing stops.
  editSelectedText: (text) => {
    const current = get().selectedText;
    if (!current) return;
    set({ selectedText: { ...current, text, status: 'idle', error: null } });
    window.dispatchEvent(new CustomEvent('studio-text-set', { detail: { id: current.id, text } }));
    clearTimeout(textSaveTimer);
    textSaveTimer = setTimeout(() => get().saveSelectedText(), 900);
  },
  saveSelectedText: async () => {
    clearTimeout(textSaveTimer);
    const { selectedText: current, activeSiteId, activePageId } = get();
    if (!current || !activeSiteId || !activePageId) return;
    const next = current.text.replace(/\s+/g, ' ').trim();
    if (!next || next === current.saved) { if (!next) set({ selectedText: { ...current, status: 'error', error: 'The text cannot be empty.' } }); return; }
    set({ selectedText: { ...current, status: 'saving', error: null } });
    try {
      await templateSiteService.editText(activeSiteId, activePageId, { oldText: current.saved, newText: next });
      const now = get().selectedText;
      if (now && now.id === current.id) set({ selectedText: { ...now, saved: next, status: now.text.replace(/\s+/g, ' ').trim() === next ? 'saved' : 'idle' } });
    } catch (error) {
      const now = get().selectedText;
      if (now && now.id === current.id) set({ selectedText: { ...now, status: 'error', error: apiMessage(error, 'The text could not be saved.') } });
    }
  },
  appSidebarHidden: readUi().appSidebarHidden === true, // remembered across a refresh
  setAppSidebarHidden: (value) => { writeUi({ appSidebarHidden: Boolean(value) }); set({ appSidebarHidden: value }); },
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
  pageSections: {},        // { [pageId]: [{ id, name, order }] } what each page shows now (null = could not be read)
  sectionsError: {},       // { [pageId]: message }
  sectionsLoading: false,
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
  editedPageIds: {},  // { [pageId]: true } pages that have been individually edited/regenerated; once any page is edited, "Generate Entire Website" is hidden

  flash: (type, message) => {
    clearTimeout(toastTimer);
    set({ toast: { type, message: type === 'error' ? calmMessage(message) : message } });
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
    set({ versionsOpen: false, compareState: null, branches: [], versionHistory: { entries: [], versions: [], dirty: false, loaded: false, loading: false, error: null, filter: 'all' }, activeSiteId: siteId, siteLoading: true, siteError: null, job: null, jobPageId: null, revisions: [], revisionPreview: null, images: [], imagesLoaded: false, imagesError: null, uploads: [], pageSections: {}, sectionsError: {}, sectionsLoading: false, editedPageIds: {}, ...loadWork(siteId) });
    uploadAbort?.abort();
    uploadRun = null;
    try {
      const res = await templateSiteService.getSite(siteId);
      if (get().activeSiteId !== siteId) return;
      const { site, pages, activeJob } = res.data;
      const saved = restore ? remembered() : {};
      const pick = pages.find((page) => page.id === saved.pageId) || pages.find((page) => page.id === site.lastPageId) || pages[0] || null;
      let storedEdited = {};
      try { storedEdited = JSON.parse(localStorage.getItem(`veave_edited_pages_${siteId}`) || '{}') || {}; } catch {}
      const initialEdited = { ...storedEdited };
      for (const p of pages) {
        if (p.currentRevision > 1 || Boolean(p.lastInstruction) || p.generation?.state === 'completed') {
          initialEdited[p.id] = true;
        }
      }
      set({ site, pages, activePageId: pick?.id || null, siteLoading: false, job: activeJob || null, jobPageId: activeJob?.pageId || null, previewKey: get().previewKey + 1, editedPageIds: initialEdited });
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
      const link = get().groupLink;
      if (link) {
        try {
          await collaborationService.shareProject(res.data.site.projectId, { groupId: link.groupId, permission: link.permission });
          get().flash('success', `${res.data.site.name} was created and shared with ${link.groupName}.`);
        } catch (error) {
          get().flash('error', `${res.data.site.name} was created, but it could not be shared with ${link.groupName}: ${apiMessage(error, 'try sharing it from the group page')}`);
        }
        set({ groupLink: null });
      } else get().flash('success', `${res.data.site.name} was created from the template.`);
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

  themeBusy: false,
  applyTheme: async (theme) => {
    const siteId = get().activeSiteId;
    if (!siteId || get().themeBusy) return false;
    set({ themeBusy: true });
    try {
      const res = await templateSiteService.updateTheme(siteId, theme);
      set((state) => ({ site: state.site ? { ...state.site, theme: res.data.site.theme, typography: res.data.site.typography } : state.site, previewKey: state.previewKey + 1 }));
      get().flash('success', res.data.adjusted?.length ? 'Theme applied. Some text colours were adjusted so they stay readable.' : 'Theme applied.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The theme could not be applied.')); return false; }
    finally { set({ themeBusy: false }); }
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
    get().setSelectedText(null);
    set({ activePageId: pageId, revisions: [], revisionPreview: null, selectedText: null });
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

  // `typed` is what the owner wrote in the box. `instruction` is what is sent (the typed text plus the page and section context the studio
  // adds), so the two differ; the box is cleared by comparing with `typed`.
  regenerate: async (instruction, attachments = [], focusSection = '', typed = null) => {
    const { activeSiteId: siteId, activePageId: pageId } = get();
    if (!siteId || !pageId) return false;
    // A second click while the first request is on its way would start a second job (each request has its own key).
    if (get().busy?.regenerate) return false;
    get().setBusy('regenerate', true);
    try {
      const res = await templateSiteService.regeneratePage(siteId, pageId, { instruction, attachments, ...(focusSection ? { focusSection } : {}), idempotencyKey: `regen-${pageId}-${Date.now()}` });
      set((state) => ({ lastRequest: { pageId, instruction, attachments, focusSection, typed: typed === null ? null : String(typed) }, job: res.data.job, jobPageId: pageId, pages: state.pages.map((page) => (page.id === pageId ? { ...page, status: 'generating', lastError: null } : page)) }));
      get().followJob(res.data.job.id);
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The page could not be regenerated.')); return false; }
    finally { get().setBusy('regenerate', false); }
  },

  generateSite: async (brief, photos = []) => {
    const siteId = get().activeSiteId;
    if (get().busy?.generateSite) return false;
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
    if (!window.confirm('Are you sure you want to cancel this generation?')) return;
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
        // A saved single-page edit: from now on "Generate Entire Website" is hidden for this site.
        const edited = { ...get().editedPageIds, [job.pageId]: true };
        try { localStorage.setItem(`veave_edited_pages_${get().activeSiteId}`, JSON.stringify(edited)); } catch {}
        set({ editedPageIds: edited });
        // What was typed is recognised from the job itself (not from memory), so it also works after a reload or when the job was
        // already running when the page was opened.
        set((state) => {
          const draft = typedOfDraft(state.drafts[job.pageId]);
          const remembered = state.lastRequest?.pageId === job.pageId && state.lastRequest?.typed ? typedOfDraft(state.lastRequest.typed) : null;
          return draft && (draft === typedPartOf(job.instruction) || draft === remembered) ? { drafts: { ...state.drafts, [job.pageId]: '' } } : {};
        });
      }
      set((state) => ({ previewKey: state.previewKey + 1 }));
      const pageId = job.pageId || get().activePageId;
      if (pageId && pageId === get().activePageId) { get().loadRevisions(pageId); get().loadSections(pageId); }
      get().loadImages();
      if (job.pageId) { const part = String(get().lastRequest?.pageId === job.pageId ? get().lastRequest.focusSection || '' : '').trim(); const unverified = job.result?.validation?.functional?.status === 'unverified'; if (unverified) get().flash('info', 'Saved, but the new behaviour could not be tested automatically. Please try it in the preview.'); else get().flash('success', part ? `The section “${part}” was updated and saved.` : 'The page was regenerated and saved.'); }
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

  // Reads the sections of ONE page. Safe to call often: a second call for the same page while one is running shares it, a slow answer
  // for a page the user already left cannot overwrite a newer one, and a failure is kept (with a retry) instead of being hidden.
  loadSections: (pageId) => {
    const siteId = get().activeSiteId;
    if (!siteId || !pageId) return Promise.resolve();
    const key = `${siteId}:${pageId}`;
    if (sectionRequests.has(key)) return sectionRequests.get(key);
    const ticket = ++sectionTicket;
    sectionTickets.set(key, ticket);
    set((state) => ({ sectionsLoading: true, sectionsError: { ...state.sectionsError, [pageId]: null } }));
    const request = (async () => {
      try {
        const res = await templateSiteService.getPage(siteId, pageId);
        if (get().activeSiteId !== siteId || sectionTickets.get(key) !== ticket) return;
        const sections = normalizeSections(res.data.page?.sectionList || res.data.page?.sections || []);
        set((state) => ({ pageSections: { ...state.pageSections, [pageId]: sections } }));
      } catch (error) {
        if (get().activeSiteId !== siteId || sectionTickets.get(key) !== ticket) return;
        set((state) => ({ sectionsError: { ...state.sectionsError, [pageId]: apiMessage(error, 'The sections could not be read.') }, pageSections: { ...state.pageSections, [pageId]: state.pageSections[pageId] ?? null } }));
      } finally {
        sectionRequests.delete(key);
        if (get().activeSiteId === siteId) set({ sectionsLoading: sectionRequests.size > 0 });
      }
    })();
    sectionRequests.set(key, request);
    return request;
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
      const problem = validatePhotoFile(file, { allowVideo: true });
      // The page is fixed when the file is chosen: a photo uploaded while the user moves to another page still belongs to the first one.
      added.push({ key, id: `${key}:${Date.now()}`, file, name: file.name, size: file.size, preview: problem || isVideoFile(file) ? '' : URL.createObjectURL(file), video: isVideoFile(file), status: problem ? 'error' : 'queued', progress: 0, error: problem, invalid: Boolean(problem), pageId: get().activePageId, imageId: null, reused: false });
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
    const send = (next) => {
      uploadAbort = new AbortController();
      return templateSiteService.uploadPhoto(siteId, next.file, { pageId: next.pageId, signal: uploadAbort.signal, onProgress: (value) => patch(next.id, { progress: value }) });
    };
    try {
      for (;;) {
        if (get().activeSiteId !== siteId) break;
        const next = get().uploads.find((item) => item.status === 'queued');
        if (!next) break;
        patch(next.id, { status: 'uploading', progress: 0, error: null });
        try {
          let res;
          try { res = await send(next); }
          catch (error) {
            if (!isNetworkFailure(error)) throw error;
            // A dropped connection is retried once on its own before the user is asked to do anything.
            patch(next.id, { progress: 0 });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            res = await send(next);
          }
          if (get().activeSiteId !== siteId) break;
          const photo = res.data.photo;
          set((state) => ({ images: state.images.some((image) => image.id === photo.id) ? state.images.map((image) => (image.id === photo.id ? { ...image, ...photo } : image)) : [photo, ...state.images] }));
          // A picture that is already in the library is not an error: nothing new was stored, and it is attached to the page it was added from.
          patch(next.id, { status: 'done', progress: 1, imageId: photo.id, reused: Boolean(photo.reused || res.data.reused) });
          if (next.pageId) get().toggleImage(photo.id, true, next.pageId);
        } catch (error) {
          if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') { patch(next.id, { status: 'error', error: 'The upload was cancelled.', progress: 0 }); continue; }
          patch(next.id, { status: 'error', progress: 0, error: error?.response?.status === 429 ? 'Too many uploads at once. Wait a moment and try again.' : apiMessage(error, 'The upload failed. Check your connection and try again.'), invalid: error?.response?.status === 400 || error?.response?.status === 413 });
        }
      }
    } finally { uploadRun = null; uploadAbort = null; }
    // Anything still waiting (for example after the site changed) is started again instead of being left "queued" for ever.
    if (get().activeSiteId === siteId && get().uploads.some((item) => item.status === 'queued')) { get().runUploads(siteId); return; }
    get().loadImages();
    // Descriptions are written a few seconds after the upload; pick them up.
    get().watchCaptions();
  },

  retryUpload: (id) => { set((state) => ({ uploads: state.uploads.map((item) => (item.id === id && item.file ? { ...item, status: 'queued', error: null, progress: 0 } : item)) })); const siteId = get().activeSiteId; if (siteId) get().runUploads(siteId); },
  dismissUpload: (id) => set((state) => { const gone = state.uploads.find((item) => item.id === id); if (gone?.status === 'uploading') uploadAbort?.abort(); if (gone?.preview) URL.revokeObjectURL(gone.preview); return { uploads: state.uploads.filter((item) => item.id !== id) }; }),
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

  toggleImage: (imageId, on, forPageId = null) => {
    const pageId = forPageId || get().activePageId;
    if (!pageId) return;
    set((state) => {
      const chosen = { ...(state.selection[pageId] || {}) };
      const image = state.images.find((item) => item.id === imageId);
      if (on === false || (on === undefined && chosen[imageId])) delete chosen[imageId];
      else if (Object.keys(chosen).length >= MAX_ATTACH && !chosen[imageId]) { setTimeout(() => get().flash('error', `You can use up to ${MAX_ATTACH} photos in one regeneration.`), 0); return {}; }
      else chosen[imageId] = chosen[imageId] || { placement: /^(page-background|section)/.test(image?.placement || '') ? '' : (image?.placement || ''), note: image?.note || '' };
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

  // The caller has already asked the user (the viewer's confirmation names the pages that show the picture), so the server is told to go ahead.
  removeImage: async (imageId, { force = true } = {}) => {
    const siteId = get().activeSiteId;
    get().setBusy(`image:${imageId}`, true);
    try {
      const res = await templateSiteService.deleteImage(siteId, imageId, { force });
      set((state) => ({ images: state.images.filter((image) => image.id !== imageId), selection: Object.fromEntries(Object.entries(state.selection).map(([pageId, chosen]) => [pageId, Object.fromEntries(Object.entries(chosen).filter(([id]) => id !== imageId))])) }));
      get().flash('success', res.data.stillShownOn?.length || res.data.stillShownElsewhere ? 'Removed from the library. Pages that already show it keep it until you change them.' : 'The picture was removed from the library.');
      return true;
    } catch (error) { get().flash('error', apiMessage(error, 'The picture could not be removed.')); return false; }
    finally { get().setBusy(`image:${imageId}`, false); }
  },

  replaceImage: async (imageId, file, onProgress) => {
    const siteId = get().activeSiteId;
    const problem = validatePhotoFile(file);
    if (problem) { get().flash('error', problem); return null; }
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

// Save the typed work whenever it changes (empty drafts are dropped so the entry does not grow).
useTemplateStudioStore.subscribe((state, previous) => {
  if (!state.activeSiteId || (state.drafts === previous.drafts && state.selection === previous.selection && state.activeSiteId === previous.activeSiteId)) return;
  if (state.activeSiteId !== previous.activeSiteId && state.siteLoading) return; // the site's saved work is still being loaded
  try {
    const drafts = Object.fromEntries(Object.entries(state.drafts).filter(([, text]) => String(text || '').trim()));
    const selection = Object.fromEntries(Object.entries(state.selection).filter(([, chosen]) => Object.keys(chosen || {}).length));
    localStorage.setItem(WORK_KEY(state.activeSiteId), JSON.stringify({ drafts, selection }));
  } catch { /* storage may be unavailable */ }
});
