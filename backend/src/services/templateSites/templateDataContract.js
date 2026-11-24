/**
 * The contract between a data file and the code that reads it. When a change rewrites the records of src/data/listings.js (houses become
 * programmes) but a page still filters, sorts or searches them by fields the new records no longer have (`l.mode !== filters.mode`,
 * `l.price`, `l.features.join(' ')`), the page builds and opens, yet shows no records at all, or breaks on the first search. This finds
 * those reads before the change is accepted, and tells the AI (in the prompt) which fields and exports other files rely on.
 */
const { parse } = require('@babel/parser');
const pageDistinctness = require('../ai/pageDistinctness');

const SOURCE = /^src\/.+\.(?:jsx?|tsx?)$/;
const DATA = /^src\/data\/.+\.(?:jsx?|tsx?)$/;
const ITERATORS = 'filter|map|find|findIndex|findLast|some|every|forEach|sort|reduce|flatMap';
const textOf = (file) => (file && file.encoding !== 'base64' && typeof file.content === 'string' ? file.content : '');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseModule(source) {
  try { return parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true }); } catch { return null; }
}

/**
 * The exported arrays of records of a data file: Map exportName -> { all: Set (fields every record has), any: Set, count, open }.
 * `open` is true when a record is built with a spread or a computed key (its fields cannot be known).
 */
function recordShapes(source) {
  const shapes = new Map();
  const ast = parseModule(source);
  if (!ast) return shapes;
  const record = (name, node) => {
    // [ ... ].map((l) => ({ ...l, image: img(l.img) })): the records are the array literal; the call may add fields, never remove them.
    if (node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && /^(?:map|filter|slice|sort|concat)$/.test(node.callee.property?.name || '')) node = node.callee.object;
    if (!node || node.type !== 'ArrayExpression' || !node.elements.length) return;
    const objects = node.elements.filter((item) => item && item.type === 'ObjectExpression');
    if (!objects.length || objects.length !== node.elements.length) return;
    let all = null;
    const any = new Set();
    const ids = [];
    const byKey = { id: [], slug: [] };
    let open = false;
    for (const object of objects) {
      const keys = new Set();
      for (const prop of object.properties) {
        if (prop.type === 'SpreadElement' || prop.computed) { open = true; continue; }
        const key = prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.type === 'StringLiteral' ? prop.key.value : null;
        if (key) keys.add(key);
        if ((key === 'id' || key === 'slug') && (prop.value?.type === 'StringLiteral' || prop.value?.type === 'NumericLiteral')) byKey[key].push(String(prop.value.value));
      }
      keys.forEach((key) => any.add(key));
      all = all ? new Set([...all].filter((key) => keys.has(key))) : keys;
    }
    ids.push(...byKey.id);
    shapes.set(name, { all: all || new Set(), any, ids, keys: byKey, count: objects.length, open });
  };
  for (const node of ast.program.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : null;
    if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) if (item.id?.type === 'Identifier') record(item.id.name, item.init);
    if (node.type === 'ExportDefaultDeclaration') record('default', node.declaration);
  }
  return shapes;
}

/** The text of the call that starts at `open` (the index of its "("), up to the matching ")". */
function callBody(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return source.slice(open, i + 1); }
  }
  return source.slice(open);
}

/**
 * The fields of the records that `source` reads through `name` (the imported array): the parameters of the callbacks of
 * `name.filter((l) => ...)`, `name.map(...)`, `[...name].sort((a, b) => ...)` and of the arrays derived from it in one step
 * (`const out = name.filter(...)`; `out.map((l) => ...)`), and what is read from them (`l.price`). Returns Set of field names.
 */
