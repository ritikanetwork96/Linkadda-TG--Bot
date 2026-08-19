import mongoose from 'mongoose';

const eventLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    telegramUserId: {
      type: Number,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      trim: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    timestamp: {
      type: Date,
      default: Date.now,
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
    collection: 'event_logs',
  }
);

// Helper static method to log events easily
eventLogSchema.statics.log = async function (eventType, userId, telegramUserId, targetId = '', metadata = {}, botId = null) {
  try {
    return await this.create({
      userId: userId || undefined,
      telegramUserId,
      eventType,
      targetId,
      metadata,
      botId: botId || undefined,
    });
  } catch (err) {
    console.error(`EventLog Error: Failed to record event ${eventType}:`, err.message);
  }
};

export const EventLog = mongoose.model('EventLog', eventLogSchema);
