const path = require('path');

/**
 * LSP-assisted resolution of the files an incremental edit should touch.
 *
 * LSP results are EVIDENCE for choosing files. They are never proof that an edit is correct, they never change files,
 * and any failure falls back to the existing keyword heuristics (passed in as `deps.selectTargetFiles`).
 */

const SYMBOL_KIND = { Class: 5, Function: 12, Variable: 13, Constant: 14 };
const CODE_RE = /\.(?:jsx?|tsx?)$/i;
const STYLE_RE = /\.(?:css|scss)$/i;
const PAGE_DIR_RE = /(?:^|\/)(?:pages?|views?|routes?|screens?)\//i;

const GENERIC = new Set(('the a an and or of to in on at for with from into this that these those it its is are be as by about make change set turn update color colour background text font size bigger smaller larger button buttons link links ' +
  'heading title label badge tab input card section page homepage home element component please should would could want need have has add remove new more less ' +
  'blue red green yellow orange purple pink black white gray grey brown teal cyan indigo violet dark light bold italic center left right top bottom width height padding margin border radius rounded shadow').split(/\s+/));
const ELEMENT_NOUNS = 'button|link|heading|title|label|badge|tab|input|card|icon|image|banner|form|menu|header|footer|navbar|section';

const splitWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function offsetToPosition(text, offset) {
  let line = 0;
  let last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) { line += 1; last = i; }
  return { line, character: offset - last - 1 };
}

function positionToOffset(text, pos) {
  let offset = 0;
  for (let line = 0; line < pos.line; line += 1) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return Math.min(text.length, offset + pos.character);
}

const before = (a, b) => a.line < b.line || (a.line === b.line && a.character <= b.character);
const contains = (range, pos) => before(range.start, pos) && before(pos, range.end);

function flattenSymbols(list, filePath, out, depth = 0) {
  for (const symbol of list || []) {
    if (!symbol || !symbol.name) continue;
    const range = symbol.range || symbol.location?.range;
    const selection = symbol.selectionRange || range;
    if (range && selection) out.push({ name: symbol.name, kind: symbol.kind, path: filePath, range, selection, depth });
    if (depth < 2) flattenSymbols(symbol.children, filePath, out, depth + 1);
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await fn(items[i]); }
  });
  await Promise.all(workers);
  return results;
}

async function buildIndex(lsp, key, files, signal) {
  const cached = lsp.getIndexCache(key);
  if (cached) return cached;
  const targets = files.filter((f) => (CODE_RE.test(f.path) || STYLE_RE.test(f.path)) && typeof f.content === 'string').slice(0, 150);
  const symbols = [];
  let calls = 0;
  let failures = 0;
  await mapLimit(targets, 6, async (file) => {
    calls += 1;
    const list = await lsp.documentSymbols(key, file.path, { signal });
    if (!list) { failures += 1; return; }
    flattenSymbols(list, file.path, symbols);
  });
  const index = { symbols, calls, failures, files: targets.length };
  if (failures < targets.length) lsp.setIndexCache(key, index);
  return index;
}

const isComponentSymbol = (s) => s.depth === 0 && /^[A-Z]/.test(s.name) && [SYMBOL_KIND.Function, SYMBOL_KIND.Variable, SYMBOL_KIND.Constant, SYMBOL_KIND.Class].includes(s.kind);

