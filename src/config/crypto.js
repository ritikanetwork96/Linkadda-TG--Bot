import crypto from 'crypto';
import { config } from './env.js';

const ALGORITHM = 'aes-256-cbc';
// Derive a 32-byte key using the JWT secret (or fallback)
const KEY = crypto.scryptSync(config.adminJwtSecret, 'salt_for_key_derivation', 32);

/**
 * Hashes a plain text password using PBKDF2
 * @param {string} password 
 * @returns {string} salt:hash format
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plain text password against a stored hashed password
 * @param {string} password 
 * @param {string} storedPassword salt:hash format
 * @returns {boolean}
 */
export function verifyPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.includes(':')) {
    return false;
  }
  const [salt, hash] = storedPassword.split(':');
  const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === checkHash;
}

/**
 * Encrypts clear text using AES-256-CBC (encryption at rest)
 * @param {string} text 
 * @returns {string} ivHex:encryptedHex
 */
export function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts encrypted text using AES-256-CBC
 * @param {string} encryptedText ivHex:encryptedHex
 * @returns {string}
 */
export function decrypt(encryptedText) {
  if (!encryptedText || !encryptedText.includes(':')) {
    return '';
  }
  const [ivHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
