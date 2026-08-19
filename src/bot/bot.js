import { Telegraf } from 'telegraf';
import { config } from '../config/env.js';
import { Setting } from '../models/Setting.js';
import { startHandler } from './handlers/start.handler.js';
import { messageHandler } from './handlers/message.handler.js';
import { callbackHandler } from './handlers/callback.handler.js';
import { handleAdminStart, handleAdminCallback, handleAdminMessage, isAdmin } from './handlers/admin.handler.js';

// ─────────────────────────────────────────────────────────────────────────────
// USER BOT  (public, serves all Telegram users)
// ─────────────────────────────────────────────────────────────────────────────

if (!config.userBotToken) {
  throw new Error('TelegramBotManager: USER_BOT_TOKEN (or BOT_TOKEN) is missing.');
}

export const bot = new Telegraf(config.userBotToken);
export const userBot = bot; // alias for clarity

// ── User Bot Middleware: fetch settings, check maintenance / enabled ───────
bot.use(async (ctx, next) => {
  let nextCalled = false;
  try {
    const { Bot } = await import('../models/Bot.js');
    const botDoc = await Bot.findOne({ telegramBotId: ctx.botInfo?.id });
    const botId = botDoc ? botDoc._id : null;

    const settings = await Setting.getSettings(botId);
    ctx.state.botId = botId;
    ctx.state.settings = settings;

    if (settings.maintenanceMode) {
      if (ctx.chat?.type === 'private') {
        await ctx.reply(settings.maintenanceMessage || '⚠️ The bot is currently undergoing scheduled maintenance. Please check back in a few minutes!');
      }
      return;
    }

    if (!settings.botEnabled) {
      if (ctx.chat?.type === 'private') {
        await ctx.reply('⚠️ The bot is currently disabled by the administrator. Please try again later.');
      }
      return;
    }

    nextCalled = true;
    await next();
  } catch (error) {
    if (nextCalled) {
      throw error;
    }
    console.error('UserBot Middleware: Error retrieving settings from DB:', error.message);
    ctx.state.settings = {
      welcomeMessage: 'Welcome 👋\n\nSelect an option below.',
      startContentEnabled: true,
      startContentLimit: 25,
      autoDeleteEnabled: true,
      autoDeleteHours: 24,
      botEnabled: true,
      maintenanceMode: false,
    };
    await next();
  }
});

// ── User Bot Handlers ─────────────────────────────────────────────────────
bot.command('start', startHandler);
bot.on('callback_query', callbackHandler);
bot.on('message', messageHandler);

