import https from 'https';
import http from 'http';
import cron from 'node-cron';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

let cronTask = null;

/**
 * Pings a URL to keep the server awake
 * @param {string} url 
 * @returns {Promise<number>} HTTP Status Code
 */
function pingUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 10000 }, (res) => {
      resolve(res.statusCode);
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * Runs the keep alive ping job
 */
export async function runKeepAliveJob() {
  const pingUrlRaw = process.env.PING_URL || config.adminOrigin;
  if (!pingUrlRaw) {
    logger.warn('Keep-Alive: No PING_URL or ADMIN_ORIGIN configured. Skipping keep-alive ping.');
    return;
  }

  // Sanitize the URL
  const targetOrigin = pingUrlRaw.replace(/\/$/, '');
  const targetUrl = `${targetOrigin}/live`;

  // Skip if URL points to localhost and we are not forcing it
  const isLocal = targetOrigin.includes('localhost') || targetOrigin.includes('127.0.0.1');
  if (isLocal && process.env.FORCE_KEEP_ALIVE !== 'true') {
    logger.info(`Keep-Alive: Target URL is local (${targetOrigin}). Skipping ping to avoid local loop.`);
    return;
  }

  try {
    logger.info(`Keep-Alive: Sending ping to ${targetUrl}...`);
    const status = await pingUrl(targetUrl);
    logger.info(`Keep-Alive: Ping successful! Response status: ${status}`);
  } catch (error) {
    logger.error(`Keep-Alive: Ping failed to ${targetUrl}: ${error.message}`);
  }
}

/**
 * Starts the keep-alive scheduler
 */
export function startKeepAliveScheduler() {
  if (cronTask) {
    logger.info('Keep-Alive: Scheduler already running.');
    return;
  }

  // Ping every 5 minutes
  cronTask = cron.schedule('*/5 * * * *', async () => {
    await runKeepAliveJob();
  });

  logger.info('Keep-Alive: Keep-alive scheduler started (running every 5 minutes).');
  
  // Trigger a ping immediately on startup to verify connectivity
  runKeepAliveJob().catch(err => {
    logger.error('Keep-Alive: Initial startup ping failed:', err.message);
  });
}

/**
 * Stops the keep-alive scheduler
 */
export function stopKeepAliveScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Keep-Alive: Scheduler stopped.');
  }
}
