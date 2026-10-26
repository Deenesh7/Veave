const crypto = require('crypto');
const parser = require('@babel/parser');

/**
 * Structural (syntax-aware) context for the incremental editor.
 *
 * What it does
 *  - Parses JS/JSX/TS/TSX with Babel (already a dependency; error-recovering, exact source offsets, no program setup needed) and
 *    splits CSS into top-level rules, so a target file can be shown as the COMPLETE syntax units that matter instead of the
 *    whole file.
 *  - Never shows a partial syntax node. A file is shown in part only when the evidence is clear; anything else (parse failure,
 *    no clear owner, ambiguous matches, small files, nothing saved) falls back to the whole file.
 *  - Keeps an edit plan (file hash + the units the model actually saw) so a patch can be checked BEFORE it is applied: stale
 *    source, a patch that lands in code the model never saw, and a rewrite of a partly shown file are all rejected.
 *  - Re-parses the result AFTER the patch: syntax, removed or replaced symbols, unexpected changes to units outside the approved
 *    region, undeclared JSX components and unresolved relative imports.
 *
 * Semantics that cannot be decided from syntax alone (what an element is FOR, which route renders it, which file a symbol comes
 * from) still come from the existing evidence: the hybrid search / LSP resolution, the import graph and the user's request.
 * The TypeScript Compiler API was evaluated: it needs a Program (config, lib files, every dependency) to resolve anything beyond
 * syntax, and that cross-file resolution already exists in the language-server layer. Babel gives the same syntax ranges
 * for far less work per edit, so it is used here.
 *
 * Parsed analyses are content-addressed (project key + path + sha1 of the text), so an entry can never describe different
 * source than the one it was built from; `evict` drops everything for a project.
 */

const CODE_RE = /\.(?:jsx?|tsx?|mjs|cjs)$/i;
const CSS_RE = /\.(?:css|scss)$/i;
const sha = (text) => crypto.createHash('sha1').update(String(text ?? '')).digest('hex');

const config = () => ({
  enabled: process.env.INCREMENTAL_STRUCTURAL !== '0',
  minFileChars: Number.parseInt(process.env.INCREMENTAL_STRUCTURAL_MIN_FILE_CHARS, 10) || 6000,
  maxUnits: Number.parseInt(process.env.INCREMENTAL_STRUCTURAL_MAX_UNITS, 10) || 5,
  maxShareOfFile: Number(process.env.INCREMENTAL_STRUCTURAL_MAX_SHARE) || 0.7,
  glueChars: 160,
  cacheEntries: Number.parseInt(process.env.INCREMENTAL_STRUCTURAL_CACHE_ENTRIES, 10) || 800
});

/* ----------------------------------------------------------------- cache */

const cache = new Map(); // `${project}|${path}|${hash}` -> analysis (insertion order = LRU order)
const counters = { parsed: 0, reused: 0, failed: 0 };

function remember(key, value) {
  cache.set(key, value);
  const limit = config().cacheEntries;
  while (cache.size > limit) cache.delete(cache.keys().next().value);
}

function evict(projectKey) {
  const prefix = `${String(projectKey)}|`;
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

function stats() { return { ...counters, entries: cache.size }; }
function resetStats() { counters.parsed = 0; counters.reused = 0; counters.failed = 0; }

/* ------------------------------------------------------------------ JS */

function parseJs(filePath, content, { strict = false } = {}) {
  const isTs = /\.tsx?$/i.test(filePath);
  const base = { sourceType: 'unambiguous', allowReturnOutsideFunction: true, errorRecovery: !strict, ranges: false };
  const attempts = isTs ? [['typescript', 'jsx'], ['typescript']] : [['jsx'], ['typescript', 'jsx']];
  let lastError = null;
  for (const plugins of attempts) {
    try {
      const ast = parser.parse(content, { ...base, plugins });
      if (!strict && ast.errors?.length) { lastError = new Error(ast.errors[0].message); continue; }
      return { ast, error: null };
    } catch (error) { lastError = error; }
  }
  return { ast: null, error: lastError };
}

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens', 'errors']);
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node.type !== 'string') return;
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) if (!SKIP.has(key)) walk(node[key], visit);
}

