import { User } from '../models/User.js';

export const userService = {
  /**
   * Upsert user when interacting with the bot
   * @param {object} telegramUser - User object from Telegram context (ctx.from)
   * @returns {Promise<object>} The Mongoose User document
   */
  async upsertUser(telegramUser, botId = null) {
    if (!telegramUser || !telegramUser.id) {
      throw new Error('User Service: Invalid Telegram user data');
    }

    const { id, username, first_name, last_name, language_code, is_bot } = telegramUser;

    const query = { telegramUserId: id };
    if (botId) {
      query.botId = botId;
    }

    // Try finding and updating in one atomic operation
    const updatedUser = await User.findOneAndUpdate(
      query,
      {
        $set: {
          username: username || '',
          firstName: first_name || '',
          lastName: last_name || '',
          languageCode: language_code || '',
          isBot: !!is_bot,
          lastActiveAt: new Date(),
          status: 'active', // Ensure they are marked active
        },
        $setOnInsert: {
          startedAt: new Date(),
          botId: botId || undefined,
        }
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    return updatedUser;
  },

  /**
   * Get user by Telegram user ID
   * @param {number} telegramUserId 
   * @param {string} [botId]
   * @returns {Promise<object|null>}
   */
  async getUserByTelegramId(telegramUserId, botId = null) {
    const query = { telegramUserId };
    if (botId) {
      query.botId = botId;
    }
    return User.findOne(query);
  }
};
