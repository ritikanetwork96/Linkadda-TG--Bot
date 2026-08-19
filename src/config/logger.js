import { config } from './env.js';

// Sensitive keys to scrub from logs
const SENSITIVE_KEYS = [
  'token',
  'bottoken',
  'password',
  'secret',
  'key',
  'uri',
  'mongodb_uri',
  'accesskey',
  'secretkey',
  'cookie',
  'authorization'
];

/**
 * Recursively deep clone and scrub sensitive values from metadata objects
 */
function scrubMetadata(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => scrubMetadata(item, depth + 1));
  }

  const scrubbed = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check for match in sensitive keys list
    const isSensitive = SENSITIVE_KEYS.some(sKey => lowerKey.includes(sKey));
    
    if (isSensitive && typeof val === 'string') {
      scrubbed[key] = '[REDACTED_SECRET]';
    } else if (typeof val === 'object') {
      scrubbed[key] = scrubMetadata(val, depth + 1);
    } else {
      scrubbed[key] = val;
    }
  }
  return scrubbed;
}

/**
 * Standard Structured Logger
 */
class StructuredLogger {
  constructor() {
    this.isProduction = config.nodeEnv === 'production';
  }

  logMessage(level, event, reqId = null, metadata = {}) {
    const timestamp = new Date().toISOString();
    const cleanMeta = metadata ? scrubMetadata(metadata) : {};

    if (this.isProduction) {
      // In production, write raw JSON for log collectors
      console.log(JSON.stringify({
        timestamp,
        level,
        requestId: reqId || 'N/A',
        event,
        metadata: cleanMeta
      }));
    } else {
      // In development, write human-readable formatted string
      const idPrefix = reqId ? ` [RID: ${reqId}]` : '';
      const metaString = Object.keys(cleanMeta).length > 0 ? ` | ${JSON.stringify(cleanMeta)}` : '';
      console.log(`[${timestamp}] [${level}]${idPrefix} ${event}${metaString}`);
    }
  }

  info(event, reqId = null, metadata = {}) {
    this.logMessage('INFO', event, reqId, metadata);
  }

  warn(event, reqId = null, metadata = {}) {
    this.logMessage('WARN', event, reqId, metadata);
  }

  error(event, errorObj, reqId = null, metadata = {}) {
    let errorMessage = 'Unknown Error';
    let errorStack = undefined;

    if (errorObj instanceof Error) {
      errorMessage = errorObj.message;
      if (!this.isProduction) {
        errorStack = errorObj.stack;
      }
    } else if (typeof errorObj === 'string') {
      errorMessage = errorObj;
    }

    const mergedMeta = {
      ...metadata,
      errorMessage,
      ...(errorStack && { stack: errorStack })
    };

    this.logMessage('ERROR', event, reqId, mergedMeta);
  }
}

export const logger = new StructuredLogger();
