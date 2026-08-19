import mongoose from 'mongoose';

const botSchema = new mongoose.Schema(
  {
    telegramBotId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'error'],
      default: 'disconnected',
      index: true,
    },
    encryptedToken: {
      type: String,
      trim: true,
    },
    configuration: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'bots',
  }
);

export const Bot = mongoose.model('Bot', botSchema);
