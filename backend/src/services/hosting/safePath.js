const path = require('node:path');

// Resolve a relative path inside root, refusing traversal, absolute paths, NUL bytes and backslashes.
function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0') || relativePath.includes('\\')) return null;
  if (path.posix.isAbsolute(relativePath)) return null;
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '..' || part === '')) return null;
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

module.exports = { resolveInside };
