const logger = require('../../utils/logger');
const { INDEX_VERSION, indexFile, isIndexable, describeUnit, lexicalFields, sha } = require('./codeIndexer');

/**
 * Project-scoped semantic code index. One ProjectIndex per project key, held in memory, rebuildable from the
 * authoritative project files at any time. It never reads or writes the filesystem or database itself: callers pass
 * the current file list, and every sync diffs it by content hash, so a stale index cannot survive a sync.
 */

const MAX_EMBEDDED_UNITS = Number(process.env.CODE_SEARCH_MAX_EMBEDDED_UNITS) || 800;
const EMBED_BATCH = 24;

class ProjectIndex {
  constructor(key) {
    this.key = key;
    this.files = new Map(); // path -> record from indexFile + { size }
    this.allPaths = new Set();
    this.generation = 0;
    this.derivedCache = null;
    this.embeddings = new Map(); // unit id -> { key, vec }
    this.lastUsed = Date.now();
    this.resolveImport = null;
    this.stats = { syncs: 0, filesIndexed: 0, filesSkipped: 0, lastSyncMs: 0, lastIndexMs: 0, parseErrors: 0 };
  }

  /**
   * Makes the index mirror `files`. Only added or modified files are re-parsed; removed files (including the old name of a
   * renamed file) drop out; unchanged files cost one hash comparison.
   */
  sync(files, { resolveImportPath } = {}) {
    const started = Date.now();
    this.resolveImport = resolveImportPath || this.resolveImport;
    const wanted = new Map();
    const present = new Set();
    for (const file of files || []) {
      if (!file || typeof file.path !== 'string') continue;
      present.add(file.path);
      if (!isIndexable(file.path, file)) { this.stats.filesSkipped += 1; continue; }
      wanted.set(file.path, file.content);
    }
    this.allPaths = present;
    const diff = { added: [], changed: [], removed: [], unchanged: 0 };
    for (const filePath of [...this.files.keys()]) {
      if (!wanted.has(filePath)) { this.files.delete(filePath); diff.removed.push(filePath); }
    }
    for (const [filePath, content] of wanted) {
      const existing = this.files.get(filePath);
      const hash = sha(content);
      if (existing && existing.hash === hash) { diff.unchanged += 1; continue; }
      const t = Date.now();
      const record = indexFile(filePath, content);
      record.indexMs = Date.now() - t;
      if (record.parseError) this.stats.parseErrors += 1;
      this.files.set(filePath, record);
      this.stats.filesIndexed += 1;
      (existing ? diff.changed : diff.added).push(filePath);
    }
    // Dropped units can no longer be embedded or searched.
    if (diff.removed.length || diff.changed.length || diff.added.length) {
      this.generation += 1;
      this.derivedCache = null;
      const live = new Set();
      for (const record of this.files.values()) for (const unit of record.units) live.add(unit.id);
      for (const id of this.embeddings.keys()) if (!live.has(id)) this.embeddings.delete(id);
    }
    this.lastUsed = Date.now();
    this.stats.syncs += 1;
    this.stats.lastSyncMs = Date.now() - started;
    return { ...diff, generation: this.generation, ms: this.stats.lastSyncMs };
  }

  /** Paths whose current content differs from what is indexed (new, modified, or deleted). */
  staleAgainst(files) {
    const stale = [];
    const seen = new Set();
    for (const file of files || []) {
      if (!file || !isIndexable(file.path, file)) continue;
      seen.add(file.path);
      const record = this.files.get(file.path);
      if (!record || record.hash !== sha(file.content)) stale.push(file.path);
    }
    for (const filePath of this.files.keys()) if (!seen.has(filePath)) stale.push(filePath);
    return stale;
  }

  derived() {
    if (this.derivedCache) return this.derivedCache;
    const units = [];
    const byId = new Map();
    const byName = new Map();
    const importGraph = new Map();
    const consumers = new Map();
    const classUsers = new Map();
    const cssByClass = new Map();
    const routes = [];
    for (const record of this.files.values()) {
      const resolved = new Set();
      for (const imp of record.imports) {
        const target = this.resolveImport ? this.resolveImport(record.path, imp.source, this.allPaths) : null;
        if (target) { resolved.add(target); imp.resolved = target; }
      }
      importGraph.set(record.path, resolved);
      for (const target of resolved) { if (!consumers.has(target)) consumers.set(target, new Set()); consumers.get(target).add(record.path); }
      for (const unit of record.units) {
        units.push(unit);
        byId.set(unit.id, unit);
        if (unit.kind !== 'block' && unit.kind !== 'file' && unit.kind !== 'route') {
          const lower = unit.name.toLowerCase();
          if (!byName.has(lower)) byName.set(lower, []);
          byName.get(lower).push(unit);
        }
        if (unit.kind === 'route') routes.push(unit);
        if (unit.kind === 'component') for (const c of unit.meta.classes || []) { if (!classUsers.has(c)) classUsers.set(c, new Set()); classUsers.get(c).add(unit.path); }
        if (unit.kind === 'css-rule') for (const c of unit.meta.classes || []) { if (!cssByClass.has(c)) cssByClass.set(c, []); cssByClass.get(c).push(unit); }
      }
    }
    // BM25 statistics.
    const docs = new Map();
    const df = new Map();
    let totalLen = 0;
    for (const unit of units) {
      const bag = lexicalFields(unit);
      const tf = new Map();
      for (const token of bag) tf.set(token, (tf.get(token) || 0) + 1);
      docs.set(unit.id, { tf, len: bag.length || 1 });
      totalLen += bag.length || 1;
      for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    }
    this.derivedCache = { units, byId, byName, importGraph, consumers, classUsers, cssByClass, routes, docs, df, avgdl: units.length ? totalLen / units.length : 1, size: units.length };
    return this.derivedCache;
  }

