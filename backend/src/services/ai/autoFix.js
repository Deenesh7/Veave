const path = require('node:path');
const babelParser = require('@babel/parser');
const { validateGeneratedFiles } = require('./generationPipeline');
const { repairStrayIdentifiers } = require('./strayIdentifiers');

// Files the project scaffolder always provides (hooks, utils, base components). Models import them freely, but the
// scaffolder only adds them after generation, so an import of one must be satisfied from the scaffold, not stubbed.
let scaffoldCache = null;
function scaffoldFiles() {
  if (!scaffoldCache) {
    const { scaffoldReactProject } = require('../project/reactScaffolder');
    const files = scaffoldReactProject([{ path: 'src/App.jsx', content: 'export default function App(){return null}\n' }]);
    scaffoldCache = new Map(files.map((file) => [file.path, file]));
  }
  return scaffoldCache;
}
function scaffoldFor(targetBase) {
  const stripped = targetBase.replace(/\.(?:jsx?|tsx?)$/, '');
  for (const candidate of [targetBase, ...SOURCE_EXT.map((e) => stripped + e), ...SOURCE_EXT.map((e) => `${stripped}/index${e}`)]) {
    const hit = scaffoldFiles().get(candidate);
    if (hit && hit.path.startsWith('src/')) return hit;
  }
  return null;
}

// Deterministic, zero-cost repairs for the mistakes models make most often in multi-page projects. They run before
// every validation so the (slow, paid) AI repair is only used for problems that really need judgement.

const KNOWN_PACKAGES = {
  'react-router-dom': '^6.26.0',
  'framer-motion': '^11.5.4',
  'lucide-react': '^0.400.0',
  'clsx': '^2.1.1',
  'axios': '^1.7.7',
  'recharts': '^2.12.7',
  'react-icons': '^5.3.0',
  'date-fns': '^3.6.0'
};
// Versions used to replace dependency specs the sandbox forbids (URL, git, file, npm: alias, dist-tag such as "latest").
const SAFE_VERSIONS = {
  ...KNOWN_PACKAGES,
  react: '^18.3.1',
  'react-dom': '^18.3.1',
  '@vitejs/plugin-react': '^4.3.0',
  autoprefixer: '^10.4.20',
  postcss: '^8.4.47',
  tailwindcss: '^3.4.13',
  vite: '^5.4.8'
};
const REGISTRY_RANGE = /^[\d\s.^~<>=|*xXv-]+$/;
const VALID_PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

// The dependency policy only allows registry version ranges. Rewrite anything else to a registry range so the job
// proceeds, and drop fields (workspaces, overrides) the single-project runner rejects.
function normalizePackageJson(content) {
  const pkg = JSON.parse(content);
  const notes = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[section] || typeof pkg[section] !== 'object') continue;
    for (const [name, version] of Object.entries(pkg[section])) {
      if (!VALID_PACKAGE_NAME.test(name)) { delete pkg[section][name]; notes.push(`removed invalid dependency name ${name}`); continue; }
      if (typeof version === 'string' && REGISTRY_RANGE.test(version)) continue;
      const replacement = SAFE_VERSIONS[name] || '*';
      pkg[section][name] = replacement;
      notes.push(`${name}: "${version}" -> "${replacement}"`);
    }
  }
  for (const field of ['workspaces', 'overrides', 'resolutions']) {
    if (pkg[field]) { delete pkg[field]; notes.push(`removed ${field}`); }
  }
  return { content: notes.length ? `${JSON.stringify(pkg, null, 2)}\n` : content, notes };
}
const SOURCE_EXT = ['.jsx', '.js', '.tsx', '.ts'];

const pascal = (value) => String(value).replace(/\.[^.]+$/, '').split(/[^a-zA-Z0-9]+/).filter(Boolean)
  .map((part) => part[0].toUpperCase() + part.slice(1)).join('') || 'Page';
const isComponentName = (name) => /^[A-Z]/.test(name);
const lines = (...parts) => `${parts.join('\n')}\n`;

function parse(file) {
  try {
    return babelParser.parse(file.content, { sourceType: 'unambiguous', sourceFilename: file.path,
      plugins: ['jsx', ...(/\.tsx?$/.test(file.path) ? ['typescript'] : []), 'decorators-legacy', 'classProperties', 'importAttributes'] });
  } catch { return null; }
}

