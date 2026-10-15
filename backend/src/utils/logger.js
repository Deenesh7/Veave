const getTimestamp = () => new Date().toISOString();

const logger = {
  info: (message) => console.log(`[${getTimestamp()}] [INFO] ${message}`),
  warn: (message) => console.warn(`[${getTimestamp()}] [WARN] ${message}`),
  error: (message) => console.error(`[${getTimestamp()}] [ERROR] ${message}`),
  debug: (message) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[${getTimestamp()}] [DEBUG] ${message}`);
    }
  }
};

module.exports = logger;
