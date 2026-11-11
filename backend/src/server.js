// Silence Node experimental warnings in main process and spawned workers
process.env.NODE_NO_WARNINGS = '1';
process.emitWarning = () => {};
Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
require('./config/loadEnv');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const jobManager = require('./services/ai/jobManager');

const PORT = parseInt(process.env.PORT, 10) || 5000;

let server;

const startServer = async () => {
  await connectDB();

  // Templates live in MongoDB (text) and S3 (images), not in the backend source: load them before any request needs one.
  try {
    const templateService = require('./services/templates/templateService');
    const loaded = await templateService.preload();
    logger.info(`Loaded ${loaded} template version(s) from the database.`);
    for (const problem of templateService.loadRegistry().problems || []) logger.error(`Template ${problem.id}@${problem.version} not loaded: ${problem.message}`);
  } catch (error) { logger.error(`Templates could not be loaded: ${error.message}`); }

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
  jobManager.startRecoverySweeper();
  try {
    const templateJobs = require('./services/templateSites/templateJobManager');
    const templateRecovery = await templateJobs.recover();
    if (templateRecovery.resumed || templateRecovery.abandoned) logger.warn(`Recovered template jobs after restart: resumed=${templateRecovery.resumed}, abandoned=${templateRecovery.abandoned}`);
    templateJobs.startSweeper();
  } catch (error) { logger.warn(`Template job recovery not started: ${error.message}`); }
  
  server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    // Confirm at startup that OpenRouter and GPT-6 Luna are reachable, so a bad key shows up in the logs right away.
    require('./services/ai/openrouterService').checkConnection().then((r) => {
      if (r.ok) logger.info(`OpenRouter: ${r.message}`);
      else logger.error(`OpenRouter NOT connected (${r.status}): ${r.message} AI generation will fail until this is fixed.`);
    }).catch((e) => logger.error(`OpenRouter check failed: ${e.message}`));
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
