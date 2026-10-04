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
    const lockCutoff = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes lock cutoff

    // 1. Release any stale locks older than 2 minutes
    await Delivery.updateMany(
      { status: 'sent', lockedAt: { $exists: true, $ne: null, $lte: lockCutoff } },
      { $set: { lockedAt: null } }
    ).catch(() => {});

    // 2. Find eligible expired deliveries that are not locked
    // CRITICAL: deleteAt must explicitly exist and not be null so lifetime messages are never touched
    const expiredCandidates = await Delivery.find({
      status: 'sent',
      deleteAt: { $exists: true, $ne: null, $lte: now },
      retryCount: { $lt: 3 },
      $or: [
        { lockedAt: { $exists: false } },
        { lockedAt: null }
      ]
    })
    .sort({ deleteAt: 1 })
    .limit(100)
    .select('_id');

    if (expiredCandidates.length === 0) {
      return;
    }

    console.log(`Scheduler: Found ${expiredCandidates.length} expired delivery message(s) to process.`);

    // 3. Process deletions sequentially, claiming each atomically to support scale-out deployments
    for (const cand of expiredCandidates) {
      // Attempt to claim lock atomically
      const delivery = await Delivery.findOneAndUpdate(
        {
          _id: cand._id,
          status: 'sent',
          $or: [
            { lockedAt: { $exists: false } },
            { lockedAt: null }
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
        await telegramService.deleteMessage(delivery.telegramChatId, delivery.telegramMessageId, delivery.botId);
        
        // Success: mark as deleted and release lock
        delivery.status = 'deleted';
        delivery.lockedAt = null;
        delivery.errorMessage = undefined;
        await delivery.save();
        console.log(`Scheduler: Successfully deleted message ${delivery.telegramMessageId} in chat ${delivery.telegramChatId} (botId: ${delivery.botId || 'active'})`);
      } catch (error) {
        const msg = error.message || '';
        
        // Permanent error checks (e.g. user blocked, chat deleted, message already gone)
        const isPermanent = msg.includes('message to delete not found') || 
                            msg.includes("message can't be deleted") || 
                            msg.includes('chat not found') || 
                            msg.includes('bot was blocked') || 
                            msg.includes('deactivated') ||
                            msg.includes('user is deactivated');

        // If message is already gone on Telegram, mark as deleted rather than failed
        if (msg.includes('message to delete not found') || msg.includes("message can't be deleted")) {
          delivery.status = 'deleted';
          delivery.lockedAt = null;
          delivery.errorMessage = 'Message already deleted on Telegram';
          await delivery.save();
          console.log(`Scheduler: Message ${delivery.telegramMessageId} in chat ${delivery.telegramChatId} was already removed.`);
          continue;
        }

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
 * Starts the deletion scheduler (running every 30 seconds)
 */
export function startDeletionScheduler() {
  if (cronTask) {
    console.log('Scheduler: Deletion scheduler is already running.');
    return;
  }

  // Startup cleanup: release any stale locks and recover any recently failed deliveries from earlier token bug
  Delivery.updateMany(
    { status: 'sent', lockedAt: { $exists: true, $ne: null } },
    { $set: { lockedAt: null } }
  ).catch(() => {});

  Delivery.updateMany(
    {
      status: 'failed',
      deleteAt: { $exists: true, $ne: null, $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      errorMessage: { $regex: /(deleteMessage|not found|unauthorized|blocked|token)/i }
    },
    { $set: { status: 'sent', retryCount: 0, lockedAt: null } }
  ).catch(() => {});

  // Run initial pass immediately
  runDeletionJob().catch(err => {
    console.warn('Scheduler: Initial deletion check notice:', err.message);
  });

  // Run every 30 seconds for precise auto-delete timing
  cronTask = cron.schedule('*/30 * * * * *', async () => {
    await runDeletionJob();
  });

  console.log('Scheduler: Automatic deletion scheduler started (running every 30 seconds).');
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
