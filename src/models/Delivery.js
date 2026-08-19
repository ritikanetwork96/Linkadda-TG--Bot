import mongoose from 'mongoose';

const deliverySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    telegramChatId: {
      type: Number,
      required: true,
      index: true,
    },
    telegramMessageId: {
      type: Number,
      required: true,
    },
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content',
      index: true,
    },
    deliveryBatchId: {
      type: String,
      required: true,
      index: true,
    },
    messageType: {
      type: String,
      enum: ['video', 'photo', 'document', 'text', 'link', 'welcome'],
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    deleteAt: {
      type: Date,
      index: true,
    },
    status: {
      type: String,
      enum: ['sent', 'deleted', 'failed'],
      default: 'sent',
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    retryCount: {
      type: Number,
      default: 0,
      index: true,
    },
    lockedAt: {
      type: Date,
      index: true,
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true,
    },
    packId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentPack',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'deliveries',
  }
);

// Define compound index for optimal scheduler scans
deliverySchema.index({ status: 1, deleteAt: 1 });

export const Delivery = mongoose.model('Delivery', deliverySchema);

