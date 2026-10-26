// Keeps the backend's own copy of the frontend preview transformer current. The backend must be deployable
// without the frontend folder (e.g. in a container where only backend/ exists), so it ships this copy.
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '../../frontend/src/utils/codeTransformer.js');
const dest = path.resolve(__dirname, '../src/vendor/codeTransformer.mjs');
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest) || fs.readFileSync(src, 'utf8') !== fs.readFileSync(dest, 'utf8')) {
    fs.copyFileSync(src, dest);
    console.log('Synced codeTransformer.mjs from frontend');
  }
}
