import { 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand, 
  HeadObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, storageConfig } from '../config/storage.js';

export const storageService = {
  /**
   * Uploads an object to Filebase S3
   * @param {string} key 
   * @param {Buffer|Blob|string} body 
   * @param {string} contentType 
   * @returns {Promise<any>}
   */
  async uploadObject(key, body, contentType) {
    try {
      const command = new PutObjectCommand({
        Bucket: storageConfig.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      });
      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      console.error(`S3 Service: uploadObject failed for key ${key}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Retrieves an object from Filebase S3
   * @param {string} key 
   * @returns {Promise<any>}
   */
  async getObject(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: storageConfig.bucketName,
        Key: key,
      });
      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      console.error(`S3 Service: getObject failed for key ${key}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Deletes an object from Filebase S3
   * @param {string} key 
   * @returns {Promise<any>}
   */
  async deleteObject(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: storageConfig.bucketName,
        Key: key,
      });
      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      console.error(`S3 Service: deleteObject failed for key ${key}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Safely deletes an object from S3 only if no other Content document references the same key.
   */
  async deleteObjectSafely(key, currentContentId = null) {
    try {
      const { Content } = await import('../models/Content.js');
      const query = { storageKey: key };
      if (currentContentId) {
        query._id = { $ne: currentContentId };
      }
      const count = await Content.countDocuments(query);
      if (count > 0) {
        console.log(`S3 Service: Bypass physical deletion of S3 key "${key}" because it is still referenced by ${count} other content record(s).`);
        return false;
      }
      await this.deleteObject(key);
      return true;
    } catch (err) {
      console.error(`S3 Service: deleteObjectSafely failed for key ${key}: ${err.message}`);
      return false;
    }
  },

  /**
   * Gets metadata of an object from Filebase S3
   * @param {string} key 
   * @returns {Promise<any>}
   */
  async headObject(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: storageConfig.bucketName,
        Key: key,
      });
      const result = await s3Client.send(command);
      return result;
    } catch (error) {
      console.error(`S3 Service: headObject failed for key ${key}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Generates a pre-signed download URL for a file stored on Filebase S3
   * @param {string} key 
   * @param {number} expiresInSeconds 
   * @returns {Promise<string>}
   */
  async generatePresignedDownloadUrl(key, expiresInSeconds = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: storageConfig.bucketName,
        Key: key,
      });
      // Generate the signed URL
      const url = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
      return url;
    } catch (error) {
      console.error(`S3 Service: generatePresignedDownloadUrl failed for key ${key}: ${error.message}`);
      throw error;
    }
  },

  /**
   * Lists objects in the S3 bucket
   * @param {string} prefix
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async listObjects(prefix = '', limit = 100) {
    try {
      const command = new ListObjectsV2Command({
        Bucket: storageConfig.bucketName,
        Prefix: prefix,
        MaxKeys: limit,
      });
      const result = await s3Client.send(command);
      return result.Contents || [];
    } catch (error) {
      console.error(`S3 Service: listObjects failed: ${error.message}`);
      throw error;
    }
  }
};