function fieldsRead(source, name) {
  const fields = new Set();
  const names = new Set([name]);
  // Arrays derived from the records in one step keep the same records.
  for (const match of source.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:\\[\\s*\\.\\.\\.\\s*)?${escape(name)}\\b\\s*(?:\\]|\\.(?:${ITERATORS}|slice|filter|concat)\\b)`, 'g'))) names.add(match[1]);
  for (const holder of names) {
    const calls = new RegExp(`(?:\\b${escape(holder)}|\\[\\s*\\.\\.\\.\\s*${escape(holder)}\\s*\\])\\s*\\.\\s*(?:${ITERATORS})\\s*\\(`, 'g');
    for (const match of source.matchAll(calls)) {
      const body = callBody(source, match.index + match[0].length - 1);
      const params = (/^\(\s*(?:\(\s*([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/.exec(body) || /^\(\s*function\s*\(([^)]*)\)/.exec(body) || []);
      const list = String(params[1] || params[2] || '').split(',').map((item) => item.trim()).filter((item) => /^[A-Za-z_$][\w$]*$/.test(item));
      // reduce((sum, item) => ...): the record is the second parameter; every other iterator: the first (sort: both).
      const records = /\.\s*reduce\s*\($/.test(match[0]) ? list.slice(1, 2) : /\.\s*sort\s*\($/.test(match[0]) ? list.slice(0, 2) : list.slice(0, 1);
      for (const param of records) {
        for (const read of body.matchAll(new RegExp(`(?<![\\w$.])${escape(param)}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, 'g'))) fields.add(read[1]);
        // const { price, beds } = l
        for (const read of body.matchAll(new RegExp(`\\{([^{}]+)\\}\\s*=\\s*${escape(param)}\\b`, 'g'))) read[1].split(',').map((item) => item.split(':')[0].trim()).filter(Boolean).forEach((item) => fields.add(item));
      }
    }
  }
  return fields;
}

/** Files that import something from `target`: [{ path, imported: [{ local, original }] }]. */
function importersOf(files, target) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const out = [];
  for (const file of files) {
    if (!SOURCE.test(file.path) || file.path === target) continue;
    const source = textOf(file);
    if (!source) continue;
    const imported = [];
    for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
      const resolved = pageDistinctness.resolveImport(file.path, match[3], byPath);
      if (resolved !== target) continue;
      if (match[1]) imported.push({ local: match[1], original: 'default' });
      for (const part of String(match[2] || '').split(',')) {
        const [original, alias] = part.trim().split(/\s+as\s+/).map((item) => item && item.trim());
        if (original) imported.push({ local: alias || original, original });
      }
    }
    if (imported.length) out.push({ path: file.path, imported });
  }
  return out;
}

/** The names a module exports (named exports; "default" when it has a default export). */
function exportNames(source) {
  const names = new Set();
  const ast = parseModule(source);
  if (!ast) return names;
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') names.add('default');
    if (node.type !== 'ExportNamedDeclaration') continue;
    const declaration = node.declaration;
    if (declaration?.type === 'VariableDeclaration') declaration.declarations.forEach((item) => item.id?.type === 'Identifier' && names.add(item.id.name));
    else if (declaration?.id?.name) names.add(declaration.id.name);
    for (const spec of node.specifiers || []) names.add(spec.exported?.name || spec.exported?.value);
  }
  return names;
}

/**
 * Problems a changed data file causes for the files that read it: fields every old record had, that the new records lack, and that
 * a reader still uses. Returns [{ path, dataPath, exportName, fields, reader, owned }].
 */
function brokenReads({ baseline = [], candidate = [], changedPaths = [], owned = new Set() }) {
  const found = [];
  const before = new Map(baseline.map((file) => [file.path, file]));
  for (const dataPath of changedPaths.filter((path) => DATA.test(path))) {
    const oldSource = textOf(before.get(dataPath));
    const newSource = textOf(candidate.find((file) => file.path === dataPath));
    if (!oldSource || !newSource) continue;
    const oldShapes = recordShapes(oldSource);
    const newShapes = recordShapes(newSource);
    for (const [exportName, oldShape] of oldShapes) {
      const newShape = newShapes.get(exportName);
      if (!newShape || newShape.open || oldShape.open) continue;
      const removed = [...oldShape.all].filter((field) => !newShape.any.has(field));
      if (!removed.length) continue;
      for (const reader of importersOf(candidate, dataPath)) {
        const local = reader.imported.find((item) => item.original === exportName)?.local;
        if (!local) continue;
        const reads = fieldsRead(textOf(candidate.find((file) => file.path === reader.path)), local);
        const fields = removed.filter((field) => reads.has(field));
        if (fields.length) found.push({ path: reader.path, dataPath, exportName, fields, owned: owned.has(reader.path) });
      }
    }
  }
  return found;
}

/** Names that other files import from a changed file and that it no longer exports: [{ path, name, importers: [path] }]. */
function brokenExports({ baseline = [], candidate = [], changedPaths = [] }) {
  const found = [];
  const before = new Map(baseline.map((file) => [file.path, file]));
  for (const path of changedPaths.filter((item) => SOURCE.test(item))) {
    const oldSource = textOf(before.get(path));
    const newSource = textOf(candidate.find((file) => file.path === path));
    if (!oldSource || !newSource) continue;
    const had = exportNames(oldSource);
    const has = exportNames(newSource);
    const lost = [...had].filter((name) => !has.has(name));
    if (!lost.length) continue;
    for (const name of lost) {
      const importers = importersOf(candidate, path).filter((reader) => reader.imported.some((item) => item.original === name)).map((reader) => reader.path);
      if (importers.length) found.push({ path, name, importers });
    }
  }
  return found;
}

