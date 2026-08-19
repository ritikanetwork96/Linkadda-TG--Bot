import { Broadcast } from '../models/Broadcast.js';
import { User } from '../models/User.js';
import { telegramService } from './telegram.service.js';
import { storageService } from './storage.service.js';
import { logger } from '../config/logger.js';
import { ActivityLog } from '../models/ActivityLog.js';

class BroadcastService {
  constructor() {
    this.activeWorkers = new Set();
  }

  /**
   * Runs the sequential rate-limited broadcast dispatch
   */
  async runBroadcast(broadcastId) {
    const idStr = broadcastId.toString();

    // Prevent duplicate worker threads on the same broadcast
    if (this.activeWorkers.has(idStr)) {
      logger.warn(`Broadcast job is already running for ID: ${idStr}`);
      return;
    }

    this.activeWorkers.add(idStr);

    try {
      const broadcast = await Broadcast.findById(broadcastId);
      if (!broadcast || ['completed', 'failed', 'cancelled'].includes(broadcast.status)) {
        this.activeWorkers.delete(idStr);
        return;
      }

      logger.info(`Starting broadcast task execution: "${broadcast.title}" (ID: ${idStr})`);
      
      // Update status to processing
      broadcast.status = 'processing';
      await broadcast.save();

      // Find active users who have NOT been processed yet
      const query = {
        status: 'active',
        _id: { $nin: broadcast.processedUserIds || [] }
      };
      if (broadcast.botId) {
        query.botId = broadcast.botId;
      }
      const eligibleUsers = await User.find(query);

      logger.info(`Broadcast targeting size: ${eligibleUsers.length} remaining users (previously processed: ${broadcast.processedUserIds.length})`);

      let sent = broadcast.sentCount || 0;
      let failed = broadcast.failedCount || 0;
      let blocked = broadcast.blockedCount || 0;

      for (const user of eligibleUsers) {
        // Re-fetch broadcast state to check for dynamic admin cancellation
        const checkState = await Broadcast.findById(broadcastId).select('status');
        if (!checkState || checkState.status === 'cancelled') {
          logger.info(`Broadcast task cancelled dynamically by administrator. ID: ${idStr}`);
          break;
        }

        try {
          const keyboard = broadcast.urlButton && broadcast.urlButton.label && broadcast.urlButton.url ? {
            reply_markup: {
              inline_keyboard: [[{ text: broadcast.urlButton.label, url: broadcast.urlButton.url }]]
            }
          } : {};

          if (broadcast.type === 'text') {
            await telegramService.client.sendMessage(user.telegramUserId, broadcast.text, keyboard);
          } else {
            const fileSource = broadcast.storageKey 
              ? (await storageService.generatePresignedDownloadUrl(broadcast.storageKey))
              : broadcast.telegramFileId;
            const options = { caption: broadcast.text, ...keyboard };

            if (broadcast.type === 'photo') {
              await telegramService.client.sendPhoto(user.telegramUserId, fileSource, options);
            } else if (broadcast.type === 'video') {
              await telegramService.client.sendVideo(user.telegramUserId, fileSource, options);
            } else if (broadcast.type === 'document') {
              await telegramService.client.sendDocument(user.telegramUserId, fileSource, options);
            }
          }

          sent++;
        } catch (err) {
          const msg = err.message || '';
          if (msg.includes('bot was blocked') || msg.includes('deactivated') || msg.includes('chat not found')) {
            blocked++;
            // Update user status in database to avoid attempts in future broadcasts
            user.status = 'blocked';
            await user.save();
          } else {
            failed++;
            logger.warn(`Failed to dispatch message to user ${user.telegramUserId}: ${msg}`);
          }
        }

        // Add user to processed set and update counts
        await Broadcast.findByIdAndUpdate(broadcastId, {
          $addToSet: { processedUserIds: user._id },
          $set: { sentCount: sent, failedCount: failed, blockedCount: blocked }
        });

        // 50ms interval to stay under limits (~20 messages/sec)
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Re-fetch final state to confirm if completed
      const finalState = await Broadcast.findById(broadcastId);
      if (finalState && finalState.status !== 'cancelled') {
        finalState.status = 'completed';
        await finalState.save();
        logger.info(`Broadcast task completed: "${broadcast.title}" | Sent: ${sent}, Failed: ${failed}, Blocked: ${blocked}`);
        await ActivityLog.log('Broadcast completed', null, 'success', { broadcastId, sent, failed, blocked });
      }

    } catch (error) {
      logger.error(`Broadcast job critical exception (ID: ${idStr}):`, error);
      await Broadcast.findByIdAndUpdate(broadcastId, {
        $set: { status: 'failed', errorMessage: error.message }
      });
    } finally {
      this.activeWorkers.delete(idStr);
    }
  }

  /**
   * Resumes any active/queued broadcasts on startup
   */
  async resumeBroadcasts() {
    try {
      const pendingBroadcasts = await Broadcast.find({
        status: { $in: ['queued', 'processing'] }
      });

      if (pendingBroadcasts.length === 0) {
        return;
      }

      logger.info(`System Boot: Found ${pendingBroadcasts.length} broadcasts in queued/processing state. Triggering recovery...`);
      for (const bc of pendingBroadcasts) {
        this.runBroadcast(bc._id).catch(err => {
          logger.error(`Error recovering broadcast ${bc._id}:`, err);
        });
      }
    } catch (err) {
      logger.error('System Boot: Error recovering active broadcasts:', err);
    }
  }
}

export const broadcastService = new BroadcastService();
