/**
 * Reads and writes a template site's files (stored in its Project) safely:
 *  - a write only succeeds if nobody changed the project since it was read (optimistic revision check),
 *  - what a change touched is recorded as before/after pairs for the revision history,
 *  - a change that introduces a syntax, import or export error is refused before anything is written.
 */
const Project = require('../../models/Project');
const generationPipeline = require('../ai/generationPipeline');
const { loadSiteFiles } = require('./templateSiteService');
const { ConflictError, ValidationError } = require('../../utils/errors');

const BLOCKING = new Set(['syntax', 'import', 'export', 'entry']);

const keyOf = (item) => `${item.category}|${item.path}|${String(item.message).slice(0, 120)}`;

/** Problems in `after` that were not already in `before` (an existing problem is not blamed on this change). */
function newProblems(before, after) {
  const known = new Set(generationPipeline.validateGeneratedFiles(before).filter((item) => BLOCKING.has(item.category)).map(keyOf));
  return generationPipeline.validateGeneratedFiles(after).filter((item) => BLOCKING.has(item.category) && !known.has(keyOf(item)));
}

function assertNoNewProblems(before, after) {
  const added = newProblems(before, after);
  if (added.length) throw new ValidationError(`The change was not applied because it would break the site: ${added.slice(0, 3).map((item) => `${item.path}: ${String(item.message).slice(0, 160)}`).join(' | ')}`);
}

/** What changed between two file lists: files whose content differs, were added, or were removed. */
function diffFiles(before, after) {
  const beforeMap = new Map(before.map((file) => [file.path, file]));
  const afterMap = new Map(after.map((file) => [file.path, file]));
  const changed = [];
  const previous = [];
  for (const file of after) {
    const old = beforeMap.get(file.path);
    if (old && old.content === file.content && old.encoding === file.encoding) continue;
    changed.push({ path: file.path, content: file.encoding === 'base64' ? '' : file.content, language: file.language || 'plaintext', deleted: false });
    if (old) previous.push({ path: old.path, content: old.encoding === 'base64' ? '' : old.content, language: old.language || 'plaintext', deleted: false });
  }
  for (const file of before) {
    if (afterMap.has(file.path)) continue;
    changed.push({ path: file.path, content: '', language: file.language || 'plaintext', deleted: true });
    previous.push({ path: file.path, content: file.encoding === 'base64' ? '' : file.content, language: file.language || 'plaintext', deleted: false });
  }
  return { changed, previous };
}

/** Loads the files together with the project revision they were read at. */
async function readSite(site) {
  const { project, files } = await loadSiteFiles(site);
  return { files, projectRevision: project.revision || 0, project };
}

/**
 * Writes `files` as the site's new files, only if the project is still at `expectedRevision`. Returns the new project revision.
 * Throws ConflictError when something else changed the project in between (the caller reloads and retries).
 */
async function writeSite(site, files, expectedRevision) {
  const filter = { _id: site.projectId, userId: site.userId, revision: expectedRevision };
  const saved = await Project.findOneAndUpdate(filter, { $set: { files, lastEditedBy: site.userId } }, { new: true }).select('revision').lean();
  if (!saved) throw new ConflictError('The site was changed by another request while this one was running. Nothing was saved; try again.');
  return saved.revision;
}

/** Puts `files` back after a later step failed. Best effort: it is only used to undo this request's own write. */
async function rollbackSite(site, files, writtenRevision) {
  const saved = await Project.findOneAndUpdate({ _id: site.projectId, revision: writtenRevision }, { $set: { files } }, { new: true }).select('revision').lean();
  return Boolean(saved);
}

module.exports = { BLOCKING, newProblems, assertNoNewProblems, diffFiles, readSite, writeSite, rollbackSite };
