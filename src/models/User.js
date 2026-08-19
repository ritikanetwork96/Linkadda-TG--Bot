import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: Number,
      required: true,
      // No standalone index here — compound index below handles it
    },
    username: {
      type: String,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    languageCode: {
      type: String,
      trim: true,
    },
    isBot: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'blocked', 'inactive'],
      default: 'active',
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    navigationState: {
      type: mongoose.Schema.Types.Mixed,
      default: { searchMode: false },
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Compound index — sparse: true allows multiple docs with null botId (legacy records)
userSchema.index({ botId: 1, telegramUserId: 1 }, { unique: true, sparse: true });

// Non-unique index for fast lookup by telegramUserId alone
userSchema.index({ telegramUserId: 1 });

export const User = mongoose.model('User', userSchema);

