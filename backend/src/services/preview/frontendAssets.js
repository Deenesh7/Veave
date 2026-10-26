const path = require('node:path');
const fs = require('node:fs');

// The backend must run without the frontend folder (container deployments contain only backend/), so the
// transformer and its runtime libraries are resolved from the backend's own copy and dependencies.
const frontendRoot = path.resolve(__dirname, '../../../../frontend');
const frontendTransformer = path.join(frontendRoot, 'src/utils/codeTransformer.js');
const vendoredTransformer = path.resolve(__dirname, '../../vendor/codeTransformer.mjs');

// Prefer the frontend source when present (development, always current); otherwise the vendored copy.
const transformerPath = fs.existsSync(frontendTransformer) ? frontendTransformer : vendoredTransformer;

function resolveFrom(request) {
  const paths = [path.resolve(__dirname, '../../..'), path.join(frontendRoot)];
  return require.resolve(request, { paths });
}

module.exports = { frontendRoot, transformerPath, resolveFrom };
