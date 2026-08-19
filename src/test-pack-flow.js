import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import crypto from 'crypto';

// Setup DNS to resolve Windows Node.js issues
try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (err) {}

dotenv.config();

import { User } from './models/User.js';
import { Bot as BotModel } from './models/Bot.js';
import { Content } from './models/Content.js';
import { Delivery } from './models/Delivery.js';
import { Setting } from './models/Setting.js';
import { ContentPack } from './models/ContentPack.js';
import { DeliveryBatch } from './models/DeliveryBatch.js';
import { EventLog } from './models/EventLog.js';
import { BotMenu } from './models/BotMenu.js';
import { Category } from './models/Category.js';
import { bot } from './bot/bot.js';
import { telegramService } from './services/telegram.service.js';
import { Telegram } from 'telegraf';

// ====================================================
// MONGOOSE IN-MEMORY MOCK FRAMEWORK
// ====================================================
const collections = {
  bots: [],
  users: [],
  contents: [],
  content_packs: [],
  deliveries: [],
  delivery_batches: [],
  settings: [],
  event_logs: [],
  bot_menus: [],
  categories: []
};

// Override connect and disconnect
mongoose.connect = async () => {
  console.log('[MOCK MONGOOSE] Connected to local in-memory DB.');
  return true;
};
mongoose.disconnect = async () => {
  console.log('[MOCK MONGOOSE] Disconnected.');
  return true;
};

function mockModel(model, collectionName) {
  model.find = function(query = {}) {
    let list = collections[collectionName];
    // Simple mock filter
    if (query.botId) list = list.filter(x => String(x.botId) === String(query.botId));
    if (query.publicCode) list = list.filter(x => x.publicCode === query.publicCode);
    if (query.status) list = list.filter(x => x.status === query.status);
    if (query.telegramUserId) list = list.filter(x => x.telegramUserId === query.telegramUserId);
    if (query.userId) list = list.filter(x => String(x.userId) === String(query.userId));
    if (query.packId) list = list.filter(x => String(x.packId) === String(query.packId));
    if (query._id) {
      if (Array.isArray(query._id)) {
        const ids = query._id.map(id => String(id));
        list = list.filter(x => ids.includes(String(x._id)));
      } else if (query._id.$in) {
        const ids = query._id.$in.map(id => String(id));
        list = list.filter(x => ids.includes(String(x._id)));
      } else {
        list = list.filter(x => String(x._id) === String(query._id));
      }
    }
    if (query.title && query.title.$regex) {
      const reg = new RegExp(query.title.$regex, 'i');
      list = list.filter(x => reg.test(x.title));
    }
    if (query.name && query.name.$regex) {
      const reg = new RegExp(query.name.$regex, 'i');
      list = list.filter(x => reg.test(x.name));
    }

    const chain = {
      populate: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      select: () => chain,
      then: (resolve) => resolve(list),
    };
    return chain;
  };

  model.findOne = async function(query = {}) {
    const list = await model.find(query);
    return list[0] || null;
  };

  model.findById = async function(id) {
    return collections[collectionName].find(x => String(x._id) === String(id)) || null;
  };

  model.create = async function(doc) {
    const newDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
      save: async function() {
        return this;
      },
      toObject: function() {
        return this;
      }
    };
    collections[collectionName].push(newDoc);
    return newDoc;
  };

  model.deleteOne = async function(query = {}) {
    const before = collections[collectionName].length;
    collections[collectionName] = collections[collectionName].filter(x => {
      if (query.telegramUserId && x.telegramUserId === query.telegramUserId) return false;
      if (query._id && String(x._id) === String(query._id)) return false;
      return true;
    });
    return { deletedCount: before - collections[collectionName].length };
  };

  model.deleteMany = async function(query = {}) {
    const before = collections[collectionName].length;
    collections[collectionName] = collections[collectionName].filter(x => {
      if (query.telegramChatId && x.telegramChatId === query.telegramChatId) return false;
      if (query.botId && String(x.botId) === String(query.botId)) return false;
      if (query.userId && String(x.userId) === String(query.userId)) return false;
      if (query.title && query.title.$regex) {
        const reg = new RegExp(query.title.$regex, 'i');
        return !reg.test(x.title);
      }
      if (query.name && query.name.$regex) {
        const reg = new RegExp(query.name.$regex, 'i');
        return !reg.test(x.name);
      }
      return true;
    });
    return { deletedCount: before - collections[collectionName].length };
  };

  model.countDocuments = async function(query = {}) {
    const list = await model.find(query);
    return list.length;
  };

  model.findOneAndUpdate = async function(filter, update, options) {
    let doc = await model.findOne(filter);
    if (!doc && options?.upsert) {
      doc = await model.create(filter);
    }
    if (doc) {
      Object.assign(doc, update);
    }
    return doc;
  };

  model.updateMany = async function(filter, update) {
    const list = await model.find(filter);
    list.forEach(x => Object.assign(x, update));
    return { modifiedCount: list.length };
  };
}

