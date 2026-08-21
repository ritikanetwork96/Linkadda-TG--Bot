import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/env.js';
import healthRoutes from './routes/health.routes.js';
import adminRoutes from './routes/admin.routes.js';
import linkRoutes from './routes/link.routes.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { logger } from './config/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 0. Request ID & Request logging
app.use(requestIdMiddleware);
app.use((req, res, next) => {
  logger.info(`HTTP Request: ${req.method} ${req.originalUrl}`, req.id, {
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  next();
});

// 1. Security Headers (Helmet CSP configuration for Admin UI and security properties)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.filebase.com", "https://*.filebase.io", "https://*.amazonaws.com"],
      mediaSrc: ["'self'", "blob:", "https://*.filebase.com", "https://*.filebase.io", "https://*.amazonaws.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// 2. CORS configuration (allowing credentials for authorized origins only)
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  let corsOptions = {
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Request-ID']
  };

  // If same-origin (no Origin header) or request is coming from our own host, allow it
  const host = req.header('Host');
  const isSameHost = origin && host && origin.includes(host);

  if (!origin || isSameHost) {
    corsOptions.origin = true;
    return callback(null, corsOptions);
  }

  // Normalize origins (remove trailing slashes)
  const cleanOrigin = origin.replace(/\/$/, '');
  const cleanAdminOrigin = (config.adminOrigin || '').replace(/\/$/, '');

  const isLocal = config.nodeEnv !== 'production' && (
    cleanOrigin.startsWith('http://localhost:') || 
    cleanOrigin.startsWith('http://127.0.0.1:')
  );

  if (isLocal || (cleanAdminOrigin && cleanOrigin === cleanAdminOrigin)) {
    corsOptions.origin = true;
  } else {
    corsOptions.origin = false; // Disallow CORS but do not throw 500 server exception
  }

  callback(null, corsOptions);
}));

// 3. Global Request Limiter (excluding assets / static files)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 API requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});
app.use('/api', apiLimiter);

// 3b. Dedicated Admin Login Brute-force Limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit to 5 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many login attempts. Please try again after 15 minutes.'
  }
});
app.use('/api/admin/auth/login', loginLimiter);

// 3c. Public Link Access Rate Limiter
const linkLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 views/requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many link access requests. Please slow down.'
  }
});
app.use('/l/:token', linkLimiter);

// 4. Body & Cookie Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 5. Serve Admin Static Panel
app.use('/admin', express.static(path.resolve(__dirname, '../admin')));

// 6. Routes
app.use('/', healthRoutes);
app.use('/', linkRoutes);
app.use('/api/admin', adminRoutes);



// 7. Centralized Error Handler
app.use(errorMiddleware);

export default app;

