import { Telegram, Markup } from 'telegraf';
import { config } from '../config/env.js';
import { Delivery } from '../models/Delivery.js';
import { Content } from '../models/Content.js';
import { storageService } from './storage.service.js';

const telegram = new Telegram(config.botToken);

export const telegramService = {
  // Direct telegram client reference
  client: telegram,

  /**
   * Sends content to a user and logs the delivery
   * @param {string} userId - Mongoose User _id
   * @param {number} chatId - Telegram chat ID
   * @param {object} content - Mongoose Content document
   * @param {string} batchId - Unique delivery batch ID
   * @param {Date} deleteAt - Date when this message should be auto-deleted
   * @returns {Promise<object>} Telegram sent message object
   */
  async deliverContent(userId, chatId, content, batchId, deleteAt, botId = null, options = {}) {
    let sentMessage = null;
    const sendOptions = {};
    
    const isAdmin = config.adminTelegramIds.map(String).includes(String(chatId));
    if (!isAdmin || options.protectContent) {
      sendOptions.protect_content = true;
    }

    let deleteNotice = '';
    if (deleteAt) {
      const diffMs = new Date(deleteAt).getTime() - Date.now();
      const diffMins = Math.round(diffMs / (60 * 1000));
      if (diffMins <= 0) {
        deleteNotice = `\n\n⏱️ Auto-delete: Immediately`;
      } else if (diffMins < 60) {
        deleteNotice = `\n\n⏱️ Auto-delete: ${diffMins} min${diffMins > 1 ? 's' : ''}`;
      } else {
        const diffHrs = Math.round(diffMins / 60);
        if (diffHrs < 24) {
          deleteNotice = `\n\n⏱️ Auto-delete: ${diffHrs} hour${diffHrs > 1 ? 's' : ''}`;
        } else {
          const diffDays = Math.round(diffHrs / 24);
          deleteNotice = `\n\n⏱️ Auto-delete: ${diffDays} day${diffDays > 1 ? 's' : ''}`;
        }
      }
    }

    const caption = (options.captionOverride !== undefined && options.captionOverride !== null)
      ? options.captionOverride
      : content.caption;

    let finalCaption = caption || '';
    if (deleteNotice) {
      finalCaption += deleteNotice;
    }

    if (finalCaption) {
      sendOptions.caption = finalCaption;
      const isOverride = options.captionOverride !== undefined && options.captionOverride !== null;
      if (!isOverride && content.captionEntities && content.captionEntities.length > 0) {
        sendOptions.caption_entities = content.captionEntities;
      } else {
        sendOptions.parse_mode = 'HTML';
      }
    }

    if (content.replyMarkup) {
      sendOptions.reply_markup = content.replyMarkup;
    }

    switch (content.type) {
      case 'video': {
        const fileSource = content.telegramFileId || (await storageService.generatePresignedDownloadUrl(content.storageKey));
        sentMessage = await telegram.sendVideo(chatId, fileSource, sendOptions);
        if (!content.telegramFileId && sentMessage.video) {
          await Content.findByIdAndUpdate(content._id, {
            telegramFileId: sentMessage.video.file_id,
            telegramFileUniqueId: sentMessage.video.file_unique_id
          });
        }
        break;
      }
      case 'photo': {
        const fileSource = content.telegramFileId || (await storageService.generatePresignedDownloadUrl(content.storageKey));
        sentMessage = await telegram.sendPhoto(chatId, fileSource, sendOptions);
        if (!content.telegramFileId && sentMessage.photo) {
          const largestPhoto = sentMessage.photo[sentMessage.photo.length - 1];
          await Content.findByIdAndUpdate(content._id, {
            telegramFileId: largestPhoto.file_id,
            telegramFileUniqueId: largestPhoto.file_unique_id
          });
        }
        break;
      }
      case 'document': {
        const fileSource = content.telegramFileId || (await storageService.generatePresignedDownloadUrl(content.storageKey));
        sentMessage = await telegram.sendDocument(chatId, fileSource, sendOptions);
        if (!content.telegramFileId && sentMessage.document) {
          await Content.findByIdAndUpdate(content._id, {
            telegramFileId: sentMessage.document.file_id,
            telegramFileUniqueId: sentMessage.document.file_unique_id
          });
        }
        break;
      }
      case 'text': {
        const textOptions = { ...sendOptions };
        let textToSend = content.text || '';
        if (deleteNotice) {
          textToSend += deleteNotice;
        }
        if (content.textEntities && content.textEntities.length > 0) {
          textOptions.entities = content.textEntities;
          delete textOptions.parse_mode;
        } else {
          textOptions.parse_mode = 'HTML';
        }
        sentMessage = await telegram.sendMessage(chatId, textToSend, textOptions);
        break;
      }
      case 'link': {
        const text = caption || content.title || 'Open the link:';
        const linkOptions = {
          ...sendOptions,
          ...Markup.inlineKeyboard([
            Markup.button.url(content.title || 'Open Link', content.url)
          ])
        };
        if (content.captionEntities && content.captionEntities.length > 0) {
          linkOptions.caption_entities = content.captionEntities;
        } else if (content.textEntities && content.textEntities.length > 0) {
          linkOptions.entities = content.textEntities;
        } else {
          linkOptions.parse_mode = 'HTML';
        }
        sentMessage = await telegram.sendMessage(chatId, text, linkOptions);
        break;
      }
      default:
        throw new Error(`Unsupported content type: ${content.type}`);
    }

    if (sentMessage) {
      // Track this delivery in the database
      await Delivery.create({
        userId,
        telegramChatId: chatId,
        telegramMessageId: sentMessage.message_id,
        contentId: content._id,
        deliveryBatchId: batchId,
        messageType: content.type,
        sentAt: new Date(),
        deleteAt,
        status: 'sent',
        botId: botId || undefined,
        packId: options.packId || undefined,
      });
    }

    return sentMessage;
  },

  /**
   * Sends a group of photos/videos as an album
   */
  async deliverMediaGroup(userId, chatId, items, batchId, deleteAt, botId, options = {}) {
    const mediaList = [];
    const resolvedContents = [];

    for (const item of items) {
      const content = item.resolvedContent;
      resolvedContents.push(content);
      const caption = (item.captionOverride !== undefined && item.captionOverride !== null)
        ? item.captionOverride
        : content.caption;
      const fileSource = content.telegramFileId || (await storageService.generatePresignedDownloadUrl(content.storageKey));
      
      const mediaItem = {
        type: content.type, // 'photo' or 'video'
        media: fileSource,
      };
      if (caption) {
        mediaItem.caption = caption;
        const isOverride = item.captionOverride !== undefined && item.captionOverride !== null;
        if (!isOverride && content.captionEntities && content.captionEntities.length > 0) {
          mediaItem.caption_entities = content.captionEntities;
        } else {
          mediaItem.parse_mode = 'HTML';
        }
      }
      mediaList.push(mediaItem);
    }

    const isAdmin = config.adminTelegramIds.map(String).includes(String(chatId));
    if (!isAdmin || options.protectContent) {
      sendOptions.protect_content = true;
    }

    const sentMessages = await telegram.sendMediaGroup(chatId, mediaList, sendOptions);

    // Save deliveries and cache file_ids
    for (let i = 0; i < sentMessages.length; i++) {
      const sentMessage = sentMessages[i];
      const content = resolvedContents[i];

      // Cache file_id if it wasn't there
      if (!content.telegramFileId) {
        if (content.type === 'video' && sentMessage.video) {
          await Content.findByIdAndUpdate(content._id, {
            telegramFileId: sentMessage.video.file_id,
            telegramFileUniqueId: sentMessage.video.file_unique_id
          });
        } else if (content.type === 'photo' && sentMessage.photo) {
          const largestPhoto = sentMessage.photo[sentMessage.photo.length - 1];
          await Content.findByIdAndUpdate(content._id, {
            telegramFileId: largestPhoto.file_id,
            telegramFileUniqueId: largestPhoto.file_unique_id
          });
        }
      }

      await Delivery.create({
        userId,
        telegramChatId: chatId,
        telegramMessageId: sentMessage.message_id,
        contentId: content._id,
        deliveryBatchId: batchId,
        messageType: content.type,
        sentAt: new Date(),
        deleteAt,
        status: 'sent',
        botId: botId || undefined,
        packId: options.packId || undefined
      });
    }

    return sentMessages;
  },

  /**
   * Groups contiguous photos/videos and delivers a content pack
   */
  async deliverContentPack(userId, chatId, pack, batchId, deleteAt, botId) {
    const items = pack.items.filter(item => item.enabled);
    const results = {
      total: items.length,
      success: 0,
      failed: 0,
      skipped: 0
    };

    const groupableTypes = ['photo', 'video'];
    let mediaGroupQueue = [];

    const flushMediaGroup = async () => {
      if (mediaGroupQueue.length === 0) return;

      if (mediaGroupQueue.length === 1) {
        const item = mediaGroupQueue[0];
        try {
          await this.deliverContent(userId, chatId, item.resolvedContent, batchId, deleteAt, botId, {
            captionOverride: item.captionOverride,
            protectContent: pack.protectContent,
            packId: pack._id
          });
          results.success++;
        } catch (err) {
          console.error(`deliverContentPack: Single item delivery failed:`, err.message);
          results.failed++;
        }
      } else {
        // Send as media groups (split into chunks of 10)
        for (let i = 0; i < mediaGroupQueue.length; i += 10) {
          const chunk = mediaGroupQueue.slice(i, i + 10);
          try {
            await this.deliverMediaGroup(userId, chatId, chunk, batchId, deleteAt, botId, {
              protectContent: pack.protectContent,
              packId: pack._id
            });
            results.success += chunk.length;
          } catch (err) {
            console.error(`deliverContentPack: Media group delivery failed:`, err.message);
            results.failed += chunk.length;
          }
        }
      }
      mediaGroupQueue = [];
    };

    for (const item of items) {
      // Resolve content item from DB
      const content = await Content.findOne({ _id: item.contentId, status: 'active' });
      if (!content) {
        results.skipped++;
        continue;
      }

      // Attach resolved document for media group helper
      item.resolvedContent = content;

      if (groupableTypes.includes(content.type)) {
        mediaGroupQueue.push(item);
      } else {
        // Flush any media queue first to maintain ordering
        await flushMediaGroup();

        // Send non-groupable item
        try {
          await this.deliverContent(userId, chatId, content, batchId, deleteAt, botId, {
            captionOverride: item.captionOverride,
            protectContent: pack.protectContent,
            packId: pack._id
          });
          results.success++;
        } catch (err) {
          console.error(`deliverContentPack: Non-groupable item delivery failed:`, err.message);
          results.failed++;
        }
      }
    }

    // Final flush
    await flushMediaGroup();

    return results;
  },

  /**
   * Sends a welcome message (which is permanent and NOT tracked for deletion)
   * @param {number} chatId 
   * @param {string} text 
   * @returns {Promise<object>} Telegram sent message object
   */
  async sendWelcomeMessage(chatId, text) {
    return telegram.sendMessage(chatId, text);
  },

  /**
   * Deletes a message from Telegram
   * @param {number} chatId 
   * @param {number} messageId 
   * @returns {Promise<boolean>}
   */
  async deleteMessage(chatId, messageId) {
    try {
      await telegram.deleteMessage(chatId, messageId);
      return true;
    } catch (error) {
      console.error(`Telegram: deleteMessage failed for chat ${chatId}, message ${messageId}: ${error.message}`);
      throw error;
    }
  }
};