  /** The component/function a JSX tag refers to when used inside `fromPath` (same file, or through an import). */
  resolveTag(fromPath, tag) {
    const d = this.derived();
    const record = this.files.get(fromPath);
    if (!record) return null;
    const local = d.byName.get(String(tag).toLowerCase())?.find((u) => u.path === fromPath && u.kind !== 'block');
    if (local) return local;
    for (const imp of record.imports) {
      const name = imp.names?.find((n) => n.local === tag);
      if (!name || !imp.resolved) continue;
      const target = this.files.get(imp.resolved);
      if (!target) continue;
      const units = target.units.filter((u) => u.kind === 'component' || u.kind === 'function' || u.kind === 'hook' || u.kind === 'class');
      if (name.imported === 'default') return units.find((u) => u.isDefault) || units[0] || null;
      return units.find((u) => u.name === name.imported) || null;
    }
    return null;
  }

  /** The file a route's component lives in. */
  routeTarget(routeUnit) {
    const home = this.files.get(routeUnit.path);
    const comp = routeUnit.meta.component;
    return home ? this.resolveTag(routeUnit.path, comp) : null;
  }

  unitText(unit) {
    return this.files.get(unit.path) ? unit : null;
  }

  /**
   * Embeds units that have no up-to-date vector. Bounded by a time budget so an edit never waits long: whatever is not
   * finished stays pending and is completed by the next call.
   */
  async ensureEmbeddings(embedder, { budgetMs = Number(process.env.CODE_SEARCH_EMBED_BUDGET_MS) || 8000 } = {}) {
    if (!embedder || !embedder.available()) return { enabled: false, embedded: 0, pending: 0 };
    const d = this.derived();
    const model = `${embedder.model()}@${INDEX_VERSION}`;
    const pending = [];
    for (const unit of d.units) {
      if (unit.kind === 'block') continue;
      const doc = describeUnit(unit);
      const key = sha(`${model}|${doc}`);
      const have = this.embeddings.get(unit.id);
      if (!have || have.key !== key) pending.push({ unit, doc, key });
      if (pending.length >= MAX_EMBEDDED_UNITS) break;
    }
    const started = Date.now();
    let embedded = 0;
    for (let i = 0; i < pending.length; i += EMBED_BATCH) {
      if (Date.now() - started > budgetMs) break;
      const batch = pending.slice(i, i + EMBED_BATCH);
      const vectors = await embedder.embed(batch.map((b) => b.doc), { timeoutMs: Math.max(2000, budgetMs - (Date.now() - started)) });
      if (!vectors) return { enabled: false, embedded, pending: pending.length - embedded, failed: true };
      batch.forEach((b, j) => this.embeddings.set(b.unit.id, { key: b.key, vec: vectors[j] }));
      embedded += batch.length;
    }
    return { enabled: true, embedded, pending: pending.length - embedded, model };
  }
}

class CodeSearchManager {
  constructor() {
    this.indexes = new Map();
    this.maxIndexes = Number(process.env.CODE_SEARCH_MAX_INDEXES) || 6;
    this.ttlMs = Number(process.env.CODE_SEARCH_INDEX_TTL_MS) || 30 * 60 * 1000;
  }

  isEnabled() { return /^(1|true|yes|on)$/i.test(String(process.env.INCREMENTAL_CODE_SEARCH || '')); }

  _evict() {
    const now = Date.now();
    for (const [key, index] of this.indexes) if (now - index.lastUsed > this.ttlMs) this.indexes.delete(key);
    while (this.indexes.size >= this.maxIndexes) {
      const oldest = [...this.indexes.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      this.indexes.delete(oldest[0]);
    }
  }

  get(key) { return this.indexes.get(String(key)) || null; }

  sync(key, files, options = {}) {
    const k = String(key);
    let index = this.indexes.get(k);
    if (!index) { this._evict(); index = new ProjectIndex(k); this.indexes.set(k, index); }
    try {
      const diff = index.sync(files, options);
      return { index, diff };
    } catch (error) {
      // A corrupt index is discarded and rebuilt from the files once.
      logger.warn(`Code index for ${k} failed to sync (${error.message}); rebuilding.`);
      this.indexes.delete(k);
      const fresh = new ProjectIndex(k);
      this.indexes.set(k, fresh);
      return { index: fresh, diff: fresh.sync(files, options), rebuilt: true };
    }
  }

  /** Full rebuild from the authoritative files (recovery, or after an indexing-strategy/model change). */
  rebuild(key, files, options = {}) {
    this.indexes.delete(String(key));
    return this.sync(key, files, options);
  }

  /** Called after saves, restores, undo/redo: the next use re-diffs against the saved project. */
  invalidate(key) {
    const index = this.indexes.get(String(key));
    if (!index) return false;
    index.derivedCache = null;
    return true;
  }

  dispose(key) { return this.indexes.delete(String(key)); }
  disposeAll() { this.indexes.clear(); }
}

const manager = new CodeSearchManager();
module.exports = manager;
module.exports.ProjectIndex = ProjectIndex;
module.exports.CodeSearchManager = CodeSearchManager;