function jsxTagName(name) {
  if (!name) return '';
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return jsxTagName(name.object);
  return '';
}

/** Names declared by a top-level statement: [{ name, kind }]. */
function declaredNames(stmt) {
  let decl = stmt;
  let exported = false;
  let isDefault = false;
  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    exported = true;
    isDefault = stmt.type === 'ExportDefaultDeclaration';
    decl = stmt.declaration;
  }
  const out = [];
  if (!decl) return { names: out, exported, isDefault };
  if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) out.push(decl.id.name);
  else if (decl.type === 'VariableDeclaration') { for (const d of decl.declarations) if (d.id?.type === 'Identifier') out.push(d.id.name); }
  else if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration' || decl.type === 'TSEnumDeclaration') out.push(decl.id.name);
  return { names: out, exported, isDefault };
}

function analyseJs(filePath, content) {
  const { ast, error } = parseJs(filePath, content);
  if (!ast) return { ok: false, error: error?.message || 'parse failed', kind: 'js', units: [], imports: [], header: { start: 0, end: 0 } };
  const lines = [0];
  for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10) lines.push(i + 1);
  const lineOf = (offset) => { let lo = 0; let hi = lines.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };

  const imports = [];
  const units = [];
  let headerEnd = 0;
  const seen = new Map();
  ast.program.body.forEach((stmt, order) => {
    if (stmt.type === 'ImportDeclaration') {
      imports.push({ source: stmt.source.value, locals: stmt.specifiers.map((s) => s.local.name) });
      headerEnd = Math.max(headerEnd, stmt.end);
      return;
    }
    const start = stmt.leadingComments?.length ? Math.min(stmt.start, stmt.leadingComments[0].start) : stmt.start;
    const { names, exported, isDefault } = declaredNames(stmt);
    const primary = names[0] || (isDefault && (stmt.declaration?.id?.name || null)) || null;
    const baseKey = primary || `stmt:${stmt.type}`;
    const count = (seen.get(baseKey) || 0) + 1;
    seen.set(baseKey, count);
    const tags = new Set();
    const classNames = new Set();
    const words = new Set();
    const refs = new Set();
    let hasJsx = false;
    walk(stmt, (node) => {
      if (node.type === 'JSXOpeningElement') {
        hasJsx = true;
        const tag = jsxTagName(node.name);
        if (tag) tags.add(tag);
        for (const attr of node.attributes || []) {
          if (attr.type === 'JSXAttribute' && /^(?:className|id)$/.test(attr.name?.name || '')) {
            const value = attr.value;
            if (value?.type === 'StringLiteral') value.value.split(/\s+/).filter(Boolean).forEach((c) => classNames.add(c));
            else if (value?.type === 'JSXExpressionContainer') walk(value.expression, (n) => { if (n.type === 'StringLiteral' || n.type === 'TemplateElement') String(n.value?.raw ?? n.value ?? '').split(/\s+/).filter(Boolean).forEach((c) => classNames.add(c)); });
          }
        }
      } else if (node.type === 'JSXText') {
        const text = node.value.trim();
        if (text) words.add(text.slice(0, 120));
      } else if (node.type === 'StringLiteral' && node.value.length < 160) words.add(node.value);
      else if (node.type === 'Identifier') refs.add(node.name);
      else if (node.type === 'JSXIdentifier' && /^[A-Z]/.test(node.name)) refs.add(node.name);
    });
    const looksComponent = hasJsx && primary && /^[A-Z]/.test(primary);
    units.push({
      key: count === 1 ? baseKey : `${baseKey}#${count}`, name: primary, names, order, start, end: stmt.end, startLine: lineOf(start), endLine: lineOf(Math.max(start, stmt.end - 1)),
      kind: !primary ? 'statement' : looksComponent ? 'component' : /^use[A-Z0-9]/.test(primary) ? 'hook' : 'declaration', exported, isDefault,
      tags: [...tags], classNames: [...classNames], words: [...words].slice(0, 200), refs: [...refs]
    });
  });
  return { ok: true, error: null, kind: 'js', units, imports, header: { start: 0, end: headerEnd } };
}

/* ----------------------------------------------------------------- CSS */

