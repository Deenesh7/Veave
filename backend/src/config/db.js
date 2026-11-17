const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      // One pool of reusable connections shared by every request (never one connection per request).
      maxPoolSize: Number.parseInt(process.env.MONGO_MAX_POOL, 10) || 50,
      minPoolSize: Number.parseInt(process.env.MONGO_MIN_POOL, 10) || 5,
      maxIdleTimeMS: 60000,
      connectTimeoutMS: 10000,
      // A query that hangs fails after this long instead of holding a request (and a pool slot) forever.
      socketTimeoutMS: Number.parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 10) || 120000,
      waitQueueTimeoutMS: 15000,
    });

    return conn;
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
