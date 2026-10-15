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

const app = express();

app.use(require('./services/project/validatedPreview').servePreview);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use('/api', generalLimiter);
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

app.use(errorHandler);

module.exports = app;
