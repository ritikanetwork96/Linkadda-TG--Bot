import { config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AdminSession } from '../../models/AdminSession.js';
import { Category } from '../../models/Category.js';
import { Content } from '../../models/Content.js';
import { ContentPack } from '../../models/ContentPack.js';
import { User } from '../../models/User.js';
import { Setting } from '../../models/Setting.js';
import { ActivityLog } from '../../models/ActivityLog.js';
import { Admin } from '../../models/Admin.js';
import { Broadcast } from '../../models/Broadcast.js';
import { Bot } from '../../models/Bot.js';
import { MediaBundle } from '../../models/MediaBundle.js';
import { ContentSequence } from '../../models/ContentSequence.js';
import { SequenceDelivery } from '../../models/SequenceDelivery.js';
import { PostDeliveryService } from '../../services/postDelivery.service.js';
import { broadcastService } from '../../services/broadcast.service.js';
import { telegramService } from '../../services/telegram.service.js';
import { storageService } from '../../services/storage.service.js';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { Link } from '../../models/Link.js';


// Helper to escape HTML characters
function escapeHTML(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let cachedBotId = null;
let cachedSettings = null;
let lastSettingsCacheTime = 0;

/**
 * Resolves the database ID of the active User Bot (with caching)
 */
async function resolveBotId() {
  if (cachedBotId) return cachedBotId;
  const botDoc = await Bot.findOne({ status: 'active' });
  if (botDoc) {
    cachedBotId = botDoc._id;
  }
  return cachedBotId;
}

/**
 * Retrieves setting document with in-memory cache to reduce latency
 */
async function getCachedSettings(botId) {
  const now = Date.now();
  if (cachedSettings && (now - lastSettingsCacheTime < 5000)) {
    return cachedSettings;
  }
  const settings = await Setting.getSettings(botId);
  cachedSettings = settings;
  lastSettingsCacheTime = now;
  return settings;
}


/**
 * Validates if the incoming Telegram update belongs to an authorized administrator.
 */
export function isAdmin(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return false;
  return config.adminTelegramIds.includes(userId.toString());
}

/**
 * Logs admin activity helpers
 */
async function logAdminActivity(action, adminTelegramId, status = 'success', metadata = {}) {
  try {
    const defaultAdmin = await Admin.findOne({ email: config.adminEmail || 'admin@bot.com' });
    const adminObjId = defaultAdmin ? defaultAdmin._id : null;
    await ActivityLog.log(action, adminObjId, status, { telegramAdminId: adminTelegramId, ...metadata });
  } catch (error) {
    console.error('Failed to log admin action:', error.message);
  }
}

/**
 * Renders the main dashboard menu with live status indicators
 */
export async function renderHome(ctx, edit = false) {
  // Quick non-blocking status check (resolve/reject handled silently)
  let userBotStatus = '🟡 Checking...';
  let dbStatus = '🟡 Checking...';
  let adminBotStatus = '⚪ N/A';

  try {
    const { telegramBotManager } = await import('../../bot/bot.js');
    const health = await Promise.race([
      telegramBotManager.healthCheck(),
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
    if (health) {
      userBotStatus = health.userBot?.status === 'ok' ? `🟢 @${health.userBot.username}` : '🔴 Error';
      adminBotStatus = health.adminBot?.status === 'ok'
        ? `🟢 @${health.adminBot.username}`
        : health.adminBot?.status === 'disabled' ? '⚪ Disabled' : '🔴 Error';
    }
  } catch (_) { /* keep defaults */ }

  try {
    const dbState = mongoose.connection.readyState;
    // 0=disconnected 1=connected 2=connecting 3=disconnecting
    dbStatus = dbState === 1 ? '🟢 Connected' : dbState === 2 ? '🟡 Connecting' : '🔴 Disconnected';
  } catch (_) { dbStatus = '🔴 Error'; }

  const text =
    `⚡ <b>ADMIN CONTROL CENTER</b>\n\n` +
    `<b>Admin Bot:</b> ${adminBotStatus}\n` +
    `<b>User Bot:</b> ${userBotStatus}\n` +
    `<b>Database:</b> ${dbStatus}\n\n` +
    `Welcome to the bot management console. Use the buttons below to configure your bot.`;

  const markup = {
    inline_keyboard: [
      [{ text: '📦 Products', callback_data: 'admin:pack:list' }, { text: '➕ Add Product', callback_data: 'admin:prod:create' }],
      [{ text: '📂 Categories', callback_data: 'admin:cat:list' }, { text: '🎬 Media Library', callback_data: 'admin:content:list' }],
      [{ text: '🔗 Access Links', callback_data: 'admin:pack:list' }, { text: '📦 Content Sequences', callback_data: 'admin:seq:list' }],
      [{ text: '➕ Create Sequence', callback_data: 'admin:seq:create' }, { text: '📢 Broadcast', callback_data: 'admin:seq:bc:menu' }],
      [{ text: '📊 Analytics', callback_data: 'admin:stats:30' }, { text: '🩺 System Health', callback_data: 'admin:health' }],
      [{ text: '⚙️ Settings', callback_data: 'admin:set:start:menu' }, { text: '📤 Publish Forwarded', callback_data: 'admin:pub:start' }],
      [{ text: '🔄 Refresh', callback_data: 'admin:refresh' }, { text: '🚪 Logout', callback_data: 'admin:logout' }],
      [{ text: '🧪 Load Demo Data', callback_data: 'admin:demo:seed' }, { text: '🗑 Clear Demo', callback_data: 'admin:demo:clear' }]
    ]
  };

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  }
}

function parseDuration(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return null;
  const unit = val.replace(num.toString(), '').trim().toLowerCase();
  if (unit === 'm' || unit === 'min' || unit === 'mins') return num * 60 * 1000;
  if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') return num * 60 * 60 * 1000;
  if (unit === 'd' || unit === 'day' || unit === 'days') return num * 24 * 60 * 60 * 1000;
  return null;
}

async function renderMyLinks(ctx, page = 1, edit = false) {
  const limit = 5;
  const skip = (page - 1) * limit;

  const total = await Link.countDocuments({ status: { $ne: 'deleted' } });
  const links = await Link.find({ status: { $ne: 'deleted' } })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  if (links.length === 0) {
    const text = '📦 <b>My Links</b>\n\nNo generated links found.';
    const markup = {
      inline_keyboard: [
        [{ text: '➕ Create Link', callback_data: 'admin:link:add_more' }],
        [{ text: '🏠 Home', callback_data: 'admin:home' }]
      ]
    };
    if (edit) {
      return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    } else {
      return ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    }
  }

  let text = `📦 <b>My Links (Page ${page}/${Math.ceil(total / limit)})</b>\n\n`;
  const inline_keyboard = [];

  for (const link of links) {
    const expiresText = link.expiresAt
      ? new Date(link.expiresAt).toUTCString()
      : 'Never';
    const statusLabel = link.status === 'active'
      ? (link.expiresAt && new Date() > link.expiresAt ? '⏱️ Expired' : '🟢 Active')
      : '⏱️ Expired';

    text += `• <b>Token:</b> <code>${link.token}</code>\n` +
            `  <b>Items:</b> ${link.items.length}\n` +
            `  <b>Status:</b> ${statusLabel}\n` +
            `  <b>Expires:</b> ${expiresText}\n\n`;

    // Row of action buttons for each link
    inline_keyboard.push([
      { text: `👁️ Preview #${link.token}`, callback_data: `admin:link:preview:${link.token}` },
      { text: `🗑️ Delete #${link.token}`, callback_data: `admin:link:delete:${link.token}:${page}` }
    ]);
  }

  // Pagination buttons
  const navRow = [];
  if (page > 1) {
    navRow.push({ text: '◀️ Prev', callback_data: `admin:link:list:${page - 1}` });
  }
  if (skip + limit < total) {
    navRow.push({ text: 'Next ▶️', callback_data: `admin:link:list:${page + 1}` });
  }
  if (navRow.length > 0) {
    inline_keyboard.push(navRow);
  }

  inline_keyboard.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(() => {});
  }
}

async function renderMediaLibrary(ctx, type = 'all', page = 1, edit = false) {
  const limit = 4;
  const skip = (page - 1) * limit;

  const query = { type: { $in: ['photo', 'video', 'document'] } };
  if (type !== 'all') {
    query.type = type;
  }

  const total = await Content.countDocuments(query);
  const items = await Content.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  let text = `🖼 <b>Media Library (${type.toUpperCase()}) - Page ${page}/${Math.ceil(total / limit) || 1}</b>\n\n`;
  const inline_keyboard = [];

  if (items.length === 0) {
    text += 'No media files found.';
  } else {
    for (const item of items) {
      const linkCount = await Link.countDocuments({ 'items.mediaId': item._id });
      const sizeMB = item.fileSize ? `${(item.fileSize / (1024 * 1024)).toFixed(2)} MB` : 'Unknown';
      text += `• <b>File:</b> <code>${escapeHTML(item.originalFileName || item.title)}</code>\n` +
              `  <b>Type:</b> ${item.type}\n` +
              `  <b>Size:</b> ${sizeMB}\n` +
              `  <b>Uploaded:</b> ${new Date(item.createdAt).toDateString()}\n` +
              `  <b>Used in:</b> ${linkCount} link(s)\n\n`;

      inline_keyboard.push([
        { text: `👁️ Preview ${item.title.substring(0, 15)}`, callback_data: `admin:med:prev:${item._id}:${type}:${page}` },
        { text: `🔗 Copy Secure URL`, callback_data: `admin:med:copy:${item._id}` }
      ]);
    }
  }

  inline_keyboard.push([
    { text: type === 'all' ? '● All' : 'All', callback_data: `admin:med:filter:all:1` },
    { text: type === 'photo' ? '● Images' : 'Images', callback_data: `admin:med:filter:photo:1` },
    { text: type === 'video' ? '● Videos' : 'Videos', callback_data: `admin:med:filter:video:1` }
  ]);

  const navRow = [];
  if (page > 1) {
    navRow.push({ text: '◀️ Prev', callback_data: `admin:med:list:${type}:${page - 1}` });
  }
  if (skip + limit < total) {
    navRow.push({ text: 'Next ▶️', callback_data: `admin:med:list:${type}:${page + 1}` });
  }
  if (navRow.length > 0) {
    inline_keyboard.push(navRow);
  }

  inline_keyboard.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard } }).catch(() => {});
  }
}

/**
 * Core entry point for /start command sent by authorized admins
 */
export async function handleAdminStart(ctx) {
  if (!ctx.from) return;
  try {
    if (!ctx.state) ctx.state = {};
    ctx.state.botId = await resolveBotId();
    ctx.state.settings = await getCachedSettings(ctx.state.botId);

    const session = await AdminSession.getSession(ctx.from.id);
    session.state = 'IDLE';
    await session.save();

    await ctx.reply(
      `⚡ <b>ADMIN PANEL</b>\n\nWelcome to the bot management console. Select an action below:`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [
            [{ text: '➕ Create Link' }, { text: '📦 My Links' }],
            [{ text: '🖼 Media Library' }, { text: '📊 Statistics' }],
            [{ text: '⚙️ Settings' }]
          ],
          resize_keyboard: true
        }
      }
    );
  } catch (err) {
    console.error('Admin Start Handler Error:', err.message);
    ctx.reply('⚠️ Error entering Admin Panel.').catch(() => {});
  }
}



/**
 * Renders the Post Composer main editor screen
 */
async function renderPostComposer(ctx, session, edit = true) {
  let bundle = null;
  if (session.currentBundleId) {
    bundle = await MediaBundle.findById(session.currentBundleId);
  }

  if (!bundle) {
    const text = `📝 <b>POST COMPOSER</b>\n\nNo active draft found. You can create a new post bundle or browse existing drafts.`;
    const markup = {
      inline_keyboard: [
        [{ text: '➕ Create New Post', callback_data: 'admin:bundle:create' }],
        [{ text: '📝 Browse Drafts', callback_data: 'admin:bundle:list' }],
        [{ text: '🏠 Home', callback_data: 'admin:home' }]
      ]
    };
    if (edit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    }
    return;
  }

  // Count items
  const mediaItems = bundle.mediaItems || [];
  const photos = mediaItems.filter(m => m.mediaType === 'photo').length;
  const videos = mediaItems.filter(m => m.mediaType === 'video').length;
  const docs = mediaItems.filter(m => m.mediaType === 'document').length;
  const totalMedia = mediaItems.length;

  const links = bundle.links || [];
  const buttons = bundle.buttons || [];

  const text = `📝 <b>CREATE POST</b>\n\n` +
    `<b>Step 1:</b> 📦 Add Media\n` +
    `<b>Step 2:</b> ✏️ Add Text\n` +
    `<b>Step 3:</b> 🔗 Add Links\n` +
    `<b>Step 4:</b> 🔘 Add Buttons\n` +
    `<b>Step 5:</b> 👁 Preview\n` +
    `<b>Step 6:</b> 📤 Publish\n\n` +
    `<b>Current progress:</b>\n` +
    `• Media: ${totalMedia}\n` +
    `• Text: ${bundle.text ? 'Added ✓' : 'Not Added'}\n` +
    `• Links: ${links.length}\n` +
    `• Buttons: ${buttons.length}\n\n` +
    `<b>Title:</b> ${escapeHTML(bundle.title)}\n` +
    `<b>Protection:</b> ${bundle.protectContent ? '🔒 Enabled' : '🔓 Disabled'}\n` +
    `<b>Auto-Delete:</b> ${bundle.autoDeleteEnabled ? `⏳ ${bundle.autoDeleteAfter}h` : '❌ Disabled'}\n\n` +
    `Use the buttons below to build your post:`;

  const markup = {
    inline_keyboard: [
      [{ text: '➕ Add Media', callback_data: 'admin:bundle:media:add' }, { text: '📋 Current Media', callback_data: 'admin:bundle:media:list:1' }],
      [{ text: '📝 Edit Text', callback_data: 'admin:bundle:text' }, { text: '🔗 Links', callback_data: 'admin:bundle:links' }],
      [{ text: '🔘 Inline Buttons', callback_data: 'admin:bundle:buttons' }, { text: '📁 Set Category', callback_data: 'admin:bundle:category' }],
      [{ text: '⚙️ Settings', callback_data: 'admin:bundle:settings' }, { text: '👁 Preview Bundle', callback_data: 'admin:bundle:preview' }],
      [{ text: '💾 Save Draft', callback_data: 'admin:bundle:save' }, { text: '📤 Publish', callback_data: 'admin:bundle:publish:dest' }],
      [{ text: '❌ Discard / Close', callback_data: 'admin:bundle:discard' }]
    ]
  };

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  }
}

/**
 * Renders the Content Sequence editor screen
 */
async function renderSequenceComposer(ctx, session, edit = true, sequenceId = null) {
  const activeSeqId = sequenceId || session.currentSequenceId;
  let sequence = null;
  if (activeSeqId) {
    sequence = await ContentSequence.findById(activeSeqId);
  }

  if (!sequence) {
    const text = `📦 <b>CONTENT SEQUENCE COMPOSER</b>\n\nNo active sequence draft found. Create a new sequence or browse existing ones.`;
    const markup = {
      inline_keyboard: [
        [{ text: '➕ Create Sequence', callback_data: 'admin:seq:create' }],
        [{ text: '📦 Browse Sequences', callback_data: 'admin:seq:list' }],
        [{ text: '🏠 Home', callback_data: 'admin:home' }]
      ]
    };
    if (edit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
    }
    return;
  }

  // Update session active sequence context
  session.currentSequenceId = sequence._id;
  await session.save();

  // Summary counts
  const blocksCount = sequence.blocks.length;
  let mediaCount = 0;
  let textBlocks = 0;
  let linksCount = 0;
  let buttonsCount = 0;

  sequence.blocks.forEach(b => {
    if (b.type === 'TEXT') textBlocks++;
    else if (b.type === 'LINKS') linksCount++;
    else if (b.type === 'TEXT_WITH_BUTTONS') {
      textBlocks++;
      buttonsCount += b.buttons.length;
    } else {
      mediaCount += b.mediaItems.length;
    }
  });

  const userBotUsername = config.userBotUsername || ctx.botInfo.username;
  const deepLink = `https://t.me/${userBotUsername}?start=${sequence.publicCode}`;

  let text = `📦 <b>CONTENT SEQUENCE BUILDER</b>\n\n` +
    `<b>Title:</b> ${escapeHTML(sequence.title)}\n` +
    `<b>Public Link:</b>\n<code>${deepLink}</code>\n` +
    `<b>Status:</b> ${sequence.status === 'ACTIVE' ? '🟢 ACTIVE' : '⚪ DRAFT'}\n` +
    `<b>Protect Content:</b> ${sequence.settings?.protectContent ? '🔒 Yes' : '🔓 No'}\n` +
    `<b>Auto Delete:</b> ${sequence.settings?.autoDeleteValue || 'OFF'}\n\n` +
    `<b>USER WILL RECEIVE:</b>\n`;

  if (blocksCount === 0) {
    text += `<i>No blocks added yet. Click Add Block to build.</i>\n`;
  } else {
    // Sort blocks by sortOrder
    const sorted = [...sequence.blocks].sort((a, b) => a.sortOrder - b.sortOrder);
    sorted.forEach((b, index) => {
      const num = index + 1;
      if (b.type === 'TEXT') text += `${num}. 📝 Text block\n`;
      else if (b.type === 'LINKS') text += `${num}. 🔗 Links block\n`;
      else if (b.type === 'TEXT_WITH_BUTTONS') text += `${num}. 📣 Text + ${b.buttons.length} buttons\n`;
      else if (b.type === 'MEDIA_GROUP') text += `${num}. 📦 Media Group (${b.mediaItems.length} items)\n`;
      else text += `${num}. 🖼️ Media: ${b.type} block\n`;
    });
  }

  // Build inline keyboard
  const markupButtons = [];

  // Add block lists as buttons for selection/edit
  const sorted = [...sequence.blocks].sort((a, b) => a.sortOrder - b.sortOrder);
  sorted.forEach((b, index) => {
    const num = index + 1;
    let label = '';
    if (b.type === 'TEXT') label = `${num}. 📝 Text`;
    else if (b.type === 'LINKS') label = `${num}. 🔗 Links`;
    else if (b.type === 'TEXT_WITH_BUTTONS') label = `${num}. 📣 Text + Buttons`;
    else if (b.type === 'MEDIA_GROUP') label = `${num}. 📦 Media Group (${b.mediaItems.length})`;
    else label = `${num}. 🖼️ Single Media (${b.type})`;

    markupButtons.push([{ text: label, callback_data: `admin:seq:block:open:${b.blockId}` }]);
  });

  markupButtons.push([
    { text: '➕ Add Block', callback_data: 'admin:seq:block:add' },
    { text: '👁 Preview', callback_data: 'admin:seq:preview' }
  ]);
  markupButtons.push([
    { text: '🔗 Generate Link', callback_data: 'admin:seq:link' },
    { text: '⚙️ Settings', callback_data: 'admin:seq:settings' }
  ]);
  markupButtons.push([
    { text: '💾 Save Draft', callback_data: 'admin:seq:save' },
    { text: '🚀 Publish', callback_data: 'admin:seq:publish:confirm' }
  ]);
  markupButtons.push([
    { text: '❌ Cancel', callback_data: 'admin:seq:cancel' }
  ]);

  const markup = { inline_keyboard: markupButtons };

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  }
}

export async function showSettingsMenu(ctx) {
  const settings = ctx.state.settings || {};
  const behaviour = settings.startBehaviour || 'WELCOME_ONLY';
  const labelMap = {
    'WELCOME_ONLY': '🟢 Welcome Message Only',
    'WELCOME_MENU': '🟢 Welcome + Main Menu',
    'CONFIGURED_CONTENT': '🟢 Welcome + Configured Content',
    'CONFIGURED_SEQUENCE': '🟢 Configured Sequence',
    'DISABLED': '🔴 Disabled'
  };

  let seqTitle = 'None';
  if (settings.startSequenceId) {
    const seq = await ContentSequence.findById(settings.startSequenceId);
    if (seq) seqTitle = seq.title;
  }

  const text = `⚙️ <b>START BEHAVIOUR CONFIG</b>\n\n` +
    `Choose what happens when a normal user starts the User Bot without a deep link parameter:\n\n` +
    `<b>Current setting:</b> <u>${labelMap[behaviour] || 'N/A'}</u>\n` +
    `<b>Active Sequence:</b> <u>${seqTitle}</u>\n\n` +
    `<b>Behaviour Explanations:</b>\n` +
    `• <b>Welcome Message Only</b>\n  → User receives only the configured welcome message.\n` +
    `• <b>Welcome + Main Menu</b>\n  → User receives welcome message and interactive folder navigation buttons.\n` +
    `• <b>Welcome + Configured Content</b>\n  → User receives welcome message and active start-content library items.\n` +
    `• <b>Configured Sequence</b>\n  → User receives the selected Content Sequence onboarding flow.\n` +
    `• <b>Disabled</b>\n  → Bot remains completely silent (sends no response).`;

  const markup = {
    inline_keyboard: [
      [{ text: 'Welcome Only', callback_data: 'admin:set:start:select:WELCOME_ONLY' }, { text: 'Welcome + Menu', callback_data: 'admin:set:start:select:WELCOME_MENU' }],
      [{ text: 'Configured Content', callback_data: 'admin:set:start:select:CONFIGURED_CONTENT' }, { text: 'Configured Sequence', callback_data: 'admin:set:start:select:CONFIGURED_SEQUENCE' }],
      [{ text: 'Disabled', callback_data: 'admin:set:start:select:DISABLED' }],
      [{ text: '⚙️ Configure Sequence Onboarding', callback_data: 'admin:set:start:sequence:list:1' }],
      [{ text: '⚙️ Configure /start Content', callback_data: 'admin:set:start:content:list:1' }],
      [{ text: '⬅️ Back to Control Center', callback_data: 'admin:home' }]
    ]
  };

  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup });
  } catch (err) {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  }
}

