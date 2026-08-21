import mongoose from 'mongoose';
import { config } from './env.js';

let isListenersRegistered = false;

export async function connectDatabase() {
  try {
    const options = {
      dbName: config.mongodbDbName,
      autoIndex: true, // Build indexes
    };

    if (!isListenersRegistered) {
      mongoose.connection.on('connected', () => {
        console.log('MongoDB: Database connection established successfully.');
      });

      mongoose.connection.on('error', (err) => {
        console.error(`MongoDB: Connection error: ${err.message}`);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB: Connection disconnected.');
      });

      isListenersRegistered = true;
    }

    if (mongoose.connection.readyState === 1) {
      console.log('MongoDB: Database is already connected. Skipping reconnection.');
      return mongoose.connection;
    }

    await mongoose.connect(config.mongodbUri, options);
    return mongoose.connection;
  } catch (error) {
    console.error(`MongoDB: Initial connection failure: ${error.message}`);
    throw error;
  }
}

export async function disconnectDatabase() {
  try {
    await mongoose.disconnect();
    console.log('MongoDB: Connection closed gracefully.');
  } catch (error) {
    console.error(`MongoDB: Error while disconnecting: ${error.message}`);
  }
}
