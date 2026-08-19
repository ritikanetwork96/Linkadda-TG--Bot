import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';

try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (err) {}

dotenv.config();

import { DeliveryBatch } from './models/DeliveryBatch.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  const batches = await DeliveryBatch.find({}).sort({ startedAt: -1 }).limit(5);
  console.log('--- RECENT BATCHES ---');
  batches.forEach(b => {
    console.log(`Batch ID: ${b._id}`);
    console.log(`Pack ID: ${b.packId}`);
    console.log(`User ID: ${b.userId}`);
    console.log(`Status: ${b.status}`);
    console.log(`Success Count: ${b.successCount}`);
    console.log(`Failure Count: ${b.failureCount}`);
    console.log(`Started At: ${b.startedAt}`);
    console.log(`Completed At: ${b.completedAt}`);
    console.log('---');
  });

  await mongoose.disconnect();
}

run().catch(console.error);
