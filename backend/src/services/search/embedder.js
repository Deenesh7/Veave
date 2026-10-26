const os = require('os');
const path = require('path');
const logger = require('../../utils/logger');

/**
 * Embedding provider for semantic code search.
 *
 * Default: a LOCAL model through @xenova/transformers (already a dependency, used for speech). No code, text or
 * credentials leave the server and there is no per-call cost. Nothing else is configured by default: if the model cannot
 * load (offline, disk, disabled) every call returns null and search runs without the semantic method.
 *
 *   CODE_SEARCH_EMBEDDINGS=local|off      (default local)
 *   CODE_SEARCH_EMBED_MODEL=<hf model>    (default Xenova/all-MiniLM-L6-v2)
 *   CODE_SEARCH_EMBED_TIMEOUT_MS          per batch (default 15000); first use downloads the model once
 *   CODE_SEARCH_MODEL_CACHE=<dir>         model cache location
 */

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const COOLDOWN_MS = 5 * 60 * 1000;

class Embedder {
  constructor({ embedFn = null, model = null } = {}) {
    this.embedFn = embedFn; // injected provider (tests, alternative backends): async (texts) => number[][]
    this.customModel = model;
    this.pipelinePromise = null;
    this.loaded = false;
    this.failedAt = 0;
    this.lastError = null;
    this.stats = { calls: 0, texts: 0, failures: 0 };
  }

  mode() { return String(process.env.CODE_SEARCH_EMBEDDINGS || 'local').toLowerCase(); }
  isEnabled() { return this.embedFn ? true : this.mode() === 'local'; }
  /** Identifies the vectors: when this changes, stored embeddings are recomputed. */
  model() { return this.customModel || process.env.CODE_SEARCH_EMBED_MODEL || DEFAULT_MODEL; }
  available() { return this.isEnabled() && !(this.failedAt && Date.now() - this.failedAt < COOLDOWN_MS); }

  get ready() { return Boolean(this.embedFn) || this.loaded; }

  /** Starts loading the model in the background (first use downloads it once). Never throws and never blocks callers. */
  warm() {
    if (this.embedFn || !this.isEnabled()) return Promise.resolve(Boolean(this.embedFn));
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline, env } = await import('@xenova/transformers');
        env.allowLocalModels = true;
        env.cacheDir = process.env.CODE_SEARCH_MODEL_CACHE || path.join(os.tmpdir(), 'veave-embedding-models');
        return pipeline('feature-extraction', this.model());
      })().then((extractor) => { this.loaded = true; return extractor; }, (error) => {
        this.pipelinePromise = null;
        this.failedAt = Date.now();
        this.lastError = error.message;
        logger.warn(`Code search embedding model failed to load (${error.message}); semantic search is off for now.`);
        return null;
      });
    }
    return this.pipelinePromise.then((extractor) => Boolean(extractor));
  }

  /**
   * @returns {Promise<number[][]|null>} one normalised vector per text, or null when embeddings are unavailable or the model
   * is still loading (an edit never waits for a model download).
   */
  async embed(texts, { timeoutMs = Number(process.env.CODE_SEARCH_EMBED_TIMEOUT_MS) || 15000 } = {}) {
    if (!texts.length) return [];
    if (!this.available()) return null;
    if (!this.ready) { this.warm(); return null; }
    this.stats.calls += 1;
    const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('embedding timed out')), timeoutMs).unref());
    try {
      let vectors;
      if (this.embedFn) {
        vectors = await Promise.race([this.embedFn(texts), timeout()]);
      } else {
        const extractor = await this.pipelinePromise;
        const output = await Promise.race([extractor(texts, { pooling: 'mean', normalize: true }), timeout()]);
        const dim = output.dims[output.dims.length - 1];
        vectors = texts.map((_, i) => Array.from(output.data.slice(i * dim, (i + 1) * dim)));
      }
      this.stats.texts += texts.length;
      return vectors;
    } catch (error) {
      this.stats.failures += 1;
      this.failedAt = Date.now();
      this.lastError = error.message;
      logger.warn(`Code search embeddings unavailable (${error.message}); continuing with exact, lexical and structural search.`);
      return null;
    }
  }

  reset() { this.failedAt = 0; this.lastError = null; }
}

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };

const shared = new Embedder();
module.exports = shared;
module.exports.Embedder = Embedder;
module.exports.cosine = cosine;