/**
 * For the prompt: who else uses each file the AI may change, and which record fields they read, so a change keeps them working.
 * Returns '' when nothing else depends on those files.
 */
function usageNotes(files, ownedPaths) {
  const lines = [];
  for (const path of ownedPaths) {
    const readers = importersOf(files, path);
    if (!readers.length) continue;
    const parts = readers.map((reader) => {
      const names = reader.imported.map((item) => (item.original === 'default' ? 'the default export' : item.original));
      let fields = [];
      if (DATA.test(path)) {
        const source = textOf(files.find((file) => file.path === reader.path));
        fields = [...new Set(reader.imported.flatMap((item) => [...fieldsRead(source, item.local)]))];
      }
      return `${reader.path} imports ${[...new Set(names)].join(', ')}${fields.length ? ` and reads the fields ${fields.join(', ')} of its records` : ''}`;
    });
    lines.push(`- ${path}: ${parts.join('; ')}.`);
  }
  if (!lines.length) return '';
  return `OTHER FILES THAT USE THE FILES YOU MAY CHANGE (keep them working):\n${lines.join('\n')}\nKeep every export they import. When you change the records of a data file, every file that reads them must still work: either keep the fields it reads (with values that make sense for the new records), or, if that file is one you may change, change its filters, sorting and search to the new fields in the same answer. A filter on a field the records no longer have (for example \`l.mode !== filters.mode\`) hides every record and leaves the page empty.`;
}

/**
 * A detail page of a template is one SAMPLE of a dynamic route: the "Program Detail" page is /listings/k-1001, served by /listings/:id.
 * When the records are rewritten, the record k-1001 may be gone: the page then opens on "not found" (and its build check still passes,
 * because a not-found page opens too). Returns the route the page should use now (the same place in the route, an id that exists),
 * or null when the route is fine or cannot be judged.
 */
function sampleRoute(files, page) {
  const route = String(page?.route || '');
  if (!route || !page?.componentPath) return null;
  const routeMatches = require('./templateValidationService').routeMatches;
  const pattern = pageDistinctness.extractRoutes(files).find((item) => /\/:/.test(item.path) && routeMatches(item.path, route) && (!item.target || item.target === page.componentPath));
  if (!pattern) return null;
  const parts = pattern.path.split('/').filter(Boolean);
  const actual = route.split('/').filter(Boolean);
  const at = parts.findIndex((part) => part.startsWith(':'));
  if (at < 0 || parts.filter((part) => part.startsWith(':')).length !== 1) return null;
  const value = decodeURIComponent(actual[at] || '');
  // The record is looked up by the route's own parameter: /listings/:id by its id, /neighbourhoods/:slug by its slug.
  const key = /^:slug$/i.test(parts[at]) ? 'slug' : /^:id$/i.test(parts[at]) ? 'id' : null;
  if (!key || !value) return null;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const data = pageDistinctness.reachableFiles(page.componentPath, byPath, 1).filter((path) => DATA.test(path));
  // Still written in one of the files the page reads (as a record of another kind, a slug, a link): the record is not gone.
  const literal = new RegExp(`(['"\`])${escape(value)}\\1`);
  if (data.some((path) => literal.test(textOf(byPath.get(path))))) return null;
  // Exactly one data file holds records with that key: otherwise it cannot be told which records the page shows.
  const withKey = data.map((path) => ({ path, ids: [...recordShapes(textOf(byPath.get(path))).values()].flatMap((shape) => shape.keys[key]) })).filter((item) => item.ids.length);
  // Several files hold such records (neighbourhoods and agents both have slugs): the one named like the route (/neighbourhoods/:slug).
  const named = withKey.filter((item) => item.path.split('/').pop().replace(/\.[jt]sx?$/, '').toLowerCase() === String(parts[0] || '').toLowerCase());
  const source = withKey.length === 1 ? withKey[0] : named.length === 1 ? named[0] : null;
  if (!source) return null;
  const ids = source.ids;
  const next = [...actual];
  next[at] = encodeURIComponent(ids[0]);
  return `/${next.join('/')}`;
}

module.exports = { sampleRoute, recordShapes, fieldsRead, importersOf, exportNames, brokenReads, brokenExports, usageNotes };
