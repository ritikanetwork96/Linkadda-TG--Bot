import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { Link } from './models/Link.js';
import { AdminSession } from './models/AdminSession.js';
import { Content } from './models/Content.js';

async function testAll() {
  console.log('--- STARTING MULTI-MEDIA LINK COLLECTION INTEGRATION TESTS ---');
  
  // Connect DB
  await connectDatabase();

  const adminTelegramId = 987654321;

  // 1. Reset any existing test session
  await AdminSession.deleteOne({ adminTelegramId });
  await Link.deleteMany({ createdBy: adminTelegramId.toString() });

  // 2. Fetch or create Admin Session
  console.log('Step 2: Getting admin session...');
  const session = await AdminSession.getSession(adminTelegramId);
  console.log('Session initialized:', !!session);

  // 3. Start Link Draft
  console.log('Step 3: Starting link draft...');
  session.state = 'LINK_DRAFT_ADD';
  session.linkDraft = {
    status: 'draft',
    items: [],
    expiresAt: null,
    updatedAt: new Date()
  };
  await session.save();

  // 4. Add Text Item
  console.log('Step 4: Adding text item to draft...');
  session.linkDraft.items.push({
    type: 'text',
    text: 'Hello, this is a test caption text!',
    sortOrder: session.linkDraft.items.length
  });
  session.state = 'LINK_DRAFT_WAIT_NEXT';
  session.markModified('linkDraft');
  await session.save();

  // 5. Add Photo Item (Mock content reference)
  console.log('Step 5: Adding photo item to draft...');
  const mockContent = await Content.create({
    title: 'test_image.jpg',
    type: 'photo',
    storageKey: 'collections/test_image_key.jpg',
    storageBucket: 'test-bucket',
    mimeType: 'image/jpeg',
    telegramFileUniqueId: 'unique_photo_file_id',
    telegramFileId: 'photo_file_id',
    status: 'active'
  });

  session.linkDraft.items.push({
    type: 'photo',
    mediaId: mockContent._id,
    caption: 'Sample photo caption',
    sortOrder: session.linkDraft.items.length
  });
  session.markModified('linkDraft');
  await session.save();

  console.log('Draft items count:', session.linkDraft.items.length);
  if (session.linkDraft.items.length !== 2) {
    throw new Error('Draft items length should be 2!');
  }

  // 6. Finalize Link with 1 Hour Expiry
  console.log('Step 6: Finalizing link with 1 hour expiry...');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
  const token = crypto.randomBytes(6).toString('hex');

  const newLink = await Link.create({
    token,
    status: 'active',
    items: session.linkDraft.items,
    createdBy: adminTelegramId.toString(),
    expiresAt
  });

  console.log('Link created successfully! Token:', newLink.token);
  console.log('Link items count:', newLink.items.length);
  if (newLink.items.length !== 2) {
    throw new Error('Saved Link items length should be 2!');
  }

  // Clear session
  session.linkDraft = { status: 'idle', items: [], expiresAt: null, updatedAt: new Date() };
  session.state = 'IDLE';
  await session.save();

  // 7. Verify request-time expiry logic
  console.log('Step 7: Validating active link...');
  const activeLink = await Link.findOne({ token });
  const isExpired = activeLink && activeLink.expiresAt && new Date() > new Date(activeLink.expiresAt);
  const isValid = activeLink && activeLink.status === 'active' && !isExpired;
  console.log('Active Link valid:', isValid);
  if (!isValid) {
    throw new Error('Link should be valid!');
  }

  // 8. Verify expired link behavior
  console.log('Step 8: Validating expired link...');
  activeLink.expiresAt = new Date(Date.now() - 1000); // Set past time
  await activeLink.save();
  const isNowExpired = activeLink && activeLink.expiresAt && new Date() > new Date(activeLink.expiresAt);
  console.log('Expired Link expired:', isNowExpired);
  if (!isNowExpired) {
    throw new Error('Link should be expired!');
  }

  // Cleanup
  await Link.deleteOne({ token });
  await Content.deleteOne({ _id: mockContent._id });
  await AdminSession.deleteOne({ adminTelegramId });

  console.log('--- ALL INTEGRATION LOGICAL TESTS PASSED SUCCESSFULLY ---');
  await disconnectDatabase();
}

testAll().catch(async (err) => {
  console.error('❌ Test failed:', err.message);
  await disconnectDatabase();
  process.exit(1);
});
