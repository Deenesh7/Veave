const path = require('node:path');
const fs = require('node:fs');

// The backend must run without the frontend folder (container deployments contain only backend/), so the
// transformer and its runtime libraries are resolved from the backend's own copy and dependencies.
const frontendRoot = path.resolve(__dirname, '../../../../frontend');
const frontendTransformer = path.join(frontendRoot, 'src/utils/codeTransformer.js');
const vendoredTransformer = path.resolve(__dirname, '../../vendor/codeTransformer.mjs');

// Prefer the frontend source when present (development, always current); otherwise the vendored copy.
const transformerPath = fs.existsSync(frontendTransformer) ? frontendTransformer : vendoredTransformer;

// Packages such as react restrict deep imports through their "exports" map, so a file like
// react/umd/react.development.js cannot be passed to require.resolve. Locate the package root through
// package.json (always exported) and join the rest of the path manually.
function resolveFrom(request) {
  const paths = [path.resolve(__dirname, '../../..'), path.join(frontendRoot)];
  const parts = request.split('/');
  const nameLength = request.startsWith('@') ? 2 : 1;
  const pkgName = parts.slice(0, nameLength).join('/');
  const subPath = parts.slice(nameLength).join('/');
  if (!subPath) return require.resolve(request, { paths });
  const root = path.dirname(require.resolve(`${pkgName}/package.json`, { paths }));
  return path.join(root, subPath);
}

module.exports = { frontendRoot, transformerPath, resolveFrom };
