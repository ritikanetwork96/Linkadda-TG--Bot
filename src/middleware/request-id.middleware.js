import crypto from 'crypto';

/**
 * Middleware that assigns a unique request ID to every incoming HTTP request
 * and returns it in the X-Request-ID response header.
 */
export const requestIdMiddleware = (req, res, next) => {
  // Check if client sent an ID, otherwise generate a secure random one
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  
  // Attach to both request and response context
  req.id = reqId;
  res.setHeader('X-Request-ID', reqId);
  
  next();
};