function relativeSpecifier(fromPath, toPath) {
  let rel = path.posix.relative(path.posix.dirname(fromPath), toPath).replace(/\.(?:jsx?|tsx?)$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

// Case-insensitive / extension / index lookup of what an import meant to reference.
function findIntendedFile(importer, source, paths) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), source));
  const lowerIndex = new Map([...paths].map((p) => [p.toLowerCase(), p]));
  const stripped = base.replace(/\.(?:jsx?|tsx?)$/, '');
  const candidates = [base, ...SOURCE_EXT.map((e) => stripped + e), ...SOURCE_EXT.map((e) => `${stripped}/index${e}`)];
  for (const candidate of candidates) {
    const hit = lowerIndex.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function componentStub(name) {
  return lines(
    "import React from 'react';",
    '',
    `export default function ${name}() {`,
    '  return (',
    '    <section className="mx-auto max-w-5xl px-6 py-16">',
    `      <h1 className="text-3xl font-bold">${name.replace(/([a-z])([A-Z])/g, '$1 $2')}</h1>`,
    '      <p className="mt-3 text-zinc-600">This section is being prepared.</p>',
    '    </section>',
    '  );',
    '}'
  );
}

function stubFor(filePath, node) {
  const defaultName = pascal(path.posix.basename(filePath));
  let out = '';
  const named = [];
  let hasDefault = false;
  for (const spec of node.specifiers || []) {
    if (spec.type === 'ImportDefaultSpecifier') hasDefault = true;
    if (spec.type === 'ImportSpecifier') named.push(spec.imported.name || spec.imported.value);
  }
  const isData = /\/(?:data|content|constants|config)\//i.test(`/${filePath}`) || (!hasDefault && named.length && named.every((n) => !isComponentName(n)));
  if (isData) {
    out += lines(...named.filter((n) => n !== 'default').map((n) => `export const ${n} = [];`));
    if (hasDefault) out += 'export default [];\n';
    return out;
  }
  out = componentStub(hasDefault || !named.length ? defaultName : defaultName);
  for (const name of named) {
    if (name === 'default') continue;
    out += isComponentName(name)
      ? `\nexport function ${name}() {\n  return null;\n}\n`
      : `\nexport const ${name} = [];\n`;
  }
  return out;
}

function topLevelBindings(ast) {
  const names = new Map(); // name -> kind
  const exportedDefault = { name: null, present: false };
  const namedExports = new Set();
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.set(node.id?.name, 'decl');
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => d.id?.name && names.set(d.id.name, 'var'));
    if (node.type === 'ExportDefaultDeclaration') {
      exportedDefault.present = true;
      exportedDefault.name = node.declaration?.id?.name || (node.declaration?.type === 'Identifier' ? node.declaration.name : null);
    }
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.id?.name) { namedExports.add(d.id.name); names.set(d.id.name, 'decl'); }
      d?.declarations?.forEach((x) => { if (x.id?.name) { namedExports.add(x.id.name); names.set(x.id.name, 'var'); } });
      (node.specifiers || []).forEach((s) => namedExports.add(s.exported?.name || s.exported?.value));
    }
  }
  names.delete(undefined);
  return { names, exportedDefault, namedExports };
}

// ---- Colour / gradient checks -------------------------------------------------------------------------------------
// Tailwind gradient mistakes that render as invisible text or an empty block, plus the product's palette rule
// (no purple / violet / fuchsia). Operates on static className strings only.
const PALETTE_SWAPS = [[/\b(purple)-(\d{2,3})\b/g, 'blue-$2'], [/\b(violet)-(\d{2,3})\b/g, 'indigo-$2'], [/\b(fuchsia)-(\d{2,3})\b/g, 'sky-$2']];

