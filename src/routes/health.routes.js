import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

/**
 * Detailed Health check — reports individual status of both User Bot and Admin Bot
 */
router.get('/health', async (req, res, next) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    let userBot = { status: 'unknown' };
    let adminBot = { status: 'disabled' };

    try {
      const { telegramBotManager } = await import('../bot/bot.js');
      const health = await Promise.race([
        telegramBotManager.healthCheck(),
        new Promise(r => setTimeout(() => r(null), 5000))
      ]);
      if (health) {
        userBot = health.userBot;
        adminBot = health.adminBot;
      }
    } catch (err) {
      console.warn(`Health Check: TelegramBotManager check failed: ${err.message}`);
    }

    // Backward-compat: also report single 'telegram' field for older admin panel code
    const telegramStatus = userBot.state === 'running' ? 'connected' : 'disconnected';
    const storageStatus = 'configured';

    const overallOk = dbStatus === 'connected';

    return res.status(overallOk ? 200 : 500).json({
      status: overallOk ? 'ok' : 'error',
      database: dbStatus,
      telegram: telegramStatus,
      storage: storageStatus,
      userBot,
      adminBot,
    });
  } catch (error) {
    next(error);
  }
});


/**
 * Liveness Check (returns 200 immediately if server process is running)
 */
router.get('/live', (req, res) => {
  return res.status(200).json({ status: 'alive' });
});

/**
 * Readiness Check (checks if MongoDB is connected and ready to parse transactions)
 */
router.get('/ready', (req, res) => {
  const isDbReady = mongoose.connection.readyState === 1;
  return res.status(isDbReady ? 200 : 503).json({
    status: isDbReady ? 'ready' : 'not_ready'
  });
});

/**
 * ONE-TIME FIX: Drop old conflicting User unique index
 * Run once: GET http://localhost:3000/api/fix-user-index
 */
router.get('/fix-user-index', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('users');

    const indexes = await collection.indexes();
    const before = indexes.map(idx => `${idx.name}${idx.unique ? ' (UNIQUE)' : ''}${idx.sparse ? ' (SPARSE)' : ''}`);

    // Drop ALL non-_id indexes so Mongoose can recreate them fresh
    const toDrop = indexes.filter(idx => idx.name !== '_id_');
    const dropped = [];

    for (const idx of toDrop) {
      await collection.dropIndex(idx.name);
      dropped.push(idx.name);
    }

    const updatedIndexes = await collection.indexes();
    const after = updatedIndexes.map(idx => `${idx.name}${idx.unique ? ' (UNIQUE)' : ''}${idx.sparse ? ' (SPARSE)' : ''}`);

    return res.json({
      status: 'success',
      dropped,
      message: dropped.length > 0
        ? `✅ Dropped ${dropped.length} indexes. Restart server to rebuild with correct schema.`
        : 'ℹ️ No custom indexes found to drop.',
      before,
      after,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * Debug Endpoint to check DB connection info as seen by the running server.
 */
router.get('/api/debug-db', async (req, res) => {
  try {
    const { Link } = await import('../models/Link.js');
    const { Content } = await import('../models/Content.js');
    
    const dbName = mongoose.connection.name;
    const dbState = mongoose.connection.readyState;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    const totalLinks = await Link.countDocuments();
    const totalContent = await Content.countDocuments();
    
    const lastLinks = await Link.find().sort({ createdAt: -1 }).limit(5).lean();
    const lastContents = await Content.find().sort({ createdAt: -1 }).limit(5).lean();
    
    return res.json({
      status: 'success',
      database: {
        name: dbName,
        state: states[dbState] || 'unknown',
        uriHost: mongoose.connection.host,
      },
      counts: {
        links: totalLinks,
        contents: totalContent
      },
      lastLinks,
      lastContents
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message, stack: err.stack });
  }
});


export default router;
