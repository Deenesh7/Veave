// Silence Node experimental warnings in main process and spawned workers
process.env.NODE_NO_WARNINGS = '1';
process.emitWarning = () => {};
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const jobManager = require('./services/ai/jobManager');

const PORT = parseInt(process.env.PORT, 10) || 5000;

let server;

const startServer = async () => {
  await connectDB();

  try {
    const recoveredDeployments = await require('./services/hosting/deploymentService').recoverInterruptedDeployments();
    if (recoveredDeployments) logger.warn(`Marked ${recoveredDeployments} interrupted publish(es) as failed; previous versions restored.`);
  } catch (error) {
    logger.warn(`Publish recovery skipped: ${error.message}`);
  }

  // Custom-domain workflows are durable: anything waiting for DNS, deployment or a certificate resumes from its saved stage.
  try { require('./services/hosting/domainOrchestrator').start(); } catch (error) { logger.warn(`Domain workflow not started: ${error.message}`); }

  const recovery = await jobManager.recoverInterruptedJobs();
  if (recovery.resumed || recovery.failedCommits) {
    logger.warn(`Recovered generation jobs after restart: resumed=${recovery.resumed}, failedCommits=${recovery.failedCommits}`);
  }
  
  server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use. Terminating existing process...`);
      process.exit(1);
    } else {
      logger.error(`Server error: ${err.message}`);
      process.exit(1);
    }
  });
};

// Graceful shutdown on nodemon restart (SIGUSR2) and termination signals
const handleShutdown = () => {
  require('./services/lsp/lspManager').disposeAll().catch(() => {}); require('./services/search/projectIndex').disposeAll(); // stop language servers and remove their scratch workspaces
  if (server) {
    server.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.once('SIGUSR2', handleShutdown);
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

if (/^(1|true|yes|on)$/i.test(String(process.env.INCREMENTAL_CODE_SEARCH || ''))) require('./services/search/embedder').warm(); // load the local embedding model in the background

startServer();