mockModel(BotModel, 'bots');
mockModel(User, 'users');
mockModel(Content, 'contents');
mockModel(Delivery, 'deliveries');
mockModel(Setting, 'settings');
mockModel(ContentPack, 'content_packs');
mockModel(DeliveryBatch, 'delivery_batches');
mockModel(EventLog, 'event_logs');
mockModel(BotMenu, 'bot_menus');
mockModel(Category, 'categories');

// Mock specific static methods
Setting.getSettings = async function(botId) {
  let s = collections.settings.find(x => String(x.botId) === String(botId));
  if (!s) {
    s = await Setting.create({
      botId,
      welcomeMessage: 'Welcome 👋\n\nChoose an option below.',
      startContentEnabled: true,
      autoDeleteEnabled: true,
      autoDeleteHours: 24,
      botEnabled: true
    });
  }
  return s;
};

EventLog.log = async function(eventType, userId, telegramUserId, targetId = '', metadata = {}, botId = null) {
  return await EventLog.create({
    userId,
    telegramUserId,
    eventType,
    targetId,
    metadata,
    botId
  });
};

DeliveryBatch.aggregate = async function(pipeline) {
  const match = pipeline.find(p => p.$match)?.$match || {};
  let list = collections.delivery_batches;
  if (match.packId) {
    list = list.filter(x => String(x.packId) === String(match.packId));
  }

  if (list.length === 0) return [];

  const uniqueUsers = new Set(list.map(x => String(x.userId)));
  const totalOpens = list.length;
  const totalMessagesDelivered = list.reduce((sum, x) => sum + (x.successCount || 0), 0);
  const successfulDeliveriesCount = list.filter(x => x.successCount > 0).length;
  const failedDeliveriesCount = list.reduce((sum, x) => sum + (x.failureCount || 0), 0);
  const lastOpened = list.reduce((max, x) => !max || x.startedAt > max ? x.startedAt : max, null);

  return [{
    totalOpens,
    uniqueUsersList: Array.from(uniqueUsers),
    totalMessagesDelivered,
    successfulDeliveriesCount,
    failedDeliveriesCount,
    lastOpened
  }];
};

// Mock UserService.upsertUser
import { userService } from './services/user.service.js';
userService.upsertUser = async function(telegramUser, botId) {
  let u = collections.users.find(x => x.telegramUserId === telegramUser.id);
  if (!u) {
    u = await User.create({
      telegramUserId: telegramUser.id,
      firstName: telegramUser.first_name,
      username: telegramUser.username,
      botId
    });
  }
  return u;
};