function promptTerms(prompt) {
  const text = String(prompt || '');
  const quoted = [...text.matchAll(/["'`\u201c\u2018]([^"'`\u201d\u2019]{2,60})["'`\u201d\u2019]/g)].map((m) => m[1].trim());
  const pascal = [...text.matchAll(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g)].map((m) => m[1]);
  const words = (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []);
  const anchors = new Set(quoted);
  const noun = new RegExp(`\\b([A-Za-z][A-Za-z0-9-]{2,})\\s+(?:${ELEMENT_NOUNS})\\b`, 'gi');
  for (const m of text.matchAll(noun)) if (!GENERIC.has(m[1].toLowerCase())) anchors.add(m[1]);
  for (const m of text.matchAll(/(?<!^|[.!?]\s)\b([A-Z][a-z]{3,})\b/g)) if (!GENERIC.has(m[1].toLowerCase())) anchors.add(m[1]);
  // Capitalised words that are not the first word of a sentence may name a component exactly (e.g. "make the Button uppercase").
  const capitalized = [...text.matchAll(/(?<!^|[.!?]\s)\b([A-Z][A-Za-z0-9]{2,})\b/g)].map((m) => m[1]);
  return { quoted, pascal, words, capitalized, anchors: [...anchors] };
}

function detectPage(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (/\b(?:home\s?page|landing\s?page|main page|index page|front page)\b/.test(text)) return { names: ['home', 'homepage', 'index', 'landing', 'main'], label: 'home page' };
  const m = text.match(/\b(?:on|in|of|for)\s+(?:the\s+)?([a-z][a-z0-9-]{2,})\s+page\b/) || text.match(/\b([a-z][a-z0-9-]{2,})\s+page\b/);
  if (m && !GENERIC.has(m[1])) return { names: [m[1], `${m[1]}page`], label: `${m[1]} page` };
  return null;
}

function findPageFile(page, files, index) {
  if (!page) return null;
  const wanted = new Set(page.names);
  const named = files.filter((f) => CODE_RE.test(f.path) && !/\.test\./.test(f.path) && wanted.has(splitWords(path.basename(f.path, path.extname(f.path))).join('')));
  const inPages = named.filter((f) => PAGE_DIR_RE.test(f.path));
  if (inPages.length === 1) return inPages[0];
  if (named.length === 1) return named[0];
  const bySymbol = index.symbols.filter((s) => isComponentSymbol(s) && wanted.has(s.name.toLowerCase()));
  const uniq = [...new Set(bySymbol.map((s) => s.path))];
  if (uniq.length === 1) return files.find((f) => f.path === uniq[0]) || null;
  return null;
}

/** The nearest opening JSX tag before an offset, e.g. `<Button variant="x">Publish</Button>` -> { tag:'Button', offset, classes } */
function enclosingTag(text, offset) {
  const head = text.slice(Math.max(0, offset - 1500), offset);
  const re = /<([A-Za-z][\w.]*)\b([^<>]*?)>\s*$/;
  const m = re.exec(head);
  if (!m) return null;
  const tagStart = offset - (head.length - m.index);
  const cls = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`"']([^`"']*)[`"']\s*\})/.exec(m[2]);
  const classes = cls ? (cls[1] || cls[2] || cls[3] || '').split(/\s+/).filter(Boolean) : [];
  return { tag: m[1], offset: tagStart + 1, classes };
}

function localImports(file, byPath, resolveImportPath) {
  const paths = new Set(byPath.keys());
  const out = [];
  const re = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(file.content || '')) !== null) {
    const resolved = resolveImportPath(file.path, m[1], paths);
    if (resolved) out.push(resolved);
  }
  return [...new Set(out)];
}

/**
 * @returns {Promise<{targets:Array, readOnly:string[], source:string, reasons:string[], fallbackReason:?string, sharedImpact:Array, constraints:string[], strictScope:boolean, unresolved:?string, metrics:Object}>}
 */
