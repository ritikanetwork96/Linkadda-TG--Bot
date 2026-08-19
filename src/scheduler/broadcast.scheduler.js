import cron from 'node-cron';
import { Broadcast } from '../models/Broadcast.js';
import { broadcastService } from '../services/broadcast.service.js';
import { logger } from '../config/logger.js';

let cronTask = null;

/**
 * Runs the scheduled broadcast worker
 */
export async function runScheduledBroadcastJob() {
  try {
    const now = new Date();

    // Find queued broadcasts whose scheduled time has arrived or passed
    const pendingBroadcasts = await Broadcast.find({
      status: 'queued',
      scheduledAt: { $exists: true, $ne: null, $lte: now }
    });

    if (pendingBroadcasts.length === 0) {
      return;
    }

    logger.info(`Broadcast Scheduler: Found ${pendingBroadcasts.length} scheduled broadcast(s) ready to dispatch.`);

    for (const bc of pendingBroadcasts) {
      // Execute asynchronously in background using broadcastService
      broadcastService.runBroadcast(bc._id).catch(err => {
        logger.error(`Broadcast Scheduler Error starting broadcast ${bc._id}:`, err);
      });
    }
  } catch (error) {
    logger.error('Broadcast Scheduler: Error checking scheduled broadcasts:', error.message);
  }
}

/**
 * Starts the scheduled broadcast worker (running every minute)
 */
export function startBroadcastScheduler() {
  if (cronTask) {
    logger.info('Broadcast Scheduler: Already running.');
    return;
  }

  cronTask = cron.schedule('*/1 * * * *', async () => {
    await runScheduledBroadcastJob();
  });

  logger.info('Broadcast Scheduler: Scheduled broadcast worker started (running every minute).');
}

/**
 * Stops the scheduled broadcast worker
 */
export function stopBroadcastScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('Broadcast Scheduler: Stopped.');
  }
}
