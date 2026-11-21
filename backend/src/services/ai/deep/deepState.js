/**
 * The persistent state of a deep generation: the requirements, the sitemap, every page and section with its status, the generated
 * files and what is left to do. It is a plain object stored on the GenerationJob document after every task, so a retry or a
 * restarted worker continues from it instead of starting again.
 */
const crypto = require('node:crypto');

const STATE_VERSION = 1;
const DONE = 'done';

const hashPrompt = (prompt) => crypto.createHash('sha256').update(String(prompt || '')).digest('hex').slice(0, 16);

const pascal = (text) => String(text || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('').replace(/^(\d)/, 'X$1') || 'Section';

function createState({ prompt, plan, requirements = [], missingInfo = [], siteName = '' }) {
  const pageFiles = new Set();
  const pages = plan.pages.map((page) => {
    let base = `${pascal(page.name)}Page`;
    while (pageFiles.has(base)) base = `${base}2`;
    pageFiles.add(base);
    const sectionFiles = new Set();
    return {
      id: page.id, name: page.name, route: page.route, status: 'pending', retries: 0, file: `src/pages/${base}.jsx`,
      sections: page.sections.map((section) => {
        let name = `${pascal(page.name)}${pascal(section.heading || section.id)}`.slice(0, 60);
        while (sectionFiles.has(name)) name = `${name}2`;
        sectionFiles.add(name);
        return { id: section.id, heading: section.heading || section.id, file: `src/components/sections/${name}.jsx`, status: 'pending', retries: 0, words: 0, note: '', error: '', requirementIds: section.requirementIds || [] };
      })
    };
  });
  return {
    version: STATE_VERSION, promptHash: hashPrompt(prompt), status: 'generating', siteName, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    requirements, missingInfo, shell: { status: 'pending', retries: 0, error: '' }, pages, files: {}, failedTasks: [], retries: 0, coverageRounds: 0,
    validation: { status: 'pending', issues: [] }
  };
}

/** A stored state that belongs to this request can be continued; anything else (another prompt, another version) cannot. */
function resumable(stored, prompt) {
  if (!stored || stored.version !== STATE_VERSION || stored.promptHash !== hashPrompt(prompt) || !Array.isArray(stored.pages)) return null;
  if (stored.status === 'complete') return null;
  const state = JSON.parse(JSON.stringify(stored));
  // A task that was running when the worker died is simply pending again.
  if (state.shell.status === 'running') state.shell.status = 'pending';
  for (const page of state.pages) {
    if (page.status === 'running') page.status = 'pending';
    for (const section of page.sections) {
      if (section.status === 'running') section.status = 'pending';
      // A task that failed before gets a fresh set of attempts when the job continues: only failed or unfinished tasks are repeated.
      if (section.status === 'failed') { section.status = 'pending'; section.retries = 0; }
    }
  }
  return state;
}

const allSections = (state) => state.pages.flatMap((page) => page.sections.map((section) => ({ page, section })));

/** The numbers shown to the user and kept for support. */
function summarize(state) {
  const sections = allSections(state);
  const uncovered = state.requirements.filter((item) => item.status !== 'covered');
  return {
    status: state.status,
    pages: { total: state.pages.length, completed: state.pages.filter((page) => page.status === DONE).length },
    sections: { total: sections.length, completed: sections.filter(({ section }) => section.status === DONE).length, pending: sections.filter(({ section }) => section.status !== DONE).length },
    requirements: { total: state.requirements.length, covered: state.requirements.length - uncovered.length, uncovered: uncovered.map((item) => ({ id: item.id, label: item.label, status: item.status })) },
    failedTasks: state.failedTasks.length, retries: state.retries, coverageRounds: state.coverageRounds, validation: state.validation.status
  };
}

/** Writes the state through `persist` one at a time, so two tasks finishing together never write an older copy over a newer one. */
function makePersister(persist) {
  let chain = Promise.resolve();
  return (state) => {
    state.updatedAt = new Date().toISOString();
    if (typeof persist !== 'function') return Promise.resolve();
    const snapshot = JSON.parse(JSON.stringify(state));
    chain = chain.then(() => persist(snapshot, summarize(snapshot))).catch(() => {});
    return chain;
  };
}

/** Adds a planned section (already in the composition plan) to its page in the state, keeping the plan's order. */
function addSectionToState(state, plan, pageId, planSection) {
  const page = state.pages.find((item) => item.id === pageId);
  const planPage = plan.pages.find((item) => item.id === pageId);
  if (!page || !planPage || page.sections.some((section) => section.id === planSection.id)) return null;
  const taken = new Set(allSections(state).map(({ section }) => section.file));
  let name = `${pascal(page.name)}${pascal(planSection.heading || planSection.id)}`.slice(0, 60);
  while (taken.has(`src/components/sections/${name}.jsx`)) name = `${name}2`;
  page.sections.push({ id: planSection.id, heading: planSection.heading || planSection.id, file: `src/components/sections/${name}.jsx`, status: 'pending', retries: 0, words: 0, note: '', error: '', requirementIds: planSection.requirementIds || [] });
  const order = new Map(planPage.sections.map((section, index) => [section.id, index]));
  page.sections.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  page.status = 'pending';
  return page.sections.find((section) => section.id === planSection.id);
}

module.exports = { addSectionToState, STATE_VERSION, DONE, hashPrompt, pascal, createState, resumable, summarize, allSections, makePersister };
