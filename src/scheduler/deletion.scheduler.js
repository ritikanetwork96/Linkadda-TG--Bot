import cron from 'node-cron';
import { Setting } from '../models/Setting.js';
import { Delivery } from '../models/Delivery.js';
import { telegramService } from '../services/telegram.service.js';

let cronTask = null;

/**
 * Runs the deletion process for expired messages
 */
export async function runDeletionJob() {
  try {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes lock expiration

    // 2. Find eligible expired deliveries that are not locked
    const expiredCandidates = await Delivery.find({
      status: 'sent',
      deleteAt: { $lte: now },
      retryCount: { $lt: 3 },
      $or: [
        { lockedAt: { $exists: false } },
        { lockedAt: null },
        { lockedAt: { $lte: lockCutoff } }
      ]
    }).select('_id');

    if (expiredCandidates.length === 0) {
      return;
    }

    console.log(`Scheduler: Found ${expiredCandidates.length} potential expired delivery message(s) to process.`);

    // 3. Process deletions sequentially, claiming each atomically to support scale-out deployments
    for (const cand of expiredCandidates) {
      // Attempt to claim lock atomically
      const delivery = await Delivery.findOneAndUpdate(
        {
          _id: cand._id,
          status: 'sent',
          $or: [
            { lockedAt: { $exists: false } },
            { lockedAt: null },
            { lockedAt: { $lte: lockCutoff } }
          ]
        },
        {
          $set: { lockedAt: new Date() }
        },
        { new: true }
      );

      if (!delivery) {
        continue; // Already claimed by another worker instance
      }

      try {
        await telegramService.deleteMessage(delivery.telegramChatId, delivery.telegramMessageId);
        
        // Success: mark as deleted and release lock
        delivery.status = 'deleted';
        delivery.lockedAt = null;
        delivery.errorMessage = undefined;
        await delivery.save();
        console.log(`Scheduler: Successfully deleted message ${delivery.telegramMessageId} in chat ${delivery.telegramChatId}`);
      } catch (error) {
        const msg = error.message || '';
        
        // Permanent error checks (e.g. user blocked, chat deleted, message already gone)
        const isPermanent = msg.includes('message to delete not found') || 
                            msg.includes('chat not found') || 
                            msg.includes('bot was blocked') || 
                            msg.includes('deactivated') ||
                            msg.includes('user is deactivated');

        const nextRetry = isPermanent ? 3 : (delivery.retryCount || 0) + 1;
        
        // If max retries reached, fail permanently, otherwise put back in queue
        delivery.status = nextRetry >= 3 ? 'failed' : 'sent';
        delivery.retryCount = nextRetry;
        delivery.errorMessage = msg || 'Unknown Telegram deletion error';
        delivery.lockedAt = null; // Release lock for retry
        await delivery.save();
        
        console.warn(`Scheduler: Failed to delete message ${delivery.telegramMessageId} in chat ${delivery.telegramChatId}: ${msg} (Retry: ${nextRetry}/3)`);
      }
    }
  } catch (error) {
    console.error('Scheduler: Error running auto-delete job:', error.message);
  }
}

/**
 * Starts the deletion scheduler (running every minute)
 */
export function startDeletionScheduler() {
  if (cronTask) {
    console.log('Scheduler: Deletion scheduler is already running.');
    return;
  }

  // Run every minute
  cronTask = cron.schedule('*/1 * * * *', async () => {
    await runDeletionJob();
  });

  console.log('Scheduler: Automatic deletion scheduler started (running every minute).');
}

/**
 * Stops the deletion scheduler
 */
export function stopDeletionScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('Scheduler: Deletion scheduler stopped.');
  }
}
