import mongoose from 'mongoose';
import { ContentSequence } from '../models/ContentSequence.js';
import { SequenceDelivery } from '../models/SequenceDelivery.js';
import { Delivery } from '../models/Delivery.js';
import { logger } from '../config/logger.js';
import { Markup } from 'telegraf';

export const SequenceDeliveryService = {
  /**
   * Helper to parse auto-delete offset in milliseconds
   * @param {string} value 
   * @returns {number|null} Offset in milliseconds
   */
  getAutoDeleteOffset(value) {
    if (!value || value === 'OFF') return null;
    const m = value.match(/^(\d+)([mh])$/);
    if (!m) return null;
    const num = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'm') return num * 60 * 1000;
    if (unit === 'h') return num * 60 * 60 * 1000;
    return null;
  },

  /**
   * Delivers a Content Sequence to a target user chat
   * @param {string} sequenceId - ContentSequence ObjectId
   * @param {object} user - User mongoose document
   * @param {number} telegramChatId - Destination telegram chat/user ID
   * @param {object} botInstance - Telegraf user bot instance
   * @returns {Promise<object>} SequenceDelivery document
   */
  async deliverSequence(sequenceId, user, telegramChatId, botInstance) {
    const sequence = await ContentSequence.findById(sequenceId);
    if (!sequence) {
      throw new Error(`ContentSequence ${sequenceId} not found.`);
    }

    if (sequence.status !== 'ACTIVE') {
      throw new Error('Content is currently unavailable.');
    }

    if (sequence.expiresAt && new Date() > new Date(sequence.expiresAt)) {
      throw new Error('Link has expired.');
    }

    logger.info(`SequenceDelivery: Delivering sequence "${sequence.title}" to user ${telegramChatId}`);

    // Compute auto-delete expiration if configured
    const deleteOffset = this.getAutoDeleteOffset(sequence.settings?.autoDeleteValue);
    const deleteAt = deleteOffset ? new Date(Date.now() + deleteOffset) : null;

    // Create the SequenceDelivery tracking record
    const deliveryRecord = await SequenceDelivery.create({
      sequenceId: sequence._id,
      userId: user._id,
      publicCode: sequence.publicCode,
      status: 'processing',
      startedAt: new Date(),
      expiresAt: deleteAt
    });

    const sentMessageIds = [];
    const failedBlocks = [];
    let errDetails = '';

    try {
      // Sort blocks by sortOrder
      const blocks = sequence.blocks.sort((a, b) => a.sortOrder - b.sortOrder);

      for (const block of blocks) {
        try {
          const protect = sequence.settings?.protectContent || false;

          // 1. TEXT / LINKS Block Type
          if (block.type === 'TEXT' || block.type === 'LINKS') {
            const finalBody = block.content || '';
            if (finalBody) {
              const sentMsg = await botInstance.telegram.sendMessage(telegramChatId, finalBody, {
                parse_mode: 'HTML',
                protect_content: protect,
                disable_web_page_preview: false
              });
              sentMessageIds.push(sentMsg.message_id);
              await this._recordMessageDelivery(user._id, telegramChatId, sentMsg.message_id, deleteAt, sequence.botId, 'text');
            }
          }

          // 2. TEXT_WITH_BUTTONS Block Type
          else if (block.type === 'TEXT_WITH_BUTTONS') {
            const finalBody = block.content || `📦 <b>${sequence.title}</b>`;
            const buttons = block.buttons.sort((a, b) => a.sortOrder - b.sortOrder);
            let replyMarkup = null;

            if (buttons.length > 0) {
              const inlineButtons = buttons.map(btn => Markup.button.url(btn.text, btn.url));
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

            const sentMsg = await botInstance.telegram.sendMessage(telegramChatId, finalBody, {
              parse_mode: 'HTML',
              reply_markup: replyMarkup || undefined,
              protect_content: protect,
              disable_web_page_preview: false
            });
            sentMessageIds.push(sentMsg.message_id);
            await this._recordMessageDelivery(user._id, telegramChatId, sentMsg.message_id, deleteAt, sequence.botId, 'text');
          }

          // 3. PHOTO / VIDEO / DOCUMENT / MEDIA Block Type
          else if (block.type === 'PHOTO' || block.type === 'VIDEO' || block.type === 'DOCUMENT' || block.type === 'MEDIA') {
            const item = block.mediaItems[0];
            if (item) {
              const type = item.mediaType;
              const fileId = item.telegramFileId;
              const caption = item.caption || block.content || '';

              let sentMsg;
              if (type === 'photo') {
                sentMsg = await botInstance.telegram.sendPhoto(telegramChatId, fileId, {
                  caption,
                  parse_mode: 'HTML',
                  protect_content: protect
                });
              } else if (type === 'video') {
                sentMsg = await botInstance.telegram.sendVideo(telegramChatId, fileId, {
                  caption,
                  parse_mode: 'HTML',
                  protect_content: protect
                });
              } else {
                sentMsg = await botInstance.telegram.sendDocument(telegramChatId, fileId, {
                  caption,
                  parse_mode: 'HTML',
                  protect_content: protect
                });
              }

              sentMessageIds.push(sentMsg.message_id);
              await this._recordMessageDelivery(user._id, telegramChatId, sentMsg.message_id, deleteAt, sequence.botId, type);
            }
          }

          // 4. MEDIA_GROUP Block Type
          else if (block.type === 'MEDIA_GROUP') {
            const items = block.mediaItems.sort((a, b) => a.sortOrder - b.sortOrder);
            if (items.length > 0) {
              // Group into chunks of 10 items max
              const chunks = [];
              for (let i = 0; i < items.length; i += 10) {
                chunks.push(items.slice(i, i + 10));
              }

              for (const chunk of chunks) {
                const mediaGroup = chunk.map(item => ({
                  type: item.mediaType === 'document' ? 'document' : item.mediaType,
                  media: item.telegramFileId,
                  caption: item.caption || ''
                }));

                const sent = await botInstance.telegram.sendMediaGroup(telegramChatId, mediaGroup, {
                  protect_content: protect
                });

                for (const msg of sent) {
                  sentMessageIds.push(msg.message_id);
                  const type = msg.video ? 'video' : msg.photo ? 'photo' : 'document';
                  await this._recordMessageDelivery(user._id, telegramChatId, msg.message_id, deleteAt, sequence.botId, type);
                }
                await new Promise(r => setTimeout(r, 100)); // batch delay
              }
            }
          }

          // Sequential delay to protect order & rate limits
          await new Promise(r => setTimeout(r, 150));

        } catch (blockErr) {
          logger.error(`SequenceDelivery: Error delivering block ${block.blockId}: ${blockErr.message}`);
          failedBlocks.push(block.blockId);
          errDetails += `Block ${block.blockId}: ${blockErr.message}\n`;
        }
      }

      // Finalize sequence delivery record status
      deliveryRecord.status = failedBlocks.length > 0 ? 'failed' : 'completed';
      deliveryRecord.completedAt = new Date();
      deliveryRecord.messageIds = sentMessageIds;
      deliveryRecord.failedBlocks = failedBlocks;
      deliveryRecord.errorDetails = errDetails || undefined;
      await deliveryRecord.save();

      return deliveryRecord;

    } catch (err) {
      logger.error(`SequenceDelivery: Critical sequence delivery failure: ${err.message}`);
      deliveryRecord.status = 'failed';
      deliveryRecord.completedAt = new Date();
      deliveryRecord.errorDetails = err.message;
      await deliveryRecord.save();
      throw err;
    }
  },

  /**
   * Internal helper to record sent message IDs for auto-delete scheduler tracking
   */
  async _recordMessageDelivery(userId, telegramChatId, telegramMessageId, deleteAt, botId, messageType) {
    try {
      await Delivery.create({
        userId,
        telegramChatId,
        telegramMessageId,
        deliveryBatchId: 'seq_' + Date.now() + '_' + Math.random().toString(36).substring(7),
        messageType,
        sentAt: new Date(),
        deleteAt,
        status: 'sent',
        botId
      });
    } catch (err) {
      logger.error(`SequenceDelivery: Error logging delivery tracking: ${err.message}`);
    }
  }
};
