import mongoose from 'mongoose';
import { Bot as BotModel } from '../models/Bot.js';
import { Category } from '../models/Category.js';
import { Content } from '../models/Content.js';
import { ContentPack } from '../models/ContentPack.js';
import { ContentSequence } from '../models/ContentSequence.js';
import { Link } from '../models/Link.js';
import { BotMenu } from '../models/BotMenu.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { MediaBundle } from '../models/MediaBundle.js';
import { Delivery } from '../models/Delivery.js';
import { DeliveryBatch } from '../models/DeliveryBatch.js';
import { Broadcast } from '../models/Broadcast.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { logger } from '../config/logger.js';

/**
 * Service to migrate/transfer all platform assets and data between bots seamlessly.
 * Transferred items:
 *  - Categories (handles slug conflict resolution)
 *  - Content/Media (resets stale telegramFileId so new bot fetches fresh from S3 with zero errors)
 *  - Content Packs (handles publicCode uniqueness)
 *  - Content Sequences
 *  - Links (collection tokens)
 *  - Bot Menus (interactive inline buttons)
 *  - Settings (replicates welcome message, limits, auto-delete hours)
 *  - Users (merges users by telegramUserId to avoid duplicate key errors)
 *  - Media Bundles, Delivery Batches & Broadcasts
 */
