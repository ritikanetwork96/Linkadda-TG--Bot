import app from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { bot, adminBot, telegramBotManager } from './bot/bot.js';
import { Bot as BotModel } from './models/Bot.js';
import { Admin } from './models/Admin.js';
import { Setting } from './models/Setting.js';
import { startDeletionScheduler, stopDeletionScheduler } from './scheduler/deletion.scheduler.js';
import { startExpiryScheduler, stopExpiryScheduler } from './scheduler/expiry.scheduler.js';
import { hashPassword, decrypt } from './config/crypto.js';

let server;

async function bootstrap() {
  try {
    console.log('Bootstrap: Initializing application startup...');

    // 1. Environment validation (run automatically on importing config)

    // 2. Connect MongoDB Atlas
    await connectDatabase();

    // 3. Ensure Admin account is seeded
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const defaultPasswordHash = hashPassword(config.adminPassword);
      await Admin.create({
        email: config.adminEmail,
        password: defaultPasswordHash,
        name: 'Default Administrator',
      });
      console.log(`Bootstrap: Default admin account seeded (${config.adminEmail} / ${config.adminPassword}).`);
    } else {
      console.log('Bootstrap: Admin account check completed.');
    }

    // 4. Ensure Settings are seeded/retrieved
    await Setting.getSettings();
    console.log('Bootstrap: DB settings initialized/seeded.');

    // 4b. Ensure default BotMenu buttons are seeded
    const { BotMenu } = await import('./models/BotMenu.js');
    const menuCount = await BotMenu.countDocuments();
    if (menuCount === 0) {
      await BotMenu.create([
        { label: 'Categories', icon: '📂', actionType: 'CATEGORY', sortOrder: 0, status: 'active' },
        { label: 'Search', icon: '🔎', actionType: 'SEARCH', sortOrder: 1, status: 'active' },
        { label: 'Featured', icon: '⭐', actionType: 'FEATURED', sortOrder: 2, status: 'active' },
        { label: 'Help', icon: 'ℹ️', actionType: 'HELP', sortOrder: 3, status: 'active' }
      ]);
      console.log('Bootstrap: Default BotMenu buttons seeded.');
    }

    // 5. Load Active Bot Token from Database if configured
    const activeDbBot = await BotModel.findOne({ status: 'active', encryptedToken: { $exists: true, $ne: '' } });
    let activeToken = config.userBotToken;
    if (activeDbBot && activeDbBot.encryptedToken) {
      try {
        const decrypted = decrypt(activeDbBot.encryptedToken);
        if (decrypted) {
          activeToken = decrypted;
          console.log('Bootstrap: Dynamic active user bot token loaded from database.');
        }
      } catch (err) {
        console.error('Bootstrap: Error decrypting stored bot token, using environment fallback:', err.message);
      }
    }

    // Apply resolved token to User Bot
    bot.telegram.token = activeToken;
    const { telegramService } = await import('./services/telegram.service.js');
    telegramService.client.token = activeToken;

    // 6. Verify User Bot Token
    console.log('Bootstrap: Verifying User Bot token...');
    try {
      const userBotInfo = await bot.telegram.getMe();
      console.log(`Bootstrap: User Bot authenticated as @${userBotInfo.username} (ID: ${userBotInfo.id})`);

      // 7. Save User Bot info in MongoDB
      await BotModel.findOneAndUpdate(
        { telegramBotId: userBotInfo.id },
        {
          username: userBotInfo.username,
          firstName: userBotInfo.first_name,
          status: 'active',
        },
        { upsert: true, new: true }
      );
      console.log('Bootstrap: User Bot metadata synchronized with MongoDB.');
    } catch (err) {
      console.error('Bootstrap: User Bot token verification failed:', err.message, '— User Bot will not function.');
    }

    // 8. Verify Admin Bot Token (optional — does not crash server if fails)
    if (adminBot) {
      try {
        const adminBotInfo = await adminBot.telegram.getMe();
        console.log(`Bootstrap: Admin Bot authenticated as @${adminBotInfo.username} (ID: ${adminBotInfo.id})`);
      } catch (err) {
        console.error('Bootstrap: Admin Bot token verification failed:', err.message, '— Admin Console will not function.');
      }
    }

    // 9. Launch both bot listeners (asynchronously — non-blocking)
    await telegramBotManager.startServices();

    // 10. Start the automatic deletion scheduler
    startDeletionScheduler();

    // Start the automatic expiry scheduler
    startExpiryScheduler();

    // 11. Start the scheduled broadcast cron worker
    const { startBroadcastScheduler } = await import('./scheduler/broadcast.scheduler.js');
    startBroadcastScheduler();

    // 12. Resume active/queued broadcasts on startup
    const { broadcastService } = await import('./services/broadcast.service.js');
    broadcastService.resumeBroadcasts().catch((bcErr) => {
      console.error('Bootstrap: Error recovering active broadcasts:', bcErr.message);
    });

    // 13. Start HTTP Express Server
    server = app.listen(config.port, () => {
      console.log(`Bootstrap: Express server listening on port ${config.port} in ${config.nodeEnv} mode.`);
    });

  } catch (error) {
    console.error('Bootstrap: CRITICAL ERROR - Server startup failed:', error.message);
    process.exit(1);
  }
}

async function handleShutdown(signal) {
  console.log(`\nShutdown: Received ${signal}. Starting graceful shutdown...`);

  // Stop scheduler
  stopDeletionScheduler();
  stopExpiryScheduler();
  try {
    const { stopBroadcastScheduler } = await import('./scheduler/broadcast.scheduler.js');
    stopBroadcastScheduler();
  } catch (err) {
    console.error('Shutdown: Error stopping broadcast scheduler:', err.message);
  }

  // Reset in-progress broadcasts to queue so they can recover on restart
  try {
    const { Broadcast } = await import('./models/Broadcast.js');
    const resetCount = await Broadcast.updateMany(
      { status: 'processing' },
      { $set: { status: 'queued' } }
    );
    console.log(`Shutdown: Reset ${resetCount.modifiedCount} active broadcast(s) to queued status.`);
  } catch (bcErr) {
    console.error('Shutdown: Error resetting broadcasts:', bcErr.message);
  }

  // Stop all Telegram Bot listeners
  try {
    await telegramBotManager.stopServices();
  } catch (error) {
    console.error('Shutdown: Error stopping bot listeners:', error.message);
  }

  // Close HTTP Server
  if (server) {
    await new Promise((resolve) => {
      server.close((err) => {
        if (err) {
          console.error('Shutdown: Error closing Express server:', err.message);
        } else {
          console.log('Shutdown: Express server closed.');
        }
        resolve();
      });
    });
  }

  // Disconnect MongoDB connection
  await disconnectDatabase();

  console.log('Shutdown: Process exiting.');
  process.exit(0);
}

// Bind process events
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('CRITICAL: Uncaught Exception caught (keeping process alive):', error.stack || error.message || error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection caught (keeping process alive):', reason?.stack || reason?.message || reason);
});

bootstrap();
