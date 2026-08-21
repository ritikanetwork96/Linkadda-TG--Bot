import crypto from 'crypto';
import mongoose from 'mongoose';
import { userService } from '../../services/user.service.js';
import { contentService } from '../../services/content.service.js';
import { telegramService } from '../../services/telegram.service.js';
import { BotMenu } from '../../models/BotMenu.js';
import { Category } from '../../models/Category.js';
import { Content } from '../../models/Content.js';
import { EventLog } from '../../models/EventLog.js';

/**
 * Helper to build inline keyboard directly showing active categories
 */
export async function buildMainMenuMarkup(botId) {
  const { Category } = await import('../../models/Category.js');
  
  const botIdFilter = botId
    ? { $or: [{ botId: botId }, { botId: { $exists: false } }, { botId: null }] }
    : {};
  const categories = await Category.find({ status: 'active', ...botIdFilter }).sort({ sortOrder: 1, name: 1 });

  const buttons = categories.map(cat => {
    const iconPrefix = cat.icon ? `${cat.icon} ` : '📁 ';
    const name = cat.displayName || cat.name;
    return { text: `${iconPrefix}${name}`, callback_data: `cat:${cat._id}:1` };
  });

  // Format into rows of 2 buttons
  const inline_keyboard = [];
  for (let i = 0; i < buttons.length; i += 2) {
    const row = [buttons[i]];
    if (buttons[i + 1]) {
      row.push(buttons[i + 1]);
    }
    inline_keyboard.push(row);
  }

  // Add search button at the bottom
  inline_keyboard.push([{ text: '🔎 Search Content', callback_data: 'srch' }]);

  return { reply_markup: { inline_keyboard } };
}

// Bounded in-memory set to prevent duplicate deliveries from Telegram update retries
const processedUpdates = new Set();

/**
 * Handler for /start command (both normal /start and deep linking)
 */
