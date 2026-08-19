import mongoose from 'mongoose';
import { Content } from '../models/Content.js';

export const contentService = {
  /**
   * Retrieves active Start Content, sorted by sortOrder ascending
   * @param {number} limit - Maximum number of contents to load
   * @returns {Promise<Array>}
   */
  async getStartContents(limit = 25, botId = null) {
    const botFilter = botId
      ? { $or: [{ botId }, { botId: { $exists: false } }, { botId: null }] }
      : {};
    const query = { status: 'active', isStartContent: true, ...botFilter };
    return Content.find(query)
      .sort({ sortOrder: 1, createdAt: 1 })
      .limit(limit);
  },

  /**
   * Retrieves active content by its MongoDB ObjectId string
   * @param {string} contentId 
   * @param {string} [botId]
   * @returns {Promise<object|null>}
   */
  async getActiveContentById(contentId, botId = null) {
    if (!mongoose.Types.ObjectId.isValid(contentId)) {
      return null;
    }
    const botFilter = botId
      ? { $or: [{ botId }, { botId: { $exists: false } }, { botId: null }] }
      : {};
    const query = { _id: contentId, status: 'active', ...botFilter };
    return Content.findOne(query);
  }
};
