process.env.NODE_NO_WARNINGS = '1';
process.emitWarning = () => {};
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const cookieParser = require('cookie-parser');
const corsOptions = require('./config/cors');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const agentRoutes = require('./routes/agent');
const historyRoutes = require('./routes/history');
const usageRoutes = require('./routes/usage');
const themePaletteRoutes = require('./routes/themePalettes');
const customFontRoutes = require('./routes/customFonts');
const aiCreationRoutes = require('./routes/aiCreation');
const promptEngineRoutes = require('./routes/prompt');
const dbViewerRoutes = require('./routes/dbViewer');
const billingRoutes = require('./routes/billing');
const hostingRoutes = require('./routes/hosting');
const groupRoutes = require('./routes/groups');
const invitationRoutes = require('./routes/invitations');
const notificationRoutes = require('./routes/notifications');
const templateRoutes = require('./routes/templates');
const templateSiteRoutes = require('./routes/templateSites');
const adminRoutes = require('./routes/admin');

const app = express();

// Behind the production reverse proxy (Caddy/Nginx): trust one hop so req.ip, rate limits and HTTPS detection are the visitor's.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Liveness / readiness probes for uptime monitors and the process manager. Registered first so they stay cheap under load.
app.get('/healthz', (req, res) => res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) }));
app.get('/readyz', (req, res) => {
  const ready = require('mongoose').connection.readyState === 1;
  const mem = process.memoryUsage();
  res.status(ready ? 200 : 503).json({ ok: ready, db: ready ? 'up' : 'down', rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) });
});

app.use(require('./services/project/validatedPreview').servePreview);
// Published sites: <slug>.<PUBLISH_BASE_DOMAIN>. Mounted before API middleware so site hosts never reach authenticated APIs.
app.use(require('./services/hosting/staticServer').serveHostedSite);

// Compress responses (the project list, compiled pages and template previews are 100 KB to several MB of text). Server-sent event
// streams are never compressed: the compressor would hold their messages back until a buffer fills.
app.use(require('compression')({
  threshold: 1024,
  filter: (req, res) => !String(res.getHeader('Content-Type') || '').includes('text/event-stream') && require('compression').filter(req, res)
}));
// The assistant on generated websites: public, called from other origins, with its own CORS and limits.
app.use('/api/site-ai', require('./routes/siteAi'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use('/api', require('./middleware/originGuard'));
// Production: log only failed requests in a compact format (slow ones are reported by slowRequestLogger). Dev keeps the full log.
app.use(process.env.NODE_ENV === 'production'
  ? morgan(':method :url :status :res[content-length] - :response-time ms', { skip: (req, res) => res.statusCode < 400 })
  : morgan('dev'));
app.use(require('./utils/perfMonitor').slowRequestLogger);
// Stored preview assets are public capability URLs (unguessable token); a page can legitimately request dozens of them.
app.get('/api/preview-assets/:token/*', require('./controllers/previewController').getPreviewAsset);
app.use('/api', generalLimiter);
// Razorpay's webhook is signed over the EXACT bytes it sends, so it gets the raw body (before the JSON parser) and no login.
app.post('/api/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), require('./controllers/billingController').webhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Database Explorer Web UI
// The raw database viewer shows every collection (including accounts), so it is never served in production.
if (process.env.NODE_ENV !== 'production') app.use('/db', dbViewerRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/theme-palettes', themePaletteRoutes);
app.use('/api/custom-fonts', customFontRoutes);
app.use('/api/ai', aiCreationRoutes);
app.use('/api/prompt', promptEngineRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/hosting', hostingRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/template-sites', templateSiteRoutes.sites);
app.use('/api/template-jobs', templateSiteRoutes.jobs);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

module.exports = app;
