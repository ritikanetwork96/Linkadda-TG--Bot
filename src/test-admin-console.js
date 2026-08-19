import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Standardize environmental config
process.env.ADMIN_TELEGRAM_IDS = '88888888,123456789';

import { config } from './config/env.js';
config.adminTelegramIds = ['88888888', '123456789'];

import { User } from './models/User.js';
import { Content } from './models/Content.js';
import { Category } from './models/Category.js';
import { ContentPack } from './models/ContentPack.js';
import { Setting } from './models/Setting.js';
import { AdminSession } from './models/AdminSession.js';
import { Broadcast } from './models/Broadcast.js';
import { EventLog } from './models/EventLog.js';
import { ActivityLog } from './models/ActivityLog.js';
import { Admin } from './models/Admin.js';
import { Bot } from './models/Bot.js';
import { BotMenu } from './models/BotMenu.js';
import { Delivery } from './models/Delivery.js';
import { DeliveryBatch } from './models/DeliveryBatch.js';
import { MediaBundle } from './models/MediaBundle.js';
import { ContentSequence } from './models/ContentSequence.js';
import { SequenceDelivery } from './models/SequenceDelivery.js';
import { startHandler } from './bot/handlers/start.handler.js';
import { handleAdminStart, handleAdminCallback, handleAdminMessage } from './bot/handlers/admin.handler.js';
import { Telegram } from 'telegraf';

// In-Memory Database collections mock
const collections = {
  users: [],
  contents: [],
  categories: [],
  content_packs: [],
  settings: [],
  admin_sessions: [],
  broadcasts: [],
  event_logs: [],
  activity_logs: [],
  admins: [],
  bot_menus: [],
  deliveries: [],
  delivery_batches: [],
  bots: [],
  media_bundles: [],
  content_sequences: [],
  sequence_deliveries: []
};

mongoose.connect = async () => {
  console.log('[MOCK MONGOOSE] Connected to local memory DB.');
  return true;
};
mongoose.disconnect = async () => {
  console.log('[MOCK MONGOOSE] Disconnected.');
  return true;
};

