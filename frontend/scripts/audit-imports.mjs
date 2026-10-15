#!/usr/bin/env node
/*
 * Veave — Static Import/Export Auditor
 * ------------------------------------
 * Detects the class of bugs that cause the React runtime error:
 *   "Element type is invalid: expected a string ... but got: undefined"
 *
 * This is the single most common failure mode when files are generated
 * or refactored: import specifiers stop matching what the target module
 * actually exports. The build (Vite/esbuild) does NOT catch these because
 * missing named exports silently become `undefined` at runtime.
 *
 * What it checks (per file, across all .js/.jsx/.ts/.tsx under src/):
 *   1. `import X from './y'`     → target has a default export.
 *   2. `import { A } from './y'` → target exports (or re-exports) `A`.
 *
 * It follows barrel files (`index.js`), `export * from './x'`, and
 * `export { A } from './x'` re-export chains.
 *
 * Exit codes:
 *   0 → no defects
 *   1 → defects found (details printed)
 *   2 → usage error
 *
 * Usage:
 *   node scripts/audit-imports.mjs [srcDir]     (defaults to ./src)
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'src'));
if (!fs.existsSync(ROOT)) {
  console.error(`audit-imports: source root does not exist: ${ROOT}`);
  process.exit(2);
}

const EXTS = ['.jsx', '.js', '.ts', '.tsx'];
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', '.vite']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(p, out);
    } else if (EXTS.includes(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // package or alias
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (path.extname(base)) candidates.push(base);
  else {
    for (const e of EXTS) candidates.push(base + e);
    for (const e of EXTS) candidates.push(path.join(base, 'index' + e));
  }
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  return null;
}

function parseExports(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripBlockComments(raw);

  const named = new Set();
  let hasDefault = false;
  const reexportAll = new Set();
  const reexportFrom = new Map(); // alias -> { file, importedName }

  if (/\bexport\s+default\b/.test(src)) hasDefault = true;

  // export { a, b as c, default as d } from './x'
  const reFromRaw = /export\s*\{([^}]*)\}\s*from\s*(['"`])([^'"`]+)\2/g;
  let m;
  while ((m = reFromRaw.exec(src)) !== null) {
    const target = resolveImport(file, m[3]);
    for (const it of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const parts = it.split(/\s+as\s+/).map(s => s.trim());
      const local = parts[0];
      const alias = parts[1] || parts[0];
      if (local === 'default') {
        if (target) reexportFrom.set(alias, { file: target, importedName: 'default' });
        named.add(alias);
      } else {
        named.add(alias);
        if (target) reexportFrom.set(alias, { file: target, importedName: local });
      }
    }
  }

  // export * from './x'
  const reStarRaw = /export\s*\*\s*from\s*(['"`])([^'"`]+)\1/g;
  while ((m = reStarRaw.exec(src)) !== null) {
    const t = resolveImport(file, m[2]);
    if (t) reexportAll.add(t);
  }

  // export * as ns from './x'
  const reStarNs = /export\s*\*\s*as\s+(\w+)\s+from\s*(['"`])([^'"`]+)\2/g;
  while ((m = reStarNs.exec(src)) !== null) named.add(m[1]);

  // export { a, b as c }  (bare, no `from`)
  const reBare = /export\s*\{([^}]*)\}(?!\s*from)/g;
  while ((m = reBare.exec(src)) !== null) {
    for (const it of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const parts = it.split(/\s+as\s+/).map(s => s.trim());
      const alias = parts[1] || parts[0];
      if (alias === 'default') hasDefault = true;
      else named.add(alias);
    }
  }

  const patterns = [
    /\bexport\s+(?:const|let|var)\s+(\w+)/g,
    /\bexport\s+(?:async\s+)?function\s*\*?\s*(\w+)/g,
    /\bexport\s+class\s+(\w+)/g,
  ];
  for (const re of patterns) {
    while ((m = re.exec(src)) !== null) named.add(m[1]);
  }

  return { hasDefault, named, reexportAll, reexportFrom };
}

const exportCache = new Map();
function getExports(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  // seed to break cycles
  exportCache.set(file, { hasDefault: false, named: new Set(), reexportAll: new Set(), reexportFrom: new Map() });
  const r = parseExports(file);
  exportCache.set(file, r);
  return r;
}

function moduleExports(file, name, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  const ex = getExports(file);
  if (name === 'default') return ex.hasDefault || ex.named.has('default');
  if (ex.named.has(name)) return true;
  if (ex.reexportFrom.has(name)) {
    const { file: t, importedName } = ex.reexportFrom.get(name);
    return moduleExports(t, importedName, seen);
  }
  for (const s of ex.reexportAll) {
    if (moduleExports(s, name, seen)) return true;
  }
  return false;
}

function parseImports(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const src = stripBlockComments(raw);
  const imports = [];
  const reImp = /import\s+([^'";]+?)\s+from\s*(['"`])([^'"`]+)\2/g;
  let m;
  while ((m = reImp.exec(src)) !== null) {
    const clause = m[1].trim();
    const source = m[3];
    let defaultName = null;
    let namespaceName = null;
    const named = [];

    const parts = [];
    let depth = 0, cur = '';
    for (const ch of clause) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());

    for (const p of parts) {
      if (p.startsWith('{')) {
        const inner = p.replace(/^\{|\}$/g, '');
        for (const it of inner.split(',').map(s => s.trim()).filter(Boolean)) {
          const [orig, alias] = it.split(/\s+as\s+/).map(s => s.trim());
          named.push({ imported: orig, local: alias || orig });
        }
      } else if (/^\*\s+as\s+\w+$/.test(p)) {
        namespaceName = p.split(/\s+as\s+/)[1].trim();
      } else if (/^\w+$/.test(p)) {
        defaultName = p;
      }
    }
    imports.push({ source, defaultName, namespaceName, named });
  }
  return imports;
}

// --------------------------- audit ---------------------------

const files = walk(ROOT);
const problems = [];

for (const f of files) {
  let imps;
  try { imps = parseImports(f); } catch { continue; }
  for (const imp of imps) {
    const target = resolveImport(f, imp.source);
    if (!target) continue; // package or unresolvable — outside our scope
    if (imp.defaultName && !moduleExports(target, 'default')) {
      problems.push({ file: f, kind: 'missing-default', source: imp.source, resolved: target, want: imp.defaultName });
    }
    for (const n of imp.named) {
      if (!moduleExports(target, n.imported)) {
        problems.push({ file: f, kind: 'missing-named', source: imp.source, resolved: target, want: n.imported });
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`audit-imports: OK — scanned ${files.length} files, no import/export mismatches.`);
  process.exit(0);
}

console.log(`audit-imports: FAIL — ${problems.length} import/export mismatch(es) across ${files.length} files:\n`);
for (const p of problems) {
  const rel = path.relative(ROOT, p.file);
  const relT = path.relative(ROOT, p.resolved);
  console.log(`  [${p.kind}] ${rel}`);
  console.log(`      wants '${p.want}' from '${p.source}'  →  ${relT}`);
}
console.log('\nFix: either add the missing export in the target module, or change');
console.log('the import to match what the target actually exports (default vs named).');
process.exit(1);
