/**
 * Fix User Index via existing server MongoDB connection
 * This runs as an Express route hit — uses the already-established connection
 * 
 * Hit: GET http://localhost:3000/api/health/fix-user-index
 * (temporary one-time fix endpoint)
 */

import mongoose from 'mongoose';

export async function fixUserIndexHandler(req, res) {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // List current indexes
    const indexes = await collection.indexes();
    const indexNames = indexes.map(idx => `${idx.name}${idx.unique ? ' (UNIQUE)' : ''}`);

    // Drop only the OLD standalone unique index if present
    const oldUniqueIndex = indexes.find(idx => idx.name === 'telegramUserId_1' && idx.unique);
    let dropped = false;

    if (oldUniqueIndex) {
      await collection.dropIndex('telegramUserId_1');
      dropped = true;
    }

    // List updated indexes
    const updatedIndexes = await collection.indexes();
    const updatedNames = updatedIndexes.map(idx => `${idx.name}${idx.unique ? ' (UNIQUE)' : ''}`);

    return res.json({
      status: 'success',
      dropped,
      message: dropped ? 'Old telegramUserId_1 unique index dropped successfully!' : 'Index was not found or already cleaned up.',
      before: indexNames,
      after: updatedNames,
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
}