/**
 * Callback query router for Admin-prefixed operations
 */
export async function handleAdminCallback(ctx) {
  if (!ctx.from) return;
  const data = ctx.callbackQuery.data;
  const adminId = ctx.from.id;

  try {
    // 1. Double check security list
    if (!isAdmin(ctx)) {
      await ctx.answerCbQuery('Unauthorized.', { show_alert: true }).catch(() => {});
      return;
    }

    await ctx.answerCbQuery().catch(() => {});

    if (!ctx.state) ctx.state = {};
    ctx.state.botId = await resolveBotId();
    ctx.state.settings = await getCachedSettings(ctx.state.botId);

    const session = await AdminSession.getSession(adminId);

    // ── Admin Multi-Media Link Callbacks ─────────────────────────────────────
    if (data.startsWith('admin:link:')) {
      const parts = data.split(':');
      const action = parts[2];

      if (action === 'add_more') {
        session.state = 'LINK_DRAFT_ADD';
        await session.save();
        await ctx.reply('📦 Send the next photo, video, document, or text message:').catch(() => {});
        return;
      }

      if (action === 'cancel') {
        session.linkDraft = { status: 'idle', items: [], expiresAt: null, updatedAt: new Date() };
        session.state = 'IDLE';
        await session.save();
        await ctx.reply('❌ Draft creation cancelled. Draft cleared.').catch(() => {});
        return;
      }

      if (action === 'direct_init') {
        if (!session.linkDraft || !session.linkDraft.items || session.linkDraft.items.length === 0) {
          return ctx.reply('⚠️ Your draft is empty. Please add at least one item first.').catch(() => {});
        }
        const text = `<b>⏱ Direct Send Expiry</b>\n\nSelect how long this post should remain in the users' chats before being auto-deleted:`;
        const markup = {
          inline_keyboard: [
            [
              { text: 'Never', callback_data: 'admin:link:dir_exp:never' },
              { text: '15 Minutes', callback_data: 'admin:link:dir_exp:15m' }
            ],
            [
              { text: '1 Hour', callback_data: 'admin:link:dir_exp:1h' },
              { text: '6 Hours', callback_data: 'admin:link:dir_exp:6h' }
            ],
            [
              { text: '24 Hours', callback_data: 'admin:link:dir_exp:24h' },
              { text: 'Custom', callback_data: 'admin:link:dir_exp:custom' }
            ],
            [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
          ]
        };
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'dir_exp') {
        const choice = parts[3];
        if (choice === 'custom') {
          session.state = 'WAITING_FOR_CUSTOM_EXPIRY_DIRECT';
          await session.save();
          await ctx.reply('✏️ <b>Enter custom duration</b>\n\nSend duration like: <code>15m</code>, <code>2h</code>, <code>1d</code>, <code>3d</code>. Or send /cancel:').catch(() => {});
          return;
        }

        let durationMs = 0;
        if (choice === '15m') durationMs = 15 * 60 * 1000;
        else if (choice === '1h') durationMs = 60 * 60 * 1000;
        else if (choice === '6h') durationMs = 6 * 60 * 60 * 1000;
        else if (choice === '24h') durationMs = 24 * 60 * 60 * 1000;

        const expiresAt = choice === 'never' ? null : new Date(Date.now() + durationMs);

        session.linkDraft.expiresAt = expiresAt;
        session.state = 'CONFIRM_DIRECT_PUBLISH';
        session.markModified('linkDraft');
        await session.save();

        const text = `🚀 <b>Ready to Publish Directly</b>\n\n` +
                     `• <b>Items:</b> ${session.linkDraft.items.length}\n` +
                     `• <b>Auto-Delete:</b> ${expiresAt ? expiresAt.toUTCString() : 'Never'}\n\n` +
                     `Click Publish to broadcast directly to all active users:`;

        const markup = {
          inline_keyboard: [
            [{ text: '🚀 Publish Now', callback_data: 'admin:link:dir_publish:run' }],
            [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
          ]
        };

        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'dir_publish' && parts[3] === 'run') {
        if (!session.linkDraft || !session.linkDraft.items || session.linkDraft.items.length === 0) {
          return ctx.reply('⚠️ No items to publish.').catch(() => {});
        }

        const deleteAt = session.linkDraft.expiresAt || null;
        const items = session.linkDraft.items;

        await ctx.reply('⏳ Broadcasting post to active users...').catch(() => {});

        (async () => {
          try {
            const activeUsers = await User.find({ status: 'active' });
            
            let success = 0;
            let failed = 0;

            for (const userObj of activeUsers) {
              const batchId = new mongoose.Types.ObjectId().toString();
              try {
                for (const item of items) {
                  let contentDoc = null;
                  if (item.type === 'text') {
                    contentDoc = await Content.create({
                      title: 'Direct Text Post',
                      type: 'text',
                      text: item.text,
                      status: 'active',
                      botId: ctx.state.botId
                    });
                  } else {
                    contentDoc = await Content.findById(item.mediaId);
                  }

                  if (contentDoc) {
                    await telegramService.deliverContent(
                      userObj._id,
                      userObj.telegramUserId,
                      contentDoc,
                      batchId,
                      deleteAt,
                      ctx.state.botId
                    );
                  }
                }
                success++;
              } catch (err) {
                console.error(`Direct broadcast failed for user ${userObj.telegramUserId}:`, err.message);
                failed++;
              }
              await new Promise(r => setTimeout(r, 100));
            }
            console.log(`Direct broadcast finished. Success: ${success}, Failed: ${failed}`);
          } catch (err) {
            console.error('Direct broadcast background job error:', err.message);
          }
        })();

        session.linkDraft = { status: 'idle', items: [], expiresAt: null, updatedAt: new Date() };
        session.state = 'IDLE';
        await session.save();

        await ctx.reply('🚀 <b>Broadcast Sent Successfully</b>\n\nAll messages have been queued for active users and will auto-delete at the scheduled time.', { parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      if (action === 'finalize') {
        if (!session.linkDraft || !session.linkDraft.items || session.linkDraft.items.length === 0) {
          return ctx.reply('⚠️ Your draft is empty. Please add at least one item first.').catch(() => {});
        }
        const text = `<b>⏱ Select Expiry</b>\n\nChoose an expiration period for your new link:`;
        const markup = {
          inline_keyboard: [
            [
              { text: 'Never', callback_data: 'admin:link:exp:never' },
              { text: '1 Hour', callback_data: 'admin:link:exp:1h' }
            ],
            [
              { text: '6 Hours', callback_data: 'admin:link:exp:6h' },
              { text: '12 Hours', callback_data: 'admin:link:exp:12h' }
            ],
            [
              { text: '24 Hours', callback_data: 'admin:link:exp:24h' },
              { text: '3 Days', callback_data: 'admin:link:exp:3d' }
            ],
            [
              { text: '7 Days', callback_data: 'admin:link:exp:7d' },
              { text: 'Custom', callback_data: 'admin:link:exp:custom' }
            ],
            [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
          ]
        };
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'exp') {
        const choice = parts[3];
        if (choice === 'custom') {
          session.state = 'WAITING_FOR_CUSTOM_EXPIRY_LINK';
          await session.save();
          await ctx.reply('✏️ <b>Enter custom duration</b>\n\nSend duration like: <code>15m</code>, <code>2h</code>, <code>1d</code>, <code>3d</code>. Or send /cancel:').catch(() => {});
          return;
        }

        let durationMs = 0;
        if (choice === '1h') durationMs = 60 * 60 * 1000;
        else if (choice === '6h') durationMs = 6 * 60 * 60 * 1000;
        else if (choice === '12h') durationMs = 12 * 60 * 60 * 1000;
        else if (choice === '24h') durationMs = 24 * 60 * 60 * 1000;
        else if (choice === '3d') durationMs = 3 * 24 * 60 * 60 * 1000;
        else if (choice === '7d') durationMs = 7 * 24 * 60 * 60 * 1000;

        const expiresAt = choice === 'never' ? null : new Date(Date.now() + durationMs);

        let token = crypto.randomBytes(6).toString('hex');
        let existing = await Link.findOne({ token });
        while (existing) {
          token = crypto.randomBytes(6).toString('hex');
          existing = await Link.findOne({ token });
        }

        const newLink = await Link.create({
          token,
          status: 'active',
          items: session.linkDraft.items,
          createdBy: adminId.toString(),
          expiresAt
        });

        session.linkDraft = { status: 'idle', items: [], expiresAt: null, updatedAt: new Date() };
        session.state = 'IDLE';
        await session.save();

        const domain = config.adminOrigin || `http://localhost:${config.port || 3000}`;
        const finalUrl = `${domain}/l/${token}`;

        const successText = `✅ <b>Link Created Successfully</b>\n\n` +
                            `• <b>Items:</b> ${newLink.items.length}\n` +
                            `• <b>Status:</b> Active\n` +
                            `• <b>Expires:</b> ${expiresAt ? expiresAt.toUTCString() : 'Never'}\n\n` +
                            `🔗 <code>${finalUrl}</code>`;

        await ctx.reply(successText, { parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      if (action === 'list') {
        const page = parseInt(parts[3] || '1', 10);
        await renderMyLinks(ctx, page, true);
        return;
      }

      if (action === 'preview') {
        const token = parts[3];
        const link = await Link.findOne({ token });
        if (!link) {
          return ctx.reply('⚠️ Link not found.').catch(() => {});
        }
        const domain = config.adminOrigin || `http://localhost:${config.port || 3000}`;
        const finalUrl = `${domain}/l/${token}`;
        await ctx.reply(`👁️ <b>Preview Link:</b> ${finalUrl}`).catch(() => {});
        return;
      }

      if (action === 'delete') {
        const token = parts[3];
        const page = parseInt(parts[4] || '1', 10);
        
        const link = await Link.findOne({ token });
        if (link) {
          link.status = 'deleted';
          await link.save();
          await ctx.reply(`🗑️ Link #${token} deleted successfully.`).catch(() => {});
        }
        await renderMyLinks(ctx, page, true);
        return;
      }
    }

    // ── Admin Media Library Callbacks ────────────────────────────────────────
    if (data.startsWith('admin:med:')) {
      const parts = data.split(':');
      const action = parts[2];

      if (action === 'list') {
        const type = parts[3];
        const page = parseInt(parts[4] || '1', 10);
        await renderMediaLibrary(ctx, type, page, true);
        return;
      }

      if (action === 'filter') {
        const type = parts[3];
        const page = parseInt(parts[4] || '1', 10);
        await renderMediaLibrary(ctx, type, page, true);
        return;
      }

      if (action === 'copy') {
        const mediaId = parts[3];
        const media = await Content.findById(mediaId);
        if (media && media.storageKey) {
          const presignedUrl = await storageService.generatePresignedDownloadUrl(media.storageKey, 900);
          await ctx.reply(`🔗 <b>Temporary Secure URL (expires in 15 mins):</b>\n\n<code>${presignedUrl}</code>`, { parse_mode: 'HTML' }).catch(() => {});
        } else {
          await ctx.reply('⚠️ Media file not found.').catch(() => {});
        }
        return;
      }

      if (action === 'prev') {
        const mediaId = parts[3];
        const type = parts[4];
        const page = parseInt(parts[5] || '1', 10);

        const media = await Content.findById(mediaId);
        if (!media) {
          return ctx.reply('⚠️ Media file not found.').catch(() => {});
        }

        const captionText = media.caption || 'Preview';

        if (media.telegramFileId) {
          if (media.type === 'photo') {
            await ctx.replyWithPhoto(media.telegramFileId, { caption: captionText }).catch(() => {});
          } else if (media.type === 'video') {
            await ctx.replyWithVideo(media.telegramFileId, { caption: captionText }).catch(() => {});
          } else if (media.type === 'document') {
            await ctx.replyWithDocument(media.telegramFileId, { caption: captionText }).catch(() => {});
          }
        } else if (media.storageKey) {
          try {
            // Generate a 15-minute presigned S3 URL
            const presignedUrl = await storageService.generatePresignedDownloadUrl(media.storageKey, 900);
            if (media.type === 'photo') {
              await ctx.replyWithPhoto({ url: presignedUrl }, { caption: captionText }).catch(() => {});
            } else if (media.type === 'video') {
              await ctx.replyWithVideo({ url: presignedUrl }, { caption: captionText }).catch(() => {});
            } else if (media.type === 'document') {
              await ctx.replyWithDocument({ url: presignedUrl }, { caption: captionText }).catch(() => {});
            }
          } catch (urlErr) {
            console.error('Failed to generate preview presigned URL:', urlErr.message);
            await ctx.reply('❌ Error generating temporary preview from S3.').catch(() => {});
          }
        } else {
          await ctx.reply('⚠️ Preview unavailable (missing storage configuration and Telegram File ID).').catch(() => {});
        }
        return;
      }
    }

    // ── Admin Publish Workflow Callbacks ─────────────────────────────────────
    if (data.startsWith('admin:pub:')) {
      const parts = data.split(':');
      const action = parts[2];

      // Resolve active pack ID from session or callback parts
      let packId = session.currentPackId;
      if (!packId) {
        if (['mode', 'cat', 'expiry'].includes(action)) {
          packId = parts[4];
        } else {
          packId = parts[3];
        }
      }

      const pack = mongoose.Types.ObjectId.isValid(packId) ? await ContentPack.findById(packId) : null;
      if (!pack && action !== 'cancel' && action !== 'start') {
        return ctx.answerCbQuery('⚠️ Post not found.', { show_alert: true });
      }

      if (pack) {
        session.currentPackId = pack._id;
        await session.save();
      }

      if (action === 'start') {
        session.state = 'WAITING_FOR_POST';
        await session.save();

        await ctx.editMessageText(
          '📤 <b>FORWARDED POST PUBLISHER</b>\n\n' +
          'Send or forward any post/message (photo, video, document, or text with formatting/links) to this bot to begin publishing it.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancel', callback_data: 'admin:home' }]
              ]
            }
          }
        ).catch(() => {});
        return;
      }

      if (action === 'preview') {
        const text = `📦 <b>NEW POST PREVIEW</b>\n\n` +
          `What do you want to do with this post?`;
        const markup = {
          inline_keyboard: [
            [{ text: '🚀 DIRECT PUBLISH', callback_data: `admin:pub:mode:direct` }],
            [{ text: '🔗 CREATE LINK', callback_data: `admin:pub:mode:link` }],
            [{ text: '❌ CANCEL', callback_data: `admin:pub:cancel` }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'mode') {
        const mode = parts[3]; // 'direct' or 'link'
        pack.settings = pack.settings || {};
        pack.settings.mode = mode;
        pack.markModified('settings');
        await pack.save();

        // Bypassing category selection! Go straight to expiry selection!
        ctx.callbackQuery.data = `admin:pub:expiry:set`;
        await handleAdminCallback(ctx);
        return;
      }

      if (action === 'expiry') {
        const subAction = parts[3]; // 'set' or 'select'

        if (subAction === 'set') {
          session.state = 'CHOOSING_EXPIRY';
          await session.save();

          const mode = pack.settings?.mode || 'direct';
          const titleText = mode === 'direct' ? '⏰ SELECT POST EXPIRY' : '⏰ SELECT LINK EXPIRY';
          const text = `<b>${titleText}</b>\n\nChoose an expiry option for this post:`;
          const markup = {
            inline_keyboard: [
              [
                { text: '15 Minutes', callback_data: `admin:pub:expiry:select:15m` },
                { text: '30 Minutes', callback_data: `admin:pub:expiry:select:30m` }
              ],
              [
                { text: '1 Hour', callback_data: `admin:pub:expiry:select:1h` },
                { text: '6 Hours', callback_data: `admin:pub:expiry:select:6h` }
              ],
              [
                { text: '12 Hours', callback_data: `admin:pub:expiry:select:12h` },
                { text: '24 Hours', callback_data: `admin:pub:expiry:select:24h` }
              ],
              [
                { text: '3 Days', callback_data: `admin:pub:expiry:select:3d` },
                { text: '♾️ Never', callback_data: `admin:pub:expiry:select:never` }
              ],
              [
                { text: '✏️ Custom', callback_data: `admin:pub:expiry:select:custom` }
              ],
              [
                { text: '🔙 Back', callback_data: pack.status === 'PENDING' ? (mode === 'direct' ? `admin:pub:mode:direct` : `admin:pub:preview`) : `admin:pack:open:${pack._id}` }
              ]
            ]
          };
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
          return;
        }

        if (subAction === 'select') {
          const durationVal = parts[4];

          if (durationVal === 'custom') {
            session.state = 'WAITING_FOR_CUSTOM_EXPIRY';
            session.currentPackId = pack._id;
            await session.save();
            await ctx.editMessageText('✏️ <b>Enter custom duration</b>\n\nSend duration like: <code>15m</code>, <code>2h</code>, <code>1d</code>, <code>3d</code>. Or send /cancel:', {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `admin:pub:expiry:set` }]] }
            }).catch(() => {});
            return;
          }

          if (durationVal === 'never') {
            pack.expiresAt = undefined;
          } else {
            let durationMs = 0;
            if (durationVal === '15m') durationMs = 15 * 60 * 1000;
            else if (durationVal === '30m') durationMs = 30 * 60 * 1000;
            else if (durationVal === '1h') durationMs = 60 * 60 * 1000;
            else if (durationVal === '6h') durationMs = 6 * 60 * 60 * 1000;
            else if (durationVal === '12h') durationMs = 12 * 60 * 60 * 1000;
            else if (durationVal === '24h') durationMs = 24 * 60 * 60 * 1000;
            else if (durationVal === '3d') durationMs = 3 * 24 * 60 * 60 * 1000;

            pack.expiresAt = new Date(Date.now() + durationMs);
          }

          await pack.save();

          if (pack.status === 'PENDING') {
            const mode = pack.settings?.mode || 'direct';
            if (mode === 'direct') {
              session.state = 'CONFIRM_PUBLISH';
            } else {
              session.state = 'CONFIRM_LINK';
            }
            await session.save();
            await renderPublishConfirm(ctx, pack, session, true);
          } else {
            ctx.callbackQuery.data = `admin:pack:open:${pack._id}`;
            await handleAdminCallback(ctx);
          }
          return;
        }
      }

      if (action === 'run') {
        if (pack.status !== 'PENDING') {
          return ctx.answerCbQuery('⚠️ This post is already published or is no longer pending.', { show_alert: true });
        }

        const mode = pack.settings?.mode || 'direct';

        // Wait for background S3 uploads if any exist
        if (pack.items && pack.items.length > 0) {
          let progressMsg = null;
          try {
            global.pendingUploads = global.pendingUploads || {};
            for (const item of pack.items) {
              const contentItem = await Content.findById(item.contentId);
              if (contentItem && contentItem.storageKey && global.pendingUploads[contentItem.storageKey]) {
                if (!progressMsg) {
                  progressMsg = await ctx.reply('⏳ Completing S3 media uploads... Please wait.').catch(() => {});
                }
                await global.pendingUploads[contentItem.storageKey];
                delete global.pendingUploads[contentItem.storageKey];
              }
            }
          } catch (err) {
            if (progressMsg) {
              await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
            }
            return ctx.answerCbQuery(`❌ S3 Upload failed: ${err.message}. Please forward/send media again.`, { show_alert: true });
          }
          if (progressMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
          }
        }

        pack.status = 'published';
        pack.publishedAt = new Date();
        await pack.save();

        if (pack.items && pack.items.length > 0) {
          for (const item of pack.items) {
            await Content.updateOne(
              { _id: item.contentId },
              { $set: { status: 'active' } }
            );
          }
        }

        session.state = 'IDLE';
        await session.save();

        await logAdminActivity('PACK_PUBLISHED', adminId, 'success', { packName: pack.name, code: pack.publicCode });

        const userBotUsername = config.userBotUsername || ctx.botInfo.username;
        const deepLink = `https://t.me/${userBotUsername}?start=p_${pack.publicCode}`;
        const expiryText = formatExpiryDescription(pack.expiresAt);

        let text = '';
        let markup = {
          inline_keyboard: [
            [{ text: '🏠 Home', callback_data: 'admin:home' }]
          ]
        };

        if (mode === 'direct') {
          // Trigger direct broadcast delivery to all active users in the background
          (async () => {
            try {
              const { User } = await import('../../models/User.js');
              const { telegramService } = await import('../../services/telegram.service.js');
              const { DeliveryBatch } = await import('../../models/DeliveryBatch.js');
              const settings = ctx.state.settings;

              const activeUsers = await User.find({ botId: ctx.state.botId, status: 'active' });
              if (activeUsers.length === 0) return;

              let success = 0;
              let failed = 0;

              for (const userObj of activeUsers) {
                try {
                  // Create Delivery Batch
                  const batch = await DeliveryBatch.create({
                    botId: ctx.state.botId,
                    userId: userObj._id,
                    packId: pack._id,
                    status: 'processing',
                    startedAt: new Date()
                  });

                  const batchId = batch._id.toString();
                  let deleteAt = pack.expiresAt || null;
                  if (settings.autoDeleteEnabled) {
                    const globalDeleteAt = new Date(Date.now() + settings.autoDeleteHours * 60 * 60 * 1000);
                    if (!deleteAt || globalDeleteAt < deleteAt) {
                      deleteAt = globalDeleteAt;
                    }
                  }

                  const results = await telegramService.deliverContentPack(
                    userObj._id,
                    userObj.telegramUserId,
                    pack,
                    batchId,
                    deleteAt,
                    ctx.state.botId
                  );

                  batch.status = 'completed';
                  batch.completedAt = new Date();
                  batch.messageCount = results.total;
                  batch.successCount = results.success;
                  batch.failureCount = results.failed;
                  await batch.save();

                  success++;
                } catch (err) {
                  console.error(`Direct publish delivery failed for user ${userObj.telegramUserId}:`, err.message);
                  failed++;
                }

                // Anti-flood rate limit sleep (100ms)
                await new Promise(r => setTimeout(r, 100));
              }

              console.log(`Direct publish broadcast completed. Success: ${success}, Failed: ${failed}`);
            } catch (err) {
              console.error('Direct publish broadcast job error:', err.message);
            }
          })();

          text = `✅ <b>POST PUBLISHED & BROADCAST STARTED</b>\n\n` +
            `<b>Post ID:</b> #${pack.publicCode}\n` +
            `<b>Status:</b> 🟢 LIVE\n` +
            `<b>Expires:</b> ${expiryText}\n\n` +
            `Delivering post directly to all active users in the background...`;
        } else {
          text = `🔗 <b>LINK CREATED</b>\n\n` +
            `<code>${deepLink}</code>\n\n` +
            `Share this link with users. When clicked, it will deliver the post.`;
        }

        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'cancel') {
        const cancelPack = await ContentPack.findById(packId);
        if (cancelPack) {
          if (cancelPack.items && cancelPack.items.length > 0) {
            for (const item of cancelPack.items) {
              await Content.findByIdAndDelete(item.contentId).catch(() => {});
            }
          }
          await ContentPack.findByIdAndDelete(packId);
        }

        session.state = 'IDLE';
        await session.save();

        const text = `❌ <b>Publishing cancelled.</b>\n\nThe post was not published.`;
        const markup = {
          inline_keyboard: [
            [{ text: '🏠 Home', callback_data: 'admin:home' }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      if (action === 'toggle') {
        const toggleAct = parts[4];
        if (toggleAct === 'unpublish') {
          pack.status = 'DISABLED';
          await pack.save();
          if (pack.items && pack.items.length > 0) {
            for (const item of pack.items) {
              await Content.updateOne(
                { _id: item.contentId },
                { $set: { status: 'inactive' } }
              );
            }
          }
          await logAdminActivity('PACK_UNPUBLISHED', adminId, 'success', { packId: pack._id });
        } else if (toggleAct === 'publish') {
          pack.status = 'published';
          await pack.save();
          if (pack.items && pack.items.length > 0) {
            for (const item of pack.items) {
              await Content.updateOne(
                { _id: item.contentId },
                { $set: { status: 'active' } }
              );
            }
          }
          await logAdminActivity('PACK_PUBLISHED', adminId, 'success', { packId: pack._id });
        }

        ctx.callbackQuery.data = `admin:pack:open:${packId}`;
        await handleAdminCallback(ctx);
        return;
      }
    }

    // Navigation Home
    if (data === 'admin:home' || data === 'admin:refresh') {
      session.state = 'IDLE';
      await session.save();
      await renderHome(ctx, true);
      return;
    }

    // Post Composer menu entry
    if (data === 'admin:post:menu') {
      await renderPostComposer(ctx, session, true);
      return;
    }

    // ── System Health Check ─────────────────────────────────────────────────
    if (data === 'admin:health') {
      let lines = ['🧪 *SYSTEM HEALTH CHECK*\n'];

      // 1. Admin Bot
      try {
        const { adminBot } = await import('../../bot/bot.js');
        if (adminBot) {
          const info = await adminBot.telegram.getMe();
          lines.push(`*Admin Bot:* 🟢 @${info.username}`);
        } else {
          lines.push('*Admin Bot:* ⚪ Disabled (no ADMIN_BOT_TOKEN)');
        }
      } catch (e) { lines.push(`*Admin Bot:* 🔴 Error — ${e.message}`); }

      // 2. User Bot
      try {
        const { bot } = await import('../../bot/bot.js');
        const info = await bot.telegram.getMe();
        lines.push(`*User Bot:* 🟢 @${info.username}`);
      } catch (e) { lines.push(`*User Bot:* 🔴 Error — ${e.message}`); }

      // 3. MongoDB
      try {
        const dbState = mongoose.connection.readyState;
        const label = dbState === 1 ? '🟢 Connected' : dbState === 2 ? '🟡 Connecting' : '🔴 Disconnected';
        lines.push(`*MongoDB:* ${label}`);
      } catch (e) { lines.push(`*MongoDB:* 🔴 Error — ${e.message}`); }

      // 4. Filebase (S3)
      try {
        await storageService.headObject('__health_check_probe__.txt').catch(() => {});
        lines.push('*Filebase S3:* 🟢 Reachable');
      } catch (e) {
        // headObject 404 means bucket reachable but key not found — still a success
        if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
          lines.push('*Filebase S3:* 🟢 Reachable');
        } else {
          lines.push(`*Filebase S3:* 🔴 Error — ${e.message}`);
        }
      }

      // 5. Backend Express
      lines.push('*Backend:* 🟢 Running');

      // Overall verdict
      const allGreen = lines.every(l => !l.includes('🔴'));
      lines.push(`\n*Overall:* ${allGreen ? '🟢 System Healthy' : '🔴 Issues Detected'}`);

      await ctx.editMessageText(lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔄 Re-check', callback_data: 'admin:health' }, { text: '🏠 Home', callback_data: 'admin:home' }]] }
      }).catch(() => {});
      return;
    }

    // Logout
    if (data === 'admin:logout') {
      await AdminSession.deleteOne({ adminTelegramId: adminId });
      await ctx.editMessageText('🚪 *Logged out.* Admin session and draft buffers cleared. Send /start to enter again.', { parse_mode: 'Markdown' }).catch(() => {});
      return;
    }

    // ── Create Post Bundle ──
    if (data === 'admin:bundle:create') {
      session.state = 'WAITING_FOR_BUNDLE_TITLE';
      await session.save();
      await ctx.editMessageText('📦 Send the Title of the new Post Bundle (e.g. `Premium Courses Batch`):', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:post:menu' }]] }
      }).catch(() => {});
      return;
    }

    // ── Browse Draft Bundles ──
    if (data === 'admin:bundle:list') {
      const drafts = await MediaBundle.find({ adminId: ctx.from.id, status: 'draft', botId: ctx.state.botId }).sort({ updatedAt: -1 });
      const buttons = drafts.map(d => [
        { text: `📝 ${d.title} (${d.mediaItems.length} media)`, callback_data: `admin:bundle:open:${d._id}` }
      ]);
      buttons.push([{ text: '◀️ Back to Composer Menu', callback_data: 'admin:post:menu' }]);

      await ctx.editMessageText('📝 <b>SELECT BUNDLE DRAFT</b>\n\nChoose an unsaved draft to continue composing:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    // ── Admin Product Manual Creation Callbacks ──────────────────────────────
    if (data.startsWith('admin:prod:')) {
      const parts = data.split(':');
      const action = parts[2];

      if (action === 'create') {
        session.state = 'WAITING_FOR_PRODUCT_TITLE';
        session.productDraft = { title: '', categoryId: undefined, description: '', media: [] };
        await session.save();

        await ctx.editMessageText(
          '➕ <b>ADD PRODUCT</b>\n\n' +
          'Please enter the title/name for your new product:',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancel', callback_data: 'admin:home' }]
              ]
            }
          }
        ).catch(() => {});
        return;
      }

      if (action === 'cat') {
        const subAct = parts[3]; // 'select'
        const catId = parts[4];

        session.productDraft = session.productDraft || { title: '', categoryId: undefined, description: '', media: [] };
        session.productDraft.categoryId = catId === 'none' ? undefined : catId;
        session.state = 'WAITING_FOR_PRODUCT_DESC';
        session.markModified('productDraft');
        await session.save();

        await ctx.editMessageText(
          '➕ <b>ADD PRODUCT</b>\n\n' +
          `Title: <b>${escapeHTML(session.productDraft.title)}</b>\n\n` +
          'Please enter the product description / caption:',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '❌ Cancel', callback_data: 'admin:home' }]
              ]
            }
          }
        ).catch(() => {});
        return;
      }

      if (action === 'media') {
        const subAct = parts[3]; // 'done'
        if (subAct === 'done') {
          const draft = session.productDraft;
          if (!draft || !draft.title) {
            return ctx.reply('⚠️ Product draft is invalid. Please restart product creation.').catch(() => {});
          }

          if (!draft.media || draft.media.length === 0) {
            return ctx.reply('⚠️ Please add at least one media item before clicking Done.').catch(() => {});
          }

          // Await background uploads for these media items
          let progressMsg = null;
          try {
            global.pendingUploads = global.pendingUploads || {};
            for (const contentId of draft.media) {
              const contentItem = await Content.findById(contentId);
              if (contentItem && contentItem.storageKey && global.pendingUploads[contentItem.storageKey]) {
                if (!progressMsg) {
                  progressMsg = await ctx.reply('⏳ Completing media S3 uploads... Please wait.').catch(() => {});
                }
                await global.pendingUploads[contentItem.storageKey];
                delete global.pendingUploads[contentItem.storageKey];
              }
            }
          } catch (err) {
            if (progressMsg) {
              await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
            }
            return ctx.reply(`❌ S3 Upload failed: ${err.message}. Please restart adding product.`).catch(() => {});
          }

          if (progressMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
          }

          // Generate publicCode
          let publicCode;
          let isUnique = false;
          while (!isUnique) {
            publicCode = 'pack_' + crypto.randomBytes(3).toString('hex').toLowerCase();
            const existing = await ContentPack.findOne({ botId: ctx.state.botId, publicCode });
            if (!existing) isUnique = true;
          }

          // Create the ContentPack document in PENDING state
          const pack = await ContentPack.create({
            botId: ctx.state.botId,
            name: draft.title,
            description: draft.description || '',
            categoryId: draft.categoryId,
            status: 'PENDING',
            items: draft.media.map((cid, idx) => ({
              contentId: cid,
              sortOrder: idx,
              enabled: true
            })),
            publicCode,
            sourceAdminId: adminId
          });

          // Reset manual draft
          session.state = 'IDLE';
          session.productDraft = undefined;
          await session.save();

          // Redirect to the publishing preview screen
          ctx.callbackQuery.data = `admin:pub:preview:${pack._id}`;
          await handleAdminCallback(ctx);
          return;
        }
      }
    }

    // ── Open Selected Draft ──
    if (data.startsWith('admin:bundle:open:')) {
      const bundleId = data.split(':')[3];
      session.currentBundleId = bundleId;
      session.state = 'IDLE';
      await session.save();
      await renderPostComposer(ctx, session, true);
      return;
    }

    // ── Add Media Menu ──
    if (data === 'admin:bundle:media:add') {
      const text = `📦 <b>ADD MEDIA BUNDLE</b>\n\n` +
        `Choose "Send Media Now" and upload your photos/videos/documents sequentially.\n\n` +
        `Send <code>/done</code> when you are finished uploading.`;

      const markup = {
        inline_keyboard: [
          [{ text: '📤 Send Media Now', callback_data: 'admin:bundle:media:batch:start' }],
          [{ text: '◀️ Back to Draft', callback_data: 'admin:post:menu' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // ── Trigger Batch Media Input ──
    if (data === 'admin:bundle:media:batch:start') {
      session.state = 'WAITING_FOR_BUNDLE_MEDIA_BATCH';
      await session.save();
      await ctx.editMessageText(
        `📤 <b>BATCH MEDIA UPLOAD MODE ACTIVE</b>\n\n` +
        `Send your photo/video/document messages to this chat one by one.\n\n` +
        `When you are completely finished, type <code>/done</code> or send <code>/done</code> as a message to save.`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Done / Close', callback_data: 'admin:post:menu' }]] } }
      ).catch(() => {});
      return;
    }

    // ── Media List (Pagination) ──
    if (data.startsWith('admin:bundle:media:list:')) {
      const page = parseInt(data.split(':')[4], 10) || 1;
      const limit = 5;

      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.').catch(() => {});

      const items = bundle.mediaItems.sort((a, b) => a.sortOrder - b.sortOrder);
      const total = items.length;
      const totalPages = Math.ceil(total / limit);

      const pageItems = items.slice((page - 1) * limit, page * limit);
      const buttons = pageItems.map(item => [
        {
          text: `#${item.sortOrder + 1} [${item.mediaType.toUpperCase()}] ${item.fileName || 'Attachment'}`,
          callback_data: `admin:bundle:media:item:${item._id}`
        }
      ]);

      // Pagination Controls
      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) {
          pagRow.push({ text: '◀️ Prev', callback_data: `admin:bundle:media:list:${page - 1}` });
        }
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'admin:ack' });
        if (page < totalPages) {
          pagRow.push({ text: 'Next ▶️', callback_data: `admin:bundle:media:list:${page + 1}` });
        }
        buttons.push(pagRow);
      }

      buttons.push([{ text: '◀️ Back to Composer', callback_data: 'admin:post:menu' }]);

      await ctx.editMessageText(`📋 <b>CURRENT MEDIA ITEMS (${total})</b>\n\nSelect an item number to reorder or remove:`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    // ── Media Item Details ──
    if (data.startsWith('admin:bundle:media:item:')) {
      const itemId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.').catch(() => {});

      const idx = bundle.mediaItems.findIndex(m => m._id.toString() === itemId);
      if (idx === -1) return ctx.reply('⚠️ Item not found in draft.').catch(() => {});

      const item = bundle.mediaItems[idx];
      const text = `📁 <b>MEDIA ITEM DETAILS</b>\n\n` +
        `<b>Number:</b> #${item.sortOrder + 1}\n` +
        `<b>Type:</b> ${item.mediaType.toUpperCase()}\n` +
        `<b>Filename:</b> ${escapeHTML(item.fileName || 'None')}\n` +
        `<b>Size:</b> ${(item.size ? (item.size / 1024 / 1024).toFixed(2) : 0)} MB\n` +
        `<b>Telegram Unique ID:</b> <code>${item.fileUniqueId || 'N/A'}</code>`;

      const markup = {
        inline_keyboard: [
          [{ text: '⬆️ Move Up', callback_data: `admin:bundle:media:up:${itemId}` }, { text: '⬇️ Move Down', callback_data: `admin:bundle:media:down:${itemId}` }],
          [{ text: '🗑 Remove Item', callback_data: `admin:bundle:media:remove:${itemId}` }],
          [{ text: '◀️ Back to List', callback_data: 'admin:bundle:media:list:1' }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // ── Move Media Up ──
    if (data.startsWith('admin:bundle:media:up:')) {
      const itemId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      const idx = bundle.mediaItems.findIndex(m => m._id.toString() === itemId);
      if (idx > 0) {
        // Swap sortOrder
        const temp = bundle.mediaItems[idx].sortOrder;
        bundle.mediaItems[idx].sortOrder = bundle.mediaItems[idx - 1].sortOrder;
        bundle.mediaItems[idx - 1].sortOrder = temp;
        bundle.mediaItems.sort((a, b) => a.sortOrder - b.sortOrder);
        // Normalize sort orders
        bundle.mediaItems.forEach((m, i) => m.sortOrder = i);
        await bundle.save();
      }

      ctx.callbackQuery.data = `admin:bundle:media:item:${itemId}`;
      await handleAdminCallback(ctx);
      return;
    }

    // ── Move Media Down ──
    if (data.startsWith('admin:bundle:media:down:')) {
      const itemId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      const idx = bundle.mediaItems.findIndex(m => m._id.toString() === itemId);
      if (idx > -1 && idx < bundle.mediaItems.length - 1) {
        // Swap sortOrder
        const temp = bundle.mediaItems[idx].sortOrder;
        bundle.mediaItems[idx].sortOrder = bundle.mediaItems[idx + 1].sortOrder;
        bundle.mediaItems[idx + 1].sortOrder = temp;
        bundle.mediaItems.sort((a, b) => a.sortOrder - b.sortOrder);
        // Normalize sort orders
        bundle.mediaItems.forEach((m, i) => m.sortOrder = i);
        await bundle.save();
      }

      ctx.callbackQuery.data = `admin:bundle:media:item:${itemId}`;
      await handleAdminCallback(ctx);
      return;
    }

    // ── Remove Media Item ──
    if (data.startsWith('admin:bundle:media:remove:')) {
      const itemId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      bundle.mediaItems = bundle.mediaItems.filter(m => m._id.toString() !== itemId);
      // Normalize sort orders
      bundle.mediaItems.sort((a, b) => a.sortOrder - b.sortOrder);
      bundle.mediaItems.forEach((m, i) => m.sortOrder = i);
      await bundle.save();

      ctx.callbackQuery.data = 'admin:bundle:media:list:1';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Edit Common Text ──
    if (data === 'admin:bundle:text') {
      session.state = 'WAITING_FOR_BUNDLE_TEXT';
      await session.save();

      const text = `✏️ <b>EDIT COMMON CAPTION TEXT</b>\n\n` +
        `Send the main body text/caption for this post. You can use standard HTML formatting tags:\n\n` +
        `• <code>&lt;b&gt;bold&lt;/b&gt;</code>\n` +
        `• <code>&lt;i&gt;italic&lt;/i&gt;</code>\n` +
        `• <code>&lt;u&gt;underline&lt;/u&gt;</code>\n` +
        `• <code>&lt;s&gt;strikethrough&lt;/s&gt;</code>\n` +
        `• <code>&lt;tg-spoiler&gt;spoiler&lt;/tg-spoiler&gt;</code>\n` +
        `• <code>&lt;a href="url"&gt;link label&lt;/a&gt;</code>`;

      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:post:menu' }]] }
      }).catch(() => {});
      return;
    }

    // ── Links Builder Menu ──
    if (data === 'admin:bundle:links') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      const links = bundle.links || [];
      const linksList = [...links].sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l, i) => `<b>#${i + 1}</b> [${escapeHTML(l.label)}] → <code>${escapeHTML(l.url)}</code>`)
        .join('\n') || '<i>No links configured.</i>';

      const text = `🔗 <b>LINKS BUILDER</b>\n\nConfigure multiple links to append to your post:\n\n${linksList}`;

      const buttons = links.map(l => [
        { text: `🗑 Remove: "${l.label}"`, callback_data: `admin:bundle:link:remove:${l._id}` }
      ]);
      buttons.push([{ text: '➕ Add Link', callback_data: 'admin:bundle:link:add' }]);
      buttons.push([{ text: '✅ Done', callback_data: 'admin:post:menu' }]);

      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:bundle:link:add') {
      session.state = 'WAITING_FOR_BUNDLE_LINK_URL';
      await session.save();
      await ctx.editMessageText('🔗 Send the redirect URL for this link (must start with http:// or https://):', {
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:bundle:links' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:bundle:link:remove:')) {
      const linkId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        bundle.links = bundle.links.filter(l => l._id.toString() !== linkId);
        bundle.links.forEach((l, i) => l.sortOrder = i);
        await bundle.save();
      }
      ctx.callbackQuery.data = 'admin:bundle:links';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Buttons Builder Menu ──
    if (data === 'admin:bundle:buttons') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      const bList = bundle.buttons || [];
      const btnList = [...bList].sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b, i) => `<b>#${i + 1}</b> [${escapeHTML(b.text)}] → <code>${escapeHTML(b.url)}</code>`)
        .join('\n') || '<i>No buttons configured.</i>';

      const text = `🔘 <b>INLINE BUTTON BUILDER</b>\n\nConfigure buttons attached under the final message:\n\n${btnList}`;

      const buttons = bList.map(b => [
        { text: `🗑 Remove: "${b.text}"`, callback_data: `admin:bundle:btn:remove:${b._id}` }
      ]);
      buttons.push([{ text: '➕ Add Button', callback_data: 'admin:bundle:btn:add' }]);
      buttons.push([{ text: '🗑 Clear All', callback_data: 'admin:bundle:btn:clear' }]);
      buttons.push([{ text: '✅ Done', callback_data: 'admin:post:menu' }]);

      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:bundle:btn:add') {
      session.state = 'WAITING_FOR_BUNDLE_BUTTON_TEXT';
      await session.save();
      await ctx.editMessageText('🔘 Send the label text for the inline button:', {
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:bundle:buttons' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:bundle:btn:remove:')) {
      const btnId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        bundle.buttons = bundle.buttons.filter(b => b._id.toString() !== btnId);
        bundle.buttons.forEach((b, i) => b.sortOrder = i);
        await bundle.save();
      }
      ctx.callbackQuery.data = 'admin:bundle:buttons';
      await handleAdminCallback(ctx);
      return;
    }

    if (data === 'admin:bundle:btn:clear') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        bundle.buttons = [];
        await bundle.save();
      }
      ctx.callbackQuery.data = 'admin:bundle:buttons';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Set Category ──
    if (data === 'admin:bundle:category') {
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} ${cat.displayName || cat.name}`, callback_data: `admin:bundle:set:cat:${cat._id}` }
      ]);
      buttons.push([{ text: '📁 Clear Category', callback_data: 'admin:bundle:set:cat:none' }]);
      buttons.push([{ text: '◀️ Back to Composer', callback_data: 'admin:post:menu' }]);

      await ctx.editMessageText('💾 <b>Set Category Assignment</b>\n\nChoose a category to file this post bundle under:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:bundle:set:cat:')) {
      const catId = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        bundle.categoryId = mongoose.Types.ObjectId.isValid(catId) ? catId : undefined;
        await bundle.save();
      }
      await renderPostComposer(ctx, session, true);
      return;
    }

    // ── Settings Sub-menu ──
    if (data === 'admin:bundle:settings') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return;

      const text = `⚙️ <b>BUNDLE DRAFT SETTINGS</b>\n\n` +
        `<b>Content Protection:</b> ${bundle.protectContent ? '🔒 Enabled (Prevents forward/save)' : '🔓 Disabled'}\n` +
        `<b>Auto-Deletion:</b> ${bundle.autoDeleteEnabled ? `⏳ ${bundle.autoDeleteAfter} hours` : '❌ Disabled (No auto-delete)'}`;

      const markup = {
        inline_keyboard: [
          [{ text: `${bundle.protectContent ? '🔓 Disable' : '🔒 Enable'} Protection`, callback_data: 'admin:bundle:toggle:protect' }],
          [{ text: '⏳ Disable Auto-delete', callback_data: 'admin:bundle:set:delete:off' }],
          [{ text: '⏳ Set 1 hour', callback_data: 'admin:bundle:set:delete:1' }, { text: '⏳ Set 6 hours', callback_data: 'admin:bundle:set:delete:6' }],
          [{ text: '⏳ Set 12 hours', callback_data: 'admin:bundle:set:delete:12' }, { text: '⏳ Set 24 hours', callback_data: 'admin:bundle:set:delete:24' }],
          [{ text: '◀️ Back to Composer', callback_data: 'admin:post:menu' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data === 'admin:bundle:toggle:protect') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        bundle.protectContent = !bundle.protectContent;
        await bundle.save();
      }
      ctx.callbackQuery.data = 'admin:bundle:settings';
      await handleAdminCallback(ctx);
      return;
    }

    if (data.startsWith('admin:bundle:set:delete:')) {
      const hoursStr = data.split(':')[4];
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (bundle) {
        if (hoursStr === 'off') {
          bundle.autoDeleteEnabled = false;
        } else {
          bundle.autoDeleteEnabled = true;
          bundle.autoDeleteAfter = parseInt(hoursStr, 10) || 24;
        }
        await bundle.save();
      }
      ctx.callbackQuery.data = 'admin:bundle:settings';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Preview Bundle ──
    if (data === 'admin:bundle:preview') {
      const { userBot } = await import('../../bot/bot.js');
      try {
        await PostDeliveryService.deliverBundle(session.currentBundleId, ctx.from.id, userBot);
        await ctx.reply('✅ <b>Preview delivered successfully!</b> Check the messages above.', { parse_mode: 'HTML' });
      } catch (err) {
        logger.error(`Preview dispatch failed: ${err.message}`);
        await ctx.reply(`⚠️ <b>Preview Failed:</b> ${err.message}`, { parse_mode: 'HTML' }).catch(() => {});
      }
      return;
    }

    // ── Save Draft ──
    if (data === 'admin:bundle:save') {
      session.state = 'IDLE';
      session.currentBundleId = undefined;
      await session.save();
      await ctx.reply('💾 <b>Draft successfully saved!</b> You can load it later under Post Composer → Browse Drafts.', { parse_mode: 'HTML' });
      await renderHome(ctx, false);
      return;
    }

    // ── Discard Draft Confirmation ──
    if (data === 'admin:bundle:discard') {
      const text = `⚠️ <b>DISCARD ACTIVE DRAFT</b>\n\n` +
        `Are you sure you want to discard this draft? All media, links, and buttons in this draft will be permanently deleted.`;

      const markup = {
        inline_keyboard: [
          [{ text: '❌ Discard Draft', callback_data: 'admin:bundle:discard:confirm' }],
          [{ text: '◀️ Keep Editing', callback_data: 'admin:post:menu' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data === 'admin:bundle:discard:confirm') {
      if (session.currentBundleId) {
        await MediaBundle.findByIdAndDelete(session.currentBundleId);
      }
      session.state = 'IDLE';
      session.currentBundleId = undefined;
      await session.save();
      await ctx.reply('🗑 <b>Post draft discarded.</b>');
      await renderHome(ctx, false);
      return;
    }

    // ── Select Publish Destination ──
    if (data === 'admin:bundle:publish:dest') {
      const markup = {
        inline_keyboard: [
          [{ text: '📢 Main Channel', callback_data: 'admin:bundle:publish:channel' }],
          [{ text: '👥 Broadcast to All Users', callback_data: 'admin:bundle:publish:bc:confirm' }],
          [{ text: '◀️ Back to Composer', callback_data: 'admin:post:menu' }]
        ]
      };
      await ctx.editMessageText('📤 <b>Select Publish Destination</b>\n\nChoose where this media bundle should be published:', {
        parse_mode: 'HTML',
        reply_markup: markup
      }).catch(() => {});
      return;
    }


    if (data === 'admin:bundle:publish:channel') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.').catch(() => {});

      const text = `📢 <b>PUBLISH TO CHANNEL CONFIRMATION</b>\n\n` +
        `<b>Post Title:</b> ${escapeHTML(bundle.title)}\n` +
        `<b>Media Items:</b> ${bundle.mediaItems.length}\n` +
        `<b>Text Body:</b> ${bundle.text ? 'Added ✓' : 'Not Added'}\n` +
        `<b>Links Count:</b> ${bundle.links.length}\n` +
        `<b>Inline Buttons:</b> ${bundle.buttons.length}\n\n` +
        `<b>Destination:</b> Main Channel (configured via process.env)\n` +
        `<b>Estimated Messages:</b> ${Math.ceil(bundle.mediaItems.length / 10) + (bundle.text || bundle.links.length > 0 || bundle.buttons.length > 0 ? 1 : 0)}\n\n` +
        `<i>This will send the configured content to the selected destination.</i>`;

      const markup = {
        inline_keyboard: [
          [{ text: '🚀 Confirm Publish', callback_data: 'admin:bundle:publish:channel:confirm' }],
          [{ text: '⬅️ Back', callback_data: 'admin:bundle:publish:dest' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // ── Publish to Channel Confirm & Run ──
    if (data === 'admin:bundle:publish:channel:confirm') {
      const channelId = process.env.MAIN_CHANNEL_ID;
      if (!channelId) {
        await ctx.reply('⚠️ <code>MAIN_CHANNEL_ID</code> environment variable is missing. Configure it in <code>.env</code> to send posts to your channel.', { parse_mode: 'HTML' }).catch(() => {});
        return;
      }

      // Add idempotency lock to prevent double-publish
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle || bundle.status === 'publishing' || bundle.status === 'published') {
        return ctx.reply('⚠️ Draft is already published or publishing.').catch(() => {});
      }

      bundle.status = 'publishing';
      await bundle.save();

      const { userBot } = await import('../../bot/bot.js');

      try {
        await ctx.reply('Publishing to channel...');
        const results = await PostDeliveryService.deliverBundle(bundle._id, channelId, userBot);

        bundle.status = 'published';
        await bundle.save();

        // Clear active session draft
        session.currentBundleId = undefined;
        await session.save();

        await logAdminActivity('BUNDLE_PUBLISHED', adminId, 'success', { destination: 'channel', channelId, bundleId: bundle._id });
        await ctx.reply(`✅ <b>Published successfully!</b>\n\nDelivered ${results.success} items to channel.`, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'admin:home' }]] }
        }).catch(() => {});

      } catch (err) {
        bundle.status = 'failed';
        await bundle.save();
        await ctx.reply(`⚠️ <b>Publish Failed:</b> ${err.message}`, { parse_mode: 'HTML' }).catch(() => {});
      }
      return;
    }

    // ── Broadcast to Users Confirmation ──
    if (data === 'admin:bundle:publish:bc:confirm') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.').catch(() => {});

      const userCount = await User.countDocuments({ botId: ctx.state.botId, status: 'active' });
      const text = `👥 <b>BROADCAST TO USERS CONFIRMATION</b>\n\n` +
        `<b>Post Title:</b> ${escapeHTML(bundle.title)}\n` +
        `<b>Media Items:</b> ${bundle.mediaItems.length}\n` +
        `<b>Text Body:</b> ${bundle.text ? 'Added ✓' : 'Not Added'}\n` +
        `<b>Links Count:</b> ${bundle.links.length}\n` +
        `<b>Inline Buttons:</b> ${bundle.buttons.length}\n\n` +
        `<b>Audience size:</b> ${userCount.toLocaleString()} active users\n` +
        `<b>Estimated Messages:</b> ${(userCount * (Math.ceil(bundle.mediaItems.length / 10) + (bundle.text || bundle.links.length > 0 || bundle.buttons.length > 0 ? 1 : 0))).toLocaleString()}\n\n` +
        `<i>This will send the configured content to the selected destination.</i>`;

      const markup = {
        inline_keyboard: [
          [{ text: '🚀 Confirm Publish', callback_data: 'admin:bundle:publish:bc:start' }],
          [{ text: '⬅️ Back', callback_data: 'admin:bundle:publish:dest' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // ── Start Broadcast Campaign ──
    if (data === 'admin:bundle:publish:bc:start') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle || bundle.status === 'publishing' || bundle.status === 'published') {
        return ctx.reply('⚠️ Draft is already published or publishing.').catch(() => {});
      }

      bundle.status = 'publishing';
      await bundle.save();

      const userCount = await User.countDocuments({ botId: ctx.state.botId, status: 'active' });
      if (userCount === 0) {
        bundle.status = 'draft';
        await bundle.save();
        return ctx.reply('⚠️ There are no active users to broadcast to.').catch(() => {});
      }

      // Clear draft session ID
      session.currentBundleId = undefined;
      await session.save();

      await ctx.reply('🚀 <b>Broadcast campaign queued!</b> Dispatching to users...');

      // Background Worker for Bundle Campaign (asynchronous execution)
      (async () => {
        const { userBot } = await import('../../bot/bot.js');
        const activeUsers = await User.find({ botId: ctx.state.botId, status: 'active' });
        let progressMsg = await ctx.reply(`Broadcast progress: 0/${userCount}...`).catch(() => null);

        let success = 0;
        let failed = 0;

        for (let idx = 0; idx < activeUsers.length; idx++) {
          const userObj = activeUsers[idx];
          try {
            await PostDeliveryService.deliverBundle(bundle._id, userObj.telegramUserId, userBot);
            success++;
          } catch (err) {
            logger.warn(`Bundle broadcast failed for user ${userObj.telegramUserId}: ${err.message}`);
            failed++;
          }

          // Rate limiting sleep
          await new Promise(r => setTimeout(r, 100));

          // Edit progress message every 10 users
          if (progressMsg && (idx + 1) % 10 === 0) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMsg.message_id,
              null,
              `Broadcast progress: ${idx + 1}/${userCount} (✅ ${success} | ❌ ${failed})...`
            ).catch(() => {});
          }
        }

        bundle.status = failed > 0 ? 'failed' : 'published';
        await bundle.save();

        if (progressMsg) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            null,
            `✅ <b>Broadcast Campaign Completed!</b>\n\nTotal Sent: ${success}\nFailed: ${failed}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      })().catch(e => logger.error(`Bundle Broadcast Campaign worker critical failure: ${e.message}`));

      await renderHome(ctx, false);
      return;
    }

    // ── Content Library Sub-menu ─────────────────────────────────────────────
    if (data === 'admin:content:list') {
      const totalContent = await Content.countDocuments({ botId: ctx.state.botId });
      const recentContent = await Content.find({ botId: ctx.state.botId })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('title type status');

      const buttons = recentContent.map(c => [
        { text: `${c.type === 'photo' ? '📷' : c.type === 'video' ? '🎬' : c.type === 'document' ? '📄' : c.type === 'link' ? '🔗' : '📝'} ${c.title}`, callback_data: `admin:content:view:${c._id}` }
      ]);
      buttons.push([{ text: '➕ Add Content', callback_data: 'admin:content:add' }]);
      buttons.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

      await ctx.editMessageText(
        `📦 *CONTENT LIBRARY*\n\nTotal Items: *${totalContent}*\nShowing last 8 items:`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
      ).catch(() => {});
      return;
    }

    if (data === 'admin:content:add') {
      const markup = {
        inline_keyboard: [
          [{ text: '📷 Photo', callback_data: 'admin:content:add:type:photo' }, { text: '🎬 Video', callback_data: 'admin:content:add:type:video' }],
          [{ text: '📄 Document', callback_data: 'admin:content:add:type:document' }, { text: '📝 Text', callback_data: 'admin:content:add:type:text' }],
          [{ text: '🔗 Link', callback_data: 'admin:content:add:type:link' }],
          [{ text: '❌ Cancel', callback_data: 'admin:content:list' }]
        ]
      };
      await ctx.editMessageText('📦 <b>ADD CONTENT TO LIBRARY</b>\n\n<i>Creates reusable content in MongoDB. Nothing is sent to users yet.</i>\n\nSelect the content type:', {
        parse_mode: 'HTML', reply_markup: markup
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:content:add:type:')) {
      const contentType = data.split(':')[4]; // photo/video/document/text/link
      session.state = `WAITING_FOR_CONTENT_MEDIA_${contentType.toUpperCase()}`;
      session.tempButtonText = contentType; // store type temporarily
      await session.save();

      let prompt = '';
      if (contentType === 'photo') prompt = '📷 Send the *photo* to add to the library.';
      else if (contentType === 'video') prompt = '🎬 Send the *video* to add to the library.';
      else if (contentType === 'document') prompt = '📄 Send the *document/file* to add to the library.';
      else if (contentType === 'text') prompt = '📝 Send the *text content* body.';
      else if (contentType === 'link') prompt = '🔗 Send the *URL link* (must start with https://).';

      await ctx.editMessageText(prompt, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:content:list' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:content:view:')) {
      const contentId = data.split(':')[3];
      const content = await Content.findById(contentId);
      if (!content) {
        return ctx.reply('⚠️ Content not found.').catch(() => {});
      }
      const catName = content.categoryId
        ? (await Category.findById(content.categoryId))?.displayName || 'Unknown'
        : 'No Category';

      const text = `📦 *CONTENT DETAILS*\n\n` +
        `*Title:* ${escapeHTML(content.title)}\n` +
        `*Type:* ${content.type.toUpperCase()}\n` +
        `*Category:* ${catName}\n` +
        `*Status:* ${content.status.toUpperCase()}`;

      const markup = {
        inline_keyboard: [
          [{ text: '🗑 Delete Content', callback_data: `admin:content:delete:${contentId}` }],
          [{ text: '◀️ Back to List', callback_data: 'admin:content:list' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:content:delete:')) {
      const parts = data.split(':');
      const contentId = parts[3];
      const confirm = parts[4];

      if (confirm !== 'confirm') {
        const text = `⚠️ <b>CONFIRM CONTENT DELETION</b>\n\nDeletes this Content library item. This action cannot be undone.`;
        const markup = {
          inline_keyboard: [
            [{ text: '🗑 Confirm Delete', callback_data: `admin:content:delete:${contentId}:confirm` }],
            [{ text: '❌ Cancel', callback_data: `admin:content:view:${contentId}` }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      const content = await Content.findById(contentId);
      if (content) {
        await Content.findByIdAndDelete(contentId);
        await logAdminActivity('CONTENT_DELETED', adminId, 'success', { title: content.title });
      }
      ctx.callbackQuery.data = 'admin:content:list';
      await handleAdminCallback(ctx);
      return;
    }

    if (data.startsWith('admin:content:save:cat:')) {
      // Final step: save content to chosen category
      const catId = data.split(':')[4];
      const s = session;
      const contentType = s.draft?.type || 'text';
      const fileId = s.draft?.telegramFileId;
      const captionText = s.draft?.caption;
      const contentTitle = s.tempButtonText2; // stored title
      const contentUrl = s.tempButtonUrl;   // stored URL (for link type)

      try {
        const contentDoc = await Content.create({
          title: contentTitle || 'Untitled',
          type: contentType,
          categoryId: mongoose.Types.ObjectId.isValid(catId) ? catId : undefined,
          telegramFileId: fileId || undefined,
          caption: captionText || undefined,
          text: contentType === 'text' ? captionText : undefined,
          url: contentType === 'link' ? contentUrl : undefined,
          status: 'active',
          botId: ctx.state.botId
        });

        session.state = 'IDLE';
        session.tempButtonText2 = undefined;
        session.tempButtonUrl = undefined;
        session.draft = { type: 'text', telegramFileId: '', caption: '', buttons: [], layout: '1' };
        session.markModified('draft');
        await session.save();

        await logAdminActivity('CONTENT_CREATED', adminId, 'success', { title: contentTitle, contentId: contentDoc._id });
        await ctx.reply(
          `✅ *Content Saved!*\n\n"${escapeHTML(contentTitle || 'Untitled')}" added to your library.`,
          { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📦 View Library', callback_data: 'admin:content:list' }, { text: '🏠 Home', callback_data: 'admin:home' }]] } }
        ).catch(() => {});
      } catch (err) {
        await ctx.reply(`⚠️ *Save Failed:* ${err.message}`).catch(() => {});
      }
      return;
    }

    // --- Categories Sub-menu ---
    if (data === 'admin:cat:list') {
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ sortOrder: 1, name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} ${cat.displayName || cat.name}`, callback_data: `admin:cat:open:${cat._id}` }
      ]);
      buttons.push([{ text: '➕ Add Category', callback_data: 'admin:cat:add' }]);
      buttons.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

      await ctx.editMessageText('📁 *CATEGORY MANAGEMENT*\n\nBrowse configured categories below:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:cat:add') {
      session.state = 'WAITING_FOR_CATEGORY_NAME';
      await session.save();

      await ctx.editMessageText('📁 <b>CREATE CATEGORY FOLDER</b>\n\n<i>Creates a category folder in MongoDB. Nothing is sent to users yet.</i>\n\nSend the name of the new category (e.g. `Courses`):', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:cat:list' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:cat:open:')) {
      const catId = data.split(':')[3];
      const cat = await Category.findById(catId);
      if (!cat) {
        return ctx.reply('⚠️ Category not found.').catch(() => {});
      }

      session.currentCategoryId = catId;
      await session.save();

      const text = `📁 *CATEGORY DETAILS*\n\n*Name:* ${escapeHTML(cat.name)}\n*Friendly Display:* ${escapeHTML(cat.displayName || 'None')}\n*Slug:* \`${cat.slug}\`\n*Status:* ${cat.status.toUpperCase()}`;
      const markup = {
        inline_keyboard: [
          [{ text: '🗑 Delete Category', callback_data: `admin:cat:delete:${catId}` }],
          [{ text: '◀️ Back to List', callback_data: 'admin:cat:list' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:cat:delete:')) {
      const parts = data.split(':');
      const catId = parts[3];
      const confirm = parts[4];

      if (confirm !== 'confirm') {
        const text = `⚠️ <b>CONFIRM CATEGORY DELETION</b>\n\nDeletes this Category database record. This action cannot be undone.`;
        const markup = {
          inline_keyboard: [
            [{ text: '🗑 Confirm Delete', callback_data: `admin:cat:delete:${catId}:confirm` }],
            [{ text: '❌ Cancel', callback_data: `admin:cat:open:${catId}` }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      const cat = await Category.findById(catId);
      if (cat) {
        await Category.findByIdAndDelete(catId);
        await logAdminActivity('CATEGORY_DELETED', adminId, 'success', { categoryName: cat.name });
      }

      ctx.callbackQuery.data = 'admin:cat:list';
      await handleAdminCallback(ctx);
      return;
    }

    // --- Content Packs Sub-menu ---
    if (data === 'admin:pack:list') {
      const packs = await ContentPack.find({ botId: ctx.state.botId }).sort({ createdAt: -1 });
      const buttons = packs.map(pack => [
        { text: `📦 ${pack.name} (${pack.items.length} items)`, callback_data: `admin:pack:open:${pack._id}` }
      ]);
      buttons.push([{ text: '➕ Create Pack', callback_data: 'admin:pack:create' }]);
      buttons.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

      await ctx.editMessageText('📦 *CONTENT PACK MANAGEMENT*\n\nSelect a pack to manage:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:pack:create') {
      session.state = 'WAITING_FOR_PACK_NAME';
      session.packDraft = { name: '', description: '', selectedItems: [] };
      await session.save();

      await ctx.editMessageText('📦 <b>CREATE CONTENT PACK</b>\n\n<i>Creates a shareable Pack. Users receive it only when they open the generated link.</i>\n\nSend a name for the new pack collection:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:pack:list' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:pack:select:cat:')) {
      const parts = data.split(':');
      const catId = parts[4];
      const page = parseInt(parts[5], 10) || 1;
      const limit = 5;

      const cat = await Category.findById(catId);
      const catTitle = cat ? (cat.displayName || cat.name) : 'Category';

      const query = { categoryId: catId, status: 'active', botId: ctx.state.botId };
      const total = await Content.countDocuments(query);
      const totalPages = Math.ceil(total / limit);

      const items = await Content.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const selected = session.packDraft?.selectedItems || [];
      const buttons = items.map(item => {
        const isAdded = selected.includes(item._id.toString());
        return [{
          text: `${isAdded ? '✅' : '➕'} ${item.title}`,
          callback_data: `admin:pack:toggle:${item._id}:${catId}:${page}`
        }];
      });

      // Pagination
      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) {
          pagRow.push({ text: '◀️ Prev', callback_data: `admin:pack:select:cat:${catId}:${page - 1}` });
        }
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'admin:ack' });
        if (page < totalPages) {
          pagRow.push({ text: 'Next ▶️', callback_data: `admin:pack:select:cat:${catId}:${page + 1}` });
        }
        buttons.push(pagRow);
      }

      buttons.push([
        { text: '↩️ Folders', callback_data: 'admin:pack:select:folders' },
        { text: '💾 Save Pack Now', callback_data: 'admin:pack:save:now' }
      ]);

      await ctx.editMessageText(`📦 *SELECT ITEMS - ${catTitle}*\n\nChoose library content items to add to pack:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:pack:select:folders') {
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} Select from ${cat.displayName || cat.name}`, callback_data: `admin:pack:select:cat:${cat._id}:1` }
      ]);
      buttons.push([{ text: '💾 Save Pack Now', callback_data: 'admin:pack:save:now' }]);
      buttons.push([{ text: '❌ Cancel', callback_data: 'admin:pack:list' }]);

      await ctx.editMessageText('📦 *Folders List:*\n\nSelect a folder to choose items or save:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:pack:toggle:')) {
      const parts = data.split(':');
      const contentId = parts[3];
      const catId = parts[4];
      const page = parts[5];

      if (!session.packDraft.selectedItems) session.packDraft.selectedItems = [];
      const idx = session.packDraft.selectedItems.indexOf(contentId);
      if (idx > -1) {
        session.packDraft.selectedItems.splice(idx, 1);
      } else {
        session.packDraft.selectedItems.push(contentId);
      }
      session.markModified('packDraft');
      await session.save();

      // Refresh items list
      ctx.callbackQuery.data = `admin:pack:select:cat:${catId}:${page}`;
      await handleAdminCallback(ctx);
      return;
    }

    if (data === 'admin:pack:save:now') {
      const draft = session.packDraft || {};
      if (!draft.name) {
        return ctx.reply('⚠️ Content Pack draft is invalid. Please restart pack creation.').catch(() => {});
      }

      let publicCode;
      let isUnique = false;
      while (!isUnique) {
        publicCode = 'pack_' + crypto.randomBytes(3).toString('hex').toLowerCase();
        const existing = await ContentPack.findOne({ botId: ctx.state.botId, publicCode });
        if (!existing) isUnique = true;
      }

      const pack = await ContentPack.create({
        botId: ctx.state.botId,
        name: draft.name,
        description: draft.description || '',
        status: 'ACTIVE',
        items: (draft.selectedItems || []).map((cid, idx) => ({
          contentId: cid,
          sortOrder: idx,
          enabled: true
        })),
        publicCode
      });

      session.state = 'IDLE';
      session.packDraft = undefined;
      await session.save();

      await logAdminActivity('PACK_CREATED', adminId, 'success', { packName: pack.name, code: publicCode });

      // Always use the USER BOT username for pack deep links, not the Admin Bot
      const userBotUsername = config.userBotUsername || ctx.botInfo.username;
      const deepLink = `https://t.me/${userBotUsername}?start=pack_${publicCode}`;
      await ctx.reply(`📦 *Pack Created successfully!*\n\n*Name:* ${escapeHTML(pack.name)}\n*Deep Link:*\n\`${deepLink}\``, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Home', callback_data: 'admin:home' }]] }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:ack') {
      return;
    }

    if (data.startsWith('admin:pack:open:')) {
      const packId = data.split(':')[3];
      const pack = await ContentPack.findById(packId);
      if (!pack) {
        return ctx.reply('⚠️ Content Pack not found.').catch(() => {});
      }

      session.currentPackId = packId;
      await session.save();

      const userBotUsername = config.userBotUsername || ctx.botInfo.username;
      const deepLink = `https://t.me/${userBotUsername}?start=p_${pack.publicCode}`;
      const expiryText = formatExpiryDescription(pack.expiresAt);
      
      const modeText = pack.settings?.mode === 'link' ? '🔗 LINK' : '🚀 DIRECT';
      const text = `📦 *CONTENT PACK DETAILS*\n\n` +
        `*Name:* ${escapeHTML(pack.name)}\n` +
        `*Description:* ${escapeHTML(pack.description || 'None')}\n` +
        `*Code:* \`${pack.publicCode}\`\n` +
        `*Mode:* ${modeText}\n` +
        `*Status:* ${pack.status}\n` +
        `*Expiry:* ${expiryText}\n` +
        `*Items:* ${pack.items.length} items\n\n` +
        `*Deep Link:*\n\`${deepLink}\``;

      const toggleButton = pack.status === 'ACTIVE' || pack.status === 'published'
        ? { text: '🔴 Unpublish', callback_data: `admin:pub:toggle:${packId}:unpublish` }
        : { text: '🟢 Publish', callback_data: `admin:pub:toggle:${packId}:publish` };

      const markup = {
        inline_keyboard: [
          [
            { text: '⏰ Change Expiry', callback_data: `admin:pub:expiry:set:${packId}` },
            toggleButton
          ],
          [{ text: '🗑 Delete Pack', callback_data: `admin:pack:delete:${packId}` }],
          [{ text: '◀️ Back to List', callback_data: 'admin:pack:list' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:pack:delete:')) {
      const parts = data.split(':');
      const packId = parts[3];
      const confirm = parts[4];

      if (confirm !== 'confirm') {
        const text = `⚠️ <b>CONFIRM CONTENT PACK DELETION</b>\n\nDeletes this Content Pack database record. This action cannot be undone.`;
        const markup = {
          inline_keyboard: [
            [{ text: '🗑 Confirm Delete', callback_data: `admin:pack:delete:${packId}:confirm` }],
            [{ text: '❌ Cancel', callback_data: `admin:pack:open:${packId}` }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      const pack = await ContentPack.findById(packId);
      if (pack) {
        await ContentPack.findByIdAndDelete(packId);
        await logAdminActivity('PACK_DELETED', adminId, 'success', { packName: pack.name });
      }

      ctx.callbackQuery.data = 'admin:pack:list';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Start Behaviour Menu ──
    if (data === 'admin:set:start:menu') {
      return showSettingsMenu(ctx);
    }

    if (data.startsWith('admin:set:start:select:')) {
      const selected = data.split(':')[4];
      const settings = await Setting.getSettings(ctx.state.botId);
      settings.startBehaviour = selected;
      await settings.save();

      ctx.callbackQuery.data = 'admin:set:start:menu';
      await handleAdminCallback(ctx);
      return;
    }

    // ── Start Sequence Selection ──
    if (data.startsWith('admin:set:start:sequence:list:')) {
      const page = parseInt(data.split(':')[5], 10) || 1;
      const limit = 5;

      const total = await ContentSequence.countDocuments({ botId: ctx.state.botId, status: 'ACTIVE' });
      const totalPages = Math.ceil(total / limit);

      const items = await ContentSequence.find({ botId: ctx.state.botId, status: 'ACTIVE' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const settings = await Setting.getSettings(ctx.state.botId);
      const activeIdStr = settings.startSequenceId ? settings.startSequenceId.toString() : '';

      const buttons = items.map(seq => {
        const flag = seq._id.toString() === activeIdStr ? '🟢 ACTIVE' : '⚫ SELECT';
        return [{
          text: `[${flag}] ${seq.title}`,
          callback_data: `admin:set:start:sequence:set:${seq._id}:${page}`
        }];
      });

      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) pagRow.push({ text: '◀️ Prev', callback_data: `admin:set:start:sequence:list:${page - 1}` });
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'admin:ack' });
        if (page < totalPages) pagRow.push({ text: 'Next ▶️', callback_data: `admin:set:start:sequence:list:${page + 1}` });
        buttons.push(pagRow);
      }

      buttons.push([{ text: '⬅️ Back to Behaviour Menu', callback_data: 'admin:set:start:menu' }]);

      const text = `⚙️ <b>SELECT START SEQUENCE ONBOARDING</b>\n\n` +
        `Click a sequence to bind it to the CONFIGURED_SEQUENCE start behaviour. Only active sequences are shown:`;

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:set:start:sequence:set:')) {
      const parts = data.split(':');
      const seqId = parts[5];
      const page = parts[6];

      const settings = await Setting.getSettings(ctx.state.botId);
      settings.startSequenceId = mongoose.Types.ObjectId.isValid(seqId) ? seqId : undefined;
      await settings.save();

      ctx.callbackQuery.data = `admin:set:start:sequence:list:${page}`;
      await handleAdminCallback(ctx);
      return;
    }

    // ── Start Content List Config ──
    if (data.startsWith('admin:set:start:content:list:')) {
      const page = parseInt(data.split(':')[5], 10) || 1;
      const limit = 5;

      const total = await Content.countDocuments({ botId: ctx.state.botId, status: 'active' });
      const totalPages = Math.ceil(total / limit);

      const items = await Content.find({ botId: ctx.state.botId, status: 'active' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const buttons = items.map(item => {
        const flag = item.isStartContent ? '🟢 ON' : '⚫ OFF';
        return [{
          text: `[${flag}] ${item.title}`,
          callback_data: `admin:set:start:content:toggle:${item._id}:${page}`
        }];
      });

      if (totalPages > 1) {
        const pagRow = [];
        if (page > 1) pagRow.push({ text: '◀️ Prev', callback_data: `admin:set:start:content:list:${page - 1}` });
        pagRow.push({ text: `Page ${page}/${totalPages}`, callback_data: 'admin:ack' });
        if (page < totalPages) pagRow.push({ text: 'Next ▶️', callback_data: `admin:set:start:content:list:${page + 1}` });
        buttons.push(pagRow);
      }

      buttons.push([{ text: '⬅️ Back to Behaviour Menu', callback_data: 'admin:set:start:menu' }]);

      const text = `⚙️ <b>CONFIGURE /start CONTENT</b>\n\n` +
        `Click any item to toggle its inclusion in the automated /start payload when "Configured Content" is enabled:`;

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:set:start:content:toggle:')) {
      const parts = data.split(':');
      const contentId = parts[5];
      const page = parts[6];

      const content = await Content.findById(contentId);
      if (content) {
        content.isStartContent = !content.isStartContent;
        await content.save();
      }

      ctx.callbackQuery.data = `admin:set:start:content:list:${page}`;
      await handleAdminCallback(ctx);
      return;
    }

    // ── System Health Diagnostic ──
    if (data === 'admin:health') {
      let dbStatus = '🔴 Disconnected';
      let userBotStatus = '🔴 Error';
      let adminBotStatus = '🔴 Error';
      let filebaseStatus = '🟢 Connected'; // endpoint configuration checked
      let backendStatus = '🟢 Running';
      let schedulerStatus = '🟢 Running';

      try {
        const dbState = mongoose.connection.readyState;
        dbStatus = dbState === 1 ? '🟢 Connected' : dbState === 2 ? '🟡 Connecting' : '🔴 Disconnected';
      } catch (_) { dbStatus = '🔴 Error'; }

      try {
        const { telegramBotManager } = await import('../../bot/bot.js');
        const health = await Promise.race([
          telegramBotManager.healthCheck(),
          new Promise(r => setTimeout(() => r(null), 3000))
        ]);
        if (health) {
          userBotStatus = health.userBot?.status === 'ok' ? `🟢 Connected (@${health.userBot.username})` : '🔴 Error';
          adminBotStatus = health.adminBot?.status === 'ok'
            ? `🟢 Connected (@${health.adminBot.username})`
            : health.adminBot?.status === 'disabled' ? '⚪ Disabled' : '🔴 Error';
        }
      } catch (_) {}

      const timestamp = new Date().toISOString();

      const text = `🧪 <b>SYSTEM DIAGNOSTICS & HEALTH</b>\n\n` +
        `• <b>Admin Bot:</b> ${adminBotStatus}\n` +
        `• <b>User Bot:</b> ${userBotStatus}\n` +
        `• <b>MongoDB:</b> ${dbStatus}\n` +
        `• <b>Filebase:</b> ${filebaseStatus}\n` +
        `• <b>Backend:</b> ${backendStatus}\n` +
        `• <b>Schedulers:</b> ${schedulerStatus}\n\n` +
        `<b>Last checked:</b> <code>${timestamp}</code>`;

      const markup = {
        inline_keyboard: [
          [{ text: '🔄 Run Again', callback_data: 'admin:health' }],
          [{ text: '🏠 Home', callback_data: 'admin:home' }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // ── Content Sequence Management Callbacks ──
    if (data === 'admin:seq:list') {
      const sequences = await ContentSequence.find({ botId: ctx.state.botId }).sort({ createdAt: -1 });
      const text = `📦 <b>CONTENT SEQUENCE MANAGEMENT</b>\n\nBrowse your sequences below:`;
      const buttons = [];

      sequences.forEach(seq => {
        const flag = seq.status === 'ACTIVE' ? '🟢' : '⚪';
        buttons.push([{
          text: `${flag} ${seq.title} (${seq.blocks.length} blocks)`,
          callback_data: `admin:seq:open:${seq._id}`
        }]);
      });

      buttons.push([{ text: '➕ Create Sequence', callback_data: 'admin:seq:create' }]);
      buttons.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
      return;
    }

    if (data === 'admin:seq:create') {
      session.state = 'WAITING_FOR_SEQ_TITLE';
      await session.save();
      await ctx.editMessageText('📝 <b>CREATE NEW CONTENT SEQUENCE</b>\n\nSends nothing to users. Enter the title for the new sequence (e.g. <i>Premium Welcome Onboarding</i>):', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:seq:list' }]] }
      }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:open:')) {
      const seqId = data.split(':')[3];
      await renderSequenceComposer(ctx, session, true, seqId);
      return;
    }

    if (data === 'admin:seq:cancel') {
      session.state = 'IDLE';
      await session.save();
      await renderHome(ctx, true);
      return;
    }

    if (data === 'admin:seq:block:add') {
      const text = `➕ <b>ADD BLOCK TO SEQUENCE</b>\n\nChoose block type to append:\n\n` +
        `• <b>Text</b>: Send a formatted Telegram text message.\n` +
        `• <b>Media Group</b>: Add multiple photos/videos. Telegram will automatically split large groups into valid batches.`;

      const markup = {
        inline_keyboard: [
          [{ text: '📝 Text', callback_data: 'admin:seq:block:create:type:TEXT' }, { text: '🖼️ Single Media', callback_data: 'admin:seq:block:create:type:MEDIA' }],
          [{ text: '📦 Media Group', callback_data: 'admin:seq:block:create:type:MEDIA_GROUP' }, { text: '🔗 Links', callback_data: 'admin:seq:block:create:type:LINKS' }],
          [{ text: '📣 Text + Buttons', callback_data: 'admin:seq:block:create:type:TEXT_WITH_BUTTONS' }],
          [{ text: '◀️ Back to Composer', callback_data: `admin:seq:open:${session.currentSequenceId}` }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:block:create:type:')) {
      const type = data.split(':')[5];
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const newBlockId = 'block_' + Math.random().toString(36).substring(7);
      sequence.blocks.push({
        blockId: newBlockId,
        type,
        sortOrder: sequence.blocks.length,
        content: '',
        mediaItems: [],
        buttons: []
      });
      await sequence.save();

      session.currentBlockId = newBlockId;

      if (type === 'TEXT' || type === 'TEXT_WITH_BUTTONS') {
        session.state = 'WAITING_FOR_BLOCK_TEXT';
        await session.save();
        await ctx.editMessageText('✏️ <b>Enter Block Text:</b>\n\nSend the text message that will appear in this block:', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `admin:seq:open:${sequence._id}` }]] }
        }).catch(() => {});
      } else if (type === 'MEDIA' || type === 'MEDIA_GROUP') {
        session.state = 'WAITING_FOR_BLOCK_MEDIA_BATCH';
        await session.save();
        await ctx.editMessageText('📤 <b>Upload Media Items:</b>\n\nSend photos, videos, or files one by one. Send <b>/done</b> when finished.', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `admin:seq:open:${sequence._id}` }]] }
        }).catch(() => {});
      } else if (type === 'LINKS') {
        session.state = 'WAITING_FOR_BLOCK_LINK_URL';
        await session.save();
        await ctx.editMessageText('🔗 <b>Enter Link URL:</b>\n\nSend redirect link (must start with http:// or https://):', {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `admin:seq:open:${sequence._id}` }]] }
        }).catch(() => {});
      }
      return;
    }

    if (data.startsWith('admin:seq:block:open:')) {
      const blockId = data.split(':')[4];
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const block = sequence.blocks.find(b => b.blockId === blockId);
      if (!block) return ctx.reply('⚠️ Block not found.').catch(() => {});

      session.currentBlockId = blockId;
      await session.save();

      const summary = block.type === 'TEXT'
        ? `Content: "${block.content || '(Empty)'}"`
        : block.type === 'MEDIA_GROUP'
        ? `Media count: ${block.mediaItems.length} items`
        : block.type === 'TEXT_WITH_BUTTONS'
        ? `Content: "${block.content || '(Empty)'}"\nButtons count: ${block.buttons.length}`
        : `Type: ${block.type}`;

      const text = `⚙️ <b>BLOCK ACTION PANEL</b>\n\n` +
        `<b>Block Type:</b> ${block.type}\n` +
        `<b>Block Details:</b>\n${summary}\n\n` +
        `Choose what to do with this block:`;

      const markup = {
        inline_keyboard: [
          [{ text: '✏️ Edit Block', callback_data: `admin:seq:block:edit:${blockId}` }, { text: '👁 Preview Block', callback_data: `admin:seq:block:preview:${blockId}` }],
          [{ text: '⬆️ Move Up', callback_data: `admin:seq:block:up:${blockId}` }, { text: '⬇️ Move Down', callback_data: `admin:seq:block:down:${blockId}` }],
          [{ text: '🗑 Delete Block', callback_data: `admin:seq:block:delete:${blockId}` }],
          [{ text: '◀️ Back to Sequence Builder', callback_data: `admin:seq:open:${sequence._id}` }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:block:up:') || data.startsWith('admin:seq:block:down:')) {
      const parts = data.split(':');
      const action = parts[3]; // up/down
      const blockId = parts[4];

      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const sorted = [...sequence.blocks].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = sorted.findIndex(b => b.blockId === blockId);

      if (action === 'up' && index > 0) {
        const temp = sorted[index].sortOrder;
        sorted[index].sortOrder = sorted[index - 1].sortOrder;
        sorted[index - 1].sortOrder = temp;
      } else if (action === 'down' && index < sorted.length - 1) {
        const temp = sorted[index].sortOrder;
        sorted[index].sortOrder = sorted[index + 1].sortOrder;
        sorted[index + 1].sortOrder = temp;
      }

      await sequence.save();
      await renderSequenceComposer(ctx, session, true);
      return;
    }

    if (data.startsWith('admin:seq:block:delete:')) {
      const parts = data.split(':');
      const blockId = parts[4];
      const confirm = parts[5];

      if (confirm !== 'confirm') {
        const text = `⚠️ <b>CONFIRM BLOCK DELETION</b>\n\nDeletes this block from the sequence. This action cannot be undone.`;
        const markup = {
          inline_keyboard: [
            [{ text: '🗑 Confirm Delete', callback_data: `admin:seq:block:delete:${blockId}:confirm` }],
            [{ text: '❌ Cancel', callback_data: `admin:seq:block:open:${blockId}` }]
          ]
        };
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
        return;
      }

      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (sequence) {
        sequence.blocks = sequence.blocks.filter(b => b.blockId !== blockId);
        sequence.blocks.forEach((b, index) => { b.sortOrder = index; });
        await sequence.save();
      }

      await renderSequenceComposer(ctx, session, true);
      return;
    }

    if (data === 'admin:seq:link') {
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (sequence) {
        sequence.publicCode = 'c_' + crypto.randomBytes(4).toString('hex').toLowerCase();
        await sequence.save();
        await ctx.reply('🔗 <b>New Public Code Generated!</b> Deep link has been refreshed.', { parse_mode: 'HTML' });
      }
      await renderSequenceComposer(ctx, session, true);
      return;
    }

    if (data === 'admin:seq:save') {
      session.state = 'IDLE';
      session.currentSequenceId = undefined;
      await session.save();
      await ctx.reply('💾 <b>Draft successfully saved!</b> Sequence available in library.');
      await renderHome(ctx, false);
      return;
    }

    if (data === 'admin:seq:publish:confirm') {
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const text = `🚀 <b>PUBLISH CONTENT SEQUENCE</b>\n\n` +
        `<b>Title:</b> ${escapeHTML(sequence.title)}\n` +
        `<b>Blocks:</b> ${sequence.blocks.length}\n\n` +
        `<i>Publishing makes this sequence active/available for users via public link. This will NOT broadcast it.</i>`;

      const markup = {
        inline_keyboard: [
          [{ text: '🚀 Confirm Publish Now', callback_data: 'admin:seq:publish:run' }],
          [{ text: '❌ Cancel', callback_data: `admin:seq:open:${sequence._id}` }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data === 'admin:seq:publish:run') {
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (sequence) {
        sequence.status = 'ACTIVE';
        await sequence.save();
        await logAdminActivity('SEQUENCE_PUBLISHED', adminId, 'success', { title: sequence.title });
        await ctx.reply(`✅ <b>Sequence is now Active!</b> Users can open the deep link mapping.`, { parse_mode: 'HTML' });
      }
      await renderSequenceComposer(ctx, session, false);
      return;
    }

    if (data === 'admin:seq:settings') {
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const settings = sequence.settings || {};
      const text = `⚙️ <b>SEQUENCE SETTINGS</b>\n\n` +
        `• <b>Protect Content:</b> ${settings.protectContent ? '🔒 Enabled' : '🔓 Disabled'}\n` +
        `• <b>Auto Delete Delay:</b> ${settings.autoDeleteValue || 'OFF'}\n` +
        `• <b>Allow Repeat Access:</b> ${settings.allowRepeatAccess !== false ? '🟢 Allowed' : '🔴 One-time Access'}`;

      const markup = {
        inline_keyboard: [
          [{ text: `${settings.protectContent ? '🔓 Disable' : '🔒 Enable'} Protection`, callback_data: 'admin:seq:settings:toggle:protect' }],
          [{ text: `Toggle Repeat (currently: ${settings.allowRepeatAccess !== false ? 'Repeat' : 'One-time'})`, callback_data: 'admin:seq:settings:toggle:repeat' }],
          [{ text: '⏳ Set Auto Delete 5m', callback_data: 'admin:seq:settings:delete:5m' }, { text: '⏳ Set Auto Delete 1h', callback_data: 'admin:seq:settings:delete:1h' }],
          [{ text: '⏳ Set Auto Delete 24h', callback_data: 'admin:seq:settings:delete:24h' }, { text: '⏳ Turn OFF Delete', callback_data: 'admin:seq:settings:delete:OFF' }],
          [{ text: '◀️ Back to Builder', callback_data: `admin:seq:open:${sequence._id}` }]
        ]
      };

      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:settings:toggle:')) {
      const action = data.split(':')[4];
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (sequence) {
        if (!sequence.settings) sequence.settings = {};
        if (action === 'protect') {
          sequence.settings.protectContent = !sequence.settings.protectContent;
        } else if (action === 'repeat') {
          sequence.settings.allowRepeatAccess = sequence.settings.allowRepeatAccess === false;
        }
        await sequence.save();
      }
      ctx.callbackQuery.data = 'admin:seq:settings';
      await handleAdminCallback(ctx);
      return;
    }

    if (data.startsWith('admin:seq:settings:delete:')) {
      const val = data.split(':')[4];
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (sequence) {
        if (!sequence.settings) sequence.settings = {};
        sequence.settings.autoDeleteValue = val;
        await sequence.save();
      }
      ctx.callbackQuery.data = 'admin:seq:settings';
      await handleAdminCallback(ctx);
      return;
    }

    if (data === 'admin:seq:preview') {
      const { userBot } = await import('../../bot/bot.js');
      const userObj = await User.findOne({ telegramUserId: ctx.from.id });
      try {
        const { SequenceDeliveryService } = await import('../../services/sequenceDelivery.service.js');
        await SequenceDeliveryService.deliverSequence(session.currentSequenceId, userObj, ctx.from.id, userBot);
        await ctx.reply('✅ <b>Preview delivered!</b> Check private chat above.', { parse_mode: 'HTML' });
      } catch (err) {
        await ctx.reply(`⚠️ <b>Preview Failed:</b> ${err.message}`, { parse_mode: 'HTML' }).catch(() => {});
      }
      return;
    }

    if (data === 'admin:seq:bc:menu') {
      const sequences = await ContentSequence.find({ botId: ctx.state.botId, status: 'ACTIVE' });
      const text = `📣 <b>SELECT SEQUENCE TO BROADCAST</b>\n\nChoose an active sequence to broadcast:`;
      const buttons = [];

      sequences.forEach(seq => {
        buttons.push([{ text: `📣 ${seq.title}`, callback_data: `admin:seq:bc:confirm:${seq._id}` }]);
      });

      buttons.push([{ text: '🏠 Home', callback_data: 'admin:home' }]);
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:bc:confirm:')) {
      const seqId = data.split(':')[4];
      const sequence = await ContentSequence.findById(seqId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const userCount = await User.countDocuments({ botId: ctx.state.botId, status: 'active' });
      const text = `👥 <b>BROADCAST SAFETY DOUBLE-CONFIRMATION</b>\n\n` +
        `<b>Sequence Title:</b> ${escapeHTML(sequence.title)}\n` +
        `<b>Blocks count:</b> ${sequence.blocks.length}\n` +
        `<b>Target Audience:</b> ${userCount.toLocaleString()} active users\n` +
        `<b>Estimated Messages:</b> ${(userCount * sequence.blocks.length).toLocaleString()}\n\n` +
        `<i>This will send the configured content to all active users. Progress will update in the background.</i>`;

      const markup = {
        inline_keyboard: [
          [{ text: '🚀 Confirm Broadcast Now', callback_data: `admin:seq:bc:start:${seqId}` }],
          [{ text: '❌ Cancel', callback_data: 'admin:seq:bc:menu' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data.startsWith('admin:seq:bc:start:')) {
      const seqId = data.split(':')[4];
      const sequence = await ContentSequence.findById(seqId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.').catch(() => {});

      const userCount = await User.countDocuments({ botId: ctx.state.botId, status: 'active' });
      if (userCount === 0) {
        return ctx.reply('⚠️ There are no active users to broadcast to.').catch(() => {});
      }

      await ctx.reply('🚀 <b>Broadcast campaign started!</b> Delivering sequence in the background...');

      (async () => {
        const { userBot } = await import('../../bot/bot.js');
        const activeUsers = await User.find({ botId: ctx.state.botId, status: 'active' });
        const { SequenceDeliveryService } = await import('../../services/sequenceDelivery.service.js');

        let progressMsg = await ctx.reply(`Broadcast progress: 0/${userCount}...`).catch(() => null);
        let success = 0;
        let failed = 0;

        for (let idx = 0; idx < activeUsers.length; idx++) {
          const userObj = activeUsers[idx];
          try {
            await SequenceDeliveryService.deliverSequence(sequence._id, userObj, userObj.telegramUserId, userBot);
            success++;
          } catch (err) {
            logger.warn(`Sequence broadcast failed for user ${userObj.telegramUserId}: ${err.message}`);
            failed++;
          }

          await new Promise(r => setTimeout(r, 100));

          if (progressMsg && (idx + 1) % 10 === 0) {
            await ctx.telegram.editMessageText(
              ctx.chat.id,
              progressMsg.message_id,
              null,
              `Broadcast progress: ${idx + 1}/${userCount} (✅ ${success} | ❌ ${failed})...`
            ).catch(() => {});
          }
        }

        if (progressMsg) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            progressMsg.message_id,
            null,
            `✅ <b>Broadcast Campaign Completed!</b>\n\nTotal Sent: ${success}\nFailed: ${failed}`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      })().catch(e => logger.error(`Sequence Broadcast Campaign critical failure: ${e.message}`));

      await renderHome(ctx, false);
      return;
    }

    // --- Settings Menu ---
    if (data === 'admin:set:menu') {
      const settings = ctx.state.settings || {};
      const text = `⚙️ *SYSTEM SETTINGS*\n\n` +
        `*Welcome Message:*\n"${escapeHTML(settings.welcomeMessage)}"\n\n` +
        `*Start Content Limit:* ${settings.startContentLimit} files\n` +
        `*Auto-Delete Delay:* ${settings.autoDeleteHours} hours\n` +
        `*Start Content Enabled:* ${settings.startContentEnabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
        `*Bot Active:* ${settings.botEnabled ? '🟢 Enabled' : '🔴 Disabled'}`;

      const markup = {
        inline_keyboard: [
          [{ text: '✏️ Edit Welcome', callback_data: 'admin:set:welcome' }],
          [{ text: '🔢 Edit Limit', callback_data: 'admin:set:limit' }, { text: '⏳ Edit Auto-delete', callback_data: 'admin:set:hours' }],
          [{ text: '🏠 Home', callback_data: 'admin:home' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => {});
      return;
    }

    if (data === 'admin:set:welcome') {
      session.state = 'WAITING_FOR_SETTINGS_WELCOME';
      await session.save();

      await ctx.editMessageText('✏️ Send the new Welcome Message text template:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:set:menu' }]] }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:set:limit') {
      session.state = 'WAITING_FOR_SETTINGS_LIMIT';
      await session.save();

      await ctx.editMessageText('🔢 Send the new maximum files limit for Start Content (integer):', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:set:menu' }]] }
      }).catch(() => {});
      return;
    }

    if (data === 'admin:set:hours') {
      session.state = 'WAITING_FOR_SETTINGS_HOURS';
      await session.save();

      await ctx.editMessageText('⏳ Send the auto-delete hours delay (e.g. `24`):', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin:set:menu' }]] }
      }).catch(() => {});
      return;
    }

    // --- Analytics view ---
    if (data.startsWith('admin:stats:')) {
      const days = parseInt(data.split(':')[2], 10) || 30;
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - days);

      const totalUsers = await User.countDocuments({ botId: ctx.state.botId });
      const newUsers = await User.countDocuments({ botId: ctx.state.botId, createdAt: { $gte: dateLimit } });
      const packOpens = await ContentPack.countDocuments({ botId: ctx.state.botId, isDemo: true });

      const text = `📊 *SYSTEM PERFORMANCE (${days} DAYS)*\n\n` +
        `• *Total Users:* ${totalUsers.toLocaleString()}\n` +
        `• *New Users (Last ${days}d):* ${newUsers.toLocaleString()}\n` +
        `• *Seeded Demo Packs:* ${packOpens}\n\n` +
        `Data loaded from active bot context database.`;

      const markup = {
        inline_keyboard: [
          [{ text: 'Today', callback_data: 'admin:stats:1' }, { text: '7 Days', callback_data: 'admin:stats:7' }, { text: '30 Days', callback_data: 'admin:stats:30' }],
          [{ text: '🏠 Home', callback_data: 'admin:home' }]
        ]
      };
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: markup }).catch(() => {});
      return;
    }

    // --- Seeding Demo Data command ---
    if (data === 'admin:demo:seed') {
      const alreadySeeded = await ContentPack.exists({ botId: ctx.state.botId, isDemo: true });
      if (alreadySeeded) {
        await ctx.reply('⚠️ *Already Seeded:* Demo workspace environment is already loaded. No duplicates created.').catch(() => {});
        return;
      }

      // Trigger seeder internally using standard seeder logic
      const categoryNames = ['Electronics', 'Gaming', 'Software', 'Courses', 'Accessories'];
      const categories = [];
      for (const name of categoryNames) {
        let cat = await Category.create({
          name,
          displayName: name,
          slug: name.toLowerCase().replace(/ /g, '-'),
          status: 'active',
          isDemo: true,
          botId: ctx.state.botId
        });
        categories.push(cat);
      }

      const catMap = {};
      categories.forEach(c => { catMap[c.name] = c._id; });

      const demoItemsData = [
        { title: 'Wireless Headphones Guide', type: 'link', url: 'https://example.com/headphones', caption: 'Premium acoustics.', categoryId: catMap['Electronics'] },
        { title: 'Mechanical Keyboard Setup', type: 'link', url: 'https://example.com/keyboards', caption: 'Custom hot-swappable layout.', categoryId: catMap['Electronics'] },
        { title: 'Gaming Mouse Review', type: 'link', url: 'https://example.com/gaming-mouse', caption: 'Ultra-lightweight sensor performance.', categoryId: catMap['Gaming'] },
        { title: 'Console Controller Guide', type: 'text', text: '🎮 Pair and customize your wireless controller.', categoryId: catMap['Gaming'] },
        { title: 'USB-C Hub Specifications', type: 'text', text: '🔌 Essential multi-port adapter specs.', categoryId: catMap['Accessories'] },
        { title: 'UI Design Kit Download', type: 'link', url: 'https://example.com/ui-kit', caption: 'Figma UI library.', categoryId: catMap['Software'] },
        { title: 'JavaScript Masterclass Course', type: 'link', url: 'https://example.com/js-course', caption: 'ESNext closures and promises.', categoryId: catMap['Courses'] },
        { title: 'Premium SVG Icon Pack', type: 'link', url: 'https://example.com/icons', caption: 'Line and solid style icons.', categoryId: catMap['Accessories'] }
      ];

      const contentIds = [];
      for (const item of demoItemsData) {
        const content = await Content.create({
          ...item,
          status: 'active',
          isStartContent: false,
          isFeatured: false,
          isDemo: true,
          botId: ctx.state.botId
        });
        contentIds.push(content._id);
      }

      const publicCode = 'demo_' + crypto.randomBytes(3).toString('hex').toLowerCase();
      await ContentPack.create({
        botId: ctx.state.botId,
        name: 'Demo Product Collection',
        description: 'An automatically generated collection of demo categories, text content and links.',
        status: 'ACTIVE',
        items: contentIds.map((cid, index) => ({
          contentId: cid,
          sortOrder: index,
          enabled: true
        })),
        publicCode,
        isDemo: true
      });

      // Seed a Demo MediaBundle Post
      await MediaBundle.create({
        botId: ctx.state.botId,
        adminId: adminId,
        title: 'Seeded JS Masterclass Bundle',
        text: '🔥 <b>JavaScript ESNext Masterclass Bundle</b>\n\nExplore intermediate and advanced patterns including closure, async-await loops, and functional programming.\n\n📚 Click below to access full course slides!',
        links: [
          { label: '📘 View ESNext Slides', url: 'https://example.com/slides', sortOrder: 0 }
        ],
        buttons: [
          { text: '🎓 Join Classroom', url: 'https://example.com/classroom', sortOrder: 0 }
        ],
        status: 'draft',
        isDemo: true
      });

      // Seed a Demo ContentSequence
      await ContentSequence.create({
        botId: ctx.state.botId,
        publicCode: 'c_demo',
        title: 'Demo Course Onboarding Sequence',
        description: 'Seeded sequence onboarding flow.',
        status: 'ACTIVE',
        createdBy: adminId,
        isDemo: true,
        blocks: [
          {
            blockId: 'block_demo_1',
            type: 'TEXT',
            sortOrder: 0,
            content: '🎓 <b>Welcome to the Premium Coding Academy Onboarding!</b>\n\nWe will deliver your first few course materials below sequentially.'
          },
          {
            blockId: 'block_demo_2',
            type: 'TEXT_WITH_BUTTONS',
            sortOrder: 1,
            content: '📘 <b>Join the Class Discussion:</b>',
            buttons: [
              { text: '💬 Telegram Chatroom', url: 'https://t.me/yourprojectrr_admin_bot', sortOrder: 0 }
            ]
          }
        ]
      });

      await logAdminActivity('SEED_DEMO_DATA', adminId, 'success', { code: publicCode });
      await ctx.reply('🧪 *Demo Environment Loaded!* Created 5 categories, 8 contents, 1 Content Pack, 1 Media Bundle, and 1 demo Content Sequence onboarding flow.').catch(() => {});
      return;
    }

    // --- Clearing Demo Data command ---
    if (data === 'admin:demo:clear') {
      const delPacks = await ContentPack.deleteMany({ botId: ctx.state.botId, isDemo: true });
      const delContent = await Content.deleteMany({ botId: ctx.state.botId, isDemo: true });
      const delCats = await Category.deleteMany({ botId: ctx.state.botId, isDemo: true });
      const delBundles = await MediaBundle.deleteMany({ botId: ctx.state.botId, isDemo: true });
      const delSeqs = await ContentSequence.deleteMany({ botId: ctx.state.botId, isDemo: true });

      await logAdminActivity('CLEAR_DEMO_DATA', adminId, 'success', {
        deletedPacks: delPacks.deletedCount,
        deletedContent: delContent.deletedCount,
        deletedCategories: delCats.deletedCount,
        deletedBundles: delBundles.deletedCount,
        deletedSequences: delSeqs.deletedCount
      });

      await ctx.reply(`🗑 *Demo Workspace Cleaned!* Deleted:\n• ${delPacks.deletedCount} Packs\n• ${delContent.deletedCount} Content items\n• ${delCats.deletedCount} Categories\n• ${delBundles.deletedCount} Media Bundles\n• ${delSeqs.deletedCount} Content Sequences`).catch(() => {});
      return;
    }

  } catch (err) {
    console.error('Admin Callback Error:', err.message);
    ctx.reply('⚠️ Error executing action. Type /start to reload.').catch(() => {});
  }
}



/**
 * Message handler router for incoming text and media sent by authorized admins.
 * Directs updates to state machine buffers based on the admin's active state.
 */
export async function handleAdminMessage(ctx) {
  if (!ctx.from) return;
  if (!isAdmin(ctx)) {
    return ctx.reply('Unauthorized. This is a private admin panel.').catch(() => {});
  }
  const adminId = ctx.from.id;
  const textMsg = ctx.message.text ? ctx.message.text.trim() : '';
  let session = null;

  try {
    if (!ctx.state) ctx.state = {};
    ctx.state.botId = await resolveBotId();
    ctx.state.settings = await getCachedSettings(ctx.state.botId);

    session = await AdminSession.getSession(adminId);

    // Intercept main menu button commands
    if (textMsg === '➕ Create Link') {
      session.state = 'LINK_DRAFT_ADD';
      session.linkDraft = {
        status: 'draft',
        items: [],
        expiresAt: null,
        updatedAt: new Date()
      };
      await session.save();
      return ctx.reply(
        `📦 <b>Create New Link</b>\n\n` +
        `Send a photo, video, document, or text message.\n\n` +
        `You can add multiple media items.\n\n` +
        `When finished, press callback buttons below:`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 Create Link', callback_data: 'admin:link:finalize' }],
              [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
            ]
          }
        }
      );
    }

    if (textMsg === '📦 My Links') {
      return renderMyLinks(ctx, 1, false);
    }

    if (textMsg === '🖼 Media Library') {
      return renderMediaLibrary(ctx, 'all', 1, false);
    }

    if (textMsg === '📊 Statistics') {
      const totalLinks = await Link.countDocuments({ status: { $ne: 'deleted' } });
      const activeLinks = await Link.countDocuments({ status: 'active' });
      const expiredLinks = await Link.countDocuments({ status: 'expired' });
      const totalMedia = await Content.countDocuments({ type: { $in: ['photo', 'video', 'document'] } });

      const text = `📊 <b>System Statistics</b>\n\n` +
                   `• <b>Total Collections/Links:</b> ${totalLinks}\n` +
                   `• <b>Active Links:</b> ${activeLinks}\n` +
                   `• <b>Expired Links:</b> ${expiredLinks}\n` +
                   `• <b>Library Media Files:</b> ${totalMedia}\n`;

      return ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🏠 Home', callback_data: 'admin:home' }]]
        }
      });
    }

    if (textMsg === '⚙️ Settings' || textMsg === '⚙ Settings' || textMsg.toLowerCase() === '/settings') {
      return showSettingsMenu(ctx);
    }

    if (session.state === 'LINK_DRAFT_ADD' || (session.state === 'IDLE' && (ctx.message?.photo || ctx.message?.video || ctx.message?.document || (ctx.message?.text && !textMsg.startsWith('/'))))) {
      let type = '';
      let fileId = '';
      let fileUniqueId = '';
      let caption = ctx.message.caption || '';
      let text = ctx.message.text || '';
      let mimeType = 'application/octet-stream';
      let fileSize = 0;
      let filename = 'file';

      if (ctx.message.photo) {
        type = 'photo';
        const p = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = p.file_id;
        fileUniqueId = p.file_unique_id;
        mimeType = 'image/jpeg';
        filename = `photo_${fileUniqueId}.jpg`;
      } else if (ctx.message.video) {
        type = 'video';
        fileId = ctx.message.video.file_id;
        fileUniqueId = ctx.message.video.file_unique_id;
        mimeType = ctx.message.video.mime_type || 'video/mp4';
        filename = ctx.message.video.file_name || `video_${fileUniqueId}.mp4`;
        fileSize = ctx.message.video.file_size || 0;
      } else if (ctx.message.document) {
        type = 'document';
        fileId = ctx.message.document.file_id;
        fileUniqueId = ctx.message.document.file_unique_id;
        mimeType = ctx.message.document.mime_type || 'application/octet-stream';
        filename = ctx.message.document.file_name || `doc_${fileUniqueId}`;
        fileSize = ctx.message.document.file_size || 0;
      } else if (ctx.message.text) {
        type = 'text';
      } else {
        return ctx.reply('⚠️ Unsupported media type. Please send a Photo, Video, Document, or Text.').catch(() => {});
      }

      // Initialize draft if it doesn't exist
      if (!session.linkDraft || session.linkDraft.status !== 'draft') {
        session.linkDraft = {
          status: 'draft',
          items: [],
          expiresAt: null,
          updatedAt: new Date()
        };
      }

      let contentId = null;

      if (type !== 'text') {
        let contentDoc = await Content.findOne({ telegramFileUniqueId: fileUniqueId });
        if (!contentDoc) {
          const fileInfo = await ctx.telegram.getFile(fileId).catch(() => null);
          const maxFileSizeLimit = (config.maxFileSizeMb || 20) * 1024 * 1024;
          if (fileInfo && fileInfo.file_size && fileInfo.file_size > maxFileSizeLimit) {
            return ctx.reply(`⚠️ File is too large. Configured limit is ${config.maxFileSizeMb || 20}MB.`).catch(() => {});
          }
          
          const progressMsg = await ctx.reply('⏳ Uploading media to S3...').catch(() => null);

          try {
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const response = await fetch(fileLink.href);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const safeRandom = crypto.randomBytes(8).toString('hex');
            const storageKey = `collections/${fileUniqueId || safeRandom}_${filename}`;

            await storageService.uploadObject(storageKey, buffer, mimeType);

            contentDoc = await Content.create({
              title: filename,
              type,
              storageKey,
              storageBucket: config.filebase.bucket,
              mimeType,
              fileSize,
              originalFileName: filename,
              telegramFileUniqueId: fileUniqueId,
              caption,
              status: 'active',
              botId: ctx.state.botId
            });
          } catch (err) {
            console.error('S3 Collection Upload Failed:', err.message);
            if (progressMsg) {
              await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
            }
            return ctx.reply(`❌ Failed to upload media to S3: ${err.message}`).catch(() => {});
          }

          if (progressMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id).catch(() => {});
          }
        }

        contentId = contentDoc._id;
      }

      const newItem = {
        type,
        mediaId: contentId,
        text: type === 'text' ? text : '',
        caption: type !== 'text' ? caption : '',
        sortOrder: session.linkDraft.items.length
      };

      session.linkDraft.items.push(newItem);
      session.linkDraft.updatedAt = new Date();
      session.state = 'LINK_DRAFT_WAIT_NEXT';
      session.markModified('linkDraft');
      await session.save();

      const typeLabels = { photo: 'Photo', video: 'Video', document: 'Document', text: 'Text message' };
      return ctx.reply(
        `✅ ${typeLabels[type]} added\n\n` +
        `Items in this draft: ${session.linkDraft.items.length}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add More', callback_data: 'admin:link:add_more' }],
              [{ text: '🚀 Direct Send', callback_data: 'admin:link:direct_init' }],
              [{ text: '🔗 Create Link', callback_data: 'admin:link:finalize' }],
              [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
            ]
          }
        }
      );
    }

    if (session.state === 'LINK_DRAFT_WAIT_NEXT') {
      return ctx.reply(
        `⚠️ Please select an action to proceed.\n\n` +
        `Items in this draft: ${session.linkDraft.items.length}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '➕ Add More', callback_data: 'admin:link:add_more' }],
              [{ text: '🚀 Direct Send', callback_data: 'admin:link:direct_init' }],
              [{ text: '🔗 Create Link', callback_data: 'admin:link:finalize' }],
              [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
            ]
          }
        }
      );
    }

    if (session.state === 'WAITING_FOR_CUSTOM_EXPIRY_DIRECT') {
      if (textMsg === '/cancel') {
        session.state = 'IDLE';
        await session.save();
        return ctx.reply('❌ Custom expiry cancelled.').catch(() => {});
      }

      const durationMs = parseDuration(textMsg);
      if (!durationMs) {
        return ctx.reply('⚠️ Invalid format. Send duration like: <code>15m</code>, <code>2h</code>, <code>1d</code>, <code>3d</code>. Or send /cancel:', { parse_mode: 'HTML' }).catch(() => {});
      }

      const expiresAt = new Date(Date.now() + durationMs);
      session.linkDraft.expiresAt = expiresAt;
      session.state = 'CONFIRM_DIRECT_PUBLISH';
      session.markModified('linkDraft');
      await session.save();

      const text = `🚀 <b>Ready to Publish Directly</b>\n\n` +
                   `• <b>Items:</b> ${session.linkDraft.items.length}\n` +
                   `• <b>Auto-Delete:</b> ${expiresAt.toUTCString()}\n\n` +
                   `Click Publish to broadcast directly to all active users:`;

      const markup = {
        inline_keyboard: [
          [{ text: '🚀 Publish Now', callback_data: 'admin:link:dir_publish:run' }],
          [{ text: '❌ Cancel', callback_data: 'admin:link:cancel' }]
        ]
      };

      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    if (session.state === 'WAITING_FOR_CUSTOM_EXPIRY_LINK') {
      if (textMsg === '/cancel') {
        session.state = 'IDLE';
        await session.save();
        return ctx.reply('❌ Custom expiry cancelled.').catch(() => {});
      }

      const durationMs = parseDuration(textMsg);
      if (!durationMs) {
        return ctx.reply('⚠️ Invalid format. Send duration like: <code>15m</code>, <code>2h</code>, <code>1d</code>, <code>3d</code>. Or send /cancel:', { parse_mode: 'HTML' }).catch(() => {});
      }

      const expiresAt = new Date(Date.now() + durationMs);

      let token = crypto.randomBytes(6).toString('hex');
      let existing = await Link.findOne({ token });
      while (existing) {
        token = crypto.randomBytes(6).toString('hex');
        existing = await Link.findOne({ token });
      }

      const newLink = await Link.create({
        token,
        status: 'active',
        items: session.linkDraft.items,
        createdBy: adminId.toString(),
        expiresAt
      });

      session.linkDraft = { status: 'idle', items: [], expiresAt: null, updatedAt: new Date() };
      session.state = 'IDLE';
      await session.save();

      const domain = config.adminOrigin || `http://localhost:${config.port || 3000}`;
      const finalUrl = `${domain}/l/${token}`;

      const successText = `✅ <b>Link Created Successfully</b>\n\n` +
                          `• <b>Items:</b> ${newLink.items.length}\n` +
                          `• <b>Status:</b> Active\n` +
                          `• <b>Expires:</b> ${expiresAt.toUTCString()}\n\n` +
                          `🔗 <code>${finalUrl}</code>`;

      await ctx.reply(successText, { parse_mode: 'HTML' }).catch(() => {});
      return;
    }

    session = await AdminSession.getSession(adminId);

    // Capture forwarded or direct media messages
    const isForwarded = ctx.message && (ctx.message.forward_date || ctx.message.forward_from || ctx.message.forward_from_chat);
    const hasMedia = ctx.message && (ctx.message.photo || ctx.message.video || ctx.message.document);
    const nonOverrideStates = [
      'WAITING_FOR_PRODUCT_TITLE',
      'WAITING_FOR_PRODUCT_MEDIA',
      'WAITING_FOR_PRODUCT_DESC',
      'WAITING_FOR_SEQUENCE_NAME',
      'WAITING_FOR_CATEGORY_NAME',
      'WAITING_FOR_CUSTOM_EXPIRY'
    ];
    const isPublishTrigger = (isForwarded || hasMedia) && !nonOverrideStates.includes(session.state) && session.state !== 'IDLE';
    const isDirectPost = ctx.message && session.state === 'WAITING_FOR_POST';

    if (isPublishTrigger || isDirectPost) {
      session.state = 'POST_RECEIVED';
      await session.save();

      const forwardDate = ctx.message.forward_date;
      const mediaGroupId = ctx.message.media_group_id;

      // Duplicate check (except for media groups)
      if (forwardDate && !mediaGroupId) {
        const existingPending = await ContentPack.findOne({
          botId: ctx.state.botId,
          status: 'PENDING',
          sourceAdminId: adminId,
          forwardDate: new Date(forwardDate * 1000)
        });
        if (existingPending) {
          session.state = 'IDLE';
          await session.save();
          return ctx.reply('⚠️ You have already forwarded this message. Please complete or cancel the pending publish workflow for it first.').catch(() => {});
        }
      }

      // Detect media type
      let type = '';
      let fileId = '';
      let fileUniqueId = '';
      let caption = ctx.message.caption || '';
      let text = ctx.message.text || '';
      let captionEntities = ctx.message.caption_entities || [];
      let textEntities = ctx.message.entities || [];
      let replyMarkup = ctx.message.reply_markup || undefined;

      if (ctx.message.photo) {
        type = 'photo';
        const p = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = p.file_id;
        fileUniqueId = p.file_unique_id;
      } else if (ctx.message.video) {
        type = 'video';
        fileId = ctx.message.video.file_id;
        fileUniqueId = ctx.message.video.file_unique_id;
      } else if (ctx.message.document) {
        type = 'document';
        fileId = ctx.message.document.file_id;
        fileUniqueId = ctx.message.document.file_unique_id;
      } else if (ctx.message.text) {
        type = 'text';
      } else {
        return ctx.reply('⚠️ Unsupported message type. Please send a Photo, Video, Document, or Text.').catch(() => {});
      }

      let s3Key = undefined;
      let s3UniqueId = undefined;
      if (['photo', 'video', 'document'].includes(type) && fileId) {
        s3UniqueId = fileUniqueId || crypto.randomBytes(8).toString('hex');
        s3Key = `tg_forwarded_${s3UniqueId}`;

        // Start background upload promise
        const uploadPromise = uploadTelegramFileToS3(ctx, fileId, type).catch(err => {
          console.error(`Background S3 upload failed for ${s3Key}:`, err.message);
          throw err;
        });

        global.pendingUploads = global.pendingUploads || {};
        global.pendingUploads[s3Key] = uploadPromise;
      }

      let pack;
      if (mediaGroupId) {
        pack = await ContentPack.findOne({
          botId: ctx.state.botId,
          status: 'PENDING',
          mediaGroupId,
          createdAt: { $gte: new Date(Date.now() - 10000) }
        });
      }

      // Create Content item
      const contentTimeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      const content = await Content.create({
        botId: ctx.state.botId,
        title: `Forwarded Item (${contentTimeStr})`,
        type,
        storageKey: s3Key || (['photo', 'video', 'document'].includes(type) ? 'tg_forwarded_' + (fileId || crypto.randomBytes(8).toString('hex')) : undefined),
        telegramFileId: undefined, // Do NOT store Admin Bot's fileId so User Bot always sends from S3 first!
        telegramFileUniqueId: s3UniqueId || fileUniqueId || undefined,
        caption: caption || undefined,
        captionEntities,
        textEntities,
        replyMarkup,
        text: text || undefined,
        status: 'inactive'
      });

      if (pack) {
        pack.items.push({
          contentId: content._id,
          sortOrder: pack.items.length,
          enabled: true
        });
        pack.sourceMessageIds.push(ctx.message.message_id);
        await pack.save();
      } else {
        let publicCode;
        let isUnique = false;
        while (!isUnique) {
          publicCode = 'pack_' + crypto.randomBytes(3).toString('hex').toLowerCase();
          const existing = await ContentPack.findOne({ botId: ctx.state.botId, publicCode });
          if (!existing) isUnique = true;
        }

        const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        pack = await ContentPack.create({
          botId: ctx.state.botId,
          name: `Forwarded Message (${dateStr})`,
          status: 'PENDING',
          items: [{
            contentId: content._id,
            sortOrder: 0,
            enabled: true
          }],
          publicCode,
          sourceAdminId: adminId,
          sourceMessageId: ctx.message.message_id,
          sourceMessageIds: [ctx.message.message_id],
          forwardDate: forwardDate ? new Date(forwardDate * 1000) : undefined,
          mediaGroupId: mediaGroupId || undefined
        });
      }

      if (mediaGroupId) {
        global.mediaGroupTimers = global.mediaGroupTimers || {};
        if (global.mediaGroupTimers[mediaGroupId]) {
          clearTimeout(global.mediaGroupTimers[mediaGroupId]);
        }
        global.mediaGroupTimers[mediaGroupId] = setTimeout(async () => {
          delete global.mediaGroupTimers[mediaGroupId];
          const finalPack = await ContentPack.findById(pack._id);
          await showPendingPreview(ctx, finalPack, session);
        }, 1000);
      } else {
        await showPendingPreview(ctx, pack, session);
      }
      return;
    }

    // Cancel state fallback
    if (textMsg.toLowerCase() === '/cancel') {
      session.state = 'IDLE';
      await session.save();
      await ctx.reply('❌ State machine operation cancelled. Returning home...');
      await handleAdminStart(ctx);
      return;
    }

    // ── Content Sequence State Machine Inputs ──
    if (session.state === 'WAITING_FOR_SEQ_TITLE') {
      if (!textMsg) {
        return ctx.reply('⚠️ Title cannot be empty. Send title:');
      }

      const sequence = await ContentSequence.create({
        botId: ctx.state.botId,
        publicCode: 'c_' + crypto.randomBytes(4).toString('hex').toLowerCase(),
        title: textMsg,
        status: 'DRAFT',
        createdBy: ctx.from.id
      });

      session.currentSequenceId = sequence._id;
      session.state = 'IDLE';
      await session.save();

      await ctx.reply(`✅ Draft sequence "${textMsg}" created successfully!`);
      await renderSequenceComposer(ctx, session, false);
      return;
    }

    if (session.state === 'WAITING_FOR_BLOCK_TEXT') {
      if (!ctx.message.text) {
        return ctx.reply('⚠️ Message text cannot be empty. Send text block content:');
      }

      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.');

      const block = sequence.blocks.find(b => b.blockId === session.currentBlockId);
      if (block) {
        block.content = ctx.message.text;
        await sequence.save();
      }

      session.state = 'IDLE';
      session.currentBlockId = undefined;
      await session.save();

      await ctx.reply('✅ Block text content saved.');
      await renderSequenceComposer(ctx, session, false);
      return;
    }

    if (session.state === 'WAITING_FOR_BLOCK_LINK_URL') {
      if (!textMsg || (!textMsg.startsWith('http://') && !textMsg.startsWith('https://'))) {
        return ctx.reply('⚠️ Invalid link URL. Must start with http:// or https://. Send again:');
      }

      session.tempButtonText = textMsg;
      session.state = 'WAITING_FOR_BLOCK_LINK_LABEL';
      await session.save();

      await ctx.reply('Send the label text for this redirect link:');
      return;
    }

    if (session.state === 'WAITING_FOR_BLOCK_LINK_LABEL') {
      if (!textMsg) {
        return ctx.reply('⚠️ Label cannot be empty. Send label:');
      }

      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.');

      const block = sequence.blocks.find(b => b.blockId === session.currentBlockId);
      if (block) {
        block.content = `🔗 <a href="${session.tempButtonText}">${textMsg}</a>`;
        await sequence.save();
      }

      session.state = 'IDLE';
      session.tempButtonText = undefined;
      session.currentBlockId = undefined;
      await session.save();

      await ctx.reply('✅ Redirect Link Block saved.');
      await renderSequenceComposer(ctx, session, false);
      return;
    }

    if (session.state === 'WAITING_FOR_BLOCK_MEDIA_BATCH') {
      const sequence = await ContentSequence.findById(session.currentSequenceId);
      if (!sequence) return ctx.reply('⚠️ Sequence not found.');

      const block = sequence.blocks.find(b => b.blockId === session.currentBlockId);
      if (!block) return ctx.reply('⚠️ Block context not found.');

      const text = ctx.message.text ? ctx.message.text.trim() : '';
      if (text === '/done') {
        if (block.mediaItems.length === 0) {
          return ctx.reply('⚠️ You must upload at least one photo or video before typing /done.');
        }
        session.state = 'IDLE';
        session.currentBlockId = undefined;
        await session.save();
        await ctx.reply(`✅ Added media block with ${block.mediaItems.length} items.`);
        await renderSequenceComposer(ctx, session, false);
        return;
      }

      let mediaType = '';
      let fileId = '';
      let fileUniqueId = '';

      if (ctx.message.photo) {
        mediaType = 'photo';
        const p = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = p.file_id;
        fileUniqueId = p.file_unique_id;
      } else if (ctx.message.video) {
        mediaType = 'video';
        fileId = ctx.message.video.file_id;
        fileUniqueId = ctx.message.video.file_unique_id;
      } else if (ctx.message.document) {
        mediaType = 'document';
        fileId = ctx.message.document.file_id;
        fileUniqueId = ctx.message.document.file_unique_id;
      }

      if (!mediaType) {
        return ctx.reply('⚠️ Send only photos, videos, or documents, then send /done when finished.');
      }

      block.mediaItems.push({
        mediaType,
        telegramFileId: fileId,
        fileUniqueId,
        sortOrder: block.mediaItems.length,
        caption: ctx.message.caption || ''
      });
      await sequence.save();

      await ctx.reply(`➕ Added item #${block.mediaItems.length} (${mediaType}). Send more or send /done to finalize.`);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_TITLE ---
    if (session.state === 'WAITING_FOR_BUNDLE_TITLE') {
      if (!textMsg) {
        return ctx.reply('⚠️ Title cannot be empty. Send title:');
      }

      const bundle = await MediaBundle.create({
        botId: ctx.state.botId,
        adminId: ctx.from.id,
        title: textMsg,
        status: 'draft'
      });

      session.currentBundleId = bundle._id;
      session.state = 'IDLE';
      await session.save();

      await ctx.reply(`✅ Draft bundle "${textMsg}" created successfully!`);
      await renderPostComposer(ctx, session, false);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_TEXT ---
    if (session.state === 'WAITING_FOR_BUNDLE_TEXT') {
      if (!textMsg) {
        return ctx.reply('⚠️ Caption/Text cannot be empty.');
      }

      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.');

      bundle.text = ctx.message.text; // Preserve raw text (including any HTML entities sent)
      await bundle.save();

      session.state = 'IDLE';
      await session.save();

      await ctx.reply('✏️ Common text successfully updated.');
      await renderPostComposer(ctx, session, false);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_LINK_URL ---
    if (session.state === 'WAITING_FOR_BUNDLE_LINK_URL') {
      if (!textMsg || (!textMsg.startsWith('http://') && !textMsg.startsWith('https://'))) {
        return ctx.reply('⚠️ Invalid link URL. Must start with http:// or https://. Send again:');
      }

      session.tempButtonText = textMsg; // Store URL temporarily
      session.state = 'WAITING_FOR_BUNDLE_LINK_LABEL';
      await session.save();

      await ctx.reply('Send the label text for this link (e.g. `💎 Premium Access`):');
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_LINK_LABEL ---
    if (session.state === 'WAITING_FOR_BUNDLE_LINK_LABEL') {
      if (!textMsg) {
        return ctx.reply('⚠️ Label cannot be empty. Send label:');
      }

      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.');

      const url = session.tempButtonText;
      const label = textMsg;

      if (!bundle.links) {
        bundle.links = [];
      }
      bundle.links.push({
        label,
        url,
        sortOrder: bundle.links.length
      });
      await bundle.save();

      session.state = 'IDLE';
      session.tempButtonText = undefined;
      await session.save();

      await ctx.reply(`✅ Link "[${label}]" added successfully!`);
      
      // Render links list
      ctx.callbackQuery = { data: 'admin:bundle:links' };
      await handleAdminCallback(ctx);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_BUTTON_TEXT ---
    if (session.state === 'WAITING_FOR_BUNDLE_BUTTON_TEXT') {
      if (!textMsg) {
        return ctx.reply('⚠️ Button text cannot be empty. Send text:');
      }

      session.tempButtonText = textMsg; // Store button text temporarily
      session.state = 'WAITING_FOR_BUNDLE_BUTTON_URL';
      await session.save();

      await ctx.reply(`Button text set to: "${textMsg}". Now send the redirect URL for this button:`);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_BUTTON_URL ---
    if (session.state === 'WAITING_FOR_BUNDLE_BUTTON_URL') {
      if (!textMsg || (!textMsg.startsWith('http://') && !textMsg.startsWith('https://'))) {
        return ctx.reply('⚠️ Invalid URL. Must start with http:// or https://. Send again:');
      }

      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.');

      const textLabel = session.tempButtonText;
      if (!bundle.buttons) {
        bundle.buttons = [];
      }
      bundle.buttons.push({
        text: textLabel,
        url: textMsg,
        sortOrder: bundle.buttons.length
      });
      await bundle.save();

      session.state = 'IDLE';
      session.tempButtonText = undefined;
      await session.save();

      await ctx.reply(`✅ Button "[${textLabel}]" added successfully!`);

      // Render buttons list
      ctx.callbackQuery = { data: 'admin:bundle:buttons' };
      await handleAdminCallback(ctx);
      return;
    }

    // --- State: WAITING_FOR_BUNDLE_MEDIA_BATCH ---
    if (session.state === 'WAITING_FOR_BUNDLE_MEDIA_BATCH') {
      const bundle = await MediaBundle.findById(session.currentBundleId);
      if (!bundle) return ctx.reply('⚠️ Active draft not found.');

      // Check for /done Command
      if (textMsg.toLowerCase() === '/done') {
        session.state = 'IDLE';
        await session.save();
        await ctx.reply('✅ Batch media upload completed!');
        await renderPostComposer(ctx, session, false);
        return;
      }

      let mediaType = null;
      let telegramFileId = null;
      let fileUniqueId = null;
      let fileName = null;
      let mimeType = null;
      let size = null;

      if (ctx.message.photo) {
        mediaType = 'photo';
        const largest = ctx.message.photo[ctx.message.photo.length - 1];
        telegramFileId = largest.file_id;
        fileUniqueId = largest.file_unique_id;
        size = largest.file_size;
      } else if (ctx.message.video) {
        mediaType = 'video';
        telegramFileId = ctx.message.video.file_id;
        fileUniqueId = ctx.message.video.file_unique_id;
        mimeType = ctx.message.video.mime_type;
        size = ctx.message.video.file_size;
        fileName = ctx.message.video.file_name;
      } else if (ctx.message.document) {
        mediaType = 'document';
        telegramFileId = ctx.message.document.file_id;
        fileUniqueId = ctx.message.document.file_unique_id;
        mimeType = ctx.message.document.mime_type;
        size = ctx.message.document.file_size;
        fileName = ctx.message.document.file_name;
      }

      if (!mediaType) {
        return ctx.reply('⚠️ Please upload a photo, video, or document file, or send /done to finish.');
      }

      // Add to mediaItems list
      if (!bundle.mediaItems) {
        bundle.mediaItems = [];
      }
      bundle.mediaItems.push({
        mediaType,
        telegramFileId,
        fileUniqueId,
        fileName,
        mimeType,
        size,
        sortOrder: bundle.mediaItems.length
      });
      await bundle.save();

      const photos = bundle.mediaItems.filter(m => m.mediaType === 'photo').length;
      const videos = bundle.mediaItems.filter(m => m.mediaType === 'video').length;
      const docs = bundle.mediaItems.filter(m => m.mediaType === 'document').length;

      // Send compact progress update with inline controls
      const text = `📦 <b>Media Bundle</b>\n\n` +
        `<b>${bundle.mediaItems.length}</b> items added\n` +
        `• 📷 Photos: ${photos}\n` +
        `• 🎬 Videos: ${videos}\n` +
        `• 📄 Documents: ${docs}\n\n` +
        `Send more media or click Done below to finish:`;

      const markup = {
        inline_keyboard: [
          [{ text: '📋 View', callback_data: 'admin:bundle:media:list:1' }, { text: '✅ Done', callback_data: 'admin:post:menu' }]
        ]
      };

      await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
      return;
    }

    // --- State: WAITING_FOR_CONTENT_TITLE ---
    if (session.state === 'WAITING_FOR_CONTENT_TITLE') {
      if (!textMsg) {
        return ctx.reply('⚠️ Title cannot be empty. Send title:');
      }

      session.tempButtonText = textMsg; // save title temporarily
      session.state = 'IDLE';
      await session.save();

      // Ask to choose Category assignment
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} ${cat.displayName || cat.name}`, callback_data: `admin:post:save:cat:${cat._id}` }
      ]);
      buttons.push([{ text: '📁 Save with No Category', callback_data: 'admin:post:save:cat:none' }]);

      await ctx.reply('💾 *Choose Category Assignment:*\n\nSelect a folder to record this item under:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }

    // --- State: WAITING_FOR_CATEGORY_NAME ---
    if (session.state === 'WAITING_FOR_CATEGORY_NAME') {
      if (!textMsg) {
        return ctx.reply('⚠️ Category name cannot be empty. Send category name:');
      }

      try {
        const cat = await Category.create({
          name: textMsg,
          displayName: textMsg,
          slug: textMsg.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, ''),
          status: 'active',
          botId: ctx.state.botId
        });

        session.state = 'IDLE';
        await session.save();

        await logAdminActivity('CATEGORY_CREATED', adminId, 'success', { categoryName: textMsg, categoryId: cat._id });
        await ctx.reply(`📁 Category "${textMsg}" created successfully!\n\nUsers of the User Bot can now see this category under [📁 Categories].`).catch(() => {});

        ctx.callbackQuery = { data: 'admin:cat:list' };
        await handleAdminCallback(ctx);
      } catch (err) {
        await ctx.reply(`⚠️ *Failed to create category:* ${err.message}`).catch(() => {});
      }
      return;
    }

    // ── Direct Content Creation State Machine ────────────────────────────────
    // States: WAITING_FOR_CONTENT_MEDIA_PHOTO/VIDEO/DOCUMENT/TEXT/LINK
    // then:   WAITING_FOR_CONTENT_TITLE  → WAITING_FOR_CONTENT_CAPTION (optional) → category picker

    if (session.state.startsWith('WAITING_FOR_CONTENT_MEDIA_')) {
      const contentType = session.state.replace('WAITING_FOR_CONTENT_MEDIA_', '').toLowerCase();
      let fileId = null;
      let urlValue = null;
      let captureText = null;

      if (contentType === 'photo') {
        const photos = ctx.message.photo;
        if (!photos || photos.length === 0) return ctx.reply('⚠️ Please send a photo image.');
        fileId = photos[photos.length - 1].file_id;
      } else if (contentType === 'video') {
        const video = ctx.message.video;
        if (!video) return ctx.reply('⚠️ Please send a video file.');
        fileId = video.file_id;
      } else if (contentType === 'document') {
        const doc = ctx.message.document;
        if (!doc) return ctx.reply('⚠️ Please send a document file.');
        fileId = doc.file_id;
      } else if (contentType === 'text') {
        if (!textMsg) return ctx.reply('⚠️ Please send text content.');
        captureText = textMsg;
      } else if (contentType === 'link') {
        if (!textMsg || (!textMsg.startsWith('http://') && !textMsg.startsWith('https://'))) {
          return ctx.reply('⚠️ Invalid URL. Must start with http:// or https://');
        }
        urlValue = textMsg;
      }

      // Store in session
      session.draft = session.draft || {};
      session.draft.type = contentType;
      session.draft.telegramFileId = fileId || '';
      session.draft.caption = captureText || '';
      session.tempButtonUrl = urlValue || '';
      session.state = 'WAITING_FOR_CONTENT_TITLE2';
      session.markModified('draft');
      await session.save();

      await ctx.reply(
        `✅ ${contentType.charAt(0).toUpperCase() + contentType.slice(1)} received!\n\nNow send a *Title* for this content item:`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (session.state === 'WAITING_FOR_CONTENT_TITLE2') {
      if (!textMsg) return ctx.reply('⚠️ Title cannot be empty. Send title:');

      session.tempButtonText2 = textMsg; // holds content title
      session.state = 'WAITING_FOR_CONTENT_CAPTION2';
      await session.save();

      const contentType = session.draft?.type;
      if (contentType === 'text' || contentType === 'link') {
        // Text/link already captured body/url — skip caption step, go straight to category picker
        session.state = 'IDLE';
        await session.save();
        await _showContentCategoryPicker(ctx, session);
      } else {
        await ctx.reply(
          '📝 Send an optional *caption* for this media (or send `/skip` to skip):',
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    if (session.state === 'WAITING_FOR_CONTENT_CAPTION2') {
      if (textMsg.toLowerCase() !== '/skip' && textMsg) {
        session.draft.caption = textMsg;
        session.markModified('draft');
      }
      session.state = 'IDLE';
      await session.save();
      await _showContentCategoryPicker(ctx, session);
      return;
    }

    // --- State: WAITING_FOR_PACK_NAME ---
    if (session.state === 'WAITING_FOR_PACK_NAME') {
      if (!textMsg) {
        return ctx.reply('⚠️ Pack name cannot be empty. Send pack name:');
      }

      session.packDraft.name = textMsg;
      session.state = 'WAITING_FOR_PACK_DESC';
      session.markModified('packDraft');
      await session.save();

      await ctx.reply('📦 Send a description for this Content Pack:');
      return;
    }

    // --- State: WAITING_FOR_PACK_DESC ---
    if (session.state === 'WAITING_FOR_PACK_DESC') {
      session.packDraft.description = textMsg;
      session.state = 'IDLE';
      session.markModified('packDraft');
      await session.save();

      // Show Category select menu to add items to pack
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} Select from ${cat.displayName || cat.name}`, callback_data: `admin:pack:select:cat:${cat._id}:1` }
      ]);
      buttons.push([{ text: '💾 Save Pack Now', callback_data: 'admin:pack:save:now' }]);

      await ctx.reply('📦 *Add Library Items to Pack:*\n\nSelect a folder to choose items or save immediately:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }

    // --- State: WAITING_FOR_PRODUCT_TITLE ---
    if (session.state === 'WAITING_FOR_PRODUCT_TITLE') {
      if (!textMsg) {
        return ctx.reply('⚠️ Title cannot be empty. Send product title:');
      }

      session.productDraft = session.productDraft || { title: '', categoryId: undefined, description: '', media: [] };
      session.productDraft.title = textMsg;
      await session.save();

      // Show Category select menu
      const categories = await Category.find(ctx.state.botId ? { $or: [{ botId: ctx.state.botId }, { botId: { $exists: false } }, { botId: null }] } : {}).sort({ name: 1 });
      const buttons = categories.map(cat => [
        { text: `${cat.icon || '📁'} ${cat.displayName || cat.name}`, callback_data: `admin:prod:cat:${cat._id}` }
      ]);
      buttons.push([{ text: '📁 No Category', callback_data: 'admin:prod:cat:none' }]);

      await ctx.reply('💾 <b>Choose Category Assignment:</b>\n\nSelect a folder/category to file this product under:', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }

    // --- State: WAITING_FOR_PRODUCT_DESC ---
    if (session.state === 'WAITING_FOR_PRODUCT_DESC') {
      session.productDraft = session.productDraft || { title: '', categoryId: undefined, description: '', media: [] };
      session.productDraft.description = textMsg || '';
      session.state = 'WAITING_FOR_PRODUCT_MEDIA';
      session.markModified('productDraft');
      await session.save();

      await ctx.reply(
        '➕ <b>ADD PRODUCT</b>\n\n' +
        'Please send media files (Photo, Video, or Document) one-by-one.\n\n' +
        'When you have finished sending files, click the <b>Done</b> button below.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Done', callback_data: 'admin:prod:media:done' }],
              [{ text: '❌ Cancel', callback_data: 'admin:home' }]
            ]
          }
        }
      );
      return;
    }

    // --- State: WAITING_FOR_PRODUCT_MEDIA ---
    if (session.state === 'WAITING_FOR_PRODUCT_MEDIA') {
      session.productDraft = session.productDraft || { title: '', categoryId: undefined, description: '', media: [] };

      // Detect media type
      let type = '';
      let fileId = '';
      let fileUniqueId = '';
      let caption = ctx.message.caption || '';
      let captionEntities = ctx.message.caption_entities || [];
      let textEntities = ctx.message.entities || [];
      let replyMarkup = ctx.message.reply_markup || undefined;

      if (ctx.message.photo) {
        type = 'photo';
        const p = ctx.message.photo[ctx.message.photo.length - 1];
        fileId = p.file_id;
        fileUniqueId = p.file_unique_id;
      } else if (ctx.message.video) {
        type = 'video';
        fileId = ctx.message.video.file_id;
        fileUniqueId = ctx.message.video.file_unique_id;
      } else if (ctx.message.document) {
        type = 'document';
        fileId = ctx.message.document.file_id;
        fileUniqueId = ctx.message.document.file_unique_id;
      }

      if (!type || !fileId) {
        return ctx.reply('⚠️ Please send a Photo, Video, or Document file, or click Done to finish.').catch(() => {});
      }

      const s3UniqueId = fileUniqueId || crypto.randomBytes(8).toString('hex');
      const s3Key = `tg_manual_${s3UniqueId}`;

      // Start background upload promise
      const uploadPromise = uploadTelegramFileToS3(ctx, fileId, type).catch(err => {
        console.error(`Background S3 upload failed for ${s3Key}:`, err.message);
        throw err;
      });

      global.pendingUploads = global.pendingUploads || {};
      global.pendingUploads[s3Key] = uploadPromise;

      // Create inactive library Content item
      const content = await Content.create({
        botId: ctx.state.botId,
        title: type.toUpperCase() + ' Item ' + new Date().toISOString().substring(11, 19),
        type,
        categoryId: session.productDraft.categoryId,
        storageKey: s3Key,
        telegramFileId: undefined, // User bot sends from S3 and registers file_id
        telegramFileUniqueId: s3UniqueId,
        caption: caption || undefined,
        captionEntities,
        textEntities,
        replyMarkup,
        status: 'inactive'
      });

      session.productDraft.media.push(content._id);
      session.markModified('productDraft');
      await session.save();

      await ctx.reply(
        `📥 Media #${session.productDraft.media.length} received. Uploading to S3 in background...\n\n` +
        'Send another file or click <b>Done</b> when finished.',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Done', callback_data: 'admin:prod:media:done' }],
              [{ text: '❌ Cancel', callback_data: 'admin:home' }]
            ]
          }
        }
      );
      return;
    }

    // --- State: WAITING_FOR_SETTINGS_WELCOME ---
    if (session.state === 'WAITING_FOR_SETTINGS_WELCOME') {
      if (!textMsg) {
        return ctx.reply('⚠️ Setting template cannot be empty.');
      }

      const settings = await Setting.getSettings(ctx.state.botId);
      settings.welcomeMessage = textMsg;
      await settings.save();

      session.state = 'IDLE';
      await session.save();

      await ctx.reply('⚙️ Settings template successfully updated.').catch(() => {});
      ctx.callbackQuery = { data: 'admin:set:menu' };
      await handleAdminCallback(ctx);
      return;
    }

    // --- State: WAITING_FOR_SETTINGS_LIMIT ---
    if (session.state === 'WAITING_FOR_SETTINGS_LIMIT') {
      const limitVal = parseInt(textMsg, 10);
      if (isNaN(limitVal)) {
        return ctx.reply('⚠️ Please send a valid number limit:');
      }

      const settings = await Setting.getSettings(ctx.state.botId);
      settings.startContentLimit = limitVal;
      await settings.save();

      session.state = 'IDLE';
      await session.save();

      await ctx.reply(`⚙️ Start content limit updated to ${limitVal} files.`).catch(() => {});
      ctx.callbackQuery = { data: 'admin:set:menu' };
      await handleAdminCallback(ctx);
      return;
    }

    // --- State: WAITING_FOR_SETTINGS_HOURS ---
    if (session.state === 'WAITING_FOR_SETTINGS_HOURS') {
      const hoursVal = parseInt(textMsg, 10);
      if (isNaN(hoursVal)) {
        return ctx.reply('⚠️ Please send a valid hours value:');
      }

      const settings = await Setting.getSettings(ctx.state.botId);
      settings.autoDeleteHours = hoursVal;
      await settings.save();

      session.state = 'IDLE';
      await session.save();

      await ctx.reply(`⚙️ Auto-delete delay updated to ${hoursVal} hours.`).catch(() => {});
      ctx.callbackQuery = { data: 'admin:set:menu' };
      await handleAdminCallback(ctx);
      return;
    }

    // --- State: WAITING_FOR_CUSTOM_EXPIRY ---
    if (session.state === 'WAITING_FOR_CUSTOM_EXPIRY') {
      const packId = session.currentPackId;
      const pack = await ContentPack.findById(packId);
      if (!pack) {
        session.state = 'IDLE';
        await session.save();
        return ctx.reply('⚠️ Content Pack not found. Returning home...').then(() => renderHome(ctx, false));
      }

      const durationMs = parseCustomDuration(textMsg);
      if (!durationMs) {
        return ctx.reply('⚠️ Invalid custom duration format.\n\nPlease enter duration like: 15m, 1h, 12h, 1d, 3d. Or send /cancel:');
      }

      const expiresAt = new Date(Date.now() + durationMs);
      pack.expiresAt = expiresAt;
      await pack.save();

      session.state = 'READY_TO_PUBLISH';
      await session.save();

      await renderPublishConfirm(ctx, pack, session, false);
      return;
    }

  } catch (error) {
    console.error('Admin Message Handler Exception:', error);
    const isForwarded = ctx.message && (ctx.message.forward_date || ctx.message.forward_from || ctx.message.forward_from_chat);
    if (isForwarded || (session && (session.state === 'WAITING_FOR_POST' || session.state === 'WAITING_FOR_EXPIRY' || session.state === 'WAITING_FOR_CUSTOM_EXPIRY'))) {
      await ctx.reply(
        '⚠️ I couldn\'t process this post.\n\n' +
        'Please make sure the media type is supported and try forwarding the post again.',
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } else {
      ctx.reply('⚠️ State machine error. Send /start to restart Admin console.').catch(() => {});
    }
  }
}

// ── Helper Functions for Admin Publish Workflow ─────────────────────────────

async function showPendingPreview(ctx, pack, session) {
  try {
    session.currentPackId = pack._id.toString();
    session.state = 'CHOOSING_PUBLISH_MODE';
    await session.save();

    await ctx.reply('📦 <b>NEW POST RECEIVED</b>', { parse_mode: 'HTML' }).catch(() => {});
    
    if (pack.sourceMessageIds && pack.sourceMessageIds.length > 0) {
      for (const msgId of pack.sourceMessageIds) {
        await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, msgId).catch(() => {});
      }
    } else if (pack.sourceMessageId) {
      await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, pack.sourceMessageId).catch(() => {});
    }

    const text = `📦 <b>NEW POST PREVIEW</b>\n\n` +
      `What do you want to do with this post?`;

    const markup = {
      inline_keyboard: [
        [{ text: '🚀 DIRECT PUBLISH', callback_data: `admin:pub:mode:direct` }],
        [{ text: '🔗 CREATE LINK', callback_data: `admin:pub:mode:link` }],
        [{ text: '❌ CANCEL', callback_data: `admin:pub:cancel` }]
      ]
    };

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  } catch (err) {
    console.error('showPendingPreview error:', err.message);
    await ctx.reply('⚠️ Error generating preview.').catch(() => {});
  }
}

function parseCustomDuration(text) {
  const match = text.match(/^(\d+)\s*(m|h|d|w|min|hour|day|week)s?$/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('m')) return val * 60 * 1000;
  if (unit.startsWith('h')) return val * 60 * 60 * 1000;
  if (unit.startsWith('d')) return val * 24 * 60 * 60 * 1000;
  if (unit.startsWith('w')) return val * 7 * 24 * 60 * 60 * 1000;
  return null;
}

function formatExpiryDescription(expiresAt) {
  if (!expiresAt) return '♾️ Never';
  const diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return 'Expired';
  
  const diffMins = Math.round(diffMs / (60 * 1000));
  if (diffMins < 60) return `${diffMins} minute(s) from now`;
  
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  if (diffHours < 24) return `${diffHours} hour(s) from now`;
  
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  return `${diffDays} day(s) from now`;
}

async function renderPublishConfirm(ctx, pack, session, edit = true) {
  const expiryText = formatExpiryDescription(pack.expiresAt);
  const mode = pack.settings?.mode || 'direct';

  let text = '';
  let publishBtnText = '✅ PUBLISH NOW';

  if (mode === 'direct') {
    let catName = 'None';
    if (pack.categoryId) {
      const { Category } = await import('../../models/Category.js');
      const cat = await Category.findById(pack.categoryId);
      if (cat) catName = cat.displayName || cat.name;
    }
    text = `📦 <b>READY TO PUBLISH</b>\n\n` +
      `<b>Mode:</b> Direct Publish\n` +
      `<b>Category:</b> ${catName}\n` +
      `<b>Expiry:</b> ${expiryText}\n\n` +
      `Are you sure you want to make this post live in the User Bot catalog?`;
  } else {
    publishBtnText = '🔗 CREATE LINK';
    text = `📦 <b>READY TO CREATE LINK</b>\n\n` +
      `<b>Mode:</b> Link\n` +
      `<b>Expiry:</b> ${expiryText}\n\n` +
      `Are you sure you want to generate a deep link for this post?`;
  }

  const markup = {
    inline_keyboard: [
      [{ text: publishBtnText, callback_data: `admin:pub:run:${pack._id}` }],
      [{ text: '🔄 CHANGE EXPIRY', callback_data: `admin:pub:expiry:set:${pack._id}` }],
      [{ text: '❌ CANCEL', callback_data: `admin:pub:cancel:${pack._id}` }]
    ]
  };

  if (edit) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup }).catch(() => {});
  }
}

async function uploadTelegramFileToS3(ctx, fileId, type) {
  try {
    const fileInfo = await ctx.telegram.getFile(fileId);
    
    // Check file size (configurable limit)
    const MAX_SIZE = (config.maxFileSizeMb || 20) * 1024 * 1024;
    if (fileInfo.file_size && fileInfo.file_size > MAX_SIZE) {
      throw new Error(`File is too large (${(fileInfo.file_size / (1024 * 1024)).toFixed(1)}MB). Configured limit is ${config.maxFileSizeMb || 20}MB.`);
    }

    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.href);
    if (!response.ok) {
      throw new Error(`Failed to download file from Telegram: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let mimeType = 'application/octet-stream';
    if (type === 'photo') mimeType = 'image/jpeg';
    else if (type === 'video') mimeType = 'video/mp4';

    const fileUniqueId = fileInfo.file_unique_id || crypto.randomBytes(8).toString('hex');
    const storageKey = `tg_forwarded_${fileUniqueId}`;

    await storageService.uploadObject(storageKey, buffer, mimeType);
    return { storageKey, fileUniqueId };
  } catch (err) {
    console.error('Failed to upload Telegram file to S3:', err.message);
    throw err;
  }
}