function fixClassList(value) {
  let out = value;
  for (const [pattern, replacement] of PALETTE_SWAPS) out = out.replace(pattern, replacement);
  const tokens = out.split(/\s+/).filter(Boolean);
  const has = (re) => tokens.some((t) => re.test(t.replace(/^(?:[a-z0-9-]+:)+/, '')));
  const hasGradient = has(/^bg-(?:gradient-to-|linear-to-|linear-\d)/) || has(/^bg-\[(?:linear|radial)-gradient/);
  const hasStops = has(/^(?:from|via|to)-/);
  const changes = [];
  if (hasGradient && !hasStops && !has(/^bg-\[(?:linear|radial)-gradient/)) {
    tokens.push('from-slate-900', 'to-slate-700');
    changes.push('gradient without colours');
  } else if (!hasGradient && has(/^from-/) && has(/^to-|^via-/) && !tokens.some((t) => /^(?:bg-clip-text)$/.test(t) && false)) {
    tokens.push('bg-gradient-to-r');
    changes.push('gradient colours without a gradient');
  }
  const transparentText = tokens.includes('text-transparent');
  if (transparentText) {
    const stillGradient = tokens.some((t) => /^bg-(?:gradient-to-|linear-to-)/.test(t)) || has(/^bg-\[(?:linear|radial)-gradient/);
    if (!stillGradient) {
      tokens.splice(tokens.indexOf('text-transparent'), 1);
      changes.push('transparent text without gradient (invisible)');
    } else if (!tokens.includes('bg-clip-text')) {
      tokens.push('bg-clip-text');
      changes.push('gradient text without bg-clip-text (invisible)');
    }
  }
  const joined = tokens.join(' ');
  return { value: joined === value.trim() ? value : (changes.length || joined !== out.trim() ? joined : out), changes: out !== value ? [...changes, 'palette'] : changes };
}

function fixColourClasses(files) {
  const fixes = [];
  const next = files.map((file) => {
    if (!/^src\/.*\.(?:jsx?|tsx?)$/.test(file.path) || typeof file.content !== 'string' || !/(?:className|class)\s*=/.test(file.content)) return file;
    let touched = [];
    const content = file.content.replace(/(\bclassName\s*=\s*)(?:"([^"\n]*)"|'([^'\n]*)'|\{`([^`$]*)`\})/g, (match, prefix, a, b, c) => {
      const original = a ?? b ?? c;
      const result = fixClassList(original);
      if (result.value === original) return match;
      touched = touched.concat(result.changes);
      return a != null ? `${prefix}"${result.value}"` : b != null ? `${prefix}'${result.value}'` : `${prefix}{\`${result.value}\`}`;
    });
    if (content !== file.content) {
      fixes.push(`${file.path}: colour/gradient fixes (${[...new Set(touched)].join(', ')})`);
      return { ...file, content };
    }
    return file;
  });
  return { files: next, fixes };
}

// A page whose default export renders nothing is blank. Replace only truly empty ones (no JSX text, no children).
function isEmptyPage(file) {
  if (!/^src\/pages\/.*\.(?:jsx|tsx)$/.test(file.path) || typeof file.content !== 'string') return false;
  const code = file.content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/^\s*import .*$/gm, '').trim();
  if (code.length > 400) return false;
  return /return\s*\(?\s*(?:null|<>\s*<\/>|<(?:div|section|main)\b[^>]*>\s*<\/(?:div|section|main)>|<(?:div|section|main)\b[^>]*\/>)\s*\)?\s*;?/.test(code)
    || /=>\s*\(?\s*(?:null|<>\s*<\/>|<(?:div|section|main)\b[^>]*\/>)\s*\)?\s*;?\s*(?:export|$)/.test(code);
}

function fillEmptyPages(files) {
  const fixes = [];
  const next = files.map((file) => {
    if (!isEmptyPage(file)) return file;
    fixes.push(`${file.path}: blank page replaced with a placeholder`);
    return { ...file, content: componentStub(pascal(path.posix.basename(file.path))) };
  });
  return { files: next, fixes };
}

