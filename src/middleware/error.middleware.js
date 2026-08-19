import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Centralized error handling middleware for Express
 */
export function errorMiddleware(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  const isProduction = config.nodeEnv === 'production';

  // Log error using structured logger
  logger.error(`Express Route Exception: ${req.method} ${req.originalUrl}`, err, req.id, {
    statusCode,
    ip: req.ip
  });

  const errorResponse = {
    status: 'error',
    message: isProduction && statusCode === 500 ? 'Internal Server Error' : err.message,
    requestId: req.id || 'N/A'
  };

  // Include stack trace only in development
  if (!isProduction) {
    errorResponse.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
}

