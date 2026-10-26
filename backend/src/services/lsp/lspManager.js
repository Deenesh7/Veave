const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const logger = require('../../utils/logger');
const { LspClient } = require('./lspClient');

/**
 * Project-scoped language server sessions for the incremental editor.
 *
 * - Runs on the backend only; the browser never talks to a language server.
 * - Each project gets a scratch workspace in the OS temp dir that is a COPY of the saved project text files.
 *   The authoritative project (database / object storage) is never written from here.
 * - Every use re-syncs from the authoritative file list (diffed by content hash), so a manual save, undo, redo,
 *   restore or concurrent edit can never leave the session serving stale documents.
 */

const SERVERS = {
  typescript: { exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'], languageIds: { '.ts': 'typescript', '.tsx': 'typescriptreact', '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript' } },
  css: { exts: ['.css', '.scss', '.less'], languageIds: { '.css': 'css', '.scss': 'scss', '.less': 'less' } },
  html: { exts: ['.html', '.htm'], languageIds: { '.html': 'html', '.htm': 'html' } },
  json: { exts: ['.json'], languageIds: { '.json': 'json' } }
};

const MAX_DOCS = 400;
const MAX_DOC_BYTES = 400 * 1024;

function isEnabled() {
  return /^(1|true|yes|on)$/i.test(String(process.env.INCREMENTAL_LSP || ''));
}

function serverFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [id, def] of Object.entries(SERVERS)) if (def.exts.includes(ext)) return { id, languageId: def.languageIds[ext] };
  return null;
}

function resolveServerCommand(id) {
  const nodeModules = path.resolve(__dirname, '../../../node_modules');
  const pick = (...segments) => path.join(nodeModules, ...segments);
  if (id === 'typescript') {
    return { command: process.execPath, args: [pick('typescript-language-server', 'lib', 'cli.mjs'), '--stdio'], init: { tsserver: { path: pick('typescript', 'lib', 'tsserver.js') }, hostInfo: 'veave' } };
  }
  const bin = { css: 'vscode-css-language-server', html: 'vscode-html-language-server', json: 'vscode-json-language-server' }[id];
  return { command: process.execPath, args: [pick('vscode-langservers-extracted', 'bin', bin), '--stdio'], init: {} };
}

const hashOf = (text) => crypto.createHash('sha1').update(text).digest('hex');

class LspManager {
  constructor() {
    this.sessions = new Map();
    this.maxSessions = Number(process.env.INCREMENTAL_LSP_MAX_SESSIONS) || 4;
    this.idleMs = Number(process.env.INCREMENTAL_LSP_IDLE_MS) || 10 * 60 * 1000;
    this.requestTimeoutMs = Number(process.env.INCREMENTAL_LSP_TIMEOUT_MS) || 8000;
    this.sweeper = null;
    this.stats = { syncs: 0, requests: 0, failures: 0 };
  }

  isEnabled() { return isEnabled(); }

