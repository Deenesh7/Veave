const { tokenize } = require('./codeIndexer');
const { cosine } = require('./embedder');

/**
 * Hybrid code search: exact + lexical (BM25) + semantic (embeddings) + structural (imports, routes, JSX usage),
 * fused with weighted reciprocal-rank fusion. Every method is optional; the others still work when one is unavailable.
 */

const STOP = new Set(('the a an and or of to in on at for with from into this that these those it its is are be as by about make change set turn update please should would could want need have has can you me my our your ' +
  'color colour colors background text font size bigger smaller larger look looks style styling find where how what which when there their them then than also just some any all more less new old ' +
  'add remove show hide move put get use using used').split(/\s+/));

const CONFIG = () => {
  let weights = {};
  try { weights = JSON.parse(process.env.CODE_SEARCH_WEIGHTS || '{}'); } catch { /* use defaults */ }
  return {
    k: Number(process.env.CODE_SEARCH_RRF_K) || 60,
    weights: { exact: 1, lexical: 1, semantic: 1, structural: 1, ...weights },
    minSimilarity: Number(process.env.CODE_SEARCH_MIN_SIM) || 0.25,
    perMethod: Number(process.env.CODE_SEARCH_PER_METHOD) || 30
  };
};

const span = (u) => Math.max(1, (u.endLine || 1) - (u.startLine || 1) + 1);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

