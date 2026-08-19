import mongoose from 'mongoose';
import { Category } from '../../models/Category.js';
import { Content } from '../../models/Content.js';
import { User } from '../../models/User.js';
import { Setting } from '../../models/Setting.js';
import { EventLog } from '../../models/EventLog.js';
import { telegramService } from '../../services/telegram.service.js';
import { userService } from '../../services/user.service.js';
import { buildMainMenuMarkup } from './start.handler.js';
import crypto from 'crypto';

// In-memory request deduplication cache to prevent rapid double-clicks (Task 22)
const requestCooldownCache = new Set();

/**
 * Handler for callback queries
 */
export async function callbackHandler(ctx) {
  try {
    const data = ctx.callbackQuery.data;
    const telegramUser = ctx.from;
    const chatId = ctx.chat.id;

    // Load/Upsert user and settings
    const user = await userService.upsertUser(telegramUser, ctx.state.botId);
    const settings = ctx.state.settings;

    // 1. Home Menu Callback
    if (data === 'home') {
      await ctx.answerCbQuery().catch(() => {});
      user.navigationState = { searchMode: false, currentMenu: 'home' };
      await user.save();

      const menuMarkup = await buildMainMenuMarkup(ctx.state.botId);
      await ctx.editMessageText(settings.welcomeMessage, menuMarkup).catch(() => {});
      await EventLog.log('menu_opened', user._id, telegramUser.id, 'home', {}, ctx.state.botId);
      return;
    }

    // 2. Categories List Callback
    if (data === 'cats') {
      await ctx.answerCbQuery().catch(() => {});
      user.navigationState = { searchMode: false, currentMenu: 'categories' };
      await user.save();

      const botIdFilter = ctx.state.botId
        ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] }
        : {};
      const categories = await Category.find({ status: 'active', ...botIdFilter }).sort({ sortOrder: 1, name: 1 });

      if (categories.length === 0) {
        return ctx.editMessageText('📂 *Categories*\n\nNo active categories configured.', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      const buttons = categories.map(cat => {
        const iconPrefix = cat.icon ? `${cat.icon} ` : '';
        const name = cat.displayName || cat.name;
        return { text: `${iconPrefix}${name}`, callback_data: `cat:${cat._id}:1` };
      });

      // Format 2 per row
      const inline_keyboard = [];
      for (let i = 0; i < buttons.length; i += 2) {
        const row = [buttons[i]];
        if (buttons[i + 1]) row.push(buttons[i + 1]);
        inline_keyboard.push(row);
      }
      inline_keyboard.push([{ text: '🏠 Home', callback_data: 'home' }]);

      await ctx.editMessageText('📂 *Categories*\n\nSelect a folder to browse contents:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
      return;
    }

    // 3. Category Contents paginated callback
    if (data.startsWith('cat:')) {
      await ctx.answerCbQuery().catch(() => {});
      const parts = data.split(':');
      const categoryId = parts[1];
      const page = parseInt(parts[2], 10) || 1;

      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return ctx.editMessageText('⚠️ Invalid Category format.', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      const catBotFilter = ctx.state.botId
        ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] }
        : {};
      const cat = await Category.findOne({ _id: categoryId, status: 'active', ...catBotFilter });
      if (!cat) {
        return ctx.editMessageText('⚠️ Category is no longer available.', {
          reply_markup: { inline_keyboard: [[{ text: '📂 Categories', callback_data: 'cats' }]] }
        });
      }

      user.navigationState = { searchMode: false, currentMenu: `cat:${categoryId}`, currentCategoryId: categoryId, currentPage: page };
      await user.save();

      // Track category open analytics
      await EventLog.log('category_opened', user._id, telegramUser.id, categoryId, {}, ctx.state.botId);

      const limit = 8; // standard list limits
      const contentBotFilter = ctx.state.botId
        ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] }
        : {};
      const query = { categoryId, status: 'active', ...contentBotFilter };
      const total = await Content.countDocuments(query);
      const totalPages = Math.ceil(total / limit);

      const contents = await Content.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const catTitle = cat.displayName || cat.name;

      if (contents.length === 0) {
        return ctx.editMessageText(`📂 *${catTitle}*\n\nThis category contains no content items.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🏠 Back to Home', callback_data: 'home' }]
            ]
          }
        });
      }

      // Map contents to inline buttons
      const inline_keyboard = contents.map(item => [
        { text: `🔹 ${item.title}`, callback_data: `info:${item._id}` }
      ]);

      // Add Pagination row
      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) {
          pagRow.push({ text: '◀️ Prev', callback_data: `cat:${categoryId}:${page - 1}` });
        }
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'ack' });
        if (page < totalPages) {
          pagRow.push({ text: 'Next ▶️', callback_data: `cat:${categoryId}:${page + 1}` });
        }
        inline_keyboard.push(pagRow);
      }

      // Add Navigation buttons
      inline_keyboard.push([
        { text: '🏠 Back to Home', callback_data: 'home' }
      ]);

      await ctx.editMessageText(`📂 *${catTitle}*\n\nBrowse available files:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
      return;
    }

    // 4. Content Preview Details Callback
    if (data.startsWith('info:')) {
      await ctx.answerCbQuery().catch(() => {});
      const contentId = data.split(':')[1];

      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return ctx.editMessageText('⚠️ Invalid content ID.', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      const content = await Content.findOne({ _id: contentId, status: 'active', botId: ctx.state.botId });
      if (!content) {
        return ctx.editMessageText('⚠️ This content is no longer available.', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      // Track preview event
      await EventLog.log('content_previewed', user._id, telegramUser.id, contentId, {}, ctx.state.botId);

      let catName = 'None';
      let backCallback = 'home';

      if (content.categoryId) {
        const cat = await Category.findOne({ _id: content.categoryId, botId: ctx.state.botId });
        if (cat) {
          catName = cat.displayName || cat.name;
          backCallback = `cat:${content.categoryId}:1`;
        }
      }

      const text = `🎬 *${content.title}*\n\n📁 *Category:* ${catName}\n\n📝 *Description:*\n${content.caption || 'No description provided.'}`;

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '▶️ Get Content', callback_data: `get:${content._id}` }],
            [{ text: '◀️ Back', callback_data: backCallback }, { text: '🏠 Home', callback_data: 'home' }]
          ]
        }
      });
      return;
    }

    // 5. Get Content Delivery Callback
    if (data.startsWith('get:')) {
      const contentId = data.split(':')[1];

      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return ctx.answerCbQuery('⚠️ Invalid reference ID format.').catch(() => {});
      }

      // Cooldown check (Task 22)
      const cooldownKey = `${telegramUser.id}_${contentId}`;
      if (requestCooldownCache.has(cooldownKey)) {
        return ctx.answerCbQuery('⏳ Processing request... please do not double-click.').catch(() => {});
      }
      requestCooldownCache.add(cooldownKey);
      setTimeout(() => requestCooldownCache.delete(cooldownKey), 2000);

      const content = await Content.findOne({ _id: contentId, status: 'active', botId: ctx.state.botId });
      if (!content) {
        return ctx.answerCbQuery('⚠️ This content is unavailable.').catch(() => {});
      }

      // Acknowledge loading state
      await ctx.answerCbQuery('🚀 Preparing files for delivery...').catch(() => {});

      // Dispatch tracking and delivery parameters using V1 services
      const batchId = `batch_${crypto.randomUUID()}_requested`;
      const deleteAt = settings.autoDeleteEnabled
        ? new Date(Date.now() + settings.autoDeleteHours * 60 * 60 * 1000)
        : null;

      try {
        await telegramService.deliverContent(user._id, chatId, content, batchId, deleteAt, ctx.state.botId);
        
        // Track analytics
        await EventLog.log('content_requested', user._id, telegramUser.id, contentId, {}, ctx.state.botId);
        await EventLog.log('content_delivered', user._id, telegramUser.id, contentId, { batchId }, ctx.state.botId);
      } catch (deliveryError) {
        console.error(`Callback handler delivery failure: ${deliveryError.message}`);
        // Notify chat quietly
        await ctx.reply('⚠️ Failed to deliver files. Please check connection or try again later.').catch(() => {});
      }
      return;
    }

    // 6. Help Message Callback
    if (data === 'help') {
      await ctx.answerCbQuery().catch(() => {});
      const helpText = `ℹ️ *Help & Support*\n\nIf you have any questions or need support, contact our administrator.\n\nType /start to reload menu interface.`;

      await ctx.editMessageText(helpText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
        }
      });
      return;
    }

    // 7. Search Command Callback
    if (data === 'srch') {
      await ctx.answerCbQuery().catch(() => {});
      user.navigationState = { searchMode: true, currentMenu: 'search' };
      await user.save();

      await ctx.editMessageText('🔎 *Search Content*\n\nPlease type the name or keyword of the content you want to search for:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]]
        }
      });
      return;
    }

    // 8. Featured Content paginated callback
    if (data.startsWith('feat:')) {
      await ctx.answerCbQuery().catch(() => {});
      const page = parseInt(data.split(':')[1], 10) || 1;

      user.navigationState = { searchMode: false, currentMenu: `featured`, currentPage: page };
      await user.save();

      const limit = 8;
      const query = { isFeatured: true, status: 'active', botId: ctx.state.botId };
      const total = await Content.countDocuments(query);
      const totalPages = Math.ceil(total / limit);

      const contents = await Content.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      if (contents.length === 0) {
        return ctx.editMessageText('⭐ *Featured Content*\n\nNo featured content items are configured at this time.', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      const inline_keyboard = contents.map(item => [
        { text: `⭐ ${item.title}`, callback_data: `info:${item._id}` }
      ]);

      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) {
          pagRow.push({ text: '◀️ Prev', callback_data: `feat:${page - 1}` });
        }
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'ack' });
        if (page < totalPages) {
          pagRow.push({ text: 'Next ▶️', callback_data: `feat:${page + 1}` });
        }
        inline_keyboard.push(pagRow);
      }

      inline_keyboard.push([{ text: '🏠 Home', callback_data: 'home' }]);

      await ctx.editMessageText('⭐ *Featured Content*\n\nExplore our hand-picked featured items:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
      return;
    }

    // Acknowledge simple acknowledgements
    if (data === 'ack') {
      await ctx.answerCbQuery().catch(() => {});
      return;
    }

  } catch (error) {
    console.error('Callback Handler Error:', error.message);
    ctx.answerCbQuery('⚠️ An error occurred processing query.').catch(() => {});
  }
}
