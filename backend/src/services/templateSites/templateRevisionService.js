/**
 * Revisions of a template site's pages. A revision stores the full content of every file a change touched, so any revision can be
 * restored on its own. Saving is idempotent per job (a job id can own at most one revision) and a restore is itself a new revision,
 * so history is never rewritten.
 */
const TemplatePage = require('../../models/TemplatePage');
const TemplateRevision = require('../../models/TemplateRevision');
const TemplateSite = require('../../models/TemplateSite');
const store = require('./siteFileStore');
const { getPage, idOf } = require('./templateSiteService');
const { assertNoRunningJob, bumpSite, undoFiles } = require('./templatePageService');
const { NotFoundError, ConflictError } = require('../../utils/errors');

// Routing and navigation are managed by the page operations, not by restoring one page's history.
const NOT_RESTORED = new Set(['src/App.jsx', 'src/data/site.js', 'package.json']);

async function listRevisions(user, siteId, pageId) {
  const { site, page } = await getPage(user, siteId, pageId);
  const revisions = await TemplateRevision.find({ siteId: site._id, pageId: page._id }).sort({ number: -1 }).select('-files -before').lean();
  return { page, revisions: revisions.map((revision) => ({ ...revision, current: revision.number === page.currentRevision })) };
}

/**
 * Records a committed change of one page as the page's next revision and moves the page to it. Safe to call again for the same job.
 */
async function recordPageRevision({ site, page, userId, kind = 'regenerate', instruction = '', changed, previous, jobId = null, validation = null, restoredFrom = null }) {
  if (jobId) {
    const existing = await TemplateRevision.findOne({ siteId: site._id, jobId });
    if (existing) return { revision: existing, created: false };
  }
  const updatedPage = await TemplatePage.findOneAndUpdate({ _id: page._id }, { $inc: { revisionCount: 1 } }, { new: true });
  const number = updatedPage.revisionCount;
  let revision;
  try {
    revision = await TemplateRevision.create({
      siteId: site._id, pageId: page._id, userId, number, kind, instruction, files: changed, before: previous, validation, jobId, restoredFrom
    });
  } catch (error) {
    // The number that was taken for this revision goes back, so history has no gap where nothing was saved.
    await TemplatePage.updateOne({ _id: page._id }, { $inc: { revisionCount: -1 } }).catch(() => {});
    if (error?.code === 11000 && jobId) {
      const winner = await TemplateRevision.findOne({ siteId: site._id, jobId });
      if (winner) return { revision: winner, created: false };
    }
    throw error;
  }
  const updatedSite = await bumpSite(site._id);
  await TemplateRevision.updateOne({ _id: revision._id }, { $set: { siteRevision: updatedSite.revision } });
  await TemplatePage.updateOne({ _id: page._id }, { $set: { currentRevision: number, status: 'ready', lastInstruction: instruction.slice(0, 300), lastError: null } });
  return { revision, created: true };
}

/** Puts the page back as it was at revision `number` (only the files that revision recorded; shared routing/navigation files excluded). */
async function restoreRevision({ user, siteId, pageId, number }) {
  const { site, page } = await getPage(user, siteId, pageId);
  await assertNoRunningJob(site._id, page._id);
  const revision = await TemplateRevision.findOne({ siteId: site._id, pageId: page._id, number: Number(number) });
  if (!revision) throw new NotFoundError('Revision');
  const wanted = revision.files.filter((file) => !file.deleted && !NOT_RESTORED.has(file.path) && /^src\//.test(file.path) && file.content);
  if (!wanted.length) throw new ConflictError('This revision has no page files to restore.');

  const { files: current, projectRevision } = await store.readSite(site);
  const byPath = new Map(current.map((file) => [file.path, file]));
  let next = current;
  for (const file of wanted) {
    const existing = byPath.get(file.path);
    next = existing ? next.map((item) => (item.path === file.path ? { ...item, content: file.content } : item)) : [...next, { path: file.path, content: file.content, language: file.language, encoding: 'utf8' }];
  }
  const { changed, previous } = store.diffFiles(current, next);
  if (!changed.length) return { unchanged: true, page, revision };
  store.assertNoNewProblems(current, next);
  const written = await store.writeSite(site, next, projectRevision);
  try {
    const recorded = await recordPageRevision({ site, page, userId: idOf(user), kind: 'restore', instruction: `Restored revision ${revision.number}`, changed, previous, restoredFrom: revision.number });
    return { unchanged: false, page: await TemplatePage.findById(page._id), revision: recorded.revision };
  } catch (error) {
    await undoFiles(site, { before: current, written });
    throw error;
  }
}

module.exports = { listRevisions, recordPageRevision, restoreRevision, NOT_RESTORED };
