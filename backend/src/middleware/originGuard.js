// Published sites live on sibling subdomains of the app's own domain (<slug>.veave.net vs app.veave.net), which
// browsers treat as "same site". That means a visitor's login cookie is also sent when a published site's script
// calls the API. This guard stops that kind of request forgery: a browser request that changes data must come from
// an allowed origin (the Veave app). Requests with no Origin header (curl, server-to-server) are not browser CSRF.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Callbacks that third parties POST to from their own origin.
const EXEMPT_PATHS = new Set(['/api/auth/apple/callback']);

function allowedOrigins() {
  const configured = [process.env.CLIENT_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map((value) => String(value || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const origins = new Set(configured.length ? configured : ['http://localhost:5173']);
  // Local development: the dev server is reachable as localhost or 127.0.0.1.
  if (process.env.NODE_ENV !== 'production') ['http://localhost:5173', 'http://127.0.0.1:5173'].forEach((origin) => origins.add(origin));
  return origins;
}

function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || EXEMPT_PATHS.has(req.path) || EXEMPT_PATHS.has(req.originalUrl.split('?')[0])) return next();
  if (allowedOrigins().has(String(origin).replace(/\/+$/, ''))) return next();
  return res.status(403).json({ success: false, error: { message: 'Cross-origin request blocked.', statusCode: 403 } });
}

module.exports = originGuard;
module.exports.allowedOrigins = allowedOrigins;
