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
  adminBot.hears(/^\/recall_(.+)$/, async (ctx) => {
    try {
      const batchId = ctx.match[1];
      const { Delivery } = await import('../models/Delivery.js');
      const { telegramService } = await import('../services/telegram.service.js');
      
      const deliveries = await Delivery.find({ deliveryBatchId: batchId, status: 'sent' });
      if (deliveries.length === 0) {
        return ctx.reply('⚠️ No active messages found for this broadcast ID or they have already been deleted.').catch(() => {});
      }

      await ctx.reply(`⏳ Recalling broadcast... Deleting messages from ${deliveries.length} users' chats.`).catch(() => {});

      let successCount = 0;
      for (const del of deliveries) {
        try {
          await telegramService.deleteMessage(del.telegramChatId, del.telegramMessageId);
          del.status = 'deleted';
          await del.save();
          successCount++;
        } catch (err) {
          console.error(`Recall: Failed to delete message ${del.telegramMessageId} in chat ${del.telegramChatId}:`, err.message);
        }
      }

      await ctx.reply(`🗑️ <b>Recall Completed</b>\n\nSuccessfully deleted <b>${successCount}</b> of <b>${deliveries.length}</b> messages from users' chats.`, { parse_mode: 'HTML' }).catch(() => {});
    } catch (error) {
      console.error('Recall Command Error:', error);
      await ctx.reply(`❌ Failed to recall broadcast: ${error.message}`).catch(() => {});
    }
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
// ─────────────────────────────────────────────────────────────────────────────
// AUTO-RECONNECT & LIFECYCLE MANAGER — keeps bots running 24/7 independently
// ─────────────────────────────────────────────────────────────────────────────

class BotLifecycleManager {
  constructor(botInstance, name, type) {
    this.bot = botInstance;
    this.name = name;
    this.type = type;
    this.state = 'stopped'; // 'stopped', 'starting', 'running', 'reconnecting', 'failed'
    this.reconnectAttempts = 0;
    this.lastSuccessfulCheck = null;
    this.lastUpdateReceived = null;
    this.lastError = null;
    this.tokenValid = null;

    this.shutdownRequested = false;
    this.reconnectTimer = null;
    this.pollingActive = false;
    this.runningPromise = null;
  }

  async start() {
    if (this.state === 'running' || this.state === 'starting') {
      console.log(`[BotLifecycleManager] ${this.name} is already starting or running. Skipping.`);
      return;
    }

    this.shutdownRequested = false;
    this.state = 'starting';
    this.runningPromise = this.runLoop();
  }

  async stop() {
    this.shutdownRequested = true;
    this.state = 'stopped';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (this.pollingActive) {
        await this.bot.stop();
        this.pollingActive = false;
      }
    } catch (err) {
      console.error(`[BotLifecycleManager] Error stopping ${this.name}:`, err.message);
    }
    // Wait for runLoop to complete
    if (this.runningPromise) {
      await this.runningPromise.catch(() => {});
      this.runningPromise = null;
    }
    console.log(`[BotLifecycleManager] ${this.name} stopped.`);
  }

  async runLoop() {
    let delayMs = 5000;

    while (!this.shutdownRequested) {
      try {
        console.log(`[BotLifecycleManager] ${this.name} verifying token...`);
        
        // Verify token first
        const me = await this.bot.telegram.getMe();
        console.log(`[BotLifecycleManager] ${this.name} verified as @${me.username}`);
        this.lastSuccessfulCheck = new Date();
        this.tokenValid = true;
        
        if (this.shutdownRequested) break;

        // Delete any existing webhooks before polling starts
        console.log(`[BotLifecycleManager] ${this.name} deleting existing webhook...`);
        await this.bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(e => {
          console.warn(`[BotLifecycleManager] ${this.name} warning deleting webhook:`, e.message);
        });

        if (this.shutdownRequested) break;

        this.state = 'running';
        this.reconnectAttempts = 0;
        this.pollingActive = true;

        console.log(`[BotLifecycleManager] ${this.name} launching polling...`);
        await this.bot.launch();
        
        // If it resolved cleanly and shutdown wasn't requested:
        if (this.shutdownRequested) {
          this.pollingActive = false;
          break;
        }
        
        console.log(`[BotLifecycleManager] ${this.name} polling stopped unexpectedly.`);
        this.state = 'reconnecting';
        this.pollingActive = false;

      } catch (err) {
        this.pollingActive = false;
        if (this.shutdownRequested) break;

        this.lastError = err.message || 'Unknown polling error';
        console.error(`[BotLifecycleManager] ${this.name} error:`, err.message);

        // Check if authentication failed (401)
        if (err.message && (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('blocked'))) {
          this.state = 'failed';
          this.tokenValid = false;
          console.error(`[BotLifecycleManager] ${this.name} failed permanently (Authentication failed).`);
          break; // Stop reconnect loop for invalid token
        }

        this.state = 'reconnecting';
        this.reconnectAttempts++;

        // Determine backoff delay
        let actualDelay = delayMs;
        
        // Handle Telegram 429 rate limit
        if (err.parameters && err.parameters.retry_after) {
          const retryAfter = parseInt(err.parameters.retry_after, 10);
          if (!isNaN(retryAfter)) {
            actualDelay = (retryAfter * 1000) + 1000;
            console.warn(`[BotLifecycleManager] ${this.name} rate limited (429). Retrying in ${actualDelay / 1000}s as requested by Telegram.`);
          }
        } else {
          // Standard exponential backoff: 5s, 10s, 20s, 40s, max 60s
          actualDelay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
        }

        console.log(`[BotLifecycleManager] ${this.name} waiting ${actualDelay / 1000}s before reconnect attempt #${this.reconnectAttempts}...`);
        
        await new Promise(resolve => {
          this.reconnectTimer = setTimeout(resolve, actualDelay);
        });
      }
    }
  }

  registerUpdateMiddleware() {
    this.bot.use(async (ctx, next) => {
      this.lastUpdateReceived = new Date();
      this.lastSuccessfulCheck = new Date();
      await next();
    });
  }
}

// Instantiate lifecycle managers for both bots
export const userBotManager = new BotLifecycleManager(bot, 'User Bot', 'userBot');
userBotManager.registerUpdateMiddleware();

export let adminBotManager = null;
if (adminBot) {
  adminBotManager = new BotLifecycleManager(adminBot, 'Admin Bot', 'adminBot');
  adminBotManager.registerUpdateMiddleware();
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT MANAGER — single lifecycle controller
// ─────────────────────────────────────────────────────────────────────────────

export const telegramBotManager = {
  /**
   * Launch both bots asynchronously. Either bot failing does NOT crash the other.
   */
  async startServices() {
    // Start User Bot with manager
    userBotManager.start().catch(err => {
      console.error('TelegramBotManager: Failed to start User Bot service:', err.message);
    });

    // Start Admin Bot (if configured)
    if (adminBotManager) {
      adminBotManager.start().catch(err => {
        console.error('TelegramBotManager: Failed to start Admin Bot service:', err.message);
      });
    }
  },

  /**
   * Gracefully stop both bots.
   */
  async stopServices() {
    console.log('TelegramBotManager: Stopping both bot services...');
    await Promise.allSettled([
      userBotManager.stop(),
      adminBotManager ? adminBotManager.stop() : Promise.resolve()
    ]);
    console.log('TelegramBotManager: All bot listeners stopped.');
  },

  /**
   * Health status of both bots (non-throwing).
   */
  async healthCheck() {
    const userBotStatus = {
      state: userBotManager.state,
      lastSuccessfulCheck: userBotManager.lastSuccessfulCheck,
      lastUpdate: userBotManager.lastUpdateReceived,
      reconnectAttempts: userBotManager.reconnectAttempts,
      lastError: userBotManager.lastError
    };

    const adminBotStatus = adminBotManager ? {
      state: adminBotManager.state,
      lastSuccessfulCheck: adminBotManager.lastSuccessfulCheck,
      lastUpdate: adminBotManager.lastUpdateReceived,
      reconnectAttempts: adminBotManager.reconnectAttempts,
      lastError: adminBotManager.lastError
    } : {
      state: 'stopped',
      lastSuccessfulCheck: null,
      lastUpdate: null,
      reconnectAttempts: 0,
      lastError: null
    };

    return {
      userBot: userBotStatus,
      adminBot: adminBotStatus
    };
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
  console.log('TelegramBotManager: Stopping User Bot for reinitialization...');
  await userBotManager.stop();

  const { telegramService } = await import('../services/telegram.service.js');
  bot.telegram.token = newToken;
  telegramService.client.token = newToken;

  console.log('TelegramBotManager: Relaunching User Bot manager with new token...');
  await userBotManager.start();

  // Try to get new identity
  const botInfo = await bot.telegram.getMe();
  return botInfo;
}
