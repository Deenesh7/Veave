/**
 * The result of a deterministic edit engine (duplicate-region, restyle, blank-space, arrangement) expressed as the same four values
 * every other edit path produces. Five call sites in the edit flow used to repeat this mapping by hand.
 */

/**
 * @param originalFiles  the project's files before the engine ran
 * @param engineFiles    the files the engine returned
 * @param previousAppCode  the App.jsx text before the edit (used when the engine did not touch App.jsx)
 * @returns {{ updatedFiles, generatedChanges, appliedOperations, generatedAppCode }}
 */
function applyEngineFiles({ originalFiles = [], engineFiles = [], previousAppCode = null }) {
  const original = new Map(originalFiles.map((file) => [file.path, file.content]));
  const generatedChanges = engineFiles.filter((file) => file.encoding !== 'base64' && original.get(file.path) !== file.content);
  return {
    updatedFiles: engineFiles,
    generatedChanges,
    appliedOperations: generatedChanges.map((file) => ({ operation: 'modify', path: file.path })),
    generatedAppCode: engineFiles.find((file) => file?.path?.endsWith('App.jsx'))?.content || previousAppCode || '__INCREMENTAL_EDIT_APPLIED__'
  };
}

/**
 * The same four values for the source-refresh paths (recrawl, re-clone, fill from the real page). Unlike an engine result these can
 * add files, so each change is a `create` when the project did not have the file and a `modify` otherwise.
 *
 * @param changed  the files the step reports as changed; when omitted they are found by comparing with `originalFiles`
 */
function describeSourceChanges({ originalFiles = [], files = [], changed = null, previousAppCode = null }) {
  const original = new Map(originalFiles.map((file) => [file.path, file.content]));
  const generatedChanges = changed || files.filter((file) => !original.has(file.path) || original.get(file.path) !== file.content);
  return {
    generatedChanges,
    appliedOperations: generatedChanges.map((file) => ({ operation: original.has(file.path) ? 'modify' : 'create', path: file.path })),
    generatedAppCode: files.find((file) => file?.path && file.path.endsWith('App.jsx'))?.content || previousAppCode || '__INCREMENTAL_EDIT_APPLIED__'
  };
}

module.exports = { applyEngineFiles, describeSourceChanges };