export async function startHandler(ctx) {
  const chatId = ctx.chat.id;
  const telegramUser = ctx.from;

  // Deduplicate updates to prevent double deliveries on Telegram request retries
  const updateId = ctx.update?.update_id;
  if (updateId) {
    if (processedUpdates.has(updateId)) {
      console.log(`Start Handler: Duplicate Telegram update ${updateId} ignored.`);
      return;
    }
    processedUpdates.add(updateId);
    if (processedUpdates.size > 1000) {
      const firstVal = processedUpdates.values().next().value;
      processedUpdates.delete(firstVal);
    }
  }

  try {
    const botId = ctx.state.botId;
    const user = await userService.upsertUser(telegramUser, botId);
    const settings = ctx.state.settings;

    user.navigationState = { searchMode: false, currentMenu: 'home' };
    await user.save();

    const payload = ctx.payload;

    if (payload) {
      // 0. Content Sequence Deep Link Router (c_XX)
      if (payload.startsWith('c_')) {
        const { ContentSequence } = await import('../../models/ContentSequence.js');
        const sequence = await ContentSequence.findOne({ botId, publicCode: payload });

        if (!sequence || sequence.status !== 'ACTIVE') {
          return ctx.reply('Invalid or expired link.').catch(() => {});
        }

        if (sequence.expiresAt && new Date() > new Date(sequence.expiresAt)) {
          return ctx.reply('Invalid or expired link.').catch(() => {});
        }

        // Check AllowRepeatAccess constraint
        const repeatAllowed = sequence.settings?.allowRepeatAccess !== false;
        if (!repeatAllowed) {
          const { SequenceDelivery } = await import('../../models/SequenceDelivery.js');
          const alreadyDelivered = await SequenceDelivery.exists({
            sequenceId: sequence._id,
            userId: user._id,
            status: 'completed'
          });
          if (alreadyDelivered) {
            return ctx.reply('You have already accessed this one-time link.').catch(() => {});
          }
        }

        // Log sequence opened event
        await EventLog.log('sequence_opened', user._id, telegramUser.id, sequence._id.toString(), {}, botId);

        // Deliver sequence blocks in order
        const { SequenceDeliveryService } = await import('../../services/sequenceDelivery.service.js');
        const { userBot } = await import('../../bot/bot.js');

        try {
          await SequenceDeliveryService.deliverSequence(sequence._id, user, chatId, userBot);
        } catch (deliveryError) {
          console.error(`Start Handler: Failed to deliver sequence:`, deliveryError.message);
        }
        return; // STOP! Bypasses all other content delivery
      }

      // 0b. Link Router (supports l_ format for deep links created from admin bot)
      if (payload.startsWith('l_')) {
        const token = payload.substring(2);
        try {
          const { Link } = await import('../../models/Link.js');
          const link = await Link.findOne({ token, $or: [{ botId }, { botId: { $exists: false } }] });

          if (!link) {
            return ctx.reply('❌ This link is no longer available.').catch(() => {});
          }

          // Log link opened event
          await EventLog.log('link_opened', user._id, telegramUser.id, link._id.toString(), {}, botId);

          const { telegramService } = await import('../../services/telegram.service.js');
          const batchId = new mongoose.Types.ObjectId().toString();
          
          let deleteAt = null;
          if (link.autoDeleteSeconds !== undefined && link.autoDeleteSeconds !== null) {
            deleteAt = new Date(Date.now() + link.autoDeleteSeconds * 1000);
          } else if (settings.autoDeleteEnabled) {
            deleteAt = new Date(Date.now() + settings.autoDeleteHours * 60 * 60 * 1000);
          }

          // Sort items by sortOrder
          const items = [...link.items].sort((a, b) => a.sortOrder - b.sortOrder);

          for (const item of items) {
            if (item.type === 'text') {
              const textContent = {
                type: 'text',
                text: item.text,
                textEntities: item.textEntities || []
              };
              await telegramService.deliverContent(user._id, chatId, textContent, batchId, deleteAt, botId);
            } else if (item.mediaId) {
              const { Content } = await import('../../models/Content.js');
              const media = await Content.findById(item.mediaId);
              if (media) {
                const deliveryMedia = {
                  ...media.toObject(),
                  caption: item.caption || media.caption || '',
                  captionEntities: (item.captionEntities && item.captionEntities.length > 0) ? item.captionEntities : (media.captionEntities || [])
                };
                await telegramService.deliverContent(user._id, chatId, deliveryMedia, batchId, deleteAt, botId);
              }
            }
          }
        } catch (deliveryError) {
          console.error(`Start Handler: Failed to deliver link "${token}":`, deliveryError.message);
          return ctx.reply('⚠️ Failed to load content. Please try again later.').catch(() => {});
        }
        return;
      }

      // 1. Pack Link Router (supports both pack_ and p_ formats)
      if (payload.startsWith('pack_') || payload.startsWith('p_')) {
        let lookupCode = '';
        if (payload.startsWith('pack_')) {
          lookupCode = payload.substring(5);
        } else {
          lookupCode = payload.substring(2);
        }

        if (!lookupCode) {
          return ctx.reply('Invalid or expired link.').catch(() => {});
        }

        const { ContentPack } = await import('../../models/ContentPack.js');
        
        let pack = null;
        if (mongoose.Types.ObjectId.isValid(lookupCode)) {
          pack = await ContentPack.findOne({ _id: lookupCode, botId });
        } else {
          pack = await ContentPack.findOne({ publicCode: lookupCode, botId });
        }

        const isExpired = pack && pack.expiresAt && new Date() > new Date(pack.expiresAt);
        const isActive = pack && (pack.status === 'ACTIVE' || pack.status === 'published');

        if (!pack || !isActive || isExpired) {
          if (pack && isExpired && pack.status !== 'expired') {
            pack.status = 'expired';
            await pack.save().catch(() => {});
            
            const { Content } = await import('../../models/Content.js');
            if (pack.items && pack.items.length > 0) {
              for (const item of pack.items) {
                await Content.updateOne(
                  { _id: item.contentId },
                  { $set: { status: 'inactive' } }
                ).catch(() => {});
              }
            }
          }
          return ctx.reply('❌ This post is no longer available.').catch(() => {});
        }

        // Log pack opened event
        await EventLog.log('pack_opened', user._id, telegramUser.id, pack._id.toString(), {}, botId);

        // Initialize Delivery Batch
        const { DeliveryBatch } = await import('../../models/DeliveryBatch.js');
        const batch = await DeliveryBatch.create({
          botId,
          userId: user._id,
          packId: pack._id,
          status: 'processing',
          startedAt: new Date()
        });

        try {
          const batchId = batch._id.toString();
          let deleteAt = pack.expiresAt || null;
          if (settings.autoDeleteEnabled) {
            const globalDeleteAt = new Date(Date.now() + settings.autoDeleteHours * 60 * 60 * 1000);
            if (!deleteAt || globalDeleteAt < deleteAt) {
              deleteAt = globalDeleteAt;
            }
          }

          const results = await telegramService.deliverContentPack(user._id, chatId, pack, batchId, deleteAt, botId);

          batch.status = 'completed';
          batch.completedAt = new Date();
          batch.messageCount = results.total;
          batch.successCount = results.success;
          batch.failureCount = results.failed;
          await batch.save();

          await EventLog.log('pack_delivered', user._id, telegramUser.id, pack._id.toString(), {
            batchId,
            successCount: results.success,
            failureCount: results.failed,
            skippedCount: results.skipped
          }, botId);

        } catch (deliveryError) {
          console.error(`Start Handler: Failed to deliver pack "${pack.name}":`, deliveryError.message);
          batch.status = 'failed';
          batch.completedAt = new Date();
          await batch.save();
          return ctx.reply('⚠️ Failed to load content pack. Please try again later.').catch(() => {});
        }
        return;
      }

      // 2. Future-ready category routing preview
      if (payload.startsWith('category_')) {
        return ctx.reply('Invalid or expired link.').catch(() => {});
      }

      // 3. Future-ready content routing preview
      if (payload.startsWith('content_')) {
        return ctx.reply('Invalid or expired link.').catch(() => {});
      }

      // 4. Legacy Content f_ links
      if (payload.startsWith('f_')) {
        const contentId = payload.substring(2);

        if (!mongoose.Types.ObjectId.isValid(contentId)) {
          return ctx.reply('Invalid or expired link.').catch(() => {});
        }

        const content = await contentService.getActiveContentById(contentId, botId);
        if (!content) {
          return ctx.reply('Invalid or expired link.').catch(() => {});
        }

        await EventLog.log('deep_link_opened', user._id, telegramUser.id, contentId, {}, botId);

        let catName = 'None';
        if (content.categoryId) {
          const cat = await Category.findOne({ _id: content.categoryId, botId });
          if (cat) catName = cat.displayName || cat.name;
        }

        const previewText = `🎬 *${content.title}*\n\n📁 *Category:* ${catName}\n\n📝 *Description:*\n${content.caption || 'No description provided.'}`;

        return ctx.replyWithMarkdown(previewText, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '▶️ Get Content', callback_data: `get:${content._id}` }],
              [{ text: '🏠 Home', callback_data: 'home' }]
            ]
          }
        });
      }

      // Safely show invalid response for any other/malformed start payload
      return ctx.reply('Invalid or expired link.').catch(() => {});
    }

    // --- Normal Start Flow ---
    await EventLog.log('user_started', user._id, telegramUser.id, '', {}, botId);

    const behaviour = settings.startBehaviour || 'WELCOME_ONLY';

    if (behaviour === 'WELCOME_ONLY') {
      const text = settings.welcomeMessage || 'Welcome.';
      await ctx.reply(text).catch(() => {});
    } else if (behaviour === 'WELCOME_MENU') {
      const text = settings.welcomeMessage || 'Welcome.';
      const menuMarkup = await buildMainMenuMarkup(botId);
      await ctx.reply(text, menuMarkup).catch(() => {});
    } else if (behaviour === 'CONFIGURED_CONTENT') {
      const text = settings.welcomeMessage || 'Welcome.';
      await ctx.reply(text).catch(() => {});

      // Retrieve configured start content
      const startContents = await contentService.getStartContents(settings.startContentLimit, botId);
      if (startContents && startContents.length > 0) {
        const batchId = new mongoose.Types.ObjectId().toString();
        const deleteAt = settings.autoDeleteEnabled
          ? new Date(Date.now() + settings.autoDeleteHours * 60 * 60 * 1000)
          : null;

        for (const content of startContents) {
          try {
            await telegramService.deliverContent(user._id, chatId, content, batchId, deleteAt, botId);
          } catch (err) {
            console.error(`Start Handler: Failed to deliver start content item:`, err.message);
          }
          await new Promise(r => setTimeout(r, 100)); // safe delay
        }
      }
    } else if (behaviour === 'CONFIGURED_SEQUENCE') {
      if (settings.startSequenceId) {
        const { SequenceDeliveryService } = await import('../../services/sequenceDelivery.service.js');
        const { userBot } = await import('../../bot/bot.js');
        try {
          await SequenceDeliveryService.deliverSequence(settings.startSequenceId, user, chatId, userBot);
        } catch (err) {
          console.error(`Start Handler: Failed to deliver start sequence:`, err.message);
        }
      } else {
        const text = settings.welcomeMessage || 'Welcome.';
        await ctx.reply(text).catch(() => {});
      }
    } else if (behaviour === 'DISABLED') {
      // Do nothing
    }

  } catch (error) {
    console.error('Start Handler Error:', error.message);
    ctx.reply('⚠️ An error occurred while loading. Please type /start to reload.').catch(() => {});
  }
}