function autoFix(inputFiles, { maxPasses = 4, stubMissing = true } = {}) {
  let files = inputFiles.map((f) => ({ ...f }));
  const fixes = [];
  // Stray words in code positions (`сия`) crash the module at runtime: remove them before anything else.
  const stray = repairStrayIdentifiers(files);
  if (stray.repaired.length) {
    files = stray.files;
    for (const item of stray.repaired) fixes.push(`${item.path}: removed stray text in code (${item.names.join(', ')})`);
  }
  const byPath = () => new Map(files.map((f) => [f.path, f]));
  const setContent = (filePath, content) => { files = files.map((f) => (f.path === filePath ? { ...f, content } : f)); };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const diagnostics = validateGeneratedFiles(files).filter((d) => ['import', 'export', 'entry'].includes(d.category));
    if (!diagnostics.length) break;
    let changed = false;
    const index = byPath();
    const paths = new Set(index.keys());

    for (const d of diagnostics) {
      const file = byPath().get(d.path);
      if (!file) continue;

      if (d.category === 'import' && d.relatedPath) {
        const ast = parse(file);
        const node = ast?.program.body.find((n) => n.source?.value === d.relatedPath);
        if (!node) continue;
        const intended = findIntendedFile(d.path, d.relatedPath, paths);
        if (intended) {
          const spec = relativeSpecifier(d.path, intended);
          const quote = file.content[node.source.start];
          setContent(d.path, file.content.slice(0, node.source.start) + quote + spec + quote + file.content.slice(node.source.end));
          fixes.push(`${d.path}: import "${d.relatedPath}" -> "${spec}"`);
          changed = true; continue;
        }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(d.path), d.relatedPath));
        const provided = scaffoldFor(target);
        if (provided) {
          files.push({ ...provided });
          fixes.push(`${provided.path}: added standard project file imported by ${d.path}`);
          changed = true; continue;
        }
        if (!stubMissing) continue;
        const hasExt = /\.[a-z0-9]+$/i.test(target);
        if (hasExt && !/\.(?:jsx?|tsx?)$/.test(target)) continue; // assets/css/json are not stubbed
        if (!/^src\//.test(target)) continue;
        const stubPath = hasExt ? target : (/\/(?:data|content|constants|config)\//i.test(`/${target}`) ? `${target}.js` : `${target}.jsx`);
        files.push({ path: stubPath, content: stubFor(stubPath, node), language: 'javascript', encoding: 'utf8' });
        fixes.push(`${stubPath}: created missing module imported by ${d.path}`);
        changed = true; continue;
      }

      if (d.category === 'export' && /^The application entry/.test(d.message)) {
        const ast = parse(file); if (!ast) continue;
        const { names } = topLevelBindings(ast);
        const name = names.has('App') ? 'App' : [...names.keys()].find(isComponentName);
        if (name) { setContent(d.path, `${file.content.trimEnd()}\n\nexport default ${name};\n`); fixes.push(`${d.path}: added default export ${name}`); changed = true; }
        continue;
      }

      if (d.category === 'export' && d.relatedPath) {
        const target = byPath().get(d.relatedPath);
        const ast = target && parse(target); if (!ast) continue;
        const info = topLevelBindings(ast);
        const missingNamed = /^Import "(.+)" is not exported/.exec(d.message)?.[1];
        if (missingNamed) {
          if (info.names.has(missingNamed)) {
            setContent(target.path, `${target.content.trimEnd()}\n\nexport { ${missingNamed} };\n`);
            fixes.push(`${target.path}: exported "${missingNamed}"`);
          } else if (info.exportedDefault.name && isComponentName(missingNamed)) {
            setContent(target.path, `${target.content.trimEnd()}\n\nexport { ${info.exportedDefault.name} as ${missingNamed} };\n`);
            fixes.push(`${target.path}: exported default as "${missingNamed}"`);
          } else {
            const add = isComponentName(missingNamed) ? `export function ${missingNamed}() {\n  return null;\n}\n` : `export const ${missingNamed} = [];\n`;
            setContent(target.path, `${target.content.trimEnd()}\n\n${add}`);
            fixes.push(`${target.path}: added placeholder export "${missingNamed}"`);
          }
          changed = true;
        } else if (/^Default import is not exported/.test(d.message)) {
          const candidates = [...info.namedExports].filter(isComponentName);
          const locals = [...info.names.keys()].filter(isComponentName);
          const name = candidates.length === 1 ? candidates[0] : locals.length === 1 ? locals[0] : null;
          if (name) {
            setContent(target.path, `${target.content.trimEnd()}\n\nexport default ${name};\n`);
            fixes.push(`${target.path}: added default export ${name}`);
          } else {
            setContent(target.path, `${target.content.trimEnd()}\n\nexport default {};\n`);
            fixes.push(`${target.path}: added empty default export`);
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Declare every known package the sources import but package.json forgot (preview passes, real builds fail).
  try {
    const current = files.find((f) => f.path === 'package.json');
    if (current && typeof current.content === 'string') {
      const normalized = normalizePackageJson(current.content);
      if (normalized.notes.length) {
        files = files.map((f) => (f.path === 'package.json' ? { ...f, content: normalized.content } : f));
        fixes.push(`package.json: normalized dependency specs (${normalized.notes.join('; ')})`);
      }
    }
  } catch { /* invalid package.json is reported by validation */ }
  const pkgFile = files.find((f) => f.path === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const needed = new Set();
      for (const f of files) {
        if (!/^src\/.*\.(?:jsx?|tsx?)$/.test(f.path) || typeof f.content !== 'string') continue;
        for (const m of f.content.matchAll(/(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)) {
          const pkgName = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
          if (KNOWN_PACKAGES[pkgName] && !declared[pkgName]) needed.add(pkgName);
        }
      }
      if (needed.size) {
        pkg.dependencies = { ...(pkg.dependencies || {}), ...Object.fromEntries([...needed].map((n) => [n, KNOWN_PACKAGES[n]])) };
        files = files.map((f) => (f.path === 'package.json' ? { ...f, content: `${JSON.stringify(pkg, null, 2)}\n` } : f));
        fixes.push(`package.json: declared ${[...needed].join(', ')}`);
      }
    } catch { /* invalid package.json is reported by validation */ }
  }
  const colour = fixColourClasses(files);
  files = colour.files; fixes.push(...colour.fixes);
  const blank = fillEmptyPages(files);
  files = blank.files; fixes.push(...blank.fixes);
  return { files, fixes };
}

module.exports = { autoFix, fixClassList, isEmptyPage, normalizePackageJson };
