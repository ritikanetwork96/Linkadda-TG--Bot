import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { Admin } from '../models/Admin.js';
import { Bot as BotModel } from '../models/Bot.js';
import { Category } from '../models/Category.js';
import { Content } from '../models/Content.js';
import { Delivery } from '../models/Delivery.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { Broadcast } from '../models/Broadcast.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { storageService } from '../services/storage.service.js';
import { telegramService } from '../services/telegram.service.js';
import { reinitializeBot } from '../bot/bot.js';
import { encrypt, decrypt, verifyPassword, hashPassword } from '../config/crypto.js';
import { broadcastService } from '../services/broadcast.service.js';
import { BotMenu } from '../models/BotMenu.js';
import { EventLog } from '../models/EventLog.js';
import { ContentPack } from '../models/ContentPack.js';
import { DeliveryBatch } from '../models/DeliveryBatch.js';

const router = express.Router();

// Express router param middleware to validate all MongoDB ObjectId parameters automatically
router.param('id', (req, res, next, id) => {
  if (id && !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid resource ID format.'
    });
  }
  next();
});

// Helper to escape regex special characters (prevent ReDoS attacks)
const escapeRegex = (string) => {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

// Help sanitize query parameters to string values only (prevents NoSQL injection objects)
const cleanQueryString = (val) => {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val.trim();
  return ''; // If it is an array or object, strip it
};

const cleanQueryInt = (val, defaultVal) => {
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultVal : parsed;
};

// Standard Param validation middleware for any MongoDB :id route variables
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid reference ID format.' });
  }
  next();
});

// Bot isolation middleware extracting active bot from header or DB status
const activeBotMiddleware = async (req, res, next) => {
  try {
    const xBotId = req.headers['x-bot-id'];
    if (xBotId && mongoose.Types.ObjectId.isValid(xBotId)) {
      req.botId = new mongoose.Types.ObjectId(xBotId);
      return next();
    }
    
    // Fall back to active bot in DB
    const activeBot = await BotModel.findOne({ status: 'connected' });
    if (activeBot) {
      req.botId = activeBot._id;
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Configure Multer for secure memory-buffered uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB (max Telegram upload limit)
  },
});

