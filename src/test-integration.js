import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import crypto from 'crypto';

// 1. Setup DNS to resolve Windows Node.js issues
try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (err) {}

// 2. Load Env
dotenv.config();

import { User } from './models/User.js';
import { Bot as BotModel } from './models/Bot.js';
import { Content } from './models/Content.js';
import { Delivery } from './models/Delivery.js';
import { Setting } from './models/Setting.js';
import { bot } from './bot/bot.js';
import { telegramService } from './services/telegram.service.js';
import { runDeletionJob } from './scheduler/deletion.scheduler.js';

async function runTests() {
  try {
    console.log('Connecting to database...');
    const mongoUri = (process.env.MONGODB_URI || '').replace(/:<([^>]+)>/, ':$1');
    await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB_NAME });
    console.log('Connected successfully.');

    // 1. Clear test user and deliveries if any
    const TEST_USER_ID = 99999999;
    await User.deleteOne({ telegramUserId: TEST_USER_ID });
    await Delivery.deleteMany({ telegramChatId: TEST_USER_ID });

    // 2. Seed test content
    await Content.deleteMany({ title: 'Test Integration Content' });
    const dummyContent = await Content.create({
      title: 'Test Integration Content',
      type: 'text',
      text: 'This is a test content message',
      status: 'active',
      isStartContent: true,
      sortOrder: 1
    });
    console.log('Dummy content seeded in MongoDB with ID:', dummyContent._id);

    // Mock settings
    const settings = await Setting.getSettings();
    settings.startContentEnabled = true;
    settings.autoDeleteEnabled = true;
    settings.autoDeleteHours = 24;
    await settings.save();

    // Spy on bot's telegram and telegramService.client calls using callApi
    const originalBotCallApi = bot.telegram.callApi;
    const originalServiceCallApi = telegramService.client.callApi;

    const mockCallApi = async (method, data) => {
      console.log(`[MOCK TELEGRAM API] Call: ${method} | data:`, JSON.stringify(data));
      if (method === 'sendMessage') {
        const msgId = Math.floor(Math.random() * 100000);
        return { message_id: msgId, chat: { id: data.chat_id }, date: Date.now(), text: data.text };
      }
      if (method === 'sendVideo' || method === 'sendPhoto' || method === 'sendDocument') {
        const msgId = Math.floor(Math.random() * 100000);
        const fileField = method.replace('send', '').toLowerCase();
        return { 
          message_id: msgId, 
          chat: { id: data.chat_id }, 
          date: Date.now(), 
          [fileField]: { file_id: 'mock_file_id', file_unique_id: 'mock_unique_id' } 
        };
      }
      return true;
    };

    bot.telegram.callApi = mockCallApi;
    telegramService.client.callApi = mockCallApi;

    // 3. Mock start command handler
    console.log('\n--- TEST 2 & 3: Simulating /start update ---');
    const startUpdate = {
      update_id: 100001,
      message: {
        message_id: 200001,
        from: {
          id: TEST_USER_ID,
          is_bot: false,
          first_name: 'Test',
          last_name: 'User',
          username: 'testuser_integration',
          language_code: 'en'
        },
        chat: {
          id: TEST_USER_ID,
          type: 'private',
          first_name: 'Test',
          last_name: 'User',
          username: 'testuser_integration'
        },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [
          {
            offset: 0,
            length: 6,
            type: 'bot_command'
          }
        ]
      }
    };
    
    // Process update
    await bot.handleUpdate(startUpdate);

    // Verify DB states
    const dbUser = await User.findOne({ telegramUserId: TEST_USER_ID });
    console.log('User saved in DB:', dbUser ? 'YES' : 'NO');
    console.log('User firstName:', dbUser?.firstName);
    console.log('User startedAt:', dbUser?.startedAt);

    const dbDeliveries = await Delivery.find({ telegramChatId: TEST_USER_ID });
    console.log(`Deliveries tracked in DB: ${dbDeliveries.length}`);
    dbDeliveries.forEach(d => {
      console.log(` - Delivery Type: ${d.messageType}, Batch ID: ${d.deliveryBatchId}, Delete At: ${d.deleteAt}`);
    });

    // 4. Test Deep Link
    console.log('\n--- TEST 4: Simulating deep link /start f_<content_id> ---');
    const deepLinkUpdate = {
      update_id: 100002,
      message: {
        message_id: 200002,
        from: {
          id: TEST_USER_ID,
          is_bot: false,
          first_name: 'Test',
          last_name: 'User',
          username: 'testuser_integration',
          language_code: 'en'
        },
        chat: {
          id: TEST_USER_ID,
          type: 'private',
        },
        date: Math.floor(Date.now() / 1000),
        text: `/start f_${dummyContent._id}`,
        entities: [
          {
            offset: 0,
            length: 6,
            type: 'bot_command'
          }
        ]
      }
    };

    await bot.handleUpdate(deepLinkUpdate);

    const postDeepLinkDeliveries = await Delivery.find({ telegramChatId: TEST_USER_ID });
    console.log(`Deliveries tracked in DB after deep link: ${postDeepLinkDeliveries.length}`);

    // 5. Test Scheduler Deletion
    console.log('\n--- TEST 7 & 8: Simulating Deletion Scheduler ---');
    // Force expire all delivery records in database
    await Delivery.updateMany(
      { telegramChatId: TEST_USER_ID },
      { $set: { deleteAt: new Date(Date.now() - 10000) } } // 10s in the past
    );
    console.log('Delivery records forced to expire in DB.');

    // Run deletion scheduler job logic
    await runDeletionJob();

    // Verify DB states after deletion
    const deletedDeliveries = await Delivery.find({ telegramChatId: TEST_USER_ID });
    console.log(`Deliveries after runDeletionJob:`);
    deletedDeliveries.forEach(d => {
      console.log(` - Delivery msgId: ${d.telegramMessageId}, status: ${d.status}`);
    });

    // Restore original functions
    bot.telegram.callApi = originalBotCallApi;
    telegramService.client.callApi = originalServiceCallApi;

    // Cleanup test data
    await User.deleteOne({ telegramUserId: TEST_USER_ID });
    await Delivery.deleteMany({ telegramChatId: TEST_USER_ID });
    await Content.deleteOne({ _id: dummyContent._id });

    console.log('\nIntegration tests completed successfully!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Test Execution Failed:', error);
    process.exit(1);
  }
}

runTests();
