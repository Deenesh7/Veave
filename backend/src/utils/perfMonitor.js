/**
 * Performance diagnostics: finds out WHY a request is slow instead of guessing.
 *   - event-loop lag: when the main thread was busy (CPU work such as decoding huge documents), every request waits;
 *   - slow requests: any API call over SLOW_REQUEST_MS is logged with its route and the time spent;
 *   - slow queries: MongoDB's own profiler (MONGO_PROFILE_MS, off unless set) records queries over that many ms.
 * All of it is cheap and can stay on in production.
 */
const { monitorEventLoopDelay } = require('node:perf_hooks');
const mongoose = require('mongoose');
const logger = require('./logger');

const SLOW_REQUEST_MS = Number.parseInt(process.env.SLOW_REQUEST_MS, 10) || 1000;
const LAG_WARN_MS = Number.parseInt(process.env.EVENT_LOOP_LAG_WARN_MS, 10) || 200;

/** Express middleware: logs requests that took longer than SLOW_REQUEST_MS. */
function slowRequestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms >= SLOW_REQUEST_MS) logger.warn(`Slow request: ${req.method} ${req.originalUrl.split('?')[0]} took ${Math.round(ms)} ms (status ${res.statusCode})`);
  });
  next();
}

let histogram = null;
let timer = null;

/** Samples the event loop and warns when the 99th percentile delay is high. */
function startEventLoopMonitor() {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  timer = setInterval(() => {
    const p99 = histogram.percentile(99) / 1e6;
    const max = histogram.max / 1e6;
    if (p99 >= LAG_WARN_MS || max >= LAG_WARN_MS * 5) logger.warn(`Event loop was blocked: p99 ${Math.round(p99)} ms, max ${Math.round(max)} ms in the last 10 s. Something is doing heavy work on the main thread.`);
    histogram.reset();
  }, 10000);
  timer.unref();
}

/** Turns on MongoDB's slow-query profiler for this database when MONGO_PROFILE_MS is set (read it with db.system.profile.find()). */
async function enableMongoProfiler() {
  const slowms = Number.parseInt(process.env.MONGO_PROFILE_MS, 10);
  if (!slowms) return;
  try {
    await mongoose.connection.db.command({ profile: 1, slowms });
    logger.info(`MongoDB profiler on: queries slower than ${slowms} ms are recorded in system.profile.`);
  } catch (error) { logger.warn(`MongoDB profiler could not be enabled: ${error.message}`); }
}

module.exports = { slowRequestLogger, startEventLoopMonitor, enableMongoProfiler };