// Helper for asynchronous rate-limited sleeping
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      // General error to prevent user enumeration
      return res.status(401).json({ status: 'error', message: 'Invalid credentials.' });
    }

    const isMatch = verifyPassword(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name },
      config.adminJwtSecret,
      { expiresIn: '8h' }
    );

    // Write HttpOnly secure cookie
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    await ActivityLog.log('Admin login', admin._id, 'success', { email: admin.email });

    return res.json({
      status: 'success',
      message: 'Logged in successfully.',
      admin: { id: admin._id, email: admin.email, name: admin.name },
      token // also return in body for Authorization headers
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', authMiddleware, async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    res.clearCookie('admin_token');
    await ActivityLog.log('Admin logout', adminId, 'success');
    return res.json({ status: 'success', message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  return res.json({ status: 'success', admin: req.admin });
});

router.patch('/auth/update-profile', authMiddleware, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    const adminId = req.admin.id;

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({ status: 'error', message: 'Admin account not found.' });
    }

    if (email && email.toLowerCase() !== admin.email) {
      const emailExists = await Admin.findOne({ email: email.toLowerCase() });
      if (emailExists) {
        return res.status(400).json({ status: 'error', message: 'Email address already in use by another admin.' });
      }
      admin.email = email.toLowerCase();
    }

    if (name) {
      admin.name = name.trim();
    }

    if (password) {
      admin.password = hashPassword(password);
    }

    await admin.save();
    await ActivityLog.log('Admin profile updated', adminId, 'success', { email: admin.email });

    // Re-issue JWT so that the updated name/email is reflected immediately in /auth/me
    const newToken = jwt.sign(
      { id: admin._id, email: admin.email, name: admin.name },
      config.adminJwtSecret,
      { expiresIn: '8h' }
    );
    res.cookie('admin_token', newToken, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000,
    });

    return res.json({
      status: 'success',
      message: 'Profile updated successfully.',
      admin: { id: admin._id, email: admin.email, name: admin.name }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email address is required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      // General success message to prevent user enumeration
      return res.json({ status: 'success', message: 'If the email exists, a reset code has been sent to your Telegram admin IDs.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    admin.resetOtp = otp;
    admin.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await admin.save();

    // Send Telegram Notification
    const messageText = `🔑 *Linkaadda Bot Password Reset Request*\n\nSomeone requested a password reset for the admin account: *${admin.email}*.\n\nYour 6-digit OTP code is: *${otp}*\n\nThis code will expire in 10 minutes. If you did not request this, please ignore this message.`;

    const { adminBot, bot } = await import('../bot/bot.js');
    const adminIds = config.adminTelegramIds || [];

    for (const telegramId of adminIds) {
      try {
        if (adminBot) {
          await adminBot.telegram.sendMessage(telegramId, messageText, { parse_mode: 'Markdown' });
        } else {
          await bot.telegram.sendMessage(telegramId, messageText, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        console.error(`Failed to send password reset OTP to Telegram ID ${telegramId}:`, err.message);
      }
    }

    return res.json({ status: 'success', message: 'If the email exists, a reset code has been sent to your Telegram admin IDs.' });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/reset-password', async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Email, OTP code, and new password are required.' });
    }

    const admin = await Admin.findOne({ 
      email: email.toLowerCase(),
      resetOtp: otp,
      resetOtpExpires: { $gt: new Date() }
    });

    if (!admin) {
      return res.status(400).json({ status: 'error', message: 'Invalid or expired verification code.' });
    }

    // Reset password
    admin.password = hashPassword(newPassword);
    admin.resetOtp = undefined;
    admin.resetOtpExpires = undefined;
    await admin.save();

    await ActivityLog.log('Admin password reset', admin._id, 'success', { email: admin.email });

    return res.json({ status: 'success', message: 'Password has been reset successfully.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 2. DASHBOARD METRICS
// ==========================================

router.get('/dashboard', authMiddleware, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const usersToday = await User.countDocuments({ createdAt: { $gte: startOfToday } });
    
    const totalCategories = await Category.countDocuments();
    const totalContent = await Content.countDocuments();
    const activeContent = await Content.countDocuments({ status: 'active' });
    const startContentCount = await Content.countDocuments({ isStartContent: true, status: 'active' });
    const pendingDeletions = await Delivery.countDocuments({ status: 'sent', deleteAt: { $gt: now } });

    // Aggregate counts by type
    const contentByType = await Content.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);
    const typeStats = contentByType.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, { video: 0, photo: 0, document: 0, link: 0, text: 0 });

    // Recent Content
    const recentContent = await Content.find()
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent Users
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent Activity
    const recentActivity = await ActivityLog.find()
      .populate('adminId', 'name email')
      .sort({ timestamp: -1 })
      .limit(10);

    return res.json({
      status: 'success',
      metrics: {
        totalUsers,
        activeUsers,
        usersToday,
        totalCategories,
        totalContent,
        activeContent,
        startContentCount,
        pendingDeletions,
        typeStats,
      },
      recentContent,
      recentUsers,
      recentActivity,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics', authMiddleware, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Basic event counts
    const totalStarts = await EventLog.countDocuments({ eventType: 'user_started' });
    const todayStarts = await EventLog.countDocuments({ eventType: 'user_started', timestamp: { $gte: startOfToday } });
    const contentRequests = await EventLog.countDocuments({ eventType: 'content_requested' });
    const contentDeliveries = await EventLog.countDocuments({ eventType: 'content_delivered' });
    const searchCount = await EventLog.countDocuments({ eventType: 'search_performed' });
    const deepLinkOpens = await EventLog.countDocuments({ eventType: 'deep_link_opened' });

    // Aggregate Top Content by successful deliveries
    const topContentAgg = await EventLog.aggregate([
      { $match: { eventType: 'content_delivered', targetId: { $ne: '' } } },
      { $group: { _id: '$targetId', deliveries: { $sum: 1 } } },
      { $sort: { deliveries: -1 } },
      { $limit: 10 }
    ]);

    const topContent = [];
    for (const item of topContentAgg) {
      if (mongoose.Types.ObjectId.isValid(item._id)) {
        const content = await Content.findById(item._id).select('title type');
        const requests = await EventLog.countDocuments({ eventType: 'content_requested', targetId: item._id });
        topContent.push({
          title: content ? content.title : 'Deleted Content',
          type: content ? content.type : 'N/A',
          requests,
          deliveries: item.deliveries
        });
      }
    }

    // Aggregate Top Categories by views/opens
    const topCategoriesAgg = await EventLog.aggregate([
      { $match: { eventType: 'category_opened', targetId: { $ne: '' } } },
      { $group: { _id: '$targetId', views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 10 }
    ]);

    const topCategories = [];
    for (const item of topCategoriesAgg) {
      if (mongoose.Types.ObjectId.isValid(item._id)) {
        const category = await Category.findById(item._id).select('name displayName');
        const contents = await Content.find({ categoryId: item._id }).select('_id');
        const contentIds = contents.map(c => c._id.toString());
        const requests = await EventLog.countDocuments({
          eventType: 'content_requested',
          targetId: { $in: contentIds }
        });

        topCategories.push({
          name: category ? (category.displayName || category.name) : 'Deleted Category',
          views: item.views,
          requests
        });
      }
    }

    // Broadcast Performance Metrics
    const broadcasts = await Broadcast.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('title status targetedCount sentCount failedCount blockedCount createdAt');

    return res.json({
      status: 'success',
      metrics: {
        totalStarts,
        todayStarts,
        contentRequests,
        contentDeliveries,
        searchCount,
        deepLinkOpens
      },
      topContent,
      topCategories,
      broadcasts
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 3. BOTS MANAGEMENT & REGISTRATION
// ==========================================

router.get('/bots', authMiddleware, async (req, res, next) => {
  try {
    const bots = await BotModel.find().sort({ createdAt: -1 });
    return res.json({ status: 'success', bots });
  } catch (error) {
    next(error);
  }
});

router.post('/bots/validate', authMiddleware, async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ status: 'error', message: 'Bot Token is required.' });
    }

    // Query telegram getMe to validate the token directly
    const tempBot = new mongoose.mongo.Admin(mongoose.connection.db); // just dynamic verification
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();

    if (!data.ok) {
      return res.status(400).json({ status: 'error', message: `Invalid Bot Token: ${data.description || 'Unknown error'}` });
    }

    return res.json({
      status: 'success',
      message: 'Token is valid.',
      bot: {
        telegramBotId: data.result.id,
        username: data.result.username,
        firstName: data.result.first_name,
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/bots', authMiddleware, async (req, res, next) => {
  try {
    const { token } = req.body;
    const adminId = req.admin.id;

    if (!token) {
      return res.status(400).json({ status: 'error', message: 'Bot Token is required.' });
    }

    // 1. Validate token with Telegram API
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json();

    if (!data.ok) {
      return res.status(400).json({ status: 'error', message: 'Could not connect bot: Invalid token.' });
    }

    const botInfo = data.result;

    // 2. Encrypt token at rest
    const encryptedToken = encrypt(token);

    // 3. Deactivate any currently active bots
    await BotModel.updateMany({}, { $set: { status: 'inactive' } });

    // 4. Upsert/Create bot info
    const registeredBot = await BotModel.findOneAndUpdate(
      { telegramBotId: botInfo.id },
      {
        username: botInfo.username,
        firstName: botInfo.first_name,
        status: 'active',
        encryptedToken,
      },
      { upsert: true, new: true }
    );

    // 5. Trigger live bot listener restart dynamically
    await reinitializeBot(token);

    await ActivityLog.log('Connect Bot token', adminId, 'success', { botId: botInfo.id, username: botInfo.username });

    return res.json({
      status: 'success',
      message: `Bot @${botInfo.username} registered and activated successfully.`,
      bot: {
        telegramBotId: registeredBot.telegramBotId,
        username: registeredBot.username,
        firstName: registeredBot.firstName,
        status: registeredBot.status,
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 4. CATEGORY MANAGEMENT
// ==========================================

router.get('/categories', authMiddleware, async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
    return res.json({ status: 'success', categories });
  } catch (error) {
    next(error);
  }
});

router.post('/categories', authMiddleware, async (req, res, next) => {
  try {
    const { name, slug, description, status, sortOrder, icon, displayName, isFeatured } = req.body;
    const adminId = req.admin.id;

    if (!name || !slug) {
      return res.status(400).json({ status: 'error', message: 'Name and slug are required.' });
    }

    // Check slug uniqueness
    const exists = await Category.findOne({ slug: slug.toLowerCase() });
    if (exists) {
      return res.status(400).json({ status: 'error', message: 'A category with this slug already exists.' });
    }

    const category = await Category.create({
      name,
      slug: slug.toLowerCase(),
      description,
      status: status || 'active',
      sortOrder: sortOrder || 0,
      icon: icon || '',
      displayName: displayName || '',
      isFeatured: isFeatured === 'true' || isFeatured === true,
    });

    await ActivityLog.log('Category created', adminId, 'success', { categoryId: category._id, name });

    return res.status(201).json({ status: 'success', category });
  } catch (error) {
    next(error);
  }
});

router.patch('/categories/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, status, sortOrder, icon, displayName, isFeatured } = req.body;
    const adminId = req.admin.id;

    if (slug) {
      const exists = await Category.findOne({ slug: slug.toLowerCase(), _id: { $ne: id } });
      if (exists) {
        return res.status(400).json({ status: 'error', message: 'A category with this slug already exists.' });
      }
    }

    const updatePayload = {};
    if (name !== undefined) updatePayload.name = name;
    if (slug !== undefined) updatePayload.slug = slug.toLowerCase();
    if (description !== undefined) updatePayload.description = description;
    if (status !== undefined) updatePayload.status = status;
    if (sortOrder !== undefined) updatePayload.sortOrder = sortOrder;
    if (icon !== undefined) updatePayload.icon = icon;
    if (displayName !== undefined) updatePayload.displayName = displayName;
    if (isFeatured !== undefined) updatePayload.isFeatured = isFeatured === 'true' || isFeatured === true;

    const updated = await Category.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Category not found.' });
    }

    await ActivityLog.log('Category edited', adminId, 'success', { categoryId: id, name: updated.name });

    return res.json({ status: 'success', category: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/categories/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    // Check if category has content items
    const contentCount = await Content.countDocuments({ categoryId: id });
    if (contentCount > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot delete: Category has ${contentCount} content item(s) linked. Please delete or reassign them first.`
      });
    }

    const deleted = await Category.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ status: 'error', message: 'Category not found.' });
    }

    await ActivityLog.log('Category deleted', adminId, 'success', { categoryId: id, name: deleted.name });

    return res.json({ status: 'success', message: 'Category deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 5. CONTENT MANAGEMENT & S3 UPLOAD
// ==========================================

router.post('/content/bulk', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const { ids, action, categoryId } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No content items selected.' });
    }

    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
    const query = { _id: { $in: objectIds } };
    if (req.botId) {
      query.botId = req.botId;
    }

    let affectedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    if (action === 'delete') {
      const items = await Content.find(query);
      affectedCount = items.length;
      
      const batchSize = 5;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(batch.map(async (item) => {
          try {
            if (item.storageKey) {
              await storageService.deleteObjectSafely(item.storageKey, item._id).catch(() => {});
            }
            await Content.deleteOne({ _id: item._id });
            successCount++;
          } catch (err) {
            console.error(`Bulk Delete Error for item ${item._id}:`, err.message);
            failedCount++;
          }
        }));
      }
    } else {
      let updateFields = {};
      if (action === 'enable') updateFields = { status: 'active' };
      else if (action === 'disable') updateFields = { status: 'inactive' };
      else if (action === 'start') updateFields = { isStartContent: true };
      else if (action === 'unstart') updateFields = { isStartContent: false };
      else if (action === 'featured') updateFields = { isFeatured: true };
      else if (action === 'unfeatured') updateFields = { isFeatured: false };
      else if (action === 'category') {
        if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
          return res.status(400).json({ status: 'error', message: 'Invalid target category.' });
        }
        updateFields = { categoryId: new mongoose.Types.ObjectId(categoryId) };
      } else {
        return res.status(400).json({ status: 'error', message: 'Invalid bulk action.' });
      }

      const items = await Content.find(query);
      affectedCount = items.length;

      const result = await Content.updateMany(query, { $set: updateFields });
      successCount = result.modifiedCount;
      failedCount = affectedCount - successCount;
    }

    await ActivityLog.log(
      `CONTENT_BULK_${action.toUpperCase()}`,
      req.admin.id,
      'success',
      { affectedCount, successCount, failedCount }
    );

    res.json({
      status: 'success',
      affectedCount,
      successCount,
      failedCount,
      message: `Bulk operation completed: ${successCount} succeeded, ${failedCount} failed.`
    });
  } catch (err) {
    next(err);
  }
});

router.get('/content', authMiddleware, async (req, res, next) => {
  try {
    const cleanCategoryId = cleanQueryString(req.query.categoryId);
    const cleanType = cleanQueryString(req.query.type);
    const cleanStatus = cleanQueryString(req.query.status);
    const cleanSearch = cleanQueryString(req.query.search);
    
    const page = Math.max(1, cleanQueryInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(cleanQueryInt(req.query.limit, 25), 100)); // Hard capped at 100

    const query = {};
    if (cleanCategoryId) {
      if (mongoose.Types.ObjectId.isValid(cleanCategoryId)) {
        query.categoryId = cleanCategoryId;
      } else {
        return res.json({
          status: 'success',
          content: [],
          pagination: { total: 0, page, limit, pages: 0 }
        });
      }
    }

    if (cleanType) query.type = cleanType;
    if (cleanStatus) query.status = cleanStatus;
    
    if (cleanSearch) {
      const escaped = escapeRegex(cleanSearch);
      query.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { caption: { $regex: escaped, $options: 'i' } },
      ];
    }

    const total = await Content.countDocuments(query);
    const content = await Content.find(query)
      .populate('categoryId', 'name slug')
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      status: 'success',
      content,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/content/:id', authMiddleware, async (req, res, next) => {
  try {
    const content = await Content.findById(req.params.id).populate('categoryId', 'name slug');
    if (!content) {
      return res.status(404).json({ status: 'error', message: 'Content not found.' });
    }
    return res.json({ status: 'success', content });
  } catch (error) {
    next(error);
  }
});

// Helper to validate URL protocols (only allow http://, https://, and t.me/)
const validateUrl = (urlStr) => {
  if (!urlStr) return false;
  return /^(https?:\/\/|t\.me\/)/i.test(urlStr);
};

// Helper to validate uploaded files based on content type, extension, and mimetype
const isSafeFile = (type, mimetype, originalname) => {
  const ext = path.extname(originalname).toLowerCase();
  if (type === 'photo') {
    const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    return allowedExts.includes(ext) && mimetype.startsWith('image/');
  }
  if (type === 'video') {
    const allowedExts = ['.mp4', '.mov', '.avi', '.mkv'];
    return allowedExts.includes(ext) && mimetype.startsWith('video/');
  }
  if (type === 'document') {
    const blockedExts = ['.exe', '.bat', '.sh', '.cmd', '.msi', '.com', '.vbs', '.scr', '.pif'];
    return !blockedExts.includes(ext);
  }
  return false;
};

router.post('/content', authMiddleware, activeBotMiddleware, upload.single('file'), async (req, res, next) => {
  let uploadedKey = null;
  try {
    const { title, type, categoryId, caption, url, text, status, sortOrder, isStartContent, isFeatured, overrideDuplicate } = req.body;
    const adminId = req.admin.id;

    if (!title || !type) {
      return res.status(400).json({ status: 'error', message: 'Title and type are required.' });
    }

    const allowedTypes = ['video', 'photo', 'document', 'text', 'link'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ status: 'error', message: 'Invalid content type.' });
    }

    if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid Category ID reference format.' });
    }

    if (status && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Invalid status option.' });
    }

    const parsedSortOrder = parseInt(sortOrder, 10);
    if (sortOrder !== undefined && (isNaN(parsedSortOrder) || parsedSortOrder < 0)) {
      return res.status(400).json({ status: 'error', message: 'Sort order must be a non-negative integer.' });
    }

    if (type === 'link') {
      if (!url || !validateUrl(url)) {
        return res.status(400).json({ status: 'error', message: 'Invalid URL. Only HTTP, HTTPS, and t.me protocols are allowed.' });
      }
    }

    // 1. Duplicate Detection Check
    let fileHash = '';
    if (overrideDuplicate !== 'true' && overrideDuplicate !== true) {
      // Check title duplicate
      const dupTitle = await Content.findOne({ title: title.trim(), botId: req.botId });
      if (dupTitle) {
        return res.json({
          status: 'duplicate_warning',
          message: `A content item with the title "${title.trim()}" already exists.`,
          duplicate: { _id: dupTitle._id, title: dupTitle.title }
        });
      }

      // Check URL duplicate for links
      if (type === 'link') {
        const dupUrl = await Content.findOne({ url: url.trim(), botId: req.botId });
        if (dupUrl) {
          return res.json({
            status: 'duplicate_warning',
            message: 'A link item with this exact URL already exists.',
            duplicate: { _id: dupUrl._id, title: dupUrl.title }
          });
        }
      }

      // Check file hash duplicate
      if (['video', 'photo', 'document'].includes(type) && req.file) {
        fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const dupFile = await Content.findOne({ fileHash, botId: req.botId });
        if (dupFile) {
          return res.json({
            status: 'duplicate_warning',
            message: 'A media file identical to this upload already exists.',
            duplicate: { _id: dupFile._id, title: dupFile.title }
          });
        }
      }
    } else if (['video', 'photo', 'document'].includes(type) && req.file) {
      fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    }

    const contentId = new mongoose.Types.ObjectId();
    let storageKey = '';
    let storageBucket = '';
    let mimeType = '';
    let fileSize = 0;
    let originalFileName = '';

    // File handling for S3 media types
    if (['video', 'photo', 'document'].includes(type)) {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: `File upload is required for content type "${type}".` });
      }

      const file = req.file;

      if (!isSafeFile(type, file.mimetype, file.originalname)) {
        return res.status(400).json({ status: 'error', message: 'Unsupported file extension or invalid MIME type.' });
      }

      const ext = path.extname(file.originalname).toLowerCase();
      const safeRandom = crypto.randomBytes(8).toString('hex');
      storageKey = `content/${contentId}/${safeRandom}${ext}`;
      storageBucket = config.filebase.bucket;
      mimeType = file.mimetype;
      fileSize = file.size;
      originalFileName = file.originalname;

      // Upload file to S3
      await storageService.uploadObject(storageKey, file.buffer, file.mimetype);
      uploadedKey = storageKey;
      console.log(`Content Upload: File uploaded to Filebase S3 -> key: ${storageKey}`);
    }

    // Save to Database
    const content = new Content({
      _id: contentId,
      title: title.trim(),
      type,
      categoryId: categoryId || undefined,
      storageKey: storageKey || undefined,
      storageBucket: storageBucket || undefined,
      mimeType: mimeType || undefined,
      fileSize: fileSize || undefined,
      originalFileName: originalFileName || undefined,
      fileHash: fileHash || undefined,
      caption,
      url,
      text,
      status: status || 'active',
      sortOrder: sortOrder || 0,
      isStartContent: isStartContent === 'true' || isStartContent === true,
      isFeatured: isFeatured === 'true' || isFeatured === true,
      botId: req.botId,
    });

    await content.save();

    await ActivityLog.log('Content uploaded', adminId, 'success', { contentId, title, type });

    return res.status(201).json({ status: 'success', content });
  } catch (error) {
    // Phase 12 - Filebase Cleanup on MongoDB Save Failures
    if (uploadedKey) {
      console.warn(`Content Upload: MongoDB save failed, cleaning up S3 object ${uploadedKey}`);
      try {
        await storageService.deleteObjectSafely(uploadedKey);
      } catch (cleanupError) {
        console.error('Content Upload: S3 Cleanup error:', cleanupError.message);
      }
    }
    next(error);
  }
});

router.patch('/content/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, categoryId, caption, url, text, status, sortOrder, isStartContent, isFeatured } = req.body;
    const adminId = req.admin.id;

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ status: 'error', message: 'Content not found.' });
    }

    // Build update payload dynamically
    const setQuery = {};
    if (title !== undefined) {
      if (!title) {
        return res.status(400).json({ status: 'error', message: 'Title cannot be empty.' });
      }
      setQuery.title = title.trim();
    }

    if (categoryId !== undefined) {
      if (categoryId && !mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({ status: 'error', message: 'Invalid Category ID reference format.' });
      }
      setQuery.categoryId = categoryId || null;
    }

    if (caption !== undefined) setQuery.caption = caption;

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ status: 'error', message: 'Invalid status option.' });
      }
      setQuery.status = status;
    }

    if (sortOrder !== undefined) {
      const parsedSortOrder = parseInt(sortOrder, 10);
      if (isNaN(parsedSortOrder) || parsedSortOrder < 0) {
        return res.status(400).json({ status: 'error', message: 'Sort order must be a non-negative integer.' });
      }
      setQuery.sortOrder = parsedSortOrder;
    }

    if (isStartContent !== undefined) {
      setQuery.isStartContent = isStartContent === 'true' || isStartContent === true;
    }

    if (isFeatured !== undefined) {
      setQuery.isFeatured = isFeatured === 'true' || isFeatured === true;
    }

    if (content.type === 'link') {
      if (url !== undefined) {
        if (!url || !validateUrl(url)) {
          return res.status(400).json({ status: 'error', message: 'Invalid URL. Only HTTP, HTTPS, and t.me protocols are allowed.' });
        }
        setQuery.url = url;
      }
    } else if (content.type === 'text') {
      if (text !== undefined) setQuery.text = text;
    }

    const updated = await Content.findByIdAndUpdate(
      id,
      { $set: setQuery },
      { new: true, runValidators: true }
    );

    await ActivityLog.log('Content edited', adminId, 'success', { contentId: id, title: updated.title });

    return res.json({ status: 'success', content: updated });
  } catch (error) {
    next(error);
  }
});

router.delete('/content/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.admin.id;

    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ status: 'error', message: 'Content not found.' });
    }

    // 1. Remove from Filebase S3 if type uses storage
    if (content.storageKey) {
      console.log(`Content Delete: Removing associated S3 file ${content.storageKey} from Filebase`);
      try {
        await storageService.deleteObjectSafely(content.storageKey, content._id);
      } catch (s3Error) {
        console.warn(`Content Delete: Failed to remove S3 object (perhaps already deleted): ${s3Error.message}`);
      }
    }

    // 2. Remove deliveries tracking details
    await Delivery.deleteMany({ contentId: id });

    // 3. Delete MongoDB metadata
    await Content.findByIdAndDelete(id);

    await ActivityLog.log('Content deleted', adminId, 'success', { contentId: id, title: content.title });

    return res.json({ status: 'success', message: 'Content and associated files deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

router.post('/content/:id/share-link', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const content = await Content.findById(id);
    if (!content) {
      return res.status(404).json({ status: 'error', message: 'Content not found.' });
    }

    // Format link: https://t.me/BOT_USERNAME?start=f_CONTENT_ID
    const link = `https://t.me/${config.botUsername}?start=f_${content._id}`;
    return res.json({ status: 'success', link });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 6. START CONTENT MANAGER & SETTINGS
// ==========================================

router.get('/start-content', authMiddleware, async (req, res, next) => {
  try {
    const list = await Content.find({ isStartContent: true })
      .populate('categoryId', 'name')
      .sort({ sortOrder: 1, createdAt: 1 });
    return res.json({ status: 'success', content: list });
  } catch (error) {
    next(error);
  }
});

router.patch('/start-content/reorder', authMiddleware, async (req, res, next) => {
  try {
    const { orders } = req.body; // Array of { id, sortOrder }
    const adminId = req.admin.id;

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ status: 'error', message: 'Orders array is required.' });
    }

    // Perform updates sequentially
    for (const item of orders) {
      await Content.findByIdAndUpdate(item.id, { $set: { sortOrder: item.sortOrder } });
    }

    await ActivityLog.log('Start content changed', adminId, 'success', { ordersCount: orders.length });

    return res.json({ status: 'success', message: 'Start content ordering updated successfully.' });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', authMiddleware, async (req, res, next) => {
  try {
    const settings = await Setting.getSettings();
    return res.json({ status: 'success', settings });
  } catch (error) {
    next(error);
  }
});

router.patch('/settings', authMiddleware, async (req, res, next) => {
  try {
    const { welcomeMessage, startContentEnabled, startContentLimit, autoDeleteEnabled, autoDeleteHours, botEnabled, helpMessage, supportLink } = req.body;
    const adminId = req.admin.id;

    const settings = await Setting.getSettings();

    if (welcomeMessage !== undefined) settings.welcomeMessage = welcomeMessage;
    if (startContentEnabled !== undefined) settings.startContentEnabled = startContentEnabled;
    if (startContentLimit !== undefined) {
      const limit = parseInt(startContentLimit, 10);
      if (limit < 1 || limit > 100) {
        return res.status(400).json({ status: 'error', message: 'Start content limit must be between 1 and 100.' });
      }
      settings.startContentLimit = limit;
    }
    if (autoDeleteEnabled !== undefined) settings.autoDeleteEnabled = autoDeleteEnabled;
    if (autoDeleteHours !== undefined) {
      const hours = parseInt(autoDeleteHours, 10);
      const allowedHours = [1, 6, 12, 24, 48];
      if (!allowedHours.includes(hours)) {
        return res.status(400).json({ status: 'error', message: 'Auto delete hours must be 1, 6, 12, 24, or 48.' });
      }
      settings.autoDeleteHours = hours;
    }
    if (botEnabled !== undefined) settings.botEnabled = botEnabled;
    if (helpMessage !== undefined) settings.helpMessage = helpMessage;
    if (supportLink !== undefined) settings.supportLink = supportLink;

    await settings.save();

    await ActivityLog.log('Settings changed', adminId, 'success', req.body);

    return res.json({ status: 'success', settings });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 7. BOT USERS LIST
// ==========================================

router.get('/users', authMiddleware, async (req, res, next) => {
  try {
    const cleanSearch = cleanQueryString(req.query.search);
    const cleanStatus = cleanQueryString(req.query.status);
    
    const page = Math.max(1, cleanQueryInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(cleanQueryInt(req.query.limit, 25), 100)); // Hard capped at 100

    const query = {};
    if (cleanStatus) query.status = cleanStatus;
    
    if (cleanSearch) {
      const escaped = escapeRegex(cleanSearch);
      query.$or = [
        { username: { $regex: escaped, $options: 'i' } },
        { firstName: { $regex: escaped, $options: 'i' } },
        { lastName: { $regex: escaped, $options: 'i' } },
        { telegramUserId: isNaN(parseInt(cleanSearch, 10)) ? undefined : parseInt(cleanSearch, 10) }
      ].filter(f => f !== undefined);
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .sort({ lastActiveAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      status: 'success',
      users,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/users/:id', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }
    return res.json({ status: 'success', user });
  } catch (error) {
    next(error);
  }
});

router.patch('/users/:id/status', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active', 'blocked', 'inactive'
    const adminId = req.admin.id;

    if (!status || !['active', 'blocked', 'inactive'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Invalid status parameter.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    await ActivityLog.log('User status changed', adminId, 'success', { userId: id, username: updatedUser.username, status });

    return res.json({ status: 'success', user: updatedUser });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 8. BROADCAST SYSTEM
// ==========================================

router.get('/broadcasts', authMiddleware, async (req, res, next) => {
  try {
    const broadcasts = await Broadcast.find().sort({ createdAt: -1 });
    return res.json({ status: 'success', broadcasts });
  } catch (error) {
    next(error);
  }
});

router.get('/broadcasts/:id', authMiddleware, async (req, res, next) => {
  try {
    const broadcast = await Broadcast.findById(req.params.id);
    if (!broadcast) {
      return res.status(404).json({ status: 'error', message: 'Broadcast not found.' });
    }
    return res.json({ status: 'success', broadcast });
  } catch (error) {
    next(error);
  }
});

router.post('/broadcasts', authMiddleware, upload.single('file'), async (req, res, next) => {
  let uploadedKey = null;
  try {
    const { title, type, text, urlButtonLabel, urlButtonUrl, scheduledAt } = req.body;
    const adminId = req.admin.id;

    if (!title || !type) {
      return res.status(400).json({ status: 'error', message: 'Title and type are required.' });
    }

    const allowedTypes = ['text', 'photo', 'video', 'document'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ status: 'error', message: 'Invalid broadcast type.' });
    }

    if (urlButtonUrl) {
      if (!validateUrl(urlButtonUrl)) {
        return res.status(400).json({ status: 'error', message: 'Invalid button URL. Only HTTP, HTTPS, and t.me protocols are allowed.' });
      }
      if (!urlButtonLabel) {
        return res.status(400).json({ status: 'error', message: 'Button label is required when URL is provided.' });
      }
    }

    let parsedScheduledAt = null;
    if (scheduledAt) {
      parsedScheduledAt = new Date(scheduledAt);
      if (isNaN(parsedScheduledAt.getTime())) {
        return res.status(400).json({ status: 'error', message: 'Invalid scheduledAt date format.' });
      }
      if (parsedScheduledAt <= new Date()) {
        return res.status(400).json({ status: 'error', message: 'Scheduled date and time must be in the future.' });
      }
    }

    let storageKey = '';
    if (['photo', 'video', 'document'].includes(type)) {
      if (!req.file) {
        return res.status(400).json({ status: 'error', message: `File upload is required for broadcast type "${type}".` });
      }

      const file = req.file;

      if (!isSafeFile(type, file.mimetype, file.originalname)) {
        return res.status(400).json({ status: 'error', message: 'Unsupported file extension or invalid MIME type.' });
      }

      // Generate a random unique path for storage
      const ext = path.extname(file.originalname).toLowerCase();
      const safeRandom = crypto.randomBytes(16).toString('hex');
      storageKey = `broadcasts/${safeRandom}${ext}`;

      // Upload file to S3
      await storageService.uploadObject(storageKey, file.buffer, file.mimetype);
      uploadedKey = storageKey;
    }

    const urlButton = (urlButtonLabel && urlButtonUrl) 
      ? { label: urlButtonLabel, url: urlButtonUrl }
      : undefined;

    // Retrieve targeted users (previously interacted and not blocked)
    const eligibleUsers = await User.find({ status: 'active' });

    const broadcast = await Broadcast.create({
      title,
      type,
      text: text ? text.trim() : '',
      storageKey: storageKey || undefined,
      urlButton,
      status: eligibleUsers.length > 0 ? 'queued' : 'completed',
      targetedCount: eligibleUsers.length,
      sentCount: 0,
      failedCount: 0,
      blockedCount: 0,
      scheduledAt: parsedScheduledAt || undefined
    });

    await ActivityLog.log(
      parsedScheduledAt ? 'Broadcast scheduled' : 'Broadcast started',
      adminId,
      'success',
      { broadcastId: broadcast._id, targeted: eligibleUsers.length, scheduledAt: parsedScheduledAt }
    );

    if (eligibleUsers.length > 0 && !parsedScheduledAt) {
      // Execute broadcasting asynchronously in the background using the dedicated service worker
      broadcastService.runBroadcast(broadcast._id).catch(err => {
        console.error(`Broadcast start error (ID: ${broadcast._id}):`, err.message);
      });
    }

    return res.status(201).json({
      status: 'success',
      message: parsedScheduledAt ? 'Broadcast scheduled successfully.' : 'Broadcast initialized and queued successfully.',
      broadcast
    });

  } catch (error) {
    if (uploadedKey) {
      console.warn(`Broadcast Create: MongoDB save failed, cleaning up S3 object ${uploadedKey}`);
      try {
        await storageService.deleteObjectSafely(uploadedKey);
      } catch (cleanupError) {
        console.error('Broadcast Create: S3 Cleanup error:', cleanupError.message);
      }
    }
    next(error);
  }
});

// ==========================================
// 9. ACTIVITY LOGS
// ==========================================

router.get('/logs', authMiddleware, async (req, res, next) => {
  try {
    const logs = await ActivityLog.find()
      .populate('adminId', 'name email')
      .sort({ timestamp: -1 })
      .limit(100);
    return res.json({ status: 'success', logs });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// 10. BOT MENU CRUD (Task 7)
// ==========================================

router.get('/bot-menus', authMiddleware, async (req, res, next) => {
  try {
    const menus = await BotMenu.find().sort({ sortOrder: 1 });
    return res.json({ status: 'success', menus });
  } catch (error) {
    next(error);
  }
});

router.post('/bot-menus', authMiddleware, async (req, res, next) => {
  try {
    const { label, icon, actionType, target, sortOrder, status } = req.body;
    const adminId = req.admin.id;

    if (!label || !actionType) {
      return res.status(400).json({ status: 'error', message: 'Label and actionType are required.' });
    }

    // Validate Action/Target pairs (Phase 17)
    if (actionType === 'CATEGORY') {
      if (!target || !mongoose.Types.ObjectId.isValid(target)) {
        return res.status(400).json({ status: 'error', message: 'Category action type requires a valid category ID target.' });
      }
    } else if (actionType === 'CONTENT') {
      if (!target || !mongoose.Types.ObjectId.isValid(target)) {
        return res.status(400).json({ status: 'error', message: 'Content action type requires a valid content ID target.' });
      }
    } else if (actionType === 'URL') {
      if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
        return res.status(400).json({ status: 'error', message: 'URL action type requires a valid http/https target URL.' });
      }
    }

    const menu = await BotMenu.create({
      label,
      icon: icon || '',
      actionType,
      target: target || '',
      sortOrder: parseInt(sortOrder, 10) || 0,
      status: status || 'active'
    });

    await ActivityLog.log('Bot Menu button created', adminId, 'success', { label, actionType });

    return res.status(201).json({ status: 'success', menu });
  } catch (error) {
    next(error);
  }
});

router.patch('/bot-menus/:id', authMiddleware, async (req, res, next) => {
  try {
    const { label, icon, actionType, target, sortOrder, status } = req.body;
    const adminId = req.admin.id;

    const menu = await BotMenu.findById(req.params.id);
    if (!menu) {
      return res.status(404).json({ status: 'error', message: 'Bot Menu button not found.' });
    }

    if (label !== undefined) menu.label = label;
    if (icon !== undefined) menu.icon = icon;
    if (actionType !== undefined) {
      const testAction = actionType;
      const testTarget = target !== undefined ? target : menu.target;

      if (testAction === 'CATEGORY') {
        if (!testTarget || !mongoose.Types.ObjectId.isValid(testTarget)) {
          return res.status(400).json({ status: 'error', message: 'Category action type requires a valid category ID target.' });
        }
      } else if (testAction === 'CONTENT') {
        if (!testTarget || !mongoose.Types.ObjectId.isValid(testTarget)) {
          return res.status(400).json({ status: 'error', message: 'Content action type requires a valid content ID target.' });
        }
      } else if (testAction === 'URL') {
        if (!testTarget || (!testTarget.startsWith('http://') && !testTarget.startsWith('https://'))) {
          return res.status(400).json({ status: 'error', message: 'URL action type requires a valid http/https target URL.' });
        }
      }
      menu.actionType = actionType;
    }
    if (target !== undefined) {
      const testAction = actionType !== undefined ? actionType : menu.actionType;
      if (testAction === 'CATEGORY' && (!target || !mongoose.Types.ObjectId.isValid(target))) {
        return res.status(400).json({ status: 'error', message: 'Category action type requires a valid category ID target.' });
      }
      if (testAction === 'CONTENT' && (!target || !mongoose.Types.ObjectId.isValid(target))) {
        return res.status(400).json({ status: 'error', message: 'Content action type requires a valid content ID target.' });
      }
      if (testAction === 'URL' && (!target || (!target.startsWith('http://') && !target.startsWith('https://')))) {
        return res.status(400).json({ status: 'error', message: 'URL action type requires a valid http/https target URL.' });
      }
      menu.target = target;
    }
    if (sortOrder !== undefined) menu.sortOrder = parseInt(sortOrder, 10) || 0;
    if (status !== undefined) menu.status = status;

    await menu.save();

    await ActivityLog.log('Bot Menu button updated', adminId, 'success', { label: menu.label, actionType: menu.actionType });

    return res.json({ status: 'success', menu });
  } catch (error) {
    next(error);
  }
});

router.delete('/bot-menus/:id', authMiddleware, async (req, res, next) => {
  try {
    const adminId = req.admin.id;
    const menu = await BotMenu.findByIdAndDelete(req.params.id);
    if (!menu) {
      return res.status(404).json({ status: 'error', message: 'Bot Menu button not found.' });
    }

    await ActivityLog.log('Bot Menu button deleted', adminId, 'success', { label: menu.label });

    return res.json({ status: 'success', message: 'Bot Menu button deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// V5 ADVANCED OPERATIONS & METRICS
// ==========================================

const convertToCSV = (data, keys) => {
  const headerRow = keys.join(',');
  const rows = data.map(item => {
    return keys.map(key => {
      let val = item[key];
      if (val === undefined || val === null) return '""';
      if (val instanceof Date) val = val.toISOString();
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(',');
  });
  return [headerRow, ...rows].join('\n');
};

const parseCSV = (csvText) => {
  const lines = [];
  let row = [""];
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const c = csvText[i];
    const next = csvText[i + 1];
    
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    lines.push(row);
  }
  return lines;
};

// 1. CSV EXPORT
router.get('/export/:resource', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const { resource } = req.params;
    const query = {};
    if (req.botId) {
      query.botId = req.botId;
    }

    let csvContent = '';
    const fileName = `${resource}_export_${Date.now()}.csv`;

    if (resource === 'users') {
      const users = await User.find(query).lean();
      csvContent = convertToCSV(users, ['telegramUserId', 'username', 'firstName', 'lastName', 'status', 'startedAt']);
    } else if (resource === 'content') {
      const contents = await Content.find(query).lean();
      csvContent = convertToCSV(contents, ['_id', 'title', 'type', 'categoryId', 'status', 'sortOrder', 'isStartContent', 'isFeatured', 'storageKey', 'url', 'createdAt']);
    } else if (resource === 'categories') {
      const categories = await Category.find(query).lean();
      csvContent = convertToCSV(categories, ['name', 'slug', 'description', 'status', 'sortOrder', 'isFeatured']);
    } else if (resource === 'broadcasts') {
      const broadcasts = await Broadcast.find(query).lean();
      csvContent = convertToCSV(broadcasts, ['title', 'type', 'status', 'targetedCount', 'sentCount', 'failedCount', 'createdAt']);
    } else if (resource === 'logs') {
      const logs = await ActivityLog.find({}).populate('operatorId', 'email').lean();
      const mapped = logs.map(l => ({ ...l, operatorEmail: l.operatorId?.email }));
      csvContent = convertToCSV(mapped, ['action', 'status', 'operatorEmail', 'createdAt']);
    } else {
      return res.status(400).json({ status: 'error', message: 'Invalid resource type for export.' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

// 2. CSV IMPORT (Metadata only, preview vs commit)
router.post('/import/content', authMiddleware, activeBotMiddleware, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No CSV file uploaded.' });
    }

    const { dryRun } = req.query;
    const isDryRun = dryRun !== 'false'; // Defaults to true (safety first)

    const csvText = req.file.buffer.toString('utf8');
    const parsedLines = parseCSV(csvText);

    if (parsedLines.length < 2) {
      return res.status(400).json({ status: 'error', message: 'CSV file is empty or missing data rows.' });
    }

    const headers = parsedLines[0].map(h => h.trim().toLowerCase());
    const dataRows = parsedLines.slice(1);

    const result = {
      totalRows: dataRows.length,
      validRows: 0,
      invalidRows: 0,
      importedRows: 0,
      failedRows: 0,
      previews: {
        newItems: [],
        existingConflicts: [],
        invalidItems: []
      }
    };

    const targetFields = ['title', 'type', 'categoryslug', 'status', 'sortorder', 'isstartcontent', 'isfeatured', 'url', 'text', 'caption'];
    const headerIndices = {};
    headers.forEach((h, index) => {
      if (targetFields.includes(h)) {
        headerIndices[h] = index;
      }
    });

    const categoryMap = {};
    const dbCategories = await Category.find({ botId: req.botId });
    dbCategories.forEach(c => {
      categoryMap[c.slug] = c._id;
    });

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
      const row = dataRows[rowIndex];
      if (row.length < 2 || !row[0]) continue; // Skip empty rows

      const getVal = (field) => {
        const idx = headerIndices[field];
        return idx !== undefined ? row[idx].trim() : '';
      };

      const title = getVal('title');
      const type = getVal('type');
      const categorySlug = getVal('categoryslug');
      const status = getVal('status') || 'active';
      const sortOrder = parseInt(getVal('sortorder'), 10) || 0;
      const isStartContent = getVal('isstartcontent') === 'true' || getVal('isstartcontent') === '1';
      const isFeatured = getVal('isfeatured') === 'true' || getVal('isfeatured') === '1';
      const url = getVal('url');
      const text = getVal('text');
      const caption = getVal('caption');

      // Validation
      const errors = [];
      if (!title) errors.push('Title is required.');
      if (!type || !['video', 'photo', 'document', 'text', 'link'].bind(null).name && !['video', 'photo', 'document', 'text', 'link'].includes(type)) {
        errors.push(`Invalid type: ${type || 'None'}`);
      }
      if (type === 'link' && (!url || !validateUrl(url))) {
        errors.push('Invalid URL link format.');
      }
      if (['video', 'photo', 'document'].includes(type)) {
        errors.push('Actual media binary uploads cannot be processed via CSV import.');
      }

      let categoryId = null;
      if (categorySlug) {
        categoryId = categoryMap[categorySlug.toLowerCase()];
        if (!categoryId) {
          errors.push(`Category slug not found: "${categorySlug}"`);
        }
      }

      if (errors.length > 0) {
        result.invalidRows++;
        result.previews.invalidItems.push({ row: rowIndex + 2, title, errors });
        continue;
      }

      // Check conflict
      const existing = await Content.findOne({ title: title.trim(), botId: req.botId });
      if (existing) {
        result.previews.existingConflicts.push({ row: rowIndex + 2, title, conflictId: existing._id });
        continue;
      }

      result.validRows++;
      result.previews.newItems.push({ title, type, categoryId, status, sortOrder, isStartContent, isFeatured, url, text, caption });

      if (!isDryRun) {
        try {
          await Content.create({
            title: title.trim(),
            type,
            categoryId: categoryId || undefined,
            status,
            sortOrder,
            isStartContent,
            isFeatured,
            url,
            text,
            caption,
            botId: req.botId
          });
          result.importedRows++;
        } catch (err) {
          result.failedRows++;
        }
      }
    }

    res.json({
      status: 'success',
      isDryRun,
      summary: result
    });
  } catch (err) {
    next(err);
  }
});

// 3. STORAGE HEALTH CHECK & HEALTH STATUS
router.get('/maintenance/health-check', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const contents = await Content.find({ botId: req.botId }).populate('categoryId');
    const checklist = [];

    let healthyCount = 0;
    let warningCount = 0;
    let brokenCount = 0;

    for (const item of contents) {
      const issueDetails = [];
      let severity = 'Healthy';

      if (['video', 'photo', 'document'].includes(item.type)) {
        if (!item.storageKey) {
          issueDetails.push('Missing storageKey reference.');
          severity = 'Broken';
        }
      }

      if (item.categoryId) {
        if (item.categoryId.status === 'inactive') {
          issueDetails.push(`Category "${item.categoryId.name}" is inactive but has active content.`);
          severity = 'Warning';
        }
      }

      if (item.type === 'link') {
        if (!item.url || !validateUrl(item.url)) {
          issueDetails.push('Invalid URL protocol template.');
          severity = 'Broken';
        }
      }

      if (severity === 'Healthy') healthyCount++;
      if (severity === 'Warning') warningCount++;
      if (severity === 'Broken') brokenCount++;

      checklist.push({
        _id: item._id,
        title: item.title,
        type: item.type,
        severity,
        issues: issueDetails.join(', ')
      });
    }

    res.json({
      status: 'success',
      summary: { healthyCount, warningCount, brokenCount },
      checklist
    });
  } catch (err) {
    next(err);
  }
});

// 4. STORAGE OVERVIEW (Phase 10 & 11)
router.get('/storage/overview', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    
    // Scan DB records size
    const contents = await Content.find({ botId: req.botId, storageKey: { $ne: null } }).select('storageKey fileSize mimeType title');
    const dbSize = contents.reduce((acc, c) => acc + (c.fileSize || 0), 0);

    // List S3 Objects
    let s3Objects = [];
    try {
      const command = new ListObjectsV2Command({
        Bucket: config.filebase.bucket,
        Prefix: 'content/'
      });
      const s3Response = await storageService.client.send(command);
      s3Objects = s3Response.Contents || [];
    } catch (err) {
      console.warn('Storage Check: Failed listing Filebase objects:', err.message);
    }

    const s3TotalSize = s3Objects.reduce((acc, o) => acc + o.Size, 0);

    // Find Orphans (Present in S3 but missing in DB Content records)
    const dbKeys = new Set(contents.map(c => c.storageKey));
    const orphans = [];

    s3Objects.forEach(obj => {
      if (!dbKeys.has(obj.Key)) {
        orphans.push({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified
        });
      }
    });

    res.json({
      status: 'success',
      totalManagedCount: contents.length,
      approximateStorageUsage: s3TotalSize,
      databaseRecordsSize: dbSize,
      largestFiles: contents.sort((a,b) => (b.fileSize || 0) - (a.fileSize || 0)).slice(0, 5).map(c => ({ title: c.title, size: c.fileSize })),
      orphans
    });
  } catch (err) {
    next(err);
  }
});

// 5. STORAGE ORPHAN CLEANUP
router.post('/storage/cleanup', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No S3 keys selected for cleanup.' });
    }

    let deletedCount = 0;
    for (const key of keys) {
      try {
        await storageService.deleteObjectSafely(key);
        deletedCount++;
      } catch (err) {
        console.error(`Orphan Clean: Failed to delete ${key} from S3:`, err.message);
      }
    }

    await ActivityLog.log('Storage orphan cleanup executed', req.admin.id, 'success', { deletedCount });

    res.json({
      status: 'success',
      message: `Cleaned up ${deletedCount} orphaned storage objects.`
    });
  } catch (err) {
    next(err);
  }
});

// 6. SYSTEM INFO
router.get('/system/info', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      status: 'success',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      dbStatus: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    });
  } catch (err) {
    next(err);
  }
});

// 7. MULTI-BOT CRUD & TESTING CONTROLLER
router.get('/bots', authMiddleware, async (req, res, next) => {
  try {
    const bots = await BotModel.find({}).select('-token'); // Exclude encrypted token values
    res.json({ status: 'success', bots });
  } catch (err) {
    next(err);
  }
});

router.post('/bots', authMiddleware, async (req, res, next) => {
  try {
    const { displayName, token } = req.body;
    if (!displayName || !token) {
      return res.status(400).json({ status: 'error', message: 'Display name and token are required.' });
    }

    // Encrypt token
    const encryptedToken = encrypt(token);

    const bot = await BotModel.create({
      displayName,
      token: encryptedToken,
      status: 'disconnected'
    });

    await ActivityLog.log('Bot configuration added', req.admin.id, 'success', { botId: bot._id, displayName });

    res.status(201).json({ status: 'success', bot: { _id: bot._id, displayName, status: bot.status } });
  } catch (err) {
    next(err);
  }
});

router.post('/bots/:id/test', authMiddleware, async (req, res, next) => {
  try {
    const botDoc = await BotModel.findById(req.params.id);
    if (!botDoc) {
      return res.status(404).json({ status: 'error', message: 'Bot config not found.' });
    }

    const decryptedToken = decrypt(botDoc.token);
    const tempBot = new Telegraf(decryptedToken);
    
    let botInfo;
    try {
      botInfo = await tempBot.telegram.getMe();
    } catch (apiErr) {
      botDoc.status = 'error';
      await botDoc.save();
      return res.json({ status: 'error', message: `Telegram API error: ${apiErr.message}` });
    }

    botDoc.telegramBotId = botInfo.id;
    botDoc.username = botInfo.username;
    botDoc.status = 'connected';
    await botDoc.save();

    res.json({
      status: 'success',
      message: `Verified successfully. Bot @${botInfo.username} is responsive.`,
      botInfo
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/bots/:id/activate', authMiddleware, async (req, res, next) => {
  try {
    const botDoc = await BotModel.findById(req.params.id);
    if (!botDoc) {
      return res.status(404).json({ status: 'error', message: 'Bot config not found.' });
    }

    // Set all other bots as disconnected
    await BotModel.updateMany({ _id: { $ne: botDoc._id } }, { $set: { status: 'disconnected' } });

    // Decrypt and hot-swap active bot token
    const decryptedToken = decrypt(botDoc.token);
    const botInfo = await reinitializeBot(decryptedToken);

    botDoc.status = 'connected';
    botDoc.telegramBotId = botInfo.id;
    botDoc.username = botInfo.username;
    await botDoc.save();

    await ActivityLog.log('Active Telegram Bot Switched', req.admin.id, 'success', { botId: botDoc._id, username: botInfo.username });

    res.json({ status: 'success', message: `Bot switched successfully. Active listener on @${botInfo.username}` });
  } catch (err) {
    next(err);
  }
});

router.delete('/bots/:id', authMiddleware, async (req, res, next) => {
  try {
    const botDoc = await BotModel.findById(req.params.id);
    if (!botDoc) {
      return res.status(404).json({ status: 'error', message: 'Bot configuration not found.' });
    }

    if (botDoc.status === 'connected') {
      return res.status(400).json({ status: 'error', message: 'Cannot delete bot configuration while it is actively connected and running.' });
    }

    await BotModel.findByIdAndDelete(req.params.id);

    await ActivityLog.log('Bot configuration deleted', req.admin.id, 'success', { botId: req.params.id });

    res.json({ status: 'success', message: 'Bot configuration deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 12. CONTENT PACKS MANAGEMENT
// ==========================================

// GET /content-packs (list packs)
router.get('/content-packs', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const botId = req.botId;
    if (!botId) {
      return res.status(400).json({ status: 'error', message: 'No active bot selected.' });
    }

    const cleanSearch = cleanQueryString(req.query.search);
    const cleanStatus = cleanQueryString(req.query.status);
    
    const page = Math.max(1, cleanQueryInt(req.query.page, 1));
    const limit = Math.max(1, Math.min(cleanQueryInt(req.query.limit, 25), 100));

    const query = { botId };
    if (cleanStatus) query.status = cleanStatus;
    if (cleanSearch) {
      const escaped = escapeRegex(cleanSearch);
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { publicCode: { $regex: escaped, $options: 'i' } },
      ];
    }

    const activeBot = await BotModel.findById(botId);
    const botUsername = activeBot ? activeBot.username : 'Bot';

    const total = await ContentPack.countDocuments(query);
    const packs = await ContentPack.find(query)
      .populate('items.contentId', 'title type status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const packsWithLinks = packs.map(p => {
      const pObj = p.toObject();
      pObj.shareLink = `https://t.me/${botUsername}?start=pack_${p.publicCode}`;
      pObj.itemCount = p.items ? p.items.length : 0;
      return pObj;
    });

    return res.json({
      status: 'success',
      packs: packsWithLinks,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /content-packs/:id (single pack details)
router.get('/content-packs/:id', authMiddleware, async (req, res, next) => {
  try {
    const pack = await ContentPack.findById(req.params.id)
      .populate('items.contentId', 'title type status categoryId');
    if (!pack) {
      return res.status(404).json({ status: 'error', message: 'Pack not found.' });
    }

    const activeBot = await BotModel.findById(pack.botId);
    const botUsername = activeBot ? activeBot.username : 'Bot';

    const packObj = pack.toObject();
    packObj.shareLink = `https://t.me/${botUsername}?start=pack_${pack.publicCode}`;

    return res.json({ status: 'success', pack: packObj });
  } catch (error) {
    next(error);
  }
});

// POST /content-packs (create pack)
router.post('/content-packs', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const botId = req.botId;
    if (!botId) {
      return res.status(400).json({ status: 'error', message: 'No active bot selected.' });
    }

    const { name, description, status, expiresAt, items, protectContent } = req.body;

    if (!name) {
      return res.status(400).json({ status: 'error', message: 'Pack name is required.' });
    }

    // Generate safe public code
    let publicCode;
    let isUnique = false;
    while (!isUnique) {
      publicCode = crypto.randomBytes(4).toString('hex').toLowerCase();
      const existing = await ContentPack.findOne({ botId, publicCode });
      if (!existing) isUnique = true;
    }

    const pack = await ContentPack.create({
      botId,
      name,
      description,
      status: status || 'ACTIVE',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      items: items || [],
      publicCode,
      protectContent: protectContent || false
    });

    await ActivityLog.log('Create Content Pack', req.admin.id, 'success', { name: pack.name, publicCode: pack.publicCode });

    return res.json({ status: 'success', pack });
  } catch (error) {
    next(error);
  }
});

// PATCH /content-packs/:id (update pack)
router.patch('/content-packs/:id', authMiddleware, async (req, res, next) => {
  try {
    const { name, description, status, expiresAt, items, protectContent } = req.body;
    const pack = await ContentPack.findById(req.params.id);
    if (!pack) {
      return res.status(404).json({ status: 'error', message: 'Pack not found.' });
    }

    if (name !== undefined) pack.name = name;
    if (description !== undefined) pack.description = description;
    if (status !== undefined) pack.status = status;
    if (expiresAt !== undefined) pack.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (items !== undefined) pack.items = items;
    if (protectContent !== undefined) pack.protectContent = protectContent;

    await pack.save();

    await ActivityLog.log('Update Content Pack', req.admin.id, 'success', { name: pack.name, publicCode: pack.publicCode });

    return res.json({ status: 'success', pack });
  } catch (error) {
    next(error);
  }
});

// POST /content-packs/:id/duplicate (duplicate pack)
router.post('/content-packs/:id/duplicate', authMiddleware, async (req, res, next) => {
  try {
    const original = await ContentPack.findById(req.params.id);
    if (!original) {
      return res.status(404).json({ status: 'error', message: 'Original pack not found.' });
    }

    // Generate safe public code
    let publicCode;
    let isUnique = false;
    while (!isUnique) {
      publicCode = crypto.randomBytes(4).toString('hex').toLowerCase();
      const existing = await ContentPack.findOne({ botId: original.botId, publicCode });
      if (!existing) isUnique = true;
    }

    const duplicated = await ContentPack.create({
      botId: original.botId,
      name: `Copy of ${original.name}`,
      description: original.description,
      status: 'ACTIVE',
      items: original.items.map(item => ({
        contentId: item.contentId,
        sortOrder: item.sortOrder,
        captionOverride: item.captionOverride,
        deliveryMode: item.deliveryMode,
        enabled: item.enabled
      })),
      publicCode,
      protectContent: original.protectContent
    });

    await ActivityLog.log('Duplicate Content Pack', req.admin.id, 'success', { name: duplicated.name, originalId: original._id });

    return res.json({ status: 'success', pack: duplicated });
  } catch (error) {
    next(error);
  }
});

// DELETE /content-packs/:id (delete pack)
router.delete('/content-packs/:id', authMiddleware, async (req, res, next) => {
  try {
    const pack = await ContentPack.findById(req.params.id);
    if (!pack) {
      return res.status(404).json({ status: 'error', message: 'Pack not found.' });
    }

    await ContentPack.findByIdAndDelete(req.params.id);

    await ActivityLog.log('Delete Content Pack', req.admin.id, 'success', { name: pack.name });

    return res.json({ status: 'success', message: 'Pack deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

// GET /content-packs/:id/analytics (pack performance metrics)
router.get('/content-packs/:id/analytics', authMiddleware, async (req, res, next) => {
  try {
    const packId = new mongoose.Types.ObjectId(req.params.id);
    const pack = await ContentPack.findById(packId);
    if (!pack) {
      return res.status(404).json({ status: 'error', message: 'Pack not found.' });
    }

    const stats = await DeliveryBatch.aggregate([
      { $match: { packId } },
      {
        $group: {
          _id: null,
          totalOpens: { $sum: 1 },
          uniqueUsersList: { $addToSet: '$userId' },
          totalMessagesDelivered: { $sum: '$successCount' },
          successfulDeliveriesCount: {
            $sum: { $cond: [{ $gt: ['$successCount', 0] }, 1, 0] }
          },
          failedDeliveriesCount: { $sum: '$failureCount' },
          lastOpened: { $max: '$startedAt' }
        }
      }
    ]);

    const analytics = stats.length > 0 ? {
      totalOpens: stats[0].totalOpens,
      uniqueUsers: stats[0].uniqueUsersList.length,
      totalMessagesDelivered: stats[0].totalMessagesDelivered,
      successfulDeliveries: stats[0].successfulDeliveriesCount,
      failedDeliveries: stats[0].failedDeliveriesCount,
      lastOpened: stats[0].lastOpened
    } : {
      totalOpens: 0,
      uniqueUsers: 0,
      totalMessagesDelivered: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      lastOpened: null
    };

    return res.json({ status: 'success', analytics });
  } catch (error) {
    next(error);
  }
});

// GET /system/demo-status (check if demo data is loaded)
router.get('/system/demo-status', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const botId = req.botId;
    if (!botId) {
      return res.status(400).json({ status: 'error', message: 'No active bot selected.' });
    }
    const hasDemoPack = await ContentPack.exists({ botId, isDemo: true });
    const hasDemoCategory = await Category.exists({ botId, isDemo: true });
    const hasDemoContent = await Content.exists({ botId, isDemo: true });
    
    const loaded = !!(hasDemoPack || hasDemoCategory || hasDemoContent);
    return res.json({ status: 'success', loaded });
  } catch (error) {
    next(error);
  }
});

// POST /system/seed-demo (seed demo pack & content)
router.post('/system/seed-demo', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const botId = req.botId;
    if (!botId) {
      return res.status(400).json({ status: 'error', message: 'No active bot selected.' });
    }

    // Check if already seeded
    const alreadySeeded = await ContentPack.exists({ botId, isDemo: true });
    if (alreadySeeded) {
      const demoPack = await ContentPack.findOne({ botId, isDemo: true });
      return res.json({
        status: 'success',
        message: 'Demo environment is already loaded.',
        pack: demoPack
      });
    }

    // 1. Find or create 5 Categories
    const categoryNames = ['Electronics', 'Gaming', 'Software', 'Courses', 'Accessories'];
    const categories = [];
    for (const name of categoryNames) {
      let cat = await Category.findOne({ name, botId });
      if (!cat) {
        cat = await Category.create({
          name,
          displayName: name,
          slug: name.toLowerCase().replace(/ /g, '-'),
          status: 'active',
          isDemo: true,
          botId
        });
      } else {
        cat.isDemo = true;
        await cat.save();
      }
      categories.push(cat);
    }

    const catMap = {};
    categories.forEach(c => { catMap[c.name] = c._id; });

    // 2. Find or create 12 Content Items (Text and Links)
    const demoItemsData = [
      { title: 'Wireless Headphones Guide', type: 'link', url: 'https://example.com/headphones', caption: 'Premium acoustics & active noise cancellation.', categoryId: catMap['Electronics'] },
      { title: 'Mechanical Keyboard Setup', type: 'link', url: 'https://example.com/keyboards', caption: 'Custom hot-swappable switches & mechanical layout.', categoryId: catMap['Electronics'] },
      { title: 'Gaming Mouse Review', type: 'link', url: 'https://example.com/gaming-mouse', caption: 'Ultra-lightweight sensor performance.', categoryId: catMap['Gaming'] },
      { title: 'Console Controller Guide', type: 'text', text: '🎮 Learn how to pair and customize your wireless gaming controllers.', categoryId: catMap['Gaming'] },
      { title: 'USB-C Hub Specifications', type: 'text', text: '🔌 Essential multi-port adapter specs for desktop workstations.', categoryId: catMap['Accessories'] },
      { title: 'UI Design Kit Download', type: 'link', url: 'https://example.com/ui-kit', caption: 'SaaS Figma UI library with custom components.', categoryId: catMap['Software'] },
      { title: 'JavaScript Masterclass Course', type: 'link', url: 'https://example.com/js-course', caption: 'ESNext features, closures, promises, and async patterns.', categoryId: catMap['Courses'] },
      { title: 'Premium SVG Icon Pack', type: 'link', url: 'https://example.com/icons', caption: 'Line and solid style icons for clean interfaces.', categoryId: catMap['Accessories'] },
      { title: 'React Dashboard Template', type: 'link', url: 'https://example.com/react-dashboard', caption: 'Fully responsive administrative theme.', categoryId: catMap['Software'] },
      { title: 'Developer Toolkit Checklist', type: 'text', text: '🛠️ Recommended system tools, shell customizations, and CLI aliases.', categoryId: catMap['Software'] },
      { title: 'Productivity Hacks Course', type: 'text', text: '⚡ Time management techniques, keyboard shortcuts, and workflow optimizations.', categoryId: catMap['Courses'] },
      { title: 'Accessories Showcase', type: 'text', text: '🎒 Desk organization accessories, monitor mounts, and ambient lighting setups.', categoryId: catMap['Accessories'] }
    ];

    const contentIds = [];
    for (const item of demoItemsData) {
      let content = await Content.findOne({ title: item.title, botId });
      if (!content) {
        content = await Content.create({
          ...item,
          status: 'active',
          isStartContent: false,
          isFeatured: false,
          isDemo: true,
          botId
        });
      } else {
        content.isDemo = true;
        await content.save();
      }
      contentIds.push(content._id);
    }

    // 3. Create Demo Content Pack
    let publicCode;
    let isUnique = false;
    while (!isUnique) {
      publicCode = 'demo_' + crypto.randomBytes(3).toString('hex').toLowerCase();
      const existing = await ContentPack.findOne({ botId, publicCode });
      if (!existing) isUnique = true;
    }

    const demoPack = await ContentPack.create({
      botId,
      name: 'Demo Product Pack',
      description: 'This is an automatically generated demo product collection containing text and web links.',
      status: 'ACTIVE',
      items: contentIds.slice(0, 6).map((cid, index) => ({
        contentId: cid,
        sortOrder: index,
        enabled: true
      })),
      publicCode,
      isDemo: true
    });

    await ActivityLog.log('Seed Demo Data', req.admin.id, 'success', { botId, packId: demoPack._id });

    return res.json({
      status: 'success',
      message: 'Demo categories, contents, and pack created successfully.',
      pack: demoPack
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /system/clear-demo (delete demo items only)
router.delete('/system/clear-demo', authMiddleware, activeBotMiddleware, async (req, res, next) => {
  try {
    const botId = req.botId;
    if (!botId) {
      return res.status(400).json({ status: 'error', message: 'No active bot selected.' });
    }

    const deletedPacks = await ContentPack.deleteMany({ botId, isDemo: true });
    const deletedContent = await Content.deleteMany({ botId, isDemo: true });
    const deletedCategories = await Category.deleteMany({ botId, isDemo: true });

    await ActivityLog.log('Clear Demo Data', req.admin.id, 'success', {
      botId,
      deletedPacks: deletedPacks.deletedCount,
      deletedContent: deletedContent.deletedCount,
      deletedCategories: deletedCategories.deletedCount
    });

    return res.json({
      status: 'success',
      message: 'Demo environment cleaned successfully.',
      details: {
        packs: deletedPacks.deletedCount,
        content: deletedContent.deletedCount,
        categories: deletedCategories.deletedCount
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
