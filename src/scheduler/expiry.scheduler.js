import cron from 'node-cron';
import { ContentPack } from '../models/ContentPack.js';
import { Content } from '../models/Content.js';
import { Link } from '../models/Link.js';

let cronTask = null;

/**
 * Runs the deactivation job for expired packs and links
 */
export async function runExpiryJob() {
  try {
    const now = new Date();
    
    // Find ACTIVE/published packs that have expiresAt and are expired
    const expiredPacks = await ContentPack.find({
      status: { $in: ['ACTIVE', 'published'] },
      expiresAt: { $exists: true, $ne: null, $lte: now }
    });

    if (expiredPacks.length > 0) {
      console.log(`ExpiryScheduler: Found ${expiredPacks.length} expired pack(s) to deactivate.`);
      for (const pack of expiredPacks) {
        pack.status = 'expired';
        await pack.save();

        // Deactivate all child Content items
        if (pack.items && pack.items.length > 0) {
          for (const item of pack.items) {
            await Content.updateOne(
              { _id: item.contentId },
              { $set: { status: 'inactive' } }
            );
          }
        }
        
        console.log(`ExpiryScheduler: Deactivated expired pack ${pack._id} (${pack.publicCode})`);
      }
    }

    // Find active links that have expiresAt and are expired
    const expiredLinks = await Link.find({
      status: 'active',
      expiresAt: { $exists: true, $ne: null, $lte: now }
    });

    if (expiredLinks.length > 0) {
      console.log(`ExpiryScheduler: Found ${expiredLinks.length} expired link(s) to deactivate.`);
      for (const link of expiredLinks) {
        link.status = 'expired';
        await link.save();
        console.log(`ExpiryScheduler: Deactivated expired link ${link._id} (Token: ${link.token})`);
      }
    }
  } catch (error) {
    console.error('ExpiryScheduler: Error running expiry check job:', error.message);
  }
}

/**
 * Starts the deactivation scheduler (running every minute)
 */
export function startExpiryScheduler() {
  if (cronTask) {
    console.log('ExpiryScheduler: Expiry scheduler is already running.');
    return;
  }
  
  // Run every minute
  cronTask = cron.schedule('* * * * *', () => {
    runExpiryJob().catch((err) => {
      console.error('ExpiryScheduler: cron task error:', err.message);
    });
  });
  
  console.log('ExpiryScheduler: Post expiry scheduler started (running every minute).');
}

/**
 * Stops the deactivation scheduler
 */
export function stopExpiryScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('ExpiryScheduler: Expiry scheduler stopped.');
  }
}
