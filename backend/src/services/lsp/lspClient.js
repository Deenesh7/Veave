const { spawn } = require('child_process');
const { EventEmitter } = require('events');

/**
 * Minimal Language Server Protocol client over stdio (JSON-RPC 2.0, Content-Length framing).
 * One instance owns one server process. It never touches project files: it only receives document text.
 */
class LspClient extends EventEmitter {
  constructor({ id, command, args = [], cwd, requestTimeoutMs = 8000, env = {} }) {
    super();
    this.id = id;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.requestTimeoutMs = requestTimeoutMs;
    this.env = env;
    this.state = 'idle'; // idle | starting | ready | crashed | stopped
    this.capabilities = {};
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.diagnostics = new Map(); // uri -> { diagnostics, at, version }
    this.docs = new Map(); // uri -> version
    this.proc = null;
  }

  get ready() { return this.state === 'ready'; }

  async start({ rootUri, initializationOptions = {}, timeoutMs = 20000 } = {}) {
    if (this.state === 'ready' || this.state === 'starting') return;
    this.state = 'starting';
    this.proc = spawn(this.command, this.args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...this.env } });
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.on('data', () => {}); // servers are chatty; protocol errors surface through responses
    this.proc.stdin.on('error', () => {});
    this.proc.on('error', (error) => this._onExit(error));
    this.proc.on('exit', (code, signal) => this._onExit(new Error(`language server ${this.id} exited (${signal || code})`)));
    try {
      const result = await this.request('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'project' }],
        initializationOptions,
        capabilities: {
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            references: {},
            definition: { linkSupport: false },
            hover: { contentFormat: ['plaintext'] }
          },
          workspace: { workspaceFolders: true, configuration: true, symbol: {} }
        }
      }, { timeoutMs, force: true });
      this.capabilities = result?.capabilities || {};
      this.notify('initialized', {});
      this.state = 'ready';
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  _onExit(error) {
    if (this.state === 'stopped') return;
    this.state = 'crashed';
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
    this.docs.clear();
    this.emit('crash', error);
  }

  _write(message) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error(`language server ${this.id} is not running`);
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
    this.proc.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.slice(0, headerEnd).toString('ascii'));
      if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const raw = this.buffer.slice(start, start + length).toString('utf8');
      this.buffer = this.buffer.slice(start + length);
      let message;
      try { message = JSON.parse(raw); } catch { continue; }
      this._dispatch(message);
    }
  }

  _dispatch(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error) && !message.method) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(Object.assign(new Error(message.error.message || 'LSP error'), { code: message.error.code }));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'textDocument/publishDiagnostics') {
      this.diagnostics.set(message.params.uri, { diagnostics: message.params.diagnostics || [], at: Date.now(), version: message.params.version });
      this.emit('diagnostics', message.params.uri);
      return;
    }
    if (message.id !== undefined && message.method) {
      // Server-to-client requests: answer neutrally so the server never blocks on us.
      let result = null;
      if (message.method === 'workspace/configuration') result = (message.params?.items || []).map(() => ({}));
      try { this._write({ id: message.id, result }); } catch { /* server gone */ }
    }
  }

  /** Sends a request. Aborting the signal or timing out cancels it on the server and rejects. */
  request(method, params, { timeoutMs = this.requestTimeoutMs, signal, force = false } = {}) {
    if (!force && !this.ready) return Promise.reject(new Error(`language server ${this.id} is ${this.state}`));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const cancel = (reason) => {
        if (!this.pending.has(id)) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        try { this._write({ method: '$/cancelRequest', params: { id } }); } catch { /* ignore */ }
        reject(new Error(reason));
      };
      const entry = { resolve, reject, timer: setTimeout(() => cancel(`LSP ${method} timed out after ${timeoutMs}ms`), timeoutMs) };
      this.pending.set(id, entry);
      if (signal) {
        if (signal.aborted) return cancel(`LSP ${method} cancelled`);
        signal.addEventListener('abort', () => cancel(`LSP ${method} cancelled`), { once: true });
      }
      try { this._write({ id, method, params }); } catch (error) { cancel(error.message); }
    });
  }

  notify(method, params) {
    try { this._write({ method, params }); } catch { /* process gone; state handled by exit */ }
  }

  openOrChange(uri, languageId, text) {
    const version = (this.docs.get(uri) || 0) + 1;
    if (version === 1) this.notify('textDocument/didOpen', { textDocument: { uri, languageId, version, text } });
    else {
      this.diagnostics.delete(uri); // anything published before this change describes old text
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
    }
    this.docs.set(uri, version);
    return version;
  }

  close(uri) {
    if (!this.docs.has(uri)) return;
    this.notify('textDocument/didClose', { textDocument: { uri } });
    this.docs.delete(uri);
    this.diagnostics.delete(uri);
  }

  /** Resolves with the diagnostics published for a document after `sinceVersion`, or null when the server stays silent. */
  waitForDiagnostics(uri, sinceVersion, timeoutMs = 6000) {
    const current = () => {
      const entry = this.diagnostics.get(uri);
      return entry && (entry.version === undefined || entry.version >= sinceVersion) ? entry : null;
    };
    // Servers may publish syntax errors first and semantic errors a moment later: wait for the stream to go quiet.
    const settle = 250;
    return new Promise((resolve) => {
      let quiet = null;
      const finish = () => { clearTimeout(timer); clearTimeout(quiet); this.off('diagnostics', onDiag); const entry = current(); resolve(entry ? entry.diagnostics : null); };
      const onDiag = (changed) => {
        if (changed !== uri || !current()) return;
        clearTimeout(quiet);
        quiet = setTimeout(finish, settle);
      };
      const timer = setTimeout(finish, timeoutMs);
      this.on('diagnostics', onDiag);
      if (current()) quiet = setTimeout(finish, settle);
    });
  }

  async stop() {
    if (this.state === 'stopped') return;
    const wasReady = this.state === 'ready';
    this.state = 'stopped';
    for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error('language server stopped')); }
    this.pending.clear();
    if (wasReady) {
      try { this._write({ id: this.nextId++, method: 'shutdown' }); this._write({ method: 'exit' }); } catch { /* ignore */ }
    }
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      await new Promise((resolve) => {
        const kill = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } resolve(); }, 1500);
        proc.once('exit', () => { clearTimeout(kill); resolve(); });
        try { proc.stdin.end(); } catch { /* ignore */ }
        setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* ignore */ } }, 300).unref();
      });
    }
    this.docs.clear();
    this.diagnostics.clear();
  }
}

module.exports = { LspClient };
