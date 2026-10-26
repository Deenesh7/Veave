// One call site for "the saved project changed": every project-scoped derived cache is told, so none can serve stale data.
const lspManager = require('../lsp/lspManager');
const codeSearch = require('./projectIndex');
const structural = require('../ai/structuralContext');

function invalidate(projectKey) {
  const key = String(projectKey);
  try { lspManager.invalidate(key); } catch { /* optional subsystem */ }
  try { codeSearch.invalidate(key); } catch { /* optional subsystem */ }
  try { structural.evict(key); } catch { /* optional subsystem */ }
}

function dispose(projectKey) {
  const key = String(projectKey);
  codeSearch.dispose(key);
  structural.evict(key);
  return lspManager.dispose(key).catch(() => {});
}

module.exports = { invalidate, dispose };
