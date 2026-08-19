import { S3Client } from '@aws-sdk/client-s3';
import { config } from './env.js';

// Parse bucket name if it's set as a full URL
let bucketName = config.filebase.bucket;
if (bucketName.startsWith('http://') || bucketName.startsWith('https://')) {
  try {
    const url = new URL(bucketName);
    const hostParts = url.hostname.split('.');
    // If the format is bucket-name.s3.filebase.io, then the first part is the bucket name
    if (hostParts.length >= 3 && hostParts[1] === 's3' && hostParts[2] === 'filebase') {
      bucketName = hostParts[0];
    } else {
      // Fallback: take the hostname or pathname
      bucketName = hostParts[0];
    }
  } catch (error) {
    console.error('S3 Client: Error parsing FILEBASE_BUCKET URL, using original value:', error.message);
  }
}

// Initialize the S3 client for Filebase
export const s3Client = new S3Client({
  endpoint: config.filebase.endpoint,
  region: config.filebase.region || 'auto',
  credentials: {
    accessKeyId: config.filebase.accessKey,
    secretAccessKey: config.filebase.secretKey,
  },
  // Filebase supports virtual hosted style buckets, but works well with default settings
});

export const storageConfig = {
  bucketName,
};

console.log(`S3 Client: Initialized for endpoint ${config.filebase.endpoint} and bucket ${bucketName}`);
