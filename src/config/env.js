import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns';
import fs from 'fs';
import crypto from 'crypto';

// Configure DNS servers first to handle Windows/Node.js resolveSrv failures
try {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
} catch (dnsErr) {
  console.warn('DNS Warning: Unable to set DNS servers explicitly:', dnsErr.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFilePath = path.resolve(__dirname, '../../.env');

// Load environment variables from .env file
dotenv.config({ path: envFilePath });

// Automatically replace insecure default JWT secret with a cryptographically secure key
if (process.env.ADMIN_JWT_SECRET === 'dev_admin_jwt_secret_key_for_linkadda_bot_2026') {
  try {
    const secureSecret = crypto.randomBytes(32).toString('hex');
    if (fs.existsSync(envFilePath)) {
      let envContent = fs.readFileSync(envFilePath, 'utf8');
      envContent = envContent.replace(
        'ADMIN_JWT_SECRET=dev_admin_jwt_secret_key_for_linkadda_bot_2026',
        `ADMIN_JWT_SECRET=${secureSecret}`
      );
      fs.writeFileSync(envFilePath, envContent, 'utf8');
      process.env.ADMIN_JWT_SECRET = secureSecret;
      console.log('Successfully generated and saved a cryptographically secure ADMIN_JWT_SECRET to .env');
    }
  } catch (err) {
    console.error('Failed to automatically write secure JWT secret to .env:', err.message);
  }
}

// Required vars that must always be present
const alwaysRequired = [
  'MONGODB_URI',
  'MONGODB_DB_NAME',
  'FILEBASE_ENDPOINT',
  'FILEBASE_REGION',
  'FILEBASE_ACCESS_KEY',
  'FILEBASE_SECRET_KEY',
  'FILEBASE_BUCKET',
  'ADMIN_JWT_SECRET'
];

// At least one bot token must be provided (USER_BOT_TOKEN or legacy BOT_TOKEN)
const userBotToken = process.env.USER_BOT_TOKEN || process.env.BOT_TOKEN;
if (!userBotToken) {
  throw new Error('CRITICAL CONFIGURATION ERROR: Missing required environment variable: USER_BOT_TOKEN (or BOT_TOKEN)');
}

// Validate always-required variables
const missingVars = alwaysRequired.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(`CRITICAL CONFIGURATION ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
}

/**
 * Normalizes MongoDB URI by programmatically removing outer angle brackets
 * from the password field if left there by the user.
 * e.g., mongodb+srv://user:<pass>@host -> mongodb+srv://user:pass@host
 */
function normalizeMongoUri(uri) {
  if (!uri) return uri;
  return uri.replace(/:<([^>]+)>/, ':$1');
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  // --- User Bot (public-facing) ---
  // USER_BOT_TOKEN preferred; BOT_TOKEN kept as backward-compat alias
  botToken: userBotToken,        // legacy alias used by telegram.service.js
  userBotToken,
  userBotUsername: process.env.USER_BOT_USERNAME || process.env.BOT_USERNAME || '',

  // --- Admin Bot (private, optional) ---
  // If ADMIN_BOT_TOKEN is absent, the Admin Telegram Console is simply disabled.
  adminBotToken: process.env.ADMIN_BOT_TOKEN || '',
  adminBotUsername: process.env.ADMIN_BOT_USERNAME || '',

  botUsername: process.env.USER_BOT_USERNAME || process.env.BOT_USERNAME || '',
  mongodbUri: normalizeMongoUri(process.env.MONGODB_URI),
  mongodbDbName: process.env.MONGODB_DB_NAME,
  filebase: {
    endpoint: process.env.FILEBASE_ENDPOINT,
    region: process.env.FILEBASE_REGION,
    accessKey: process.env.FILEBASE_ACCESS_KEY,
    secretKey: process.env.FILEBASE_SECRET_KEY,
    bucket: process.env.FILEBASE_BUCKET,
  },
  adminJwtSecret: process.env.ADMIN_JWT_SECRET,
  adminOrigin: process.env.ADMIN_ORIGIN || '',
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => id.trim()).filter(Boolean),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '20', 10),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@bot.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'adminpassword'
};
