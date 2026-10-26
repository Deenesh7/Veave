const hybrid = require('./hybridSearch');
const { redactSecrets, tokenize } = require('./codeIndexer');
const { promptTerms, detectPage } = require('../lsp/lspTargeting');

/**
 * Chooses the files an incremental edit may change, and the read-only context, from hybrid search results.
 * Search results are evidence. They never edit anything, and enforceEditScope stays the authority on what a patch may touch.
 *
 * Precedence: selected element -> named file/component/class/route (exact search) -> structural + hybrid ranking ->
 * previous-turn files -> keyword heuristics -> App.jsx fallback (the last three are handled by the caller's heuristic result).
 */

const BLOCK_BUDGET_CHARS = () => Number(process.env.CODE_SEARCH_CONTEXT_CHARS) || 24000;
const PAGE_DIR_RE = /(?:^|\/)(?:pages?|views?|routes?|screens?)\//i;

function lineSlice(file, start, end) {
  const lines = String(file.content || '').split('\n');
  return lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');
}

const overlaps = (a, b) => a.path === b.path && a.start <= b.end && b.start <= a.end;

// "remove the empty space in this page", "this page is wrong": the page the user is looking at in the editor.
const THIS_PAGE = /\b(?:this|the\s+current|current|that|the\s+same)\s+page\b|\b(?:on|in|of)\s+the\s+page\b|\bthe\s+page\s+(?:is|has|looks|needs|should)\b/i;

