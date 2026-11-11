'use strict';

// Persistence for the prototype engine: run checkpoints (PrototypeRun) and the project the pages are saved into.
// The engine only sees { loadState, saveState, persistProject, loadProjectFiles }, so tests replace all of this.

function createMongoStore({ runId, userId, url, siteName, prompt, settings, models, blob, existingProjectId = null }) {
  const { PrototypeRun, Project } = models;
  let projectId = existingProjectId;
  const dehydrate = (files) => (blob?.dehydrateFiles ? blob.dehydrateFiles(files) : files);
  const hydrate = (files) => (blob?.hydrateFiles ? blob.hydrateFiles(files) : files);

  return {
    get projectId() { return projectId; },

    async loadState() {
      const run = await PrototypeRun.findOne({ runId }).lean();
      if (run?.projectId) projectId = String(run.projectId);
      return run?.state || null;
    },

    async saveState(state) {
      await PrototypeRun.updateOne({ runId }, { $set: { userId: userId || null, projectId: projectId || null, url, state, updatedAt: new Date() } }, { upsert: true });
    },

    async loadProjectFiles() {
      if (!projectId) return null;
      const project = await Project.findById(projectId).lean();
      return project?.files?.length ? hydrate(project.files) : null;
    },

    // First call creates the project, later calls update it. Every call is a complete, consistent file set.
    async persistProject(files, meta = {}) {
      const stored = await dehydrate(files);
      if (!projectId) {
        const project = await Project.create({
          userId: userId || null, name: siteName, description: String(prompt || '').trim(), files: stored, validation: null,
          settings: { framework: 'react', styling: 'tailwindcss', designSystem: 'Prototype', aiModel: settings?.model || 'Veave AI', theme: settings?.theme },
          provenance: { type: 'website-prototype', sourceUrl: url, runId, status: 'building', startedAt: new Date() }
        });
        projectId = String(project._id);
        await PrototypeRun.updateOne({ runId }, { $set: { projectId } }, { upsert: true });
        return { created: true, projectId };
      }
      await Project.updateOne({ _id: projectId }, { $set: { files: stored, 'provenance.lastSave': { stage: meta.stage, route: meta.route || null, status: meta.status || null, at: new Date() } } });
      return { created: false, projectId };
    },

    async finalizeProvenance(report) {
      if (!projectId) return;
      await Project.updateOne({ _id: projectId }, { $set: { 'provenance.status': 'complete', 'provenance.mode': report.mode, 'provenance.report': { mode: report.mode, headline: report.headline, crawl: { captured: report.crawl.captured, failed: report.crawl.failed, truncated: report.crawl.truncated }, counts: report.counts, unresolved: report.unresolved.slice(0, 30), missingEvidence: report.missingEvidence.slice(0, 40), assets: { slots: report.assets.slots, filledBy: report.assets.filledBy, unresolved: report.assets.unresolved.length } }, 'provenance.completedAt': new Date() } });
    }
  };
}

// In-memory store with the same interface (tests, and a dry run without a database).
function createMemoryStore({ initial = null } = {}) {
  let state = initial; let files = null; const saves = [];
  return {
    saves, get state() { return state; }, get files() { return files; },
    async loadState() { return state ? JSON.parse(JSON.stringify(state)) : null; },
    async saveState(next) { state = JSON.parse(JSON.stringify(next)); },
    async loadProjectFiles() { return files ? files.map((f) => ({ ...f })) : null; },
    async persistProject(next, meta) { files = next.map((f) => ({ ...f })); saves.push({ meta, count: next.length }); return { created: saves.length === 1 }; },
    async finalizeProvenance() {}
  };
}

module.exports = { createMongoStore, createMemoryStore };
