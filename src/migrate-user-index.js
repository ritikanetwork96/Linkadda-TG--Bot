/**
 * Migration Script: Fix User collection indexes
 * 
 * Problem: Old unique index on telegramUserId_1 conflicts with new compound index.
 * Solution: Drop the old single unique index, keep the new compound {botId, telegramUserId} one.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function fixUserIndexes() {
  console.log('Migration: Connecting to MongoDB...');
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Migration: Connected!');

  const db = mongoose.connection.db;
  const collection = db.collection('users');

  // List current indexes
  const indexes = await collection.indexes();
  console.log('\nCurrent indexes on users collection:');
  indexes.forEach(idx => {
    console.log(`  - ${idx.name}:`, JSON.stringify(idx.key), idx.unique ? '(UNIQUE)' : '');
  });

  // Drop the old standalone unique index if it exists
  const oldIndex = indexes.find(idx => idx.name === 'telegramUserId_1' && idx.unique);
  if (oldIndex) {
    console.log('\nMigration: Dropping old unique index "telegramUserId_1"...');
    await collection.dropIndex('telegramUserId_1');
    console.log('Migration: Old index dropped successfully!');
  } else {
    console.log('\nMigration: Old unique index not found or already cleaned up.');
  }

  // List updated indexes
  const updatedIndexes = await collection.indexes();
  console.log('\nUpdated indexes on users collection:');
  updatedIndexes.forEach(idx => {
    console.log(`  - ${idx.name}:`, JSON.stringify(idx.key), idx.unique ? '(UNIQUE)' : '');
  });

  console.log('\nMigration: Done! Disconnecting...');
  await mongoose.disconnect();
  console.log('Migration: Complete.');
}

fixUserIndexes().catch(err => {
  console.error('Migration FAILED:', err.message);
  process.exit(1);
});
