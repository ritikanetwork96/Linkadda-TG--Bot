/**
 * Formats a welcome message dynamically by replacing template tags
 * and ensuring bot name matches the active bot identity.
 * 
 * Supported tags:
 *   {botName} / {bot_name} - Bot Display Name (e.g. InfoShow, LinkAdda)
 *   {botUsername} / {username} - Bot Telegram username (e.g. @InfoShow0987_bot)
 *   {userName} / {name} - User's first name
 */
export function formatWelcomeMessage(rawMessage, botInfo = {}, user = {}) {
  if (!rawMessage) return 'Welcome.';
  
  const botName = botInfo.displayName || botInfo.firstName || botInfo.first_name || 'Bot';
  const botUsername = botInfo.username ? `@${botInfo.username.replace(/^@/, '')}` : '';
  const userName = user.first_name || user.firstName || user.name || 'Friend';

  let text = rawMessage;

  // 1. Replace explicit template placeholders
  text = text
    .replace(/\{botName\}|\{bot_name\}|\{botname\}/gi, botName)
    .replace(/\{botUsername\}|\{bot_username\}|\{username\}/gi, botUsername)
    .replace(/\{userName\}|\{user_name\}|\{name\}/gi, userName);

  // 2. Intelligent Auto-Replacement:
  // If the welcome message has a hardcoded old bot name (e.g. "Welcome to LinkAdda" or "LinkAdda")
  // and the current bot is NOT LinkAdda, seamlessly swap it with the current bot's name!
  if (botName && botName.toLowerCase() !== 'linkadda' && /LinkAdda/i.test(text)) {
    text = text.replace(/LinkAdda/gi, botName);
  }

  // 3. Catch general "Welcome to [OldName]" pattern if it doesn't match current bot
  if (botName) {
    text = text.replace(/(Welcome\s+to\s+)([A-Za-z0-9_ -]+?)(\s*!*|\s*\n)/i, (match, prefix, oldName, suffix) => {
      if (oldName.trim().toLowerCase() !== botName.trim().toLowerCase() && oldName.trim().length > 1) {
        return `${prefix}${botName}${suffix}`;
      }
      return match;
    });
  }

  return text;
}

/**
 * Adapts an existing welcome message when a new bot is registered or data is migrated.
 * Replaces old bot references with the new bot's display name.
 */
export function adaptWelcomeMessageForBot(rawMessage, newBotName, oldBotName = null) {
  if (!rawMessage || !newBotName) return rawMessage;
  let updated = rawMessage;

  // 1. Replace explicit oldBotName if provided
  if (oldBotName && oldBotName.trim().toLowerCase() !== newBotName.trim().toLowerCase()) {
    const escapedOld = oldBotName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    updated = updated.replace(new RegExp(escapedOld, 'gi'), newBotName);
  }

  // 2. Replace hardcoded "LinkAdda" default if new bot is named differently
  if (newBotName.trim().toLowerCase() !== 'linkadda' && /LinkAdda/i.test(updated)) {
    updated = updated.replace(/LinkAdda/gi, newBotName);
  }

  // 3. Adapt "Welcome to [PreviousName]" pattern
  updated = updated.replace(/(Welcome\s+to\s+)([A-Za-z0-9_ -]+?)(\s*!*|\s*\n)/i, (match, prefix, capturedName, suffix) => {
    if (capturedName.trim().toLowerCase() !== newBotName.trim().toLowerCase()) {
      return `${prefix}${newBotName}${suffix}`;
    }
    return match;
  });

  return updated;
}
