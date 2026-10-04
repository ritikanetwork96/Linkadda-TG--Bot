import { Telegram } from 'telegraf';
import { config } from '../config/env.js';

/**
 * Validates if the given Telegram chat/user ID belongs to an administrator.
 * @param {string|number} chatId
 * @returns {boolean}
 */
export function isTelegramAdmin(chatId) {
  if (chatId === undefined || chatId === null) return false;
  const idStr = String(chatId).trim();
  if (!idStr) return false;

  // Check config.adminTelegramIds first
  const adminIds = (config.adminTelegramIds || []).map(id => String(id).trim()).filter(Boolean);
  if (adminIds.includes(idStr)) {
    return true;
  }

  // Dynamic fallback check in process.env.ADMIN_TELEGRAM_IDS
  const rawEnvIds = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  if (rawEnvIds.includes(idStr)) {
    return true;
  }

  return false;
}

// Telegram methods that send or duplicate content and support protect_content
const PROTECTED_METHODS = new Set([
  'sendMessage',
  'sendPhoto',
  'sendVideo',
  'sendAudio',
  'sendDocument',
  'sendAnimation',
  'sendVoice',
  'sendVideoNote',
  'sendMediaGroup',
  'sendSticker',
  'sendDice',
  'sendPoll',
  'sendLocation',
  'sendVenue',
  'sendContact',
  'sendInvoice',
  'sendPaidMedia',
  'copyMessage',
  'copyMessages',
  'forwardMessage',
  'forwardMessages'
]);

function shouldProtectMethod(method) {
  if (PROTECTED_METHODS.has(method)) return true;
  return /^(send|copy|forward)/.test(method);
}

/**
 * Universal protection hook:
 * Intercepts all outgoing messages and media from any Telegram client instance.
 * For non-admin recipients, strictly enforces `protect_content: true` to prevent forwarding, saving, and copying.
 * For admin recipients, allows forwarding and saving (`protect_content: false`).
 */
export function installTelegramContentProtection() {
  if (Telegram.prototype._isContentProtectionInstalled) {
    return;
  }

  const originalCallApi = Telegram.prototype.callApi;

  Telegram.prototype.callApi = async function (method, data, options) {
    if (shouldProtectMethod(method) && data && data.chat_id !== undefined && data.chat_id !== null) {
      const isAdmin = isTelegramAdmin(data.chat_id);
      if (!isAdmin) {
        // Enforce anti-forwarding and anti-saving for regular users
        data.protect_content = true;
      } else {
        // Admin recipient: allow forwarding/saving unless explicitly requested otherwise
        data.protect_content = data.protect_content ?? false;
      }
    }

    return originalCallApi.call(this, method, data, options);
  };

  Telegram.prototype._isContentProtectionInstalled = true;
}

// Auto-install immediately on module import
installTelegramContentProtection();
