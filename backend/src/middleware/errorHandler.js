const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  // Expected client errors (e.g. 401 when logged out) only need a one-line note; keep stacks for real faults.
  if (err instanceof AppError && err.statusCode < 500) {
    logger.warn(`${err.name}: ${err.message} (${req.method} ${req.originalUrl})`);
  } else {
    logger.error(err.stack);
  }

  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  } else if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate field value entered';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Resource not found with id of ${err.value}`;
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      ...(err instanceof AppError && typeof err.code === 'string' ? { code: err.code } : {}),
      ...(err instanceof AppError && err.details ? { details: err.details } : {}),
      ...(err.report ? { validation: err.report } : {})
    }
  });
};

module.exports = errorHandler;
