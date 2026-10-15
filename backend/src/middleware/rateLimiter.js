const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

const isLocalhost = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.includes('127.0.0.1');
};

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // In local development or localhost requests, never rate-limit
    if (isDev || isLocalhost(req)) return true;
    // Never rate-limit static assets, icons, or favicon
    if (req.path === '/favicon.ico' || req.originalUrl?.includes('favicon.ico')) return true;
    // Never rate-limit background job polling status endpoints
    if (req.originalUrl?.includes('/api/ai/jobs/')) return true;
    return false;
  },
  message: { success: false, error: { message: 'Too many requests, please try again later.' } }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDev || isLocalhost(req),
  message: { success: false, error: { message: 'Too many authentication attempts, please try again later.' } }
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 500 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDev || isLocalhost(req),
  message: { success: false, error: { message: 'Too many AI requests, please try again later.' } }
});

module.exports = { generalLimiter, authLimiter, aiLimiter };