function analyseQuery(prompt, terms, page) {
  const text = String(prompt || '');
  const identifiers = new Set([...(terms.pascal || []), ...(terms.capitalized || [])]);
  for (const m of text.matchAll(/\b([a-z]+[A-Z][A-Za-z0-9]*)\b/g)) identifiers.add(m[1]);
  const classes = new Set([...text.matchAll(/(?:^|\s)\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g)) classes.add(m[1]);
  const paths = [...text.matchAll(/([\w./-]+\.(?:jsx?|tsx?|css|scss|html?|json))\b/gi)].map((m) => m[1]);
  const endpoints = [...text.matchAll(/(?:^|\s)(\/[a-z][\w/-]*)/gi)].map((m) => m[1]);
  const content = [...new Set(tokenize(text).map(singular).filter((t) => !STOP.has(t) && !STOP.has(`${t}s`) && t.length >= 3))];
  return { identifiers: [...identifiers], quoted: terms.quoted || [], anchors: terms.anchors || [], classes: [...classes], paths, endpoints, content, page };
}

function exactSearch(index, q) {
  const d = index.derived();
  const hits = new Map();
  const add = (unit, score, why) => {
    const have = hits.get(unit.id);
    if (!have) hits.set(unit.id, { unit, score, why: [why] });
    else { have.score = Math.max(have.score, score) + 0.1; if (!have.why.includes(why)) have.why.push(why); }
  };
  for (const ident of q.identifiers) {
    for (const unit of d.byName.get(ident.toLowerCase()) || []) add(unit, unit.name === ident ? 10 : 8, `exact identifier ${unit.name}`);
    for (const record of index.files.values()) {
      const base = record.path.split('/').pop().replace(/\.[^.]+$/, '');
      if (base.toLowerCase() === ident.toLowerCase()) add(record.units[0], 8, `file name ${record.path.split('/').pop()}`);
    }
    for (const rule of d.cssByClass.get(ident) || []) add(rule, 7, `css class .${ident}`);
  }
  for (const cls of q.classes) {
    for (const rule of d.cssByClass.get(cls) || []) add(rule, 7, `css class .${cls}`);
    for (const unit of d.units) if (unit.kind === 'component' && (unit.meta.classes || []).includes(cls)) add(unit, 5, `uses class ${cls}`);
  }
  for (const p of q.paths) for (const record of index.files.values()) if (record.path === p || record.path.endsWith(`/${p}`)) add(record.units[0], 9, `file path ${record.path}`);
  for (const ep of q.endpoints) for (const unit of d.units) if ((unit.meta.endpoints || []).some((e) => e.includes(ep))) add(unit, 8, `calls ${ep}`);
  const phrases = [...q.quoted.map((p) => [p, 6]), ...q.anchors.filter((a) => !q.quoted.includes(a)).map((p) => [p, 5])];
  for (const [phrase, score] of phrases) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(phrase)}(?:$|[^A-Za-z0-9])`, 'i');
    for (const unit of d.units) {
      if (unit.kind === 'file' || unit.kind === 'config') continue;
      if ((unit.meta.ui || []).some((t) => re.test(t))) add(unit, score, `displays "${phrase}"`);
      else if (unit.kind === 'block' && re.test(unit.text)) add(unit, score - 1, `contains "${phrase}"`);
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || span(a.unit) - span(b.unit));
}

function lexicalSearch(index, q, limit) {
  const d = index.derived();
  if (!q.content.length || !d.size) return [];
  const k1 = 1.2;
  const b = 0.75;
  const scored = [];
  for (const unit of d.units) {
    const doc = d.docs.get(unit.id);
    let score = 0;
    const matched = [];
    for (const term of q.content) {
      const tf = doc.tf.get(term) || doc.tf.get(`${term}s`) || 0;
      if (!tf) continue;
      const n = d.df.get(term) || d.df.get(`${term}s`) || 1;
      const idf = Math.log(1 + (d.size - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.len) / d.avgdl)));
      matched.push(term);
    }
    if (score > 0) scored.push({ unit, score, why: [`matches ${matched.slice(0, 5).join(', ')}`] });
  }
  return scored.sort((a, b2) => b2.score - a.score || span(a.unit) - span(b2.unit)).slice(0, limit);
}

async function semanticSearch(index, prompt, embedder, cfg, budgetMs) {
  if (!embedder || !embedder.available()) return { hits: [], status: { enabled: false } };
  const status = await index.ensureEmbeddings(embedder, { budgetMs });
  if (!status.enabled && !index.embeddings.size) return { hits: [], status };
  const vectors = await embedder.embed([String(prompt).slice(0, 600)]);
  if (!vectors) return { hits: [], status: { ...status, enabled: false } };
  const q = vectors[0];
  const d = index.derived();
  const hits = [];
  for (const [id, rec] of index.embeddings) {
    const unit = d.byId.get(id);
    if (!unit) continue;
    const sim = cosine(q, rec.vec);
    if (sim >= cfg.minSimilarity) hits.push({ unit, score: sim, why: [`semantically similar (${sim.toFixed(2)})`] });
  }
  return { hits: hits.sort((a, b) => b.score - a.score).slice(0, cfg.perMethod), status };
}

function structuralSearch(index, q, seeds) {
  const d = index.derived();
  const hits = new Map();
  const add = (unit, score, why) => {
    if (!unit) return;
    const have = hits.get(unit.id);
    if (!have) hits.set(unit.id, { unit, score, why: [why] });
    else { have.score += 0.5; have.why.push(why); }
  };
  // Route -> page component ("homepage", "the pricing page").
  if (q.page) {
    for (const route of d.routes) {
      const routeWords = tokenize(route.meta.route).concat(tokenize(route.meta.component));
      const isHome = q.page.names.some((n) => ['home', 'homepage', 'index', 'landing', 'main'].includes(n)) && (route.meta.route === '/' || route.meta.route === '(index)');
      if (isHome || q.page.names.some((n) => routeWords.includes(n.replace(/page$/, '')))) {
        const target = index.routeTarget(route);
        if (target) add(target, 9, `route ${route.meta.route} renders ${target.name}`);
        add(route, 6, `route ${route.meta.route}`);
      }
    }
  }
  // Displayed text -> the component it is rendered by, and the component it is rendered with.
  const phrases = [...q.quoted, ...q.anchors];
  for (const phrase of phrases) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(phrase)}(?:$|[^A-Za-z0-9])`, 'i');
    for (const unit of d.units) {
      if (unit.kind !== 'component') continue;
      for (const tt of unit.meta.textTags || []) {
        if (!re.test(tt.text)) continue;
        add(unit, 6, `renders "${phrase}"`);
        if (/^[A-Z]/.test(tt.tag)) add(index.resolveTag(unit.path, tt.tag), 7, `<${tt.tag}> shows "${phrase}" in ${unit.name}`);
      }
    }
  }
  // Children of the strongest seeds that the request mentions ("publish BUTTON" -> <Button>).
  for (const seed of seeds.slice(0, 4)) {
    if (seed.kind !== 'component') continue;
    for (const tag of seed.meta.tags || []) {
      if (!/^[A-Z]/.test(tag) || !q.content.some((t) => tokenize(tag).includes(t))) continue;
      add(index.resolveTag(seed.path, tag), 5, `child <${tag}> of ${seed.name}`);
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score);
}