export async function migrateBotData(fromBotId, toBotId, options = {}) {
  const adminId = options.adminId || null;

  if (!toBotId || !mongoose.Types.ObjectId.isValid(toBotId)) {
    throw new Error('Target bot ID is required and must be a valid ObjectId.');
  }

  const targetBot = await BotModel.findById(toBotId);
  if (!targetBot) {
    throw new Error('Target bot not found in database.');
  }

  let sourceBotQuery = {};
  if (fromBotId && mongoose.Types.ObjectId.isValid(fromBotId)) {
    sourceBotQuery = { $in: [new mongoose.Types.ObjectId(fromBotId)] };
  } else {
    // If no specific source bot specified, migrate everything from any other bot or unassigned (null/undefined)
    sourceBotQuery = { $ne: new mongoose.Types.ObjectId(toBotId) };
  }

  const stats = {
    categories: 0,
    content: 0,
    contentPacks: 0,
    contentSequences: 0,
    links: 0,
    botMenus: 0,
    settings: false,
    users: 0,
    mediaBundles: 0,
    broadcasts: 0,
    deliveryBatches: 0
  };

  const targetObjectId = new mongoose.Types.ObjectId(toBotId);

  // 1. Migrate Categories
  try {
    const categoriesToMigrate = await Category.find({ botId: sourceBotQuery });
    for (const cat of categoriesToMigrate) {
      // Check if target bot already has a category with same slug
      const existingSlug = await Category.findOne({ botId: targetObjectId, slug: cat.slug });
      if (existingSlug) {
        // Re-link contents from this old category to the existing target category
        await Content.updateMany(
          { categoryId: cat._id },
          { $set: { categoryId: existingSlug._id } }
        );
        // Delete redundant duplicate category
        await Category.deleteOne({ _id: cat._id });
      } else {
        cat.botId = targetObjectId;
        await cat.save();
        stats.categories++;
      }
    }
  } catch (err) {
    logger.error('BotMigration: Error migrating Categories:', err.message);
  }

  // 2. Migrate Content / Media
  // CRITICAL: Reset telegramFileId and telegramFileUniqueId to null.
  // Because Telegram file IDs are bound to the specific bot that uploaded them,
  // resetting them ensures the new bot delivers directly from S3 Filebase on first send,
  // caches the new bot's own file_id, and avoids Telegram 400 Bad Request error.
  try {
    const contentResult = await Content.updateMany(
      { $or: [{ botId: sourceBotQuery }, { botId: targetObjectId }] },
      {
        $set: {
          botId: targetObjectId,
          telegramFileId: null,
          telegramFileUniqueId: null
        }
      }
    );
    stats.content = contentResult.modifiedCount || 0;
  } catch (err) {
    logger.error('BotMigration: Error migrating Content:', err.message);
  }

  // 3. Migrate Content Packs
  try {
    const packsToMigrate = await ContentPack.find({ botId: sourceBotQuery });
    for (const pack of packsToMigrate) {
      // Check if target bot has the same publicCode
      const existingPack = await ContentPack.findOne({ botId: targetObjectId, publicCode: pack.publicCode });
      if (existingPack) {
        // Append random suffix if conflict
        pack.publicCode = `${pack.publicCode}_${Date.now().toString(36).slice(-4)}`;
      }
      pack.botId = targetObjectId;
      await pack.save();
      stats.contentPacks++;
    }
  } catch (err) {
    logger.error('BotMigration: Error migrating Content Packs:', err.message);
  }

  // 4. Migrate Content Sequences
  try {
    const seqResult = await ContentSequence.updateMany(
      { botId: sourceBotQuery },
      { $set: { botId: targetObjectId } }
    );
    stats.contentSequences = seqResult.modifiedCount || 0;
  } catch (err) {
    logger.error('BotMigration: Error migrating Content Sequences:', err.message);
  }

  // 5. Migrate Links
  try {
    const linkResult = await Link.updateMany(
      { botId: sourceBotQuery },
      { $set: { botId: targetObjectId } }
    );
    stats.links = linkResult.modifiedCount || 0;
  } catch (err) {
    logger.error('BotMigration: Error migrating Links:', err.message);
  }

  // 6. Migrate Bot Menus
  try {
    const targetMenuCount = await BotMenu.countDocuments({ botId: targetObjectId });
    if (targetMenuCount === 0) {
      // Only migrate menu buttons if target bot doesn't already have menus configured
      const menuResult = await BotMenu.updateMany(
        { botId: sourceBotQuery },
        { $set: { botId: targetObjectId } }
      );
      stats.botMenus = menuResult.modifiedCount || 0;
    }
  } catch (err) {
    logger.error('BotMigration: Error migrating Bot Menus:', err.message);
  }

  // 7. Migrate Settings
  try {
    let sourceSetting = null;
    if (fromBotId && mongoose.Types.ObjectId.isValid(fromBotId)) {
      sourceSetting = await Setting.findOne({ botId: new mongoose.Types.ObjectId(fromBotId) });
    }
    if (!sourceSetting) {
      sourceSetting = await Setting.findOne({ botId: { $ne: targetObjectId } });
    }

    if (sourceSetting) {
      const targetSetting = await Setting.getSettings(targetObjectId);
      targetSetting.welcomeMessage = sourceSetting.welcomeMessage;
      targetSetting.startContentEnabled = sourceSetting.startContentEnabled;
      targetSetting.startContentLimit = sourceSetting.startContentLimit;
      targetSetting.autoDeleteEnabled = sourceSetting.autoDeleteEnabled;
      targetSetting.autoDeleteHours = sourceSetting.autoDeleteHours;
      targetSetting.botEnabled = sourceSetting.botEnabled;
      targetSetting.helpMessage = sourceSetting.helpMessage;
      targetSetting.supportLink = sourceSetting.supportLink;
      targetSetting.startBehaviour = sourceSetting.startBehaviour;
      if (sourceSetting.botDescription) targetSetting.botDescription = sourceSetting.botDescription;
      if (sourceSetting.botShortDescription) targetSetting.botShortDescription = sourceSetting.botShortDescription;
      await targetSetting.save();
      Setting.clearCache(targetObjectId);
      stats.settings = true;
    }
  } catch (err) {
    logger.error('BotMigration: Error migrating Settings:', err.message);
  }

  // 8. Migrate Users (Safe deduplication by telegramUserId)
  try {
    const usersToMigrate = await User.find({ botId: sourceBotQuery });
    for (const u of usersToMigrate) {
      const existingUser = await User.findOne({ botId: targetObjectId, telegramUserId: u.telegramUserId });
      if (existingUser) {
        // User already exists on new bot: keep latest active time and delete duplicate old doc
        if (u.lastActiveAt && (!existingUser.lastActiveAt || u.lastActiveAt > existingUser.lastActiveAt)) {
          existingUser.lastActiveAt = u.lastActiveAt;
          await existingUser.save();
        }
        await User.deleteOne({ _id: u._id });
      } else {
        u.botId = targetObjectId;
        await u.save();
        stats.users++;
      }
    }
  } catch (err) {
    logger.error('BotMigration: Error migrating Users:', err.message);
  }

  // 9. Migrate MediaBundles, DeliveryBatches, Broadcasts
  try {
    const bundleRes = await MediaBundle.updateMany({ botId: sourceBotQuery }, { $set: { botId: targetObjectId } });
    stats.mediaBundles = bundleRes.modifiedCount || 0;

    const batchRes = await DeliveryBatch.updateMany({ botId: sourceBotQuery }, { $set: { botId: targetObjectId } });
    stats.deliveryBatches = batchRes.modifiedCount || 0;

    const bcRes = await Broadcast.updateMany({ botId: sourceBotQuery }, { $set: { botId: targetObjectId } });
    stats.broadcasts = bcRes.modifiedCount || 0;
  } catch (err) {
    logger.error('BotMigration: Error migrating miscellaneous records:', err.message);
  }

  // Log activity
  try {
    await ActivityLog.log('Bot Data Migrated', adminId, 'success', {
      targetBotId: toBotId,
      targetBotUsername: targetBot.username,
      sourceBotId: fromBotId || 'ALL_PREVIOUS',
      stats
    });
  } catch (logErr) {
    logger.warn('BotMigration: ActivityLog failed:', logErr.message);
  }

  logger.info(`BotMigration: Successfully migrated assets to @${targetBot.username}:`, stats);
  return stats;
}