// Mock query logic
function mockModel(model, collectionName) {
  model.find = function(query = {}) {
    let list = collections[collectionName];
    if (query.botId) list = list.filter(x => String(x.botId) === String(query.botId));
    if (query.isDemo !== undefined) list = list.filter(x => x.isDemo === query.isDemo);
    if (query.adminTelegramId) list = list.filter(x => x.adminTelegramId === query.adminTelegramId);
    if (query.publicCode) list = list.filter(x => x.publicCode === query.publicCode);

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

  model.findByIdAndDelete = async function(id) {
    const idx = collections[collectionName].findIndex(x => String(x._id) === String(id));
    if (idx > -1) {
      const item = collections[collectionName][idx];
      collections[collectionName].splice(idx, 1);
      return item;
    }
    return null;
  };

  model.deleteMany = async function(query = {}) {
    let count = 0;
    const toKeep = [];
    collections[collectionName].forEach(x => {
      let match = true;
      if (query.botId && String(x.botId) !== String(query.botId)) match = false;
      if (query.isDemo !== undefined && x.isDemo !== query.isDemo) match = false;
      
      if (match) {
        count++;
      } else {
        toKeep.push(x);
      }
    });
    collections[collectionName] = toKeep;
    return { deletedCount: count };
  };

  model.exists = async function(query = {}) {
    const list = await model.find(query);
    return list.length > 0;
  };

  model.countDocuments = async function(query = {}) {
    const list = await model.find(query);
    return list.length;
  };

  model.create = async function(doc) {
    const newDoc = {
      _id: new mongoose.Types.ObjectId(),
      ...doc,
      save: async function() {
        return this;
      },
      toObject: function() {
        return this;
      },
      markModified: function(path) {
        // dummy mock
      }
    };
    collections[collectionName].push(newDoc);
    return newDoc;
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
}

mockModel(User, 'users');
mockModel(Content, 'contents');
mockModel(Category, 'categories');
mockModel(ContentPack, 'content_packs');
mockModel(Setting, 'settings');
mockModel(AdminSession, 'admin_sessions');
mockModel(Broadcast, 'broadcasts');
mockModel(EventLog, 'event_logs');
mockModel(ActivityLog, 'activity_logs');
mockModel(Admin, 'admins');
mockModel(BotMenu, 'bot_menus');
mockModel(Delivery, 'deliveries');
mockModel(DeliveryBatch, 'delivery_batches');
mockModel(Bot, 'bots');
mockModel(MediaBundle, 'media_bundles');
mockModel(ContentSequence, 'content_sequences');
mockModel(SequenceDelivery, 'sequence_deliveries');

// Mock specific static methods
Setting.getSettings = async function(botId) {
  let s = collections.settings.find(x => String(x.botId) === String(botId));
  if (!s) {
    s = await Setting.create({
      botId,
      welcomeMessage: 'Welcome to normal bot!',
      botEnabled: true,
      startContentEnabled: true,
      autoDeleteEnabled: true,
      autoDeleteHours: 24
    });
  }
  return s;
};

AdminSession.getSession = async function(adminTelegramId) {
  let session = collections.admin_sessions.find(x => x.adminTelegramId === adminTelegramId);
  if (!session) {
    session = await AdminSession.create({
      adminTelegramId,
      draft: {
        type: 'text',
        telegramFileId: '',
        fileUniqueId: '',
        caption: '',
        buttons: [],
        layout: '1'
      },
      packDraft: {
        name: '',
        description: '',
        selectedItems: []
      },
      categoryDraft: {
        name: ''
      }
    });
  }
  return session;
};

EventLog.log = async function(eventType, userId, telegramUserId, targetId = '', metadata = {}, botId = null) {
  return await EventLog.create({
    eventType,
    userId,
    telegramUserId,
    targetId,
    metadata,
    botId,
    timestamp: new Date()
  });
};

ActivityLog.log = async function(action, adminId, status = 'success', metadata = {}) {
  return await ActivityLog.create({
    action,
    adminId,
    status,
    metadata,
    timestamp: new Date()
  });
};

// Mock Telegraf CallApi
let apiCalls = [];
Telegram.prototype.callApi = async function(method, data) {
  apiCalls.push({ method, data });
  if (method === 'getMe') {
    return { id: 99999, username: 'test_admin_bot', first_name: 'Admin Bot' };
  }
  if (method === 'sendMediaGroup') {
    return (data.media || []).map((m, idx) => ({
      message_id: Math.floor(Math.random() * 100000) + idx,
      photo: m.type === 'photo' ? [{ file_id: m.media }] : undefined,
      video: m.type === 'video' ? { file_id: m.media } : undefined
    }));
  }
  return { message_id: Math.floor(Math.random() * 100000) };
};

const testBotId = new mongoose.Types.ObjectId();

// Test context builder
function createTestContext(userId, text = '', isCallback = false, callbackData = '', payload = '') {
  const ctx = {
    from: { id: userId, username: 'tester', first_name: 'Tester' },
    chat: { id: 88888888, type: 'private' },
    state: {
      botId: testBotId,
      settings: { welcomeMessage: 'Welcome to normal bot!', botEnabled: true }
    },
    botInfo: { id: 99999, username: 'test_admin_bot' },
    reply: async (text, options) => {
      apiCalls.push({ method: 'sendMessage', data: { chat_id: 88888888, text, ...options } });
      return { message_id: 111 };
    },
    replyWithPhoto: async (photo, options) => {
      apiCalls.push({ method: 'sendPhoto', data: { chat_id: 88888888, photo, ...options } });
      return { message_id: 222 };
    },
    editMessageText: async (text, options) => {
      apiCalls.push({ method: 'editMessageText', data: { text, ...options } });
      return true;
    },
    answerCbQuery: async (text, options) => {
      apiCalls.push({ method: 'answerCbQuery', data: { text, ...options } });
      return true;
    },
    telegram: new Telegram('')
  };

  if (isCallback) {
    ctx.callbackQuery = { data: callbackData };
  } else {
    ctx.message = { text };
    ctx.payload = payload;
  }
  return ctx;
}

// RUN TESTS
async function runTests() {
  console.log('--- STARTING ADMIN CONSOLE INTEGRATION TESTS ---');

  // Seed default admin document
  await Admin.create({ email: 'admin@bot.com', password: 'hash', name: 'SuperAdmin' });

  // Seed default bot configuration
  await Bot.create({
    telegramBotId: 99999,
    username: 'test_admin_bot',
    status: 'active'
  });

  // Test 1: Unauthorized user /start without parameter
  console.log('\n--- TEST 1: Unauthorized user start ---');
  apiCalls = [];
  const ctxUser = createTestContext(11111, '/start');
  await startHandler(ctxUser);
  const userStartMsg = apiCalls.find(c => c.method === 'sendMessage');
  if (userStartMsg && userStartMsg.data.text.includes('Welcome to normal bot')) {
    console.log('SUCCESS: Unauthorized user got welcome message (not Admin Console).');
  } else {
    throw new Error('FAILED: Unauthorized user bypassed flow.');
  }

  // Test 2: Authorized Admin /start without parameter
  console.log('\n--- TEST 2: Authorized Admin start ---');
  apiCalls = [];
  const ctxAdmin = createTestContext(88888888, '/start');
  await handleAdminStart(ctxAdmin);
  const adminStartMsg = apiCalls.find(c => c.method === 'sendMessage');
  if (adminStartMsg && adminStartMsg.data.text.includes('ADMIN CONTROL CENTER')) {
    console.log('SUCCESS: Authorized admin reached the Admin dashboard.');
  } else {
    throw new Error('FAILED: Admin failed to reach console.');
  }

  // Test 3: Enter Post Composer & Create Bundle
  console.log('\n--- TEST 3: Enter Post Composer & Create Bundle ---');
  apiCalls = [];
  const ctxComposer = createTestContext(88888888, '', true, 'admin:post:menu');
  await handleAdminCallback(ctxComposer);
  
  const ctxCreateBtn = createTestContext(88888888, '', true, 'admin:bundle:create');
  await handleAdminCallback(ctxCreateBtn);

  let session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.state !== 'WAITING_FOR_BUNDLE_TITLE') {
    throw new Error('FAILED: State did not transition to WAITING_FOR_BUNDLE_TITLE.');
  }

  const ctxTitleMsg = createTestContext(88888888, 'My Test Bundle Post');
  await handleAdminMessage(ctxTitleMsg);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.currentBundleId && session.state === 'IDLE') {
    console.log('SUCCESS: Bundle created and currentBundleId saved.');
  } else {
    throw new Error('FAILED: Could not create bundle.');
  }

  // Test 4: Upload Photo flow
  console.log('\n--- TEST 4: Photo attachment flow ---');
  apiCalls = [];
  const ctxAddMedia = createTestContext(88888888, '', true, 'admin:bundle:media:add');
  await handleAdminCallback(ctxAddMedia);

  const ctxStartBatch = createTestContext(88888888, '', true, 'admin:bundle:media:batch:start');
  await handleAdminCallback(ctxStartBatch);
  
  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.state !== 'WAITING_FOR_BUNDLE_MEDIA_BATCH') {
    throw new Error('FAILED: State did not transition to WAITING_FOR_BUNDLE_MEDIA_BATCH.');
  }

  // Send photo message
  const ctxPhotoMsg = createTestContext(88888888);
  ctxPhotoMsg.message.photo = [{ file_id: 'ph_123', file_unique_id: 'ph_uniq_123' }];
  await handleAdminMessage(ctxPhotoMsg);
  
  // Send /done command to finalize batch
  const ctxDoneMsg = createTestContext(88888888, '/done');
  await handleAdminMessage(ctxDoneMsg);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  const bundle = collections.media_bundles.find(b => String(b._id) === String(session.currentBundleId));
  if (bundle && bundle.mediaItems.length > 0 && bundle.mediaItems[0].telegramFileId === 'ph_123' && session.state === 'IDLE') {
    console.log('SUCCESS: Photo attached, state restored to IDLE.');
  } else {
    throw new Error('FAILED: Photo was not saved to draft.');
  }

  // Test 5: Add Caption flow
  console.log('\n--- TEST 5: Caption text flow ---');
  const ctxCapBtn = createTestContext(88888888, '', true, 'admin:bundle:text');
  await handleAdminCallback(ctxCapBtn);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.state !== 'WAITING_FOR_BUNDLE_TEXT') {
    throw new Error('FAILED: State did not transition to WAITING_FOR_BUNDLE_TEXT.');
  }

  // Send caption message
  const ctxCapMsg = createTestContext(88888888, 'Hello <b>Admin</b> world!');
  await handleAdminMessage(ctxCapMsg);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  const updatedBundle = collections.media_bundles.find(b => String(b._id) === String(session.currentBundleId));
  if (updatedBundle && updatedBundle.text === 'Hello <b>Admin</b> world!' && session.state === 'IDLE') {
    console.log('SUCCESS: Caption saved to draft.');
  } else {
    throw new Error('FAILED: Caption text was not saved.');
  }

  // Test 6: URL Button flow
  console.log('\n--- TEST 6: URL Button flow ---');
  const ctxBtnClick = createTestContext(88888888, '', true, 'admin:bundle:buttons');
  await handleAdminCallback(ctxBtnClick);

  const ctxAddBtnClick = createTestContext(88888888, '', true, 'admin:bundle:btn:add');
  await handleAdminCallback(ctxAddBtnClick);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.state !== 'WAITING_FOR_BUNDLE_BUTTON_TEXT') {
    throw new Error('FAILED: State did not transition to WAITING_FOR_BUNDLE_BUTTON_TEXT.');
  }

  // Send button text
  const ctxBtnText = createTestContext(88888888, 'Google Link');
  await handleAdminMessage(ctxBtnText);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  if (session.state !== 'WAITING_FOR_BUNDLE_BUTTON_URL') {
    throw new Error('FAILED: State did not transition to WAITING_FOR_BUNDLE_BUTTON_URL.');
  }

  // Send button url
  const ctxBtnUrl = createTestContext(88888888, 'https://google.com');
  await handleAdminMessage(ctxBtnUrl);

  session = collections.admin_sessions.find(x => x.adminTelegramId === 88888888);
  const finalBundle = collections.media_bundles.find(b => String(b._id) === String(session.currentBundleId));
  const btn = finalBundle?.buttons[0];
  if (btn && btn.text === 'Google Link' && btn.url === 'https://google.com' && session.state === 'IDLE') {
    console.log('SUCCESS: Link Button added to draft.');
  } else {
    throw new Error('FAILED: Button was not added to list.');
  }

  // Test 7: Send Preview post
  console.log('\n--- TEST 7: Preview dispatch ---');
  apiCalls = [];
  const ctxPreview = createTestContext(88888888, '', true, 'admin:bundle:preview');
  await handleAdminCallback(ctxPreview);
  const previewMedia = apiCalls.find(c => c.method === 'sendMediaGroup');
  const previewText = apiCalls.find(c => c.method === 'sendMessage' && c.data.text && c.data.text.includes('Hello <b>Admin</b> world!'));
  if (previewMedia && previewMedia.data.media[0].media === 'ph_123' && previewText && previewText.data.reply_markup?.inline_keyboard[0][0].text === 'Google Link') {
    console.log('SUCCESS: Real preview message delivered to admin chat.');
  } else {
    throw new Error('FAILED: Preview was not sent.');
  }

  // Test 8: Load Demo Data
  console.log('\n--- TEST 8: Demo data seeder duplicates check ---');
  apiCalls = [];
  const ctxSeed = createTestContext(88888888, '', true, 'admin:demo:seed');
  await handleAdminCallback(ctxSeed);

  const packsCount = collections.content_packs.length;
  const catsCount = collections.categories.length;
  const itemsCount = collections.contents.length;

  if (packsCount === 1 && catsCount === 5 && itemsCount === 8) {
    console.log('SUCCESS: Demo records created accurately.');
  } else {
    throw new Error(`FAILED: Seed counts mismatch (packs:${packsCount}, cats:${catsCount}, contents:${itemsCount})`);
  }

  // Click seed again
  apiCalls = [];
  await handleAdminCallback(ctxSeed);
  if (collections.content_packs.length === 1) {
    console.log('SUCCESS: Seeder duplicates gate working correctly.');
  } else {
    throw new Error('FAILED: Duplicate demo packs created.');
  }

  // Test 9: Clear Demo Data
  console.log('\n--- TEST 9: Clear demo data ---');
  const ctxClear = createTestContext(88888888, '', true, 'admin:demo:clear');
  await handleAdminCallback(ctxClear);
  if (collections.content_packs.length === 0 && collections.categories.length === 0) {
    console.log('SUCCESS: Clear demo records successfully deleted only demo items.');
  } else {
    throw new Error('FAILED: Demo data clear failed.');
  }

  console.log('\n--- ALL ADMIN CONSOLE TESTS COMPLETED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.log('API CALLS ON FAILURE:', JSON.stringify(apiCalls, null, 2));
  console.error(err);
  process.exit(1);
});