/** Merge child blocks into their parent unit, remember the best matching range, and drop overlapping duplicates. */
function dedupe(index, entries) {
  const d = index.derived();
  let removed = 0;
  const merged = new Map();
  for (const e of entries) {
    let unit = e.unit;
    let focus = null;
    if (unit.kind === 'block' && unit.parent && d.byId.get(unit.parent)) { focus = { start: unit.startLine, end: unit.endLine }; unit = d.byId.get(unit.parent); removed += 1; }
    const have = merged.get(unit.id);
    if (!have) merged.set(unit.id, { ...e, unit, focus: focus ? [focus] : [], methods: { ...e.methods } });
    else {
      removed += 1;
      for (const [m, r] of Object.entries(e.methods)) have.methods[m] = Math.min(have.methods[m] ?? Infinity, r);
      have.score += e.score;
      have.why = [...new Set([...have.why, ...e.why])];
      if (focus) have.focus.push(focus);
    }
  }
  const list = [...merged.values()].sort((a, b) => b.score - a.score);
  // File-level evidence folds into the best finer unit of the same file.
  const out = [];
  for (const e of list) {
    if (e.unit.kind === 'file' || e.unit.kind === 'config') {
      const sibling = out.find((o) => o.unit.path === e.unit.path && o.unit.kind !== 'file');
      if (sibling) { sibling.score += e.score * 0.5; sibling.why = [...new Set([...sibling.why, ...e.why])]; removed += 1; continue; }
    }
    // Overlapping ranges in the same file collapse into the higher-ranked one.
    const overlap = out.find((o) => o.unit.path === e.unit.path && o.unit.kind !== 'file' && e.unit.kind !== 'file' && o.unit.startLine <= e.unit.endLine && e.unit.startLine <= o.unit.endLine);
    if (overlap) { overlap.why = [...new Set([...overlap.why, ...e.why])]; overlap.focus.push(...e.focus); removed += 1; continue; }
    out.push(e);
  }
  return { results: out.sort((a, b) => b.score - a.score), removed };
}

async function search(index, prompt, { terms, page, embedder = null, config = CONFIG(), semanticBudgetMs } = {}) {
  const started = Date.now();
  const timing = {};
  const q = analyseQuery(prompt, terms, page);
  const lists = {};
  const t = (name, fn) => { const s = Date.now(); const out = fn(); timing[name] = Date.now() - s; return out; };

  lists.exact = t('exact', () => exactSearch(index, q)).slice(0, config.perMethod);
  lists.lexical = t('lexical', () => lexicalSearch(index, q, config.perMethod));
  const s0 = Date.now();
  const semantic = await semanticSearch(index, prompt, embedder, config, semanticBudgetMs);
  timing.semantic = Date.now() - s0;
  lists.semantic = semantic.hits;
  const seeds = [...lists.exact, ...lists.lexical].map((h) => h.unit).filter((u) => u.kind === 'component');
  lists.structural = t('structural', () => structuralSearch(index, q, seeds));

  const fused = new Map();
  for (const [method, list] of Object.entries(lists)) {
    const w = config.weights[method] ?? 1;
    list.forEach((hit, i) => {
      const rank = i + 1;
      const e = fused.get(hit.unit.id) || { unit: hit.unit, score: 0, why: [], methods: {} };
      e.score += w / (config.k + rank);
      e.methods[method] = Math.min(e.methods[method] ?? Infinity, rank);
      for (const why of hit.why) if (!e.why.includes(why)) e.why.push(why);
      fused.set(hit.unit.id, e);
    });
  }
  const { results, removed } = dedupe(index, [...fused.values()].sort((a, b) => b.score - a.score));
  const maxPossible = Object.entries(config.weights).reduce((s, [m, w]) => s + (lists[m] ? w : 0), 0) / (config.k + 1) || 1;
  for (const r of results) r.confidence = r.score / maxPossible;
  return {
    results,
    query: q,
    metrics: { ms: Date.now() - started, timing, counts: Object.fromEntries(Object.entries(lists).map(([m, l]) => [m, l.length])), duplicatesRemoved: removed, semantic: semantic.status }
  };
}

/** high: an exact hit or two independent methods agree; medium: a clear lead; low: do not act on it. */
function confidenceOf(results) {
  const top = results[0];
  if (!top) return { level: 'none', reason: 'no results' };
  const top3 = (m) => (top.methods[m] ?? Infinity) <= 3;
  const agreeing = Object.keys(top.methods).filter(top3).length;
  const exactTop = (top.methods.exact ?? Infinity) <= 2;
  const nextFile = results.find((r) => r.unit.path !== top.unit.path);
  const lead = nextFile ? top.score / nextFile.score : 10;
  if (exactTop) return { level: 'high', reason: 'exact match', agreeing, lead };
  if (agreeing >= 2) return { level: 'high', reason: `${agreeing} methods agree`, agreeing, lead };
  if (lead >= 1.5 && Object.keys(top.methods).length >= 2) return { level: 'medium', reason: 'clear lead', agreeing, lead };
  return { level: 'low', reason: 'ambiguous', agreeing, lead };
}

module.exports = { search, confidenceOf, analyseQuery, exactSearch, lexicalSearch, structuralSearch, CONFIG, STOP };
