import mongoose from 'mongoose';

const deliveryBatchSchema = new mongoose.Schema(
  {
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    packId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentPack',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    successCount: {
      type: Number,
      default: 0,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'delivery_batches',
  }
);

deliveryBatchSchema.index({ createdAt: 1 });

export const DeliveryBatch = mongoose.model('DeliveryBatch', deliveryBatchSchema);
