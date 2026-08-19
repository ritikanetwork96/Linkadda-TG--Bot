import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (err) {}

dotenv.config();

import { User } from './models/User.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB.');

  const users = await User.find({});
  console.log(`Total users in DB: ${users.length}`);
  users.forEach(u => {
    console.log(`- ID: ${u._id}`);
    console.log(`  Telegram User ID: ${u.telegramUserId}`);
    console.log(`  Username: ${u.username}`);
    console.log(`  Status: ${u.status}`);
    console.log(`  BotId: ${u.botId}`);
    console.log(`  Created At: ${u.createdAt}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