/** Top-level CSS rules / at-rules with their exact ranges (strings and comments are skipped when counting braces). */
function analyseCss(content) {
  const units = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = content.length;
  const flush = (end) => {
    const text = content.slice(start, end);
    if (!text.trim()) return;
    const selector = text.slice(0, Math.max(0, text.indexOf('{') < 0 ? text.length : text.indexOf('{'))).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const classes = [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    // The classes used by rules nested in an at-rule (@media) count too.
    if (/^@/.test(selector)) for (const m of text.matchAll(/\.(-?[_a-zA-Z][\w-]*)\s*[{,:.\s>+~[]/g)) classes.push(m[1]);
    units.push({ key: `css:${selector.slice(0, 80)}#${units.length}`, name: selector.slice(0, 80), names: [selector.slice(0, 80)], order: units.length, start, end, kind: 'rule', classNames: [...new Set(classes)], tags: [], words: [], refs: [] });
  };
  while (i < n) {
    const ch = content[i];
    if (ch === '/' && content[i + 1] === '*') { const close = content.indexOf('*/', i + 2); i = close < 0 ? n : close + 2; continue; }
    if (ch === '"' || ch === "'") { let j = i + 1; while (j < n && content[j] !== ch) j += content[j] === '\\' ? 2 : 1; i = j + 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { flush(i + 1); start = i + 1; } if (depth < 0) return { ok: false, error: 'unbalanced braces', kind: 'css', units: [], imports: [], header: { start: 0, end: 0 } }; }
    else if (ch === ';' && depth === 0) { flush(i + 1); start = i + 1; }
    i += 1;
  }
  if (depth !== 0) return { ok: false, error: 'unbalanced braces', kind: 'css', units: [], imports: [], header: { start: 0, end: 0 } };
  if (content.slice(start).trim()) flush(n);
  // Leading whitespace belongs to no unit; trim each range to its code.
  for (const unit of units) {
    const text = content.slice(unit.start, unit.end);
    unit.start += text.length - text.trimStart().length;
    unit.end -= text.length - text.trimEnd().length;
  }
  return { ok: true, error: null, kind: 'css', units, imports: [], header: { start: 0, end: 0 } };
}

/** Parsed (or reused) analysis of one file. Content-addressed; `fromCache` tells whether the tree was reused. */
function analyse(filePath, content, projectKey = '_') {
  const text = String(content ?? '');
  const hash = sha(text);
  const key = `${projectKey}|${filePath}|${hash}`;
  const hit = cache.get(key);
  if (hit) { counters.reused += 1; cache.delete(key); cache.set(key, hit); return hit; }
  let result;
  try {
    result = CODE_RE.test(filePath) ? analyseJs(filePath, text) : CSS_RE.test(filePath) ? analyseCss(text) : { ok: false, error: 'unsupported file type', kind: 'other', units: [], imports: [], header: { start: 0, end: 0 } };
  } catch (error) {
    result = { ok: false, error: error.message, kind: 'other', units: [], imports: [], header: { start: 0, end: 0 } };
  }
  result.hash = hash;
  result.length = text.length;
  result.path = filePath;
  if (result.ok) counters.parsed += 1; else counters.failed += 1;
  remember(key, result);
  return result;
}

/* ------------------------------------------------------------ selection */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words from the request that identify code: quoted text, identifiers, class-like tokens. */
function requestTerms(prompt = '') {
  const text = String(prompt || '');
  const quoted = [...text.matchAll(/["'“”‘’`]([^"'“”‘’`]{2,80})["'“”‘’`]/g)].map((m) => m[1].trim()).filter(Boolean);
  const identifiers = [...new Set((text.match(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[a-z0-9]+(?:[-_][a-z0-9]+)+\b/g) || []))];
  return { quoted, identifiers };
}

/**
 * Decides how one target file is shown. Returns { mode: 'full'|'excerpt', reason, ... }.
 * `focus` = { names: [component/function names the resolver identified], classNames: [...] } for this file (from search/LSP evidence).
 */
function planFile(file, { prompt = '', focus = null, projectKey = '_', forceFull = false } = {}) {
  const cfg = config();
  const full = (reason, extra = {}) => ({ path: file.path, mode: 'full', reason, hash: sha(file.content), chars: String(file.content || '').length, shownChars: String(file.content || '').length, ...extra });
  const content = String(file.content ?? '');
  if (!cfg.enabled) return full('structural retrieval disabled');
  if (forceFull) return full('this request needs whole-file context');
  if (file.encoding === 'base64' || typeof file.content !== 'string') return full('not a text file');
  if (!CODE_RE.test(file.path) && !CSS_RE.test(file.path)) return full('unsupported file type');
  if (content.length < cfg.minFileChars) return full('file is small');
  const analysis = analyse(file.path, content, projectKey);
  if (!analysis.ok) return full(`parser could not read the file (${String(analysis.error).slice(0, 80)})`);
  const units = analysis.units;
  if (units.length < 2) return full('file has a single syntax unit');

  const terms = requestTerms(prompt);
  const focusNames = new Set((focus?.names || []).map((n) => String(n).toLowerCase()));
  const focusClasses = new Set(focus?.classNames || []);
  const scored = units.map((unit) => {
    let score = 0;
    const why = [];
    if (unit.names.some((n) => focusNames.has(String(n).toLowerCase()))) { score += 100; why.push('named by the resolver'); }
    const lower = unit.names.map((n) => String(n).toLowerCase());
    for (const id of terms.identifiers) if (lower.includes(id.toLowerCase())) { score += 80; why.push(`named in the request (${id})`); }
    if (unit.classNames.some((c) => focusClasses.has(c))) { score += 40; why.push('uses the target class'); }
    for (const phrase of terms.quoted) {
      const needle = phrase.toLowerCase();
      if (unit.words.some((w) => w.toLowerCase().includes(needle)) || unit.classNames.some((c) => c.toLowerCase() === needle)) { score += 60; why.push(`contains "${phrase.slice(0, 30)}"`); }
    }
    return { unit, score, why };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.unit.order - b.unit.order);
  if (!matched.length) return full('no unit identified by the request or the resolver');
  const strongest = matched[0].score;
  const chosen = matched.filter((s) => s.score >= Math.max(40, strongest * 0.5));
  if (chosen.length > cfg.maxUnits) return full(`ambiguous: ${chosen.length} units match equally well`);
  // A weak, tied match is a guess; only name-based or text-based evidence is trusted to narrow the view.
  if (strongest < 60) return full('only weak evidence (class match) for this file');
  if (matched.filter((s) => s.score === strongest).length > 2 && strongest < 100) return full('ambiguous: several units contain the same text');

  const shown = new Map(chosen.map((s) => [s.unit.key, s.unit]));
  // Dependencies: top-level declarations the shown units use (components, data, helpers), transitively. Whole units only.
  const byName = new Map();
  for (const unit of units) for (const name of unit.names) if (name && !byName.has(name)) byName.set(name, unit);
  for (let round = 0; round < 3; round += 1) {
    let added = false;
    for (const unit of [...shown.values()]) {
      for (const ref of unit.refs) {
        const dep = byName.get(ref);
        if (dep && !shown.has(dep.key)) { shown.set(dep.key, dep); added = true; }
      }
    }
    if (!added) break;
  }
  // Tiny statements (export default X; const x = 1;) are glue and cost nothing.
  for (const unit of units) if (unit.end - unit.start <= cfg.glueChars && !shown.has(unit.key)) shown.set(unit.key, unit);

  const ordered = [...shown.values()].sort((a, b) => a.order - b.order);
  const headerChars = analysis.header.end;
  const bodyChars = ordered.reduce((sum, unit) => sum + (unit.end - unit.start), 0);
  if ((headerChars + bodyChars) > content.length * cfg.maxShareOfFile) return full('the relevant units are most of the file');

  // Render: header, then each shown unit in source order; every gap says what was left out.
  const parts = [];
  let cursor = analysis.header.end;
  if (analysis.header.end > 0) parts.push(content.slice(0, analysis.header.end));
  const omittedNames = [];
  const marker = (from, to) => {
    const hidden = units.filter((u) => u.start >= from && u.end <= to && !shown.has(u.key));
    if (!hidden.length) return null;
    const names = hidden.map((u) => u.name || u.kind).slice(0, 12);
    omittedNames.push(...hidden.map((u) => u.key));
    const first = content.slice(0, hidden[0].start).split('\n').length;
    const last = content.slice(0, hidden[hidden.length - 1].end).split('\n').length;
    return `/* VEAVE-OMITTED: lines ${first}-${last} are NOT shown (${names.join(', ')}${hidden.length > names.length ? ', ...' : ''}). This note is not file content; never put it in a SEARCH block. */`;
  };
  for (const unit of ordered) {
    const gap = marker(cursor, unit.start);
    if (gap) parts.push(gap);
    parts.push(content.slice(unit.start, unit.end));
    cursor = unit.end;
  }
  const tail = marker(cursor, content.length);
  if (tail) parts.push(tail);
  const excerpt = parts.join('\n\n');
  if (!omittedNames.length) return full('nothing could be left out');
  return {
    path: file.path, mode: 'excerpt', hash: analysis.hash, chars: content.length, shownChars: excerpt.length, excerpt,
    reason: `${chosen.map((s) => `${s.unit.name || s.unit.kind} (${s.why[0]})`).join('; ')}`,
    visible: ordered.map((u) => u.key), omitted: omittedNames, headerEnd: analysis.header.end, units: ordered.map((u) => ({ key: u.key, name: u.name, startLine: u.startLine, endLine: u.endLine }))
  };
}

/**
 * Builds the context for every target file. Returns { files: [{ file, plan, text }], plan, metrics }.
 * `focusByPath`: { [path]: { names, classNames } }.
 */
function buildTargetContext(targetFiles = [], { prompt = '', focusByPath = {}, projectKey = '_', forceFull = false, allowPaths = null, realFiles = null } = {}) {
  const before = stats();
  // The model may be shown a compacted view (image data replaced by tokens); the plan's hash must describe the REAL saved source.
  const realHash = new Map((realFiles || []).filter((f) => f && typeof f.content === 'string').map((f) => [f.path, sha(f.content)]));
  const files = targetFiles.map((file) => {
    const forced = forceFull || (allowPaths && !allowPaths.has(file.path));
    const plan = planFile(file, { prompt, focus: focusByPath[file.path] || null, projectKey, forceFull: Boolean(forced) });
    if (realHash.has(file.path)) plan.hash = realHash.get(file.path);
    return { file, plan, text: plan.mode === 'excerpt' ? plan.excerpt : String(file.content || '') };
  });
  const after = stats();
  const fullChars = files.reduce((n, f) => n + f.plan.chars, 0);
  const shownChars = files.reduce((n, f) => n + f.plan.shownChars, 0);
  const metrics = {
    files: files.length, excerptFiles: files.filter((f) => f.plan.mode === 'excerpt').length, fullFiles: files.filter((f) => f.plan.mode === 'full').length,
    fullFileFallbacks: files.filter((f) => f.plan.mode === 'full' && f.plan.chars >= config().minFileChars).length,
    fallbackReasons: files.filter((f) => f.plan.mode === 'full' && f.plan.chars >= config().minFileChars).map((f) => `${f.plan.path}: ${f.plan.reason}`),
    fullChars, shownChars, savedChars: fullChars - shownChars, reductionPct: fullChars ? Math.round(((fullChars - shownChars) / fullChars) * 1000) / 10 : 0,
    estimatedTokens: Math.ceil(shownChars / 4), estimatedTokensFull: Math.ceil(fullChars / 4),
    treesParsed: after.parsed - before.parsed, treesReused: after.reused - before.reused, parseFailures: after.failed - before.failed
  };
  return { files, plan: { files: files.map((f) => f.plan) }, metrics };
}

/* ----------------------------------------------------- pre-apply checks */

class StructuralEditError extends Error {
  constructor(message) { super(message); this.name = 'StructuralEditError'; }
}

function unitAt(analysis, from, to) {
  return analysis.units.filter((u) => u.start < to && from < u.end);
}

/**
 * Checks operations against what the model was actually shown. Throws StructuralEditError on the first problem.
 * `currentFiles`: the project files the patch will be applied to.
 */
function assertOperationsMatchPlan(plan, operations = [], currentFiles = [], { projectKey = '_' } = {}) {
  if (!plan?.files?.length) return { checked: 0 };
  const byPath = new Map((currentFiles || []).filter(Boolean).map((f) => [f.path, f]));
  const planByPath = new Map(plan.files.map((p) => [p.path, p]));
  let checked = 0;
  for (const op of operations) {
    const filePlan = planByPath.get(op.path);
    if (!filePlan) continue;
    const current = byPath.get(op.path);
    if (!current) throw new StructuralEditError(`"${op.path}" is not in the project; the edit refers to a path that does not exist.`);
    if (sha(current.content) !== filePlan.hash && typeof current.content === 'string') {
      throw new StructuralEditError(`"${op.path}" changed after its source was read (stale source); the edit was not applied.`);
    }
    if (filePlan.mode !== 'excerpt') { checked += 1; continue; }
    if (op.operation !== 'patch') throw new StructuralEditError(`"${op.path}" was shown only in part, so it cannot be ${op.operation === 'delete' ? 'deleted' : 'rewritten'} as a whole; use a PATCH on the shown code.`);
    const content = current.content;
    const at = content.indexOf(op.search);
    if (at < 0) continue; // the normal apply step reports a missing search block with its own message
    if (content.indexOf(op.search, at + 1) >= 0) throw new StructuralEditError(`The search text in "${op.path}" matches more than one place; it must identify exactly one.`);
    const analysis = analyse(op.path, content, projectKey);
    if (!analysis.ok) continue; // cannot place the range; the rest of the pipeline still validates the result
    const end = at + op.search.length;
    const visible = new Set(filePlan.visible);
    const touched = unitAt(analysis, at, end);
    const insideHeader = end <= analysis.header.end;
    const hidden = touched.filter((u) => !visible.has(u.key));
    if (hidden.length && !insideHeader) {
      throw new StructuralEditError(`The patch for "${op.path}" changes ${hidden.map((u) => u.name || u.kind).slice(0, 4).join(', ')}, which was not part of the code shown for this request.`);
    }
    checked += 1;
  }
  return { checked };
}

/* ---------------------------------------------------- post-apply checks */

const REMOVAL_INTENT = /\b(remove|delete|drop|get rid of|replace|rename|split|merge|move|refactor|convert|rewrite|redesign|rebuild|restructure|extract)\b/i;
const BUILTIN_TAGS = new Set(['Fragment', 'Suspense', 'StrictMode', 'Profiler']);

function bindingNames(ast) {
  const names = new Set();
  walk(ast.program, (node) => {
    if (node.type === 'Identifier') names.add(node.name);
    if (node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') names.add(node.local.name);
  });
  return names;
}

function jsxTagsOf(ast) {
  const tags = new Set();
  walk(ast.program, (node) => { if (node.type === 'JSXOpeningElement') { const t = jsxTagName(node.name); if (/^[A-Z]/.test(t)) tags.add(t); } });
  return tags;
}

/**
 * Re-parses every changed code file and compares it with the version before the edit.
 * Returns { ok, issues: [string], checkedFiles }. Never throws.
 */
function validateAppliedStructure({ before = [], after = [], plan = null, prompt = '', operations = [], resolveImportPath = null, projectKey = '_' } = {}) {
  const issues = [];
  const beforeMap = new Map(before.filter(Boolean).map((f) => [f.path, f]));
  const afterMap = new Map(after.filter(Boolean).map((f) => [f.path, f]));
  const allPaths = new Set(afterMap.keys());
  const planByPath = new Map((plan?.files || []).map((p) => [p.path, p]));
  const removalAllowed = REMOVAL_INTENT.test(String(prompt || ''));
  let checkedFiles = 0;
  for (const [filePath, next] of afterMap) {
    const prev = beforeMap.get(filePath);
    if (!next || typeof next.content !== 'string' || next.encoding === 'base64') continue;
    if (prev && prev.content === next.content) continue;
    if (!CODE_RE.test(filePath)) {
      if (CSS_RE.test(filePath)) {
        const css = analyseCss(next.content);
        checkedFiles += 1;
        if (!css.ok) issues.push(`${filePath}: stylesheet is not balanced after the edit (${css.error}).`);
      }
      continue;
    }
    checkedFiles += 1;
    const strict = parseJs(filePath, next.content, { strict: true });
    if (!strict.ast) { issues.push(`${filePath}: syntax error after the edit: ${String(strict.error?.message || 'unparseable').slice(0, 160)}`); continue; }
    // Protocol text that leaked into the source (a <REPLACE> or <SEARCH> tag nested inside the edit) is never valid code.
    const leaked = (text) => /<\/?(?:SEARCH|REPLACE|PATCH)\b/.test(text);
    if (leaked(next.content) && !(prev && typeof prev.content === 'string' && leaked(prev.content))) { issues.push(`${filePath}: the edit left <SEARCH>/<REPLACE>/<PATCH> protocol tags inside the source.`); continue; }
    if (!prev || typeof prev.content !== 'string') continue; // a new file: syntax is all that can be compared
    const prevAnalysis = analyse(filePath, prev.content, projectKey);
    const nextAnalysis = analyse(filePath, next.content, projectKey);
    if (!prevAnalysis.ok || !nextAnalysis.ok) continue;
    // Symbols that disappeared.
    if (!removalAllowed) {
      const nextNames = new Set(nextAnalysis.units.flatMap((u) => u.names));
      const lost = prevAnalysis.units.filter((u) => u.names.length && u.names.every((n) => !nextNames.has(n)) && (u.kind === 'component' || u.exported));
      if (lost.length) issues.push(`${filePath}: ${lost.map((u) => u.name).slice(0, 4).join(', ')} no longer exists after the edit, but the request did not ask to remove or replace it.`);
    }
    // Units outside the approved region must be untouched.
    const filePlan = planByPath.get(filePath);
    if (filePlan?.mode === 'excerpt') {
      const visible = new Set(filePlan.visible);
      const nextByKey = new Map(nextAnalysis.units.map((u) => [u.key, u]));
      const changedHidden = prevAnalysis.units.filter((u) => !visible.has(u.key)).filter((u) => {
        const now = nextByKey.get(u.key);
        return !now || next.content.slice(now.start, now.end) !== prev.content.slice(u.start, u.end);
      });
      if (changedHidden.length) issues.push(`${filePath}: ${changedHidden.map((u) => u.name || u.kind).slice(0, 4).join(', ')} changed although it was outside the approved source region.`);
    }
    // JSX components used by the edit must be declared or imported.
    const bound = bindingNames(strict.ast);
    const prevTags = prevAnalysis.units.flatMap((u) => u.tags);
    const newTags = [...jsxTagsOf(strict.ast)].filter((t) => !prevTags.includes(t) && !BUILTIN_TAGS.has(t));
    const unresolved = newTags.filter((t) => !bound.has(t));
    if (unresolved.length) issues.push(`${filePath}: <${unresolved.slice(0, 4).join('>, <')}> is used but not defined or imported.`);
  }
  // Relative imports added by the edit must resolve to a project file.
  if (typeof resolveImportPath === 'function') {
    for (const [filePath, next] of afterMap) {
      const prev = beforeMap.get(filePath);
      if (!next || !CODE_RE.test(filePath) || typeof next.content !== 'string' || (prev && prev.content === next.content)) continue;
      const nextAnalysis = analyse(filePath, next.content, projectKey);
      if (!nextAnalysis.ok) continue;
      const known = new Set(prev && typeof prev.content === 'string' ? analyse(filePath, prev.content, projectKey).imports.map((i) => i.source) : []);
      for (const imp of nextAnalysis.imports) {
        if (known.has(imp.source) || !imp.source.startsWith('.')) continue;
        if (!resolveImportPath(filePath, imp.source, allPaths)) issues.push(`${filePath}: the new import "${imp.source}" does not match any file in the project.`);
      }
    }
  }
  return { ok: issues.length === 0, issues, checkedFiles };
}

/** Throws StructuralEditError with the first few issues (the message is fed back to the model as new evidence). */
function assertAppliedStructure(args) {
  const result = validateAppliedStructure(args);
  if (!result.ok) throw new StructuralEditError(`Structural check failed: ${result.issues.slice(0, 4).join(' | ')}`);
  return result;
}

module.exports = {
  analyse, analyseCss, planFile, buildTargetContext, assertOperationsMatchPlan, validateAppliedStructure, assertAppliedStructure,
  StructuralEditError, evict, stats, resetStats, requestTerms, config
};
