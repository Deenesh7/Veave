/**
 * Small read cache with namespaces.
 *
 *   - REDIS_URL set  -> shared Redis (all server processes see the same cache);
 *   - not set / Redis down -> an in-process Map with a size cap (works on its own, nothing to install or run).
 *
 * Every namespace has a version number. Bumping it makes all entries of that namespace unreachable at once (they expire on their own),
 * so a write anywhere never has to find and delete individual keys.
 * Cache failures never fail a request: a miss or an error simply runs the real query.
 */
const logger = require('../../utils/logger');

const MAX_MEMORY_ENTRIES = 2000;
const memory = new Map();       // key -> { value, expires }
const versions = new Map();     // namespace -> number (memory mode)
let redis = null;
let redisReady = false;

function connectRedis() {
  if (redis || !process.env.REDIS_URL) return;
  try {
    const Redis = require('ioredis');
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 3000 });
    redis.on('ready', () => { redisReady = true; logger.info('Redis cache connected.'); });
    redis.on('end', () => { redisReady = false; });
    redis.on('error', (error) => { if (redisReady) logger.warn(`Redis cache error: ${error.message}`); redisReady = false; });
  } catch (error) { logger.warn(`Redis cache unavailable (${error.message}); using the in-process cache.`); redis = null; }
}
connectRedis();

const useRedis = () => Boolean(redis && redisReady);

async function versionOf(namespace) {
  if (useRedis()) {
    try { return (await redis.get(`veave:v:${namespace}`)) || '0'; } catch { /* fall through to memory */ }
  }
  return String(versions.get(namespace) || 0);
}

/** Returns the cached value, or runs `load()`, stores its result for `ttlSeconds` and returns it. */
async function remember(namespace, key, ttlSeconds, load) {
  const full = `veave:${namespace}:${await versionOf(namespace)}:${key}`;
  try {
    if (useRedis()) {
      const hit = await redis.get(full);
      if (hit !== null) return JSON.parse(hit);
    } else {
      const hit = memory.get(full);
      if (hit && hit.expires > Date.now()) return hit.value;
      if (hit) memory.delete(full);
    }
  } catch { /* a broken cache is just a miss */ }
  const value = await load();
  try {
    if (useRedis()) await redis.set(full, JSON.stringify(value), 'EX', ttlSeconds);
    else {
      if (memory.size >= MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
      memory.set(full, { value, expires: Date.now() + ttlSeconds * 1000 });
    }
  } catch { /* ignore */ }
  return value;
}

/** Makes every entry of the namespace stale at once (call after any write that changes what the cached reads return). */
async function invalidate(namespace) {
  versions.set(namespace, (versions.get(namespace) || 0) + 1);
  if (useRedis()) { try { await redis.incr(`veave:v:${namespace}`); } catch { /* ignore */ } }
}

module.exports = { remember, invalidate };
