import { User } from '../../models/User.js';
import { Content } from '../../models/Content.js';
import { Category } from '../../models/Category.js';
import { EventLog } from '../../models/EventLog.js';
import { userService } from '../../services/user.service.js';

// Helper to escape regex special characters (prevent ReDoS attacks)
const escapeRegex = (string) => {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

/**
 * Handler for general message updates (Interceptive Search routing)
 */
export async function messageHandler(ctx) {
  if (ctx.chat?.type !== 'private') return;

  try {
    const telegramUser = ctx.from;
    const textMsg = ctx.message.text ? ctx.message.text.trim() : '';
    const botId = ctx.state.botId;

    const user = await userService.upsertUser(telegramUser, botId);
    const state = user.navigationState || {};

    // 1. Intercept if user is currently in search mode (Task 6)
    if (state.searchMode && textMsg) {
      // Limit search length and trim input
      const cleanSearch = textMsg.substring(0, 100).trim();

      // Reset search mode state immediately
      user.navigationState = { searchMode: false, currentMenu: 'home' };
      await user.save();

      if (!cleanSearch) {
        return ctx.reply('⚠️ Please send a valid keyword to search.', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'home' }]] }
        });
      }

      const escaped = escapeRegex(cleanSearch);

      // Fetch active categories that match the term within this bot
      const matchedCats = await Category.find({
        status: 'active',
        botId,
        $or: [
          { name: { $regex: escaped, $options: 'i' } },
          { displayName: { $regex: escaped, $options: 'i' } }
        ]
      }).select('_id');

      const query = {
        status: 'active',
        botId,
        $or: [
          { title: { $regex: escaped, $options: 'i' } },
          { caption: { $regex: escaped, $options: 'i' } }
        ]
      };

      // Push matched categories into lookup
      if (matchedCats.length > 0) {
        query.$or.push({ categoryId: { $in: matchedCats.map(c => c._id) } });
      }

      // Query active matched items, limit results to 10
      const items = await Content.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .limit(10);

      // Track search event analytics
      await EventLog.log('search_performed', user._id, telegramUser.id, '', { query: cleanSearch, resultsCount: items.length }, botId);

      if (items.length === 0) {
        return ctx.reply(`🔎 *Search Results*\n\nNo matches found for "${cleanSearch}". Please refine your term.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔎 Search Again', callback_data: 'srch' }],
              [{ text: '🏠 Home', callback_data: 'home' }]
            ]
          }
        });
      }

      // Map results to list buttons
      const inline_keyboard = items.map(item => [
        { text: `🔹 ${item.title}`, callback_data: `info:${item._id}` }
      ]);
      inline_keyboard.push([{ text: '🏠 Home', callback_data: 'home' }]);

      return ctx.reply(`🔎 *Search Results for "${cleanSearch}":*\n\nSelect an item to view preview details:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
    }

    // 2. Fallback guide response
    await ctx.reply('👋 Hello! Please send the /start command to browse available content folders or click a menu button.');
  } catch (error) {
    console.error('Message Handler Error:', error.message);
    ctx.reply('⚠️ Error loading search results. Type /start to reload.').catch(() => {});
  }
}
