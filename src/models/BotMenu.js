import mongoose from 'mongoose';

const botMenuSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
      default: '',
    },
    actionType: {
      type: String,
      enum: ['CATEGORY', 'CONTENT', 'SEARCH', 'FEATURED', 'HELP', 'URL', 'COMMAND'],
      required: true,
    },
    target: {
      type: String,
      trim: true,
      default: '',
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
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
    collection: 'bot_menus',
  }
);

// Compound index to handle ordering within a specific bot context
botMenuSchema.index({ botId: 1, status: 1, sortOrder: 1 });

export const BotMenu = mongoose.model('BotMenu', botMenuSchema);