async function resolveTargetsHybrid({ prompt, files, conversation = null, selectedElement = null, viewingRoute = null, projectKey, deps, manager, embedder = null, signal }) {
  const started = Date.now();
  const all = (files || []).map(deps.normalizeFile).filter(Boolean);
  const byPath = new Map(all.map((f) => [f.path, f]));
  const heuristic = deps.selectTargetFiles(prompt, files, conversation);
  const result = {
    targets: heuristic, readOnly: [], blocks: [], source: 'heuristic', reasons: [], fallbackReason: null, sharedImpact: [], constraints: [], strictScope: false,
    unresolved: null, outline: '', metrics: { ms: 0, lspCalls: 0, symbols: 0 }, search: null
  };
  const finish = (patch) => { Object.assign(result, patch); result.metrics.ms = Date.now() - started; return result; };

  if (deps.isBroadRequest(prompt, all)) return finish({ fallbackReason: 'project-wide, global or page-creation request: kept the full heuristic selection', reasons: ['broad request preserved'] });
  if (all.length <= 1) return finish({ fallbackReason: 'single-file project' });
  if (signal?.aborted) return finish({ fallbackReason: 'cancelled' });

  let index;
  let syncInfo;
  try {
    const synced = manager.sync(projectKey, all, { resolveImportPath: deps.resolveImportPath });
    index = synced.index;
    syncInfo = synced.diff;
    index.derived();
  } catch (error) {
    return finish({ fallbackReason: `code index unavailable: ${error.message}` });
  }
  const stale = index.staleAgainst(all);
  if (stale.length) return finish({ fallbackReason: `index out of date for ${stale.length} file(s)` }); // cannot happen after sync; guards against races

  const d = index.derived();
  const terms = promptTerms(prompt);
  const page = detectPage(prompt);
  const reasons = [];

  // The page the user is looking at, as the file that renders it (an override in the engine router wins over the generated app's table).
  let viewing = null;
  const viewPath = viewingRoute ? (String(viewingRoute).split(/[?#]/)[0].replace(/\/+$/, '') || '/') : null;
  if (viewPath) {
    const candidates = d.routes.filter((route) => route.meta.route === viewPath);
    candidates.sort((a, b) => Number(/^src\/App\.(?:jsx?|tsx?)$/.test(b.path)) - Number(/^src\/App\.(?:jsx?|tsx?)$/.test(a.path)));
    for (const route of candidates) {
      const unit = index.resolveTag(route.path, route.meta.component);
      if (unit && byPath.has(unit.path)) { viewing = { route: viewPath, file: unit.path, unit }; break; }
    }
    if (!viewing) viewing = { route: viewPath, file: null, unit: null };
  }
  result.viewing = viewing ? { route: viewing.route, file: viewing.file } : null;
  const namesAnotherPage = Boolean(page);

  // Pronoun-only follow-ups ("make it bigger") carry no searchable content: previous-turn heuristics handle them.
  const q0 = hybrid.analyseQuery(prompt, terms, page);
  if (!q0.content.length && !q0.identifiers.length && !q0.quoted.length && !q0.classes.length && !q0.paths.length && !selectedElement) {
    return finish({ fallbackReason: 'request has no searchable content' });
  }

  // The page the request names ("the about page") or, when it names none, the page being viewed, with everything that page imports.
  let pageScopeUnit = null;
  if (page) {
    for (const route of d.routes) {
      const isHome = page.names.some((n) => ['home', 'homepage', 'index', 'landing', 'main'].includes(n)) && (route.meta.route === '/' || route.meta.route === '(index)');
      if (!isHome && !page.names.some((n) => tokenize(`${route.meta.component} ${route.meta.route}`).includes(n.replace(/page$/, '')))) continue;
      const target = index.routeTarget(route);
      if (target && byPath.has(target.path)) { pageScopeUnit = target; break; }
    }
  } else if (viewing?.unit) pageScopeUnit = viewing.unit;
  const pageScopePaths = new Set();
  if (pageScopeUnit) {
    const queue = [pageScopeUnit.path];
    while (queue.length && pageScopePaths.size < 60) {
      const current = queue.pop();
      if (pageScopePaths.has(current)) continue;
      pageScopePaths.add(current);
      for (const next of d.importGraph.get(current) || []) queue.push(next);
    }
  }
  const inPageScope = (filePath) => pageScopePaths.has(filePath);

  let searchOutcome = null;
  let primary = []; // units that directly implement the change
  let selectionWhy = '';

  // 1. Explicit visual selection.
  const selected = selectedElement?.sourceFile && byPath.has(selectedElement.sourceFile) ? selectedElement : null;
  if (selected) {
    const text = typeof selected.text === 'string' ? selected.text.trim().toLowerCase() : '';
    const inFile = d.units.filter((u) => u.path === selected.sourceFile && u.kind === 'component');
    const owner = (text && inFile.find((u) => (u.meta.ui || []).some((t) => t.toLowerCase().includes(text)))) || inFile.find((u) => u.name === String(selected.sourceComponent || '').replace(/[<>/]/g, '')) || inFile[0] || null;
    if (owner) primary = [owner];
    else primary = [d.units.find((u) => u.path === selected.sourceFile && u.kind === 'file')].filter(Boolean);
    selectionWhy = `selected element -> ${selected.sourceFile}`;
    reasons.push(selectionWhy);
  }

  // 2-4. Search.
  const semanticBudgetMs = Number(process.env.CODE_SEARCH_EMBED_BUDGET_MS) || 8000;
  try {
    searchOutcome = await hybrid.search(index, prompt, { terms, page, embedder, semanticBudgetMs });
  } catch (error) {
    if (!selected) return finish({ fallbackReason: `search failed: ${error.message}` });
  }
  const results = searchOutcome?.results || [];
  result.search = searchOutcome?.metrics || null;
  const confidence = hybrid.confidenceOf(results);

  if (!selected && viewing?.unit && !namesAnotherPage && THIS_PAGE.test(prompt)) {
    primary = [viewing.unit];
    selectionWhy = `"this page" -> the page being viewed (${viewing.route}) -> ${viewing.file}`;
    reasons.push(selectionWhy);
  } else if (!selected) {
    const sure = confidence.level === 'high' || confidence.level === 'medium';
    if (!sure && viewing?.unit && !terms.pascal.length && !terms.quoted.length) {
      // Nothing in the request identifies a part, but the user is looking at a page: edit that page rather than guess.
      primary = [viewing.unit];
      selectionWhy = `no part named; the page being viewed (${viewing.route}) -> ${viewing.file}`;
      reasons.push(selectionWhy);
    } else if (!sure) {
      const named = [...terms.pascal, ...terms.quoted];
      const raw = deps.selectTargetFilesRaw(prompt, files, conversation);
      const onlyRoot = raw.length === 1 && /(?:^|\/)App\.(?:jsx?|tsx?)$/i.test(raw[0]?.path || '');
      if (named.length && onlyRoot && deps.isElementScoped(prompt)) {
        return finish({ reasons, fallbackReason: `search was ${confidence.level}`, unresolved: `I could not tell which part of the project ${named.map((n) => `"${n}"`).join(', ')} refers to, so I did not change anything. Select the element in the preview or tell me which page or component it is in.` });
      }
      return finish({ reasons, fallbackReason: `search ${confidence.level}: ${confidence.reason}` });
    } else if (pageScopeUnit && PAGE_DIR_RE.test(results[0].unit.path) && !inPageScope(results[0].unit.path)) {
      // The best match is in a DIFFERENT page (e.g. "overview" matches the Placement page) than the one the request names or the user is
      // viewing: the named page wins; its own best match is used when there is one.
      const own = results.find((r) => inPageScope(r.unit.path));
      primary = [own && own.unit.kind !== 'file' ? own.unit : pageScopeUnit];
      selectionWhy = `the request names or is viewing ${pageScopeUnit.path}; the top search result ${results[0].unit.path} is another page, so ${primary[0].path} is edited`;
      reasons.push(selectionWhy);
    } else {
      primary = [results[0].unit];
      selectionWhy = `top hybrid result ${results[0].unit.kind} ${results[0].unit.name} (${confidence.reason}; ${results[0].why.slice(0, 2).join('; ')})`;
      reasons.push(selectionWhy);
      // A second file is only added when it is nearly as strong AND independently supported.
      for (const r of results.slice(1, 4)) {
        if (primary.some((p) => p.path === r.unit.path)) continue;
        if (r.score >= results[0].score * 0.8 && Object.keys(r.methods).length >= 2 && r.unit.kind !== 'file') { primary.push(r.unit); reasons.push(`also ${r.unit.name} (${r.why[0]})`); }
      }
    }
  }
  if (!primary.length) return finish({ reasons, fallbackReason: 'no unit resolved' });

  // Structural evidence for the prompt builder: which symbols / classes of each editable file the resolver decided on.
  const focusMap = new Map();
  const addFocus = (filePath, name, classNames = []) => {
    if (!filePath) return;
    if (!focusMap.has(filePath)) focusMap.set(filePath, { names: new Set(), classNames: new Set() });
    const entry = focusMap.get(filePath);
    if (name) entry.names.add(name);
    for (const c of classNames) entry.classNames.add(c);
  };

  // Page scope from the route map, e.g. "on the homepage" -> the page component file.
  let pageFile = null;
  if (page) {
    for (const route of d.routes) {
      const isHome = page.names.some((n) => ['home', 'homepage', 'index', 'landing', 'main'].includes(n)) && (route.meta.route === '/' || route.meta.route === '(index)');
      if (!isHome && !page.names.some((n) => tokenize(`${route.meta.component} ${route.meta.route}`).includes(n.replace(/page$/, '')))) continue;
      const target = index.routeTarget(route);
      if (target) { pageFile = target.path; addFocus(target.path, target.name); reasons.push(`page "${page.label}" -> route ${route.meta.route} -> ${target.path}`); break; }
    }
    if (!pageFile) {
      const named = all.filter((f) => PAGE_DIR_RE.test(f.path) && page.names.some((n) => f.path.toLowerCase().includes(n.replace(/page$/, ''))));
      if (named.length === 1) { pageFile = named[0].path; reasons.push(`page "${page.label}" -> ${pageFile}`); }
    }
  }
  const pageSpecific = Boolean(pageFile) || Boolean(selected);

  // Groups: A editable, B read-only blocks, C affected consumers (reported, never edited automatically).
  const editable = new Map();
  const constraints = [];
  const impacts = [];
  let strictScope = false;
  const addFile = (filePath) => { if (filePath && byPath.has(filePath) && !editable.has(filePath) && byPath.get(filePath).encoding !== 'base64') editable.set(filePath, byPath.get(filePath)); };
  const consumersOf = (filePath) => [...(d.consumers.get(filePath) || [])].filter((p) => p !== filePath);

  for (const unit of primary) {
    let owner = unit;
    addFile(unit.path);
    if (unit.kind !== 'file') addFocus(unit.path, unit.name, unit.meta?.classes || []);
    // Where the matched text is rendered by a component, that component's definition is the real owner of the element.
    if (unit.kind === 'component') {
      const anchorRes = [...terms.quoted, ...terms.anchors].map((a) => new RegExp(`(?:^|[^A-Za-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^A-Za-z0-9])`, 'i'));
      const hit = (unit.meta.textTags || []).find((tt) => /^[A-Z]/.test(tt.tag) && anchorRes.some((re) => re.test(tt.text)));
      const def = hit ? index.resolveTag(unit.path, hit.tag) : null;
      if (def && def.path !== unit.path) { owner = def; reasons.push(`<${hit.tag}> defined in ${def.path}`); }
    if (owner !== unit) addFocus(owner.path, owner.name, owner.meta?.classes || []);
    }
    const users = consumersOf(owner.path);
    const isComponentFile = owner.kind === 'component' && !PAGE_DIR_RE.test(owner.path);
    if (isComponentFile && users.length) impacts.push({ symbol: owner.name, file: owner.path, usedIn: users });
    const shared = isComponentFile && users.length >= 2;
    if (owner.path !== unit.path) {
      if (shared && pageSpecific) {
        addFile(owner.path);
        if (pageFile) addFile(pageFile);
        strictScope = true;
        constraints.push(`${owner.name} (${owner.path}) is shared by ${users.length} file(s): ${users.slice(0, 8).join(', ')}. The request is specific to ${pageFile || 'the selected instance'}: change it at that call site (props, className or inline style). Do NOT change ${owner.name}'s default appearance or behaviour. If a new optional prop is truly needed, keep the current default so every other usage renders unchanged.`);
      } else {
        addFile(owner.path);
        if (shared) constraints.push(`${owner.name} (${owner.path}) is shared by ${users.length} file(s): ${users.slice(0, 8).join(', ')}. Editing it changes all of them; the request names it directly.`);
      }
    } else if (shared && pageSpecific && pageFile && byPath.has(pageFile) && pageFile !== owner.path) {
      // The best match is the shared component itself, but the request is about one page that renders it.
      addFile(pageFile);
      strictScope = true;
      constraints.push(`${owner.name} (${owner.path}) is shared by ${users.length} file(s): ${users.slice(0, 8).join(', ')}. The request is specific to ${pageFile}: change it there. Do NOT change ${owner.name}'s default appearance or behaviour.`);
    } else if (shared && pageSpecific && selected) {
      strictScope = true;
      constraints.push(`${owner.name} is used by ${users.length} other file(s). Keep the change local to the selected instance.`);
    }
    // CSS: a rule is editable only when a single component uses its class; otherwise it is context with a constraint.
    for (const cls of (owner.meta.classes || []).slice(0, 8)) {
      const rules = d.cssByClass.get(cls) || [];
      if (!rules.length) continue;
      const usedBy = d.classUsers.get(cls)?.size || 0;
      const styleFile = rules[0].path;
      if (usedBy <= 1) { addFile(styleFile); addFocus(styleFile, null, [cls]); }
      else constraints.push(`CSS class .${cls} (${styleFile}) is used in ${usedBy} files; do not edit the shared rule for this request, scope it locally.`);
    }
  }
  result.strictScope = strictScope;

  // Group B: signatures of the components the editable units render, and the next-best hits, as source ranges.
  const budget = { left: BLOCK_BUDGET_CHARS(), removed: 0 };
  const blocks = [];
  const consider = (filePath, start, end, why) => {
    const file = byPath.get(filePath);
    if (!file || editable.has(filePath) || file.encoding === 'base64') return;
    const range = { path: filePath, start: Math.max(1, start), end };
    if (blocks.some((b) => overlaps(b, range))) { budget.removed += 1; return; }
    const text = redactSecrets(lineSlice(file, range.start, range.end));
    if (!text.trim() || text.length > budget.left) return;
    budget.left -= text.length;
    blocks.push({ ...range, why, text });
  };
  for (const unit of [...editable.values()].flatMap((f) => d.units.filter((u) => u.path === f.path && u.kind === 'component'))) {
    for (const tag of (unit.meta.tags || []).slice(0, 12)) {
      if (!/^[A-Z]/.test(tag)) continue;
      const def = index.resolveTag(unit.path, tag);
      if (def && !editable.has(def.path)) consider(def.path, def.startLine, Math.min(def.endLine, def.startLine + 29), `definition of <${tag}> used by ${unit.name}`);
    }
  }
  for (const r of results.slice(0, 6)) {
    if (editable.has(r.unit.path)) continue;
    const f = r.focus?.[0];
    const start = f ? Math.max(r.unit.startLine, f.start - 2) : r.unit.startLine;
    const end = f ? Math.min(r.unit.endLine, f.end + 2) : Math.min(r.unit.endLine, r.unit.startLine + 59);
    consider(r.unit.path, start, end, `related: ${r.why[0] || r.unit.name}`);
  }
  const shownFiles = new Set([...editable.keys(), ...blocks.map((b) => b.path)]);
  const byFile = new Map();
  for (const u of d.units) if (u.kind === 'component' && !shownFiles.has(u.path)) { if (!byFile.has(u.path)) byFile.set(u.path, []); byFile.get(u.path).push(u.name); }
  const outline = [...byFile].map(([p, names]) => `${p} [${names.slice(0, 4).join(', ')}]`).join('; ').slice(0, 2500);

  const targets = [...editable.values()].filter((f) => typeof f.content === 'string');
  if (!targets.length) return finish({ reasons, fallbackReason: 'resolved files were not editable text' });

  return finish({
    targets, readOnly: [], blocks, outline, focus: [...focusMap].map(([path, f]) => ({ path, names: [...f.names], classNames: [...f.classNames] })), source: 'hybrid', reasons, sharedImpact: impacts, constraints, strictScope, fallbackReason: null,
    search: { ...(result.search || {}), confidence: confidence.level, indexed: { files: index.files.size, units: d.size, sync: syncInfo }, blocks: blocks.length, blockChars: BLOCK_BUDGET_CHARS() - budget.left, blockDuplicatesRemoved: budget.removed }
  });
}

module.exports = { resolveTargetsHybrid };