  _startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, session] of this.sessions) if (now - session.lastUsed > this.idleMs) this.dispose(key).catch(() => {});
    }, Math.min(this.idleMs, 60 * 1000));
    this.sweeper.unref();
  }

  async _session(key) {
    let session = this.sessions.get(key);
    if (!session) {
      while (this.sessions.size >= this.maxSessions) {
        const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        await this.dispose(oldest[0]);
      }
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'veave-lsp-'));
      session = { key, dir, rootUri: pathToFileURL(dir).href, docs: new Map(), clients: new Map(), lastUsed: Date.now(), queue: Promise.resolve(), index: null, generation: 0, restarts: 0, failed: new Set() };
      this.sessions.set(key, session);
      this._startSweeper();
    }
    session.lastUsed = Date.now();
    return session;
  }

  // Operations on one session are serialised so a sync and a query never interleave.
  _exclusive(session, task) {
    const run = session.queue.then(task, task);
    session.queue = run.catch(() => {});
    return run;
  }

  async _client(session, id) {
    let client = session.clients.get(id);
    if (client && client.state === 'crashed') {
      session.clients.delete(id);
      if (session.restarts >= 3) throw new Error(`language server ${id} keeps crashing`);
      session.restarts += 1;
      client = null;
    }
    if (client) { if (client.starting) await client.starting; return client; }
    if (session.failed.has(id)) throw new Error(`language server ${id} unavailable`);
    const spec = resolveServerCommand(id);
    if (!fs.existsSync(spec.args[0])) { session.failed.add(id); throw new Error(`language server ${id} is not installed`); }
    client = new LspClient({ id, command: spec.command, args: spec.args, cwd: session.dir, requestTimeoutMs: this.requestTimeoutMs });
    client.on('crash', (error) => logger.warn(`LSP ${id} crashed for project ${session.key}: ${error.message}`));
    session.clients.set(id, client);
    try {
      client.starting = client.start({ rootUri: session.rootUri, initializationOptions: spec.init });
      await client.starting;
      client.starting = null;
    } catch (error) {
      session.clients.delete(id);
      session.failed.add(id);
      throw error;
    }
    // Re-open everything this server owns (first start, or after a crash restart).
    for (const [rel, doc] of session.docs) if (doc.server === id) client.openOrChange(doc.uri, doc.languageId, doc.text);
    return client;
  }

  /**
   * Makes the session mirror `files` exactly. `overlay` ({path: text}) lets unsaved editor buffers win over the saved text
   * for this sync only; the next sync without an overlay returns to the saved state.
   */
  async sync(key, files, { overlay = null } = {}) {
    const session = await this._session(key);
    return this._exclusive(session, async () => {
      this.stats.syncs += 1;
      const wanted = new Map();
      const hasTsConfig = (files || []).some((file) => file && /^(?:ts|js)config\.json$/.test(file.path));
      for (const file of files || []) {
        if (!file || typeof file.path !== 'string' || file.encoding === 'base64' || typeof file.content !== 'string') continue;
        if (file.path.startsWith('..') || path.isAbsolute(file.path) || /node_modules\//.test(file.path)) continue;
        const target = serverFor(file.path);
        if (!target || Buffer.byteLength(file.content) > MAX_DOC_BYTES) continue;
        const text = overlay && typeof overlay[file.path] === 'string' ? overlay[file.path] : file.content;
        wanted.set(file.path, { text, target });
        if (wanted.size >= MAX_DOCS) break;
      }
      if (!hasTsConfig) {
        wanted.set('jsconfig.json', { text: JSON.stringify({ compilerOptions: { allowJs: true, checkJs: true, jsx: 'react-jsx', module: 'esnext', moduleResolution: 'bundler', target: 'es2022', skipLibCheck: true, noEmit: true }, include: ['src/**/*', '*.js', '*.jsx', '*.ts', '*.tsx'] }), target: { id: 'json', languageId: 'json' }, synthetic: true });
      }
      let changed = 0;
      // Removed files.
      for (const [rel, doc] of [...session.docs]) {
        if (wanted.has(rel)) continue;
        const client = session.clients.get(doc.server);
        if (client) client.close(doc.uri);
        await fs.promises.rm(path.join(session.dir, rel), { force: true }).catch(() => {});
        session.docs.delete(rel);
        changed += 1;
      }
      // New or modified files.
      for (const [rel, { text, target, synthetic }] of wanted) {
        const hash = hashOf(text);
        const existing = session.docs.get(rel);
        if (existing && existing.hash === hash) continue;
        const abs = path.join(session.dir, rel);
        await fs.promises.mkdir(path.dirname(abs), { recursive: true });
        await fs.promises.writeFile(abs, text);
        const doc = { uri: pathToFileURL(abs).href, languageId: target.languageId, server: target.id, text, hash, synthetic: Boolean(synthetic) };
        session.docs.set(rel, doc);
        changed += 1;
        if (synthetic) continue;
        const client = session.clients.get(target.id);
        if (client && client.ready) doc.version = client.openOrChange(doc.uri, doc.languageId, text);
      }
      if (changed) { session.generation += 1; session.index = null; }
      return { changed, generation: session.generation, docs: session.docs.size };
    });
  }

  async _ensureServers(session, rels) {
    const ids = new Set();
    for (const rel of rels) { const doc = session.docs.get(rel); if (doc && !doc.synthetic) ids.add(doc.server); }
    const out = new Map();
    for (const id of ids) {
      try {
        const client = await this._client(session, id);
        // Documents synced before the server existed still need to be opened.
        for (const [rel, doc] of session.docs) if (doc.server === id && !doc.synthetic && !client.docs.has(doc.uri)) doc.version = client.openOrChange(doc.uri, doc.languageId, doc.text);
        out.set(id, client);
      } catch (error) {
        this.stats.failures += 1;
        out.set(id, null);
        logger.warn(`LSP ${id} unavailable for project ${session.key}: ${error.message}`);
      }
    }
    return out;
  }

  async _withDoc(key, rel, fn, { signal } = {}) {
    const session = this.sessions.get(key);
    const doc = session?.docs.get(rel);
    if (!session || !doc || doc.synthetic) return null;
    session.lastUsed = Date.now();
    const clients = await this._ensureServers(session, [rel]);
    const client = clients.get(doc.server);
    if (!client || !client.ready) return null;
    this.stats.requests += 1;
    try { return await fn(client, doc, signal); } catch (error) { this.stats.failures += 1; logger.warn(`LSP request failed (${rel}): ${error.message}`); return null; }
  }

  async documentSymbols(key, rel, opts) {
    return this._withDoc(key, rel, async (client, doc, signal) => {
      const result = await client.request('textDocument/documentSymbol', { textDocument: { uri: doc.uri } }, { signal });
      return Array.isArray(result) ? result : null;
    }, opts);
  }

  async references(key, rel, position, opts) {
    return this._withDoc(key, rel, async (client, doc, signal) => {
      const result = await client.request('textDocument/references', { textDocument: { uri: doc.uri }, position, context: { includeDeclaration: false } }, { signal });
      return Array.isArray(result) ? result.map((loc) => ({ path: this._rel(key, loc.uri), range: loc.range })).filter((loc) => loc.path) : null;
    }, opts);
  }

  async definition(key, rel, position, opts) {
    return this._withDoc(key, rel, async (client, doc, signal) => {
      const result = await client.request('textDocument/definition', { textDocument: { uri: doc.uri }, position }, { signal });
      const list = Array.isArray(result) ? result : result ? [result] : [];
      return list.map((loc) => ({ path: this._rel(key, loc.uri || loc.targetUri), range: loc.range || loc.targetSelectionRange })).filter((loc) => loc.path);
    }, opts);
  }

  /** Diagnostics for the given documents (all errors/warnings the server publishes), or null for documents it could not analyse. */
  async diagnostics(key, rels, { timeoutMs = 6000 } = {}) {
    const session = this.sessions.get(key);
    if (!session) return null;
    return this._exclusive(session, async () => {
      const clients = await this._ensureServers(session, rels);
      const out = {};
      await Promise.all(rels.map(async (rel) => {
        const doc = session.docs.get(rel);
        const client = doc && clients.get(doc.server);
        if (!doc || !client || !client.ready) { out[rel] = null; return; }
        const list = await client.waitForDiagnostics(doc.uri, doc.version || 1, timeoutMs);
        out[rel] = list ? list.map((d) => ({ severity: d.severity || 1, code: d.code, message: String(d.message || ''), line: d.range?.start?.line, character: d.range?.start?.character })) : null;
      }));
      return out;
    });
  }

  _rel(key, uri) {
    const session = this.sessions.get(key);
    if (!session || !uri) return null;
    let abs;
    try { abs = decodeURIComponent(new URL(uri).pathname); } catch { return null; }
    const rel = path.relative(safeReal(session.dir), safeReal(abs)).split(path.sep).join('/');
    return rel && !rel.startsWith('..') && session.docs.has(rel) ? rel : null;
  }

  getDocText(key, rel) { return this.sessions.get(key)?.docs.get(rel)?.text ?? null; }
  generation(key) { return this.sessions.get(key)?.generation ?? -1; }
  getIndexCache(key) { const s = this.sessions.get(key); return s && s.index && s.index.generation === s.generation ? s.index.value : null; }
  setIndexCache(key, value) { const s = this.sessions.get(key); if (s) s.index = { generation: s.generation, value }; }

  /** Drops cached symbol data after a save, restore, undo or redo. The next use re-syncs from the saved project. */
  invalidate(key) {
    const session = this.sessions.get(String(key));
    if (!session) return false;
    session.index = null; // documents themselves are re-diffed against the saved project on the next sync
    return true;
  }

  async dispose(key) {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    await Promise.all([...session.clients.values()].map((client) => client.stop().catch(() => {})));
    await fs.promises.rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }

  async disposeAll() {
    await Promise.all([...this.sessions.keys()].map((key) => this.dispose(key)));
    if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; }
  }
}

function safeReal(p, fallback = p) {
  try { return fs.realpathSync(p); } catch { return fallback; }
}

const manager = new LspManager();
const cleanup = () => { for (const session of manager.sessions.values()) for (const client of session.clients.values()) { try { client.proc?.kill('SIGKILL'); } catch { /* ignore */ } } };
process.once('exit', cleanup);

module.exports = manager;
module.exports.LspManager = LspManager;
module.exports.serverFor = serverFor;
module.exports.isEnabled = isEnabled;