async function resolveTargets({ prompt, files, conversation = null, selectedElement = null, projectKey, lsp, deps, buffers = null, signal }) {
  const started = Date.now();
  const all = (files || []).map(deps.normalizeFile).filter(Boolean);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const heuristic = deps.selectTargetFiles(prompt, files, conversation);
  const result = { targets: heuristic, readOnly: [], source: 'heuristic', reasons: [], fallbackReason: null, sharedImpact: [], constraints: [], strictScope: false, unresolved: null, metrics: { ms: 0, symbols: 0, lspCalls: 0 } };
  const finish = (patch) => { Object.assign(result, patch); result.metrics.ms = Date.now() - started; return result; };

  if (deps.isBroadRequest(prompt, all)) return finish({ fallbackReason: 'project-wide, global or page-creation request: kept the full heuristic selection', reasons: ['broad request preserved'] });
  if (all.length <= 1) return finish({ fallbackReason: 'single-file project' });

  let index;
  try {
    await lsp.sync(projectKey, all, { overlay: buffers });
    index = await buildIndex(lsp, projectKey, all, signal);
  } catch (error) {
    return finish({ fallbackReason: `language server unavailable: ${error.message}` });
  }
  if (!index.symbols.length) return finish({ fallbackReason: 'language server returned no symbols' });
  result.metrics.symbols = index.symbols.length;
  result.metrics.lspCalls = index.calls;

  const reasons = [];
  const anchors = []; // { file, offset?, symbol?, why }
  const terms = promptTerms(prompt);

  // 1. Explicit visual selection (highest priority). sourceFile is a frontend guess, so it is checked against the source.
  if (selectedElement?.sourceFile && byPath.has(selectedElement.sourceFile)) {
    const file = byPath.get(selectedElement.sourceFile);
    const text = typeof selectedElement.text === 'string' ? selectedElement.text.trim() : '';
    const at = text ? file.content.indexOf(text) : -1;
    const symbol = selectedElement.sourceComponent
      ? index.symbols.find((s) => s.path === file.path && isComponentSymbol(s) && s.name === String(selectedElement.sourceComponent).replace(/[<>/]/g, ''))
      : at >= 0 ? index.symbols.find((s) => s.path === file.path && isComponentSymbol(s) && contains(s.range, offsetToPosition(file.content, at))) : null;
    anchors.push({ file, offset: at >= 0 ? at : null, symbol: symbol || null, why: 'selected element' });
    reasons.push(`selected element -> ${file.path}${symbol ? ` (${symbol.name})` : ''}`);
  }

  // 2. Named component / function / file.
  if (!anchors.length) {
    const promptWords = new Set(terms.words);
    const joined = terms.words.join('');
    const scored = [];
    for (const symbol of index.symbols.filter(isComponentSymbol)) {
      const nameWords = splitWords(symbol.name);
      const distinct = nameWords.filter((w) => !GENERIC.has(w));
      const exact = terms.pascal.includes(symbol.name) || terms.capitalized.includes(symbol.name) || terms.quoted.some((q) => q.replace(/\s+/g, '').toLowerCase() === symbol.name.toLowerCase());
      const allPresent = nameWords.length > 0 && nameWords.every((w) => promptWords.has(w) || promptWords.has(`${w}s`)) && distinct.length > 0;
      const adjacent = nameWords.length > 1 && joined.includes(nameWords.join('')) && distinct.length > 0;
      if (exact || allPresent || adjacent) scored.push({ symbol, score: (exact ? 10 : 0) + distinct.length * 2 + nameWords.length });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score === scored[0]?.score);
    if (top.length === 1 || (top.length > 1 && new Set(top.map((t) => t.symbol.path)).size === 1)) {
      const file = byPath.get(top[0].symbol.path);
      anchors.push({ file, symbol: top[0].symbol, why: `named symbol ${top[0].symbol.name}` });
      reasons.push(`named symbol ${top[0].symbol.name} -> ${file.path}`);
    }
  }

  // 3. Page scope + 4. text anchors resolved through definitions.
  const page = detectPage(prompt);
  const pageFile = findPageFile(page, all, index);
  if (page) reasons.push(pageFile ? `page "${page.label}" -> ${pageFile.path}` : `page "${page.label}" not resolved`);

  if (!anchors.length && terms.anchors.length) {
    const searchSpace = pageFile ? [pageFile] : all.filter((f) => /\.(?:jsx|tsx)$/i.test(f.path));
    for (const word of terms.anchors) {
      const re = new RegExp(`>[^<>{}]*\\b${escapeRe(word)}\\b[^<>{}]*<`, 'i');
      const hits = searchSpace.filter((f) => re.test(f.content));
      if (hits.length === 1 || (hits.length > 1 && pageFile)) {
        const file = hits[0];
        const m = re.exec(file.content);
        anchors.push({ file, offset: m.index + 1, why: `text "${word}"` });
        reasons.push(`text "${word}" -> ${file.path}`);
        break;
      }
    }
  }
  if (!anchors.length && pageFile) {
    anchors.push({ file: pageFile, why: 'page' });
  }

  if (!anchors.length) {
    // Nothing resolved: decide between the heuristic result and a clarification request.
    const named = [...terms.pascal, ...terms.quoted];
    // The raw heuristic pick (before import expansion) being only the root App file means no keyword rule matched: a pure last-resort guess.
    const raw = deps.selectTargetFilesRaw(prompt, files, conversation);
    const onlyRoot = raw.length === 1 && /(?:^|\/)App\.(?:jsx?|tsx?)$/i.test(raw[0]?.path || '');
    if (named.length && onlyRoot && deps.isElementScoped(prompt) && !selectedElement) {
      return finish({ reasons, fallbackReason: 'no symbol or text matched', unresolved: `I could not find ${named.map((n) => `"${n}"`).join(', ')} in this project, so I did not change anything. Select the element in the preview or tell me which page or component it is in.` });
    }
    return finish({ reasons, fallbackReason: 'no symbol, text or page matched the request' });
  }

  // Resolve each anchor to the file that owns the element, via the language server's definitions.
  const editable = new Map();
  const readOnly = new Set();
  const impacts = [];
  const constraints = [];
  let pageSpecific = Boolean(pageFile) || Boolean(selectedElement);
  const add = (file) => { if (file && !editable.has(file.path)) editable.set(file.path, file); };

  for (const anchor of anchors) {
    add(anchor.file);
    let ownerSymbol = anchor.symbol;
    let ownerFile = anchor.file;
    let classes = [];
    // A component tag at the anchor: follow it to its definition.
    if (anchor.offset != null && CODE_RE.test(anchor.file.path)) {
      const tag = enclosingTag(anchor.file.content, anchor.offset);
      if (tag) {
        classes = tag.classes;
        if (/^[A-Z]/.test(tag.tag)) {
          const defs = await lsp.definition(projectKey, anchor.file.path, offsetToPosition(anchor.file.content, tag.offset + 1), { signal });
          result.metrics.lspCalls += 1;
          const def = defs?.find((d) => d.path && byPath.has(d.path) && d.path !== anchor.file.path);
          if (def) {
            ownerFile = byPath.get(def.path);
            ownerSymbol = index.symbols.find((s) => s.path === def.path && isComponentSymbol(s) && contains(s.range, def.range.start)) || null;
            reasons.push(`<${tag.tag}> defined in ${def.path}`);
          }
        }
      }
    }
    if (!ownerSymbol && ownerFile) ownerSymbol = index.symbols.find((s) => s.path === ownerFile.path && isComponentSymbol(s) && /(?:^|\/)(?:components?|ui|shared)\//i.test(ownerFile.path)) || null;

    // Who else uses the owning component?
    if (ownerSymbol && ownerFile) {
      const refs = await lsp.references(projectKey, ownerFile.path, ownerSymbol.selection.start, { signal });
      result.metrics.lspCalls += 1;
      const usedIn = refs ? [...new Set(refs.map((r) => r.path).filter((p) => p !== ownerFile.path))] : [];
      if (usedIn.length) impacts.push({ symbol: ownerSymbol.name, file: ownerFile.path, usedIn });
      const shared = usedIn.length >= 2 || usedIn.some((p) => p !== anchor.file.path && PAGE_DIR_RE.test(p) && PAGE_DIR_RE.test(anchor.file.path));
      if (ownerFile.path !== anchor.file.path) {
        if (shared && pageSpecific) {
          add(ownerFile); // may need an optional prop; the constraint below keeps the default look intact
          constraints.push(`${ownerSymbol.name} (${ownerFile.path}) is shared by ${usedIn.length} file(s): ${usedIn.slice(0, 8).join(', ')}. The request is specific to ${pageFile ? pageFile.path : 'the selected instance'}: change it at that call site (props, className or inline style). Do NOT change ${ownerSymbol.name}'s default appearance or behaviour. If a new optional prop is truly needed, keep the current default so every other usage renders unchanged.`);
          result.strictScope = true;
        } else if (shared) {
          add(ownerFile);
          constraints.push(`${ownerSymbol.name} (${ownerFile.path}) is shared by ${usedIn.length} file(s): ${usedIn.slice(0, 8).join(', ')}. Editing it changes all of them; the request names it directly.`);
        } else {
          add(ownerFile);
        }
      } else if (shared && pageSpecific) {
        constraints.push(`${ownerSymbol.name} is used by ${usedIn.length} other file(s). Keep the change local to this instance.`);
      }
    }

    // Styles for the matched element: editable only when the class is used by this element alone.
    for (const cls of classes.slice(0, 6)) {
      const rule = index.symbols.find((s) => STYLE_RE.test(s.path) && s.name.split(/[\s,]+/).some((part) => part === `.${cls}`));
      if (!rule) continue;
      const uses = all.filter((f) => CODE_RE.test(f.path) && new RegExp(`['"\`\\s]${escapeRe(cls)}['"\`\\s]`).test(f.content)).length;
      const styleFile = byPath.get(rule.path);
      if (uses <= 1) add(styleFile); else { readOnly.add(styleFile.path); constraints.push(`CSS class .${cls} (${styleFile.path}) is used in ${uses} files; do not edit the shared rule for this request, scope it locally.`); }
    }
  }

  // Dependency context: small, read-only, one hop from the files being edited.
  for (const file of editable.values()) {
    for (const dep of localImports(file, byPath, deps.resolveImportPath)) {
      const target = byPath.get(dep);
      if (!target || editable.has(dep) || target.encoding === 'base64' || !/\.(?:jsx?|tsx?|css|scss|json)$/i.test(dep)) continue;
      if (String(target.content || '').length <= 12000 && readOnly.size < 6) readOnly.add(dep);
    }
  }

  const targets = [...editable.values()].filter((f) => f.encoding !== 'base64' && typeof f.content === 'string');
  if (!targets.length) return finish({ reasons, fallbackReason: 'resolved files were not editable text' });

  // Everything else is summarised as "path: exported symbols" instead of being sent as source.
  const shown = new Set([...targets.map((f) => f.path), ...readOnly]);
  const byFile = new Map();
  for (const s of index.symbols) if (s.depth === 0 && CODE_RE.test(s.path) && !shown.has(s.path) && [SYMBOL_KIND.Function, SYMBOL_KIND.Variable, SYMBOL_KIND.Constant, SYMBOL_KIND.Class].includes(s.kind)) {
    if (!byFile.has(s.path)) byFile.set(s.path, []);
    byFile.get(s.path).push(s.name);
  }
  const outline = [...byFile].map(([p, names]) => `${p} [${names.slice(0, 4).join(', ')}]`).join('; ').slice(0, 2500);

  return finish({
    outline,
    targets,
    readOnly: [...readOnly],
    source: 'lsp',
    reasons,
    sharedImpact: impacts,
    constraints,
    strictScope: result.strictScope,
    fallbackReason: null
  });
}

/** Diagnostics a patch introduced: present after, absent before (by file + code + message). */
const BLOCKING_CODES = new Set([2304, 2305, 2307, 2614, 2724, 2552]);
function newBlockingDiagnostics(beforeMap, afterMap) {
  const out = [];
  for (const [file, list] of Object.entries(afterMap || {})) {
    if (!list) continue;
    const known = new Set((beforeMap?.[file] || []).map((d) => `${d.code}|${d.message}`));
    for (const d of list) {
      if (d.severity !== 1) continue;
      const syntax = typeof d.code === 'number' && d.code < 2000;
      if (!(syntax || BLOCKING_CODES.has(Number(d.code)))) continue;
      // Packages are not installed in the scratch workspace, so only RELATIVE import failures are meaningful.
      if (Number(d.code) === 2307 && !/Cannot find module '\.{1,2}\//.test(d.message)) continue;
      if (Number(d.code) === 2304 && /Cannot find name '(?:React|process|require|module|__dirname)'/.test(d.message)) continue;
      if (!known.has(`${d.code}|${d.message}`)) out.push({ file, ...d });
    }
  }
  return out;
}

module.exports = { resolveTargets, newBlockingDiagnostics, promptTerms, detectPage, offsetToPosition, positionToOffset, enclosingTag };
