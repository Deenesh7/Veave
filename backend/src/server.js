require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const jobManager = require('./services/ai/jobManager');

const PORT = parseInt(process.env.PORT, 10) || 5000;

let server;

const startServer = async () => {
  await connectDB();

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

startServer();
