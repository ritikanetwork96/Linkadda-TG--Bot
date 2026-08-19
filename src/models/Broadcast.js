import mongoose from 'mongoose';

const broadcastSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['text', 'photo', 'video', 'document', 'link'],
      required: true,
    },
    text: {
      type: String,
      trim: true,
    },
    storageKey: {
      type: String,
      trim: true,
    },
    telegramFileId: {
      type: String,
      trim: true,
    },
    urlButton: {
      label: { type: String, trim: true },
      url: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    targetedCount: {
      type: Number,
      default: 0,
    },
    sentCount: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    blockedCount: {
      type: Number,
      default: 0,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    processedUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      }
    ],
    scheduledAt: {
      type: Date,
      index: true,
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'broadcasts',
  }
);

export const Broadcast = mongoose.model('Broadcast', broadcastSchema);
