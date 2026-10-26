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

const app = express();

// Behind the production reverse proxy (Caddy/Nginx): trust one hop so req.ip, rate limits and HTTPS detection are the visitor's.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(require('./services/project/validatedPreview').servePreview);
// Published sites: <slug>.<PUBLISH_BASE_DOMAIN>. Mounted before API middleware so site hosts never reach authenticated APIs.
app.use(require('./services/hosting/staticServer').serveHostedSite);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use('/api', require('./middleware/originGuard'));
app.use(morgan('dev'));
// Stored preview assets are public capability URLs (unguessable token); a page can legitimately request dozens of them.
app.get('/api/preview-assets/:token/*', require('./controllers/previewController').getPreviewAsset);
app.use('/api', generalLimiter);
// Razorpay signs the exact raw bytes, so this route must be registered before the JSON body parser.
app.post('/api/hosting/razorpay-webhook', express.raw({ type: 'application/json', limit: '1mb' }), require('./controllers/hostingController').razorpayWebhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize());

// Database Explorer Web UI
app.use('/db', dbViewerRoutes);

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

app.use(errorHandler);

module.exports = app;