// ====================================================
// TEST SUITE RUNNER
// ====================================================
async function runTests() {
  try {
    console.log('Starting Test Suit...');
    await mongoose.connect();

    // Seed default menus
    await BotMenu.create({ label: 'Categories', icon: '📂', actionType: 'CATEGORY', sortOrder: 0, status: 'active' });
    await BotMenu.create({ label: 'Search', icon: '🔎', actionType: 'SEARCH', sortOrder: 1, status: 'active' });

    // 1. Get or create active bot configuration
    const testBot = await BotModel.create({
      telegramBotId: 12345678,
      username: 'test_content_pack_bot',
      firstName: 'Test Bot',
      status: 'active'
    });
    console.log('Created mock Bot configuration:', testBot._id);

    const TEST_USER_ID = 88888888;

    // Seed test contents
    const contentVideo = await Content.create({
      title: 'Test Integration Content Video',
      type: 'video',
      storageKey: 'test-video-key',
      status: 'active',
      botId: testBot._id
    });
    const contentPhoto = await Content.create({
      title: 'Test Integration Content Photo',
      type: 'photo',
      storageKey: 'test-photo-key',
      status: 'active',
      botId: testBot._id
    });
    const contentText = await Content.create({
      title: 'Test Integration Content Text',
      type: 'text',
      text: 'Test message body text',
      status: 'active',
      botId: testBot._id
    });

    console.log('Seeded content items.');

    // Seed active pack
    const activePack = await ContentPack.create({
      botId: testBot._id,
      name: 'Test Integration Pack Active',
      description: 'curated active pack',
      status: 'ACTIVE',
      publicCode: 'active_pack_code',
      protectContent: true,
      items: [
        { contentId: contentVideo._id, sortOrder: 0, enabled: true },
        { contentId: contentPhoto._id, sortOrder: 1, enabled: true },
        { contentId: contentText._id, sortOrder: 2, enabled: true }
      ]
    });
    console.log('Seeded ACTIVE Content Pack:', activePack.publicCode);

    // Seed expired pack
    const expiredPack = await ContentPack.create({
      botId: testBot._id,
      name: 'Test Integration Pack Expired',
      status: 'ACTIVE',
      publicCode: 'expired_pack_code',
      expiresAt: new Date(Date.now() - 10000), // 10s in past
      items: [
        { contentId: contentText._id, sortOrder: 0, enabled: true }
      ]
    });
    console.log('Seeded EXPIRED Content Pack:', expiredPack.publicCode);

    // Seed disabled pack
    const disabledPack = await ContentPack.create({
      botId: testBot._id,
      name: 'Test Integration Pack Disabled',
      status: 'DISABLED',
      publicCode: 'disabled_pack_code',
      items: [
        { contentId: contentText._id, sortOrder: 0, enabled: true }
      ]
    });
    console.log('Seeded DISABLED Content Pack:', disabledPack.publicCode);

    // Spy on Telegram.prototype.callApi calls
    const originalCallApi = Telegram.prototype.callApi;

    const apiCalls = [];
    const mockCallApi = async function(method, data) {
      console.log(`[MOCK TELEGRAM API] Call: ${method} | data:`, JSON.stringify(data));
      apiCalls.push({ method, data });

      if (method === 'getMe') {
        return { id: 12345678, is_bot: true, first_name: 'Test Bot', username: 'test_content_pack_bot' };
      }
      if (method === 'sendMessage') {
        const msgId = Math.floor(Math.random() * 100000);
        return { message_id: msgId, chat: { id: data.chat_id }, date: Date.now(), text: data.text };
      }
      if (method === 'sendVideo' || method === 'sendPhoto' || method === 'sendDocument') {
        const msgId = Math.floor(Math.random() * 100000);
        const isPhoto = method === 'sendPhoto';
        return { 
          message_id: msgId, 
          chat: { id: data.chat_id }, 
          date: Date.now(), 
          video: method === 'sendVideo' ? { file_id: 'mock_video_id', file_unique_id: 'mock_video_uid' } : undefined,
          document: method === 'sendDocument' ? { file_id: 'mock_doc_id', file_unique_id: 'mock_doc_uid' } : undefined,
          photo: isPhoto ? [{ file_id: 'mock_photo_id', file_unique_id: 'mock_photo_uid' }] : undefined
        };
      }
      if (method === 'sendMediaGroup') {
        const baseMsgId = Math.floor(Math.random() * 100000);
        return data.media.map((m, idx) => ({
          message_id: baseMsgId + idx,
          chat: { id: data.chat_id },
          date: Date.now(),
          video: m.type === 'video' ? { file_id: `mock_grouped_id_${idx}`, file_unique_id: `mock_grouped_uid_${idx}` } : undefined,
          photo: m.type === 'photo' ? [{ file_id: `mock_grouped_id_${idx}`, file_unique_id: `mock_grouped_uid_${idx}` }] : undefined
        }));
      }
      return true;
    };

    Telegram.prototype.callApi = mockCallApi;

    // Attach bot context properties just like middleware does
    bot.use(async (ctx, next) => {
      ctx.state.botId = testBot._id;
      ctx.state.settings = await Setting.getSettings(testBot._id);
      await next();
    });

    // ----------------------------------------------------
    // TEST 1: Normal plain /start flow
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Simulating Plain /start (No parameters) ---');
    apiCalls.length = 0;
    const plainStartUpdate = {
      update_id: 200001,
      message: {
        message_id: 300001,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
        chat: { id: TEST_USER_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }
    };
    await bot.handleUpdate(plainStartUpdate);

    // Verify: ONLY welcome message is sent, NO media or content pack files
    const plainStartMessages = apiCalls.filter(c => c.method === 'sendMessage');
    console.log(`sendMessage calls: ${plainStartMessages.length}`);
    const mediaCalls = apiCalls.filter(c => ['sendVideo', 'sendPhoto', 'sendMediaGroup'].includes(c.method));
    console.log(`Media delivery calls: ${mediaCalls.length} (Expected: 0)`);
    if (mediaCalls.length > 0) {
      throw new Error('FAILED: Plain start sent media automatically.');
    }
    console.log('SUCCESS: Plain start is clean.');

    // ----------------------------------------------------
    // TEST 2: Active Pack deep link flow
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Simulating Deep Link /start pack_active_pack_code ---');
    apiCalls.length = 0;
    const packStartUpdate = {
      update_id: 200002,
      message: {
        message_id: 300002,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
        chat: { id: TEST_USER_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start pack_active_pack_code',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }
    };
    await bot.handleUpdate(packStartUpdate);

    // Verify:
    // - NO welcome message (normal start welcome bypassed)
    // - Media items (video & photo) grouped in sendMediaGroup
    // - Text item sent via sendMessage
    // - protect_content: true passed in parameters
    const packSendGroup = apiCalls.find(c => c.method === 'sendMediaGroup');
    const packSendText = apiCalls.find(c => c.method === 'sendMessage');
    
    console.log('sendMediaGroup detected:', packSendGroup ? 'YES' : 'NO');
    console.log('sendMessage detected:', packSendText ? 'YES' : 'NO');
    console.log('Group size:', packSendGroup?.data?.media?.length);
    console.log('Group protect_content:', packSendGroup?.data?.protect_content);
    console.log('Text protect_content:', packSendText?.data?.protect_content);

    if (!packSendGroup || !packSendText || packSendGroup.data.media.length !== 2) {
      throw new Error('FAILED: Media grouping or sequencing is incorrect.');
    }
    if (packSendGroup.data.protect_content !== true || packSendText.data.protect_content !== true) {
      throw new Error('FAILED: Content protection option was not respected.');
    }

    // Verify delivery batch & deliveries in DB
    const userDoc = await User.findOne({ telegramUserId: TEST_USER_ID });
    const batch = await DeliveryBatch.findOne({ userId: userDoc._id, packId: activePack._id });
    console.log('DeliveryBatch status:', batch?.status);
    console.log('Success count:', batch?.successCount);
    console.log('Message count:', batch?.messageCount);

    const packDeliveries = await Delivery.find({ userId: userDoc._id, packId: activePack._id });
    console.log(`Deliveries logged in DB: ${packDeliveries.length} (Expected: 3)`);

    if (packDeliveries.length !== 3 || batch.status !== 'completed' || batch.successCount !== 3) {
      throw new Error('FAILED: Database delivery tracking or batch logs missing.');
    }
    console.log('SUCCESS: Active pack delivery and tracking completed.');

    // ----------------------------------------------------
    // TEST 3: Duplicate request check (idempotency)
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Simulating duplicate Telegram Update (same update_id) ---');
    apiCalls.length = 0;
    // Send same packStartUpdate again (update_id: 200002)
    await bot.handleUpdate(packStartUpdate);
    console.log(`API calls made on duplicate: ${apiCalls.length} (Expected: 0)`);
    if (apiCalls.length > 0) {
      throw new Error('FAILED: Idempotency filter failed to block duplicate updates.');
    }
    console.log('SUCCESS: Duplicate update ignored.');

    // ----------------------------------------------------
    // TEST 4: Expired Pack flow
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Simulating Expired Pack link ---');
    apiCalls.length = 0;
    const expiredStartUpdate = {
      update_id: 200003,
      message: {
        message_id: 300003,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
        chat: { id: TEST_USER_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start pack_expired_pack_code',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }
    };
    await bot.handleUpdate(expiredStartUpdate);

    const expiredMsg = apiCalls.find(c => c.method === 'sendMessage');
    console.log('Response text:', expiredMsg?.data?.text);
    if (expiredMsg?.data?.text !== '❌ This post is no longer available.') {
      throw new Error('FAILED: Did not show safe invalid message for expired pack.');
    }
    console.log('SUCCESS: Expired link blocked.');

    // ----------------------------------------------------
    // TEST 5: Disabled Pack flow
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Simulating Disabled Pack link ---');
    apiCalls.length = 0;
    const disabledStartUpdate = {
      update_id: 200004,
      message: {
        message_id: 300004,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
        chat: { id: TEST_USER_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start pack_disabled_pack_code',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }
    };
    await bot.handleUpdate(disabledStartUpdate);

    const disabledMsg = apiCalls.find(c => c.method === 'sendMessage');
    console.log('Response text:', disabledMsg?.data?.text);
    if (disabledMsg?.data?.text !== '❌ This post is no longer available.') {
      throw new Error('FAILED: Did not show safe invalid message for disabled pack.');
    }
    console.log('SUCCESS: Disabled link blocked.');

    // ----------------------------------------------------
    // TEST 6: Simulating Deep Link /start p_active_pack_code
    // ----------------------------------------------------
    console.log('\n--- TEST 6: Simulating Deep Link /start p_active_pack_code ---');
    apiCalls.length = 0;
    const pStartUpdate = {
      update_id: 200005,
      message: {
        message_id: 300005,
        from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test', username: 'testuser' },
        chat: { id: TEST_USER_ID, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start p_active_pack_code',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }]
      }
    };
    await bot.handleUpdate(pStartUpdate);

    const pSendGroup = apiCalls.find(c => c.method === 'sendMediaGroup');
    const pSendText = apiCalls.find(c => c.method === 'sendMessage');
    console.log('sendMediaGroup detected for p_ prefix:', pSendGroup ? 'YES' : 'NO');
    console.log('sendMessage detected for p_ prefix:', pSendText ? 'YES' : 'NO');
    if (!pSendGroup || !pSendText) {
      throw new Error('FAILED: p_ deep link did not deliver active pack.');
    }
    console.log('SUCCESS: p_ deep link lookup and delivery completed.');

    // Restore original functions
    Telegram.prototype.callApi = originalCallApi;

    console.log('\nContent Pack Flow Integration tests completed successfully!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Test Execution Failed:', error);
    process.exit(1);
  }
}

runTests();