bot.catch((err, ctx) => {
  console.error(`UserBot: Error for update type "${ctx.updateType}":`, err.message);
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN BOT  (private, only authorized ADMIN_TELEGRAM_IDS)
// ─────────────────────────────────────────────────────────────────────────────

export let adminBot = null;

if (config.adminBotToken) {
  adminBot = new Telegraf(config.adminBotToken);

  // ── /myid — tell anyone their Telegram user ID (NO auth required) ─────────
  // This is how admins find their ID to put in ADMIN_TELEGRAM_IDS
  adminBot.command('myid', async (ctx) => {
    const id = ctx.from?.id;
    const name = ctx.from?.first_name || 'User';
    await ctx.reply(
      `👤 *Your Telegram ID*\n\n` +
      `Name: ${name}\n` +
      `ID: \`${id}\`\n\n` +
      `Copy this number and add it to \`.env\`:\n` +
      `\`ADMIN_TELEGRAM_IDS=${id}\`\n\n` +
      `Then restart the server — you'll have full Admin access.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  });

  // ── Admin Bot: block all unauthorized users immediately ──────────────────
  adminBot.use(async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId || !config.adminTelegramIds.includes(userId)) {
      if (ctx.chat?.type === 'private') {
        // Don't block /myid — that's handled above before this middleware
        await ctx.reply(
          `⛔ *Unauthorized*\n\n` +
          `This is a private Admin Console.\n\n` +
          `To get access, send /myid to this bot and give the number to the server owner.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return; // stop processing
    }
    await next();
  });

  // ── Admin Bot Handlers ──────────────────────────────────────────────────
  adminBot.command('start', handleAdminStart);
  adminBot.command('create_link', async (ctx) => {
    ctx.message.text = '➕ Create Link';
    return handleAdminMessage(ctx);
  });
  adminBot.command('my_links', async (ctx) => {
    ctx.message.text = '📦 My Links';
    return handleAdminMessage(ctx);
  });
  adminBot.command('media_library', async (ctx) => {
    ctx.message.text = '🖼 Media Library';
    return handleAdminMessage(ctx);
  });
  adminBot.command('stats', async (ctx) => {
    ctx.message.text = '📊 Statistics';
    return handleAdminMessage(ctx);
  });
  adminBot.command('settings', async (ctx) => {
    ctx.message.text = '⚙️ Settings';
    return handleAdminMessage(ctx);
  });

  adminBot.on('callback_query', handleAdminCallback);
  adminBot.on('message', handleAdminMessage);

  // Set Commands in Telegram menu suggestions
  adminBot.telegram.setMyCommands([
    { command: 'start', description: '🏠 Open main menu' },
    { command: 'create_link', description: '➕ Create new collection link' },
    { command: 'my_links', description: '📦 View generated links list' },
    { command: 'media_library', description: '🖼 View uploaded media library' },
    { command: 'stats', description: '📊 View link collection stats' },
    { command: 'settings', description: '⚙️ Configure general settings' }
  ]).then(() => {
    console.log('TelegramBotManager: Admin Bot commands suggestion list set successfully.');
  }).catch((err) => {
    console.error('TelegramBotManager: Failed to set Admin Bot commands suggestion list:', err.message);
  });

  adminBot.catch((err, ctx) => {
    console.error(`AdminBot: Error for update type "${ctx.updateType}":`, err.message);
  });

  console.log('TelegramBotManager: Admin Bot instance created.');
} else {
  console.warn('TelegramBotManager: ADMIN_BOT_TOKEN not set — Admin Telegram Console is disabled.');
}


// ─────────────────────────────────────────────────────────────────────────────
// BOT MANAGER — single lifecycle controller
// ─────────────────────────────────────────────────────────────────────────────

export const telegramBotManager = {
  /**
   * Launch both bots asynchronously. Either bot failing does NOT crash the other.
   */
  async startServices() {
    // Start User Bot
    bot.launch()
      .then(() => console.log('TelegramBotManager: User Bot listener started.'))
      .catch((err) => console.error('TelegramBotManager: User Bot failed to launch:', err.message));

    // Start Admin Bot (if configured)
    if (adminBot) {
      adminBot.launch()
        .then(() => console.log('TelegramBotManager: Admin Bot listener started.'))
        .catch((err) => console.error('TelegramBotManager: Admin Bot failed to launch:', err.message));
    }
  },

  /**
   * Gracefully stop both bots.
   */
  async stopServices() {
    const stops = [];
    stops.push(
      bot.stop('SIGINT').catch((err) => console.error('TelegramBotManager: Error stopping User Bot:', err.message))
    );
    if (adminBot) {
      stops.push(
        adminBot.stop('SIGINT').catch((err) => console.error('TelegramBotManager: Error stopping Admin Bot:', err.message))
      );
    }
    await Promise.allSettled(stops);
    console.log('TelegramBotManager: All bot listeners stopped.');
  },

  /**
   * Health status of both bots (non-throwing).
   */
  async healthCheck() {
    const result = {
      userBot: { status: 'unknown' },
      adminBot: { status: config.adminBotToken ? 'unknown' : 'disabled' },
    };

    try {
      const info = await bot.telegram.getMe();
      result.userBot = { status: 'ok', username: info.username, id: info.id };
    } catch (err) {
      result.userBot = { status: 'error', error: err.message };
    }

    if (adminBot) {
      try {
        const info = await adminBot.telegram.getMe();
        result.adminBot = { status: 'ok', username: info.username, id: info.id };
      } catch (err) {
        result.adminBot = { status: 'error', error: err.message };
      }
    }

    return result;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic reinitialize (used by browser Admin Panel "Change Bot Token" feature)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dynamically reinitializes the USER bot with a new token without restarting server.
 * @param {string} newToken
 * @returns {Promise<object>} Bot identity metadata
 */
export async function reinitializeBot(newToken) {
  try {
    await bot.stop();
    console.log('TelegramBotManager: Stopped User Bot listener for reinitialization.');
  } catch (_) { /* ignore if not running */ }

  const { telegramService } = await import('../services/telegram.service.js');
  bot.telegram.token = newToken;
  telegramService.client.token = newToken;

  const botInfo = await bot.telegram.getMe();

  bot.launch()
    .then(() => console.log(`TelegramBotManager: User Bot restarted as @${botInfo.username}`))
    .catch((err) => console.error('TelegramBotManager: Failed to relaunch User Bot:', err.message));

  return botInfo;
}
