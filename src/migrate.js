import mongoose from 'mongoose';
import dns from 'dns';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (err) {}

import { Content } from './models/Content.js';

async function run() {
  console.log('Connecting to MongoDB:', process.env.MONGODB_URI);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB.');
  const res = await Content.updateMany(
    { storageKey: { $exists: true } },
    { $unset: { telegramFileId: '' } }
  );
  console.log('Migration completed successfully:', res);
  await mongoose.disconnect();
}
run().catch(console.error);
