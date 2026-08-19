import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/**
 * Middleware to verify JWT token from HttpOnly cookie or Authorization header
 */
export function authMiddleware(req, res, next) {
  try {
    let token = null;

    // 1. Check cookies first (preferred for Admin Panel)
    if (req.cookies && req.cookies.admin_token) {
      token = req.cookies.admin_token;
    }

    // 2. Fallback to Authorization Header (Bearer token)
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized: No active admin session found.',
      });
    }

    // Verify token
    jwt.verify(token, config.adminJwtSecret, (err, decoded) => {
      if (err) {
        return res.status(401).json({
          status: 'error',
          message: 'Unauthorized: Session is invalid or has expired.',
        });
      }

      // Attach admin profile data to request
      req.admin = {
        id: decoded.id,
        email: decoded.email,
        name: decoded.name,
      };
      
      next();
    });
  } catch (error) {
    console.error('Auth Middleware Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error during authentication.',
    });
  }
}
