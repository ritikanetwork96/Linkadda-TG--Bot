import { MediaBundle } from '../models/MediaBundle.js';
import { Delivery } from '../models/Delivery.js';
import { DeliveryBatch } from '../models/DeliveryBatch.js';
import { logger } from '../config/logger.js';
import { Markup } from 'telegraf';

export const PostDeliveryService = {
  /**
   * Delivers a Media Bundle to a target chat (channel or user)
   * @param {string} bundleId - MediaBundle ObjectId string
   * @param {number|string} targetChatId - Destination chat/channel ID
   * @param {object} botInstance - The Telegraf bot instance to use (User Bot)
   * @returns {Promise<object>} Results summary
   */
  async deliverBundle(bundleId, targetChatId, botInstance) {
    const bundle = await MediaBundle.findById(bundleId);
    if (!bundle) {
      throw new Error(`MediaBundle ${bundleId} not found.`);
    }

    logger.info(`PostDelivery: Starting delivery of bundle "${bundle.title}" to target ${targetChatId}`);

    // Create a delivery batch record
    const batch = await DeliveryBatch.create({
      botId: bundle.botId,
      status: 'processing',
      startedAt: new Date()
    });

    const sentMessageIds = [];
    const deleteAt = bundle.autoDeleteEnabled
      ? new Date(Date.now() + bundle.autoDeleteAfter * 60 * 60 * 1000)
      : null;

    let successCount = 0;
    let failedCount = 0;

    try {
      // 1. Deliver Media Items in chunks of 10
      const items = [...(bundle.mediaItems || [])].sort((a, b) => a.sortOrder - b.sortOrder);
      const mediaChunks = [];
      for (let i = 0; i < items.length; i += 10) {
        mediaChunks.push(items.slice(i, i + 10));
      }

      for (const chunk of mediaChunks) {
        const mediaGroup = chunk.map(item => ({
          type: item.mediaType === 'document' ? 'document' : item.mediaType,
          media: item.telegramFileId
        }));

        try {
          const sent = await botInstance.telegram.sendMediaGroup(targetChatId, mediaGroup, {
            protect_content: bundle.protectContent
          });

          for (const msg of sent) {
            sentMessageIds.push(msg.message_id);
            successCount++;

            // Log individual deliveries for auto-deletion
            await Delivery.create({
              telegramChatId: targetChatId,
              telegramMessageId: msg.message_id,
              deliveryBatchId: batch._id,
              messageType: msg.video ? 'video' : msg.photo ? 'photo' : 'document',
              sentAt: new Date(),
              deleteAt,
              status: 'sent',
              botId: bundle.botId
            });
          }
        } catch (err) {
          logger.error(`PostDelivery: Media group chunk delivery failed: ${err.message}`);
          failedCount += chunk.length;
        }
      }

      // 2. Deliver Common Text + Links + Inline Buttons
      // Construct links block
      const linksBlock = [...(bundle.links || [])].sort((a, b) => a.sortOrder - b.sortOrder)
        .map(l => `🔗 <a href="${l.url}">${l.label || l.url}</a>`)
        .join('\n\n');

      let finalBody = bundle.text || '';
      if (linksBlock) {
        finalBody += (finalBody ? '\n\n' : '') + linksBlock;
      }

      // Construct inline buttons markup
      const buttons = [...(bundle.buttons || [])].sort((a, b) => a.sortOrder - b.sortOrder);
      let replyMarkup = null;
      if (buttons.length > 0) {
        const inlineButtons = buttons.map(btn => Markup.button.url(btn.text, btn.url));
        // Use layout configuration: 1 or 2 per row
        const layout = [];
        for (let i = 0; i < inlineButtons.length; i += 2) {
          const row = [inlineButtons[i]];
          if (inlineButtons[i + 1]) {
            row.push(inlineButtons[i + 1]);
          }
          layout.push(row);
        }
        replyMarkup = Markup.inlineKeyboard(layout).reply_markup;
      }

      if (finalBody || replyMarkup) {
        // If there's no text body but buttons exist, send a placeholder or title
        const textToSend = finalBody || `📦 <b>${bundle.title}</b>`;
        const sentMsg = await botInstance.telegram.sendMessage(targetChatId, textToSend, {
          parse_mode: 'HTML',
          reply_markup: replyMarkup || undefined,
          protect_content: bundle.protectContent,
          disable_web_page_preview: false
        });

        sentMessageIds.push(sentMsg.message_id);
        successCount++;

        await Delivery.create({
          telegramChatId: targetChatId,
          telegramMessageId: sentMsg.message_id,
          deliveryBatchId: batch._id,
          messageType: 'text',
          sentAt: new Date(),
          deleteAt,
          status: 'sent',
          botId: bundle.botId
        });
      }

      // Update batch summary
      batch.status = failedCount > 0 ? 'failed' : 'completed';
      batch.completedAt = new Date();
      batch.messageCount = successCount + failedCount;
      batch.successCount = successCount;
      batch.failureCount = failedCount;
      batch.telegramMessageIds = sentMessageIds;
      await batch.save();

      return {
        batchId: batch._id,
        success: successCount,
        failed: failedCount,
        messageIds: sentMessageIds
      };

    } catch (err) {
      logger.error(`PostDelivery: Critical bundle delivery failure: ${err.message}`);
      batch.status = 'failed';
      batch.completedAt = new Date();
      await batch.save();
      throw err;
    }
  }
};
