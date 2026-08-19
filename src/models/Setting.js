import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
  {
    welcomeMessage: {
      type: String,
      default: 'Welcome.',
    },
    startBehaviour: {
      type: String,
      enum: ['WELCOME_ONLY', 'WELCOME_MENU', 'CONFIGURED_CONTENT', 'CONFIGURED_SEQUENCE', 'DISABLED'],
      default: 'WELCOME_ONLY',
    },
    startSequenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ContentSequence',
    },
    startContentEnabled: {
      type: Boolean,
      default: false,
    },
    startContentLimit: {
      type: Number,
      default: 25,
    },
    autoDeleteEnabled: {
      type: Boolean,
      default: true,
    },
    autoDeleteHours: {
      type: Number,
      default: 24,
    },
    botEnabled: {
      type: Boolean,
      default: true,
    },
    helpMessage: {
      type: String,
      default: 'ℹ️ *Help & Support*\n\nIf you have any questions or need support, contact our administrator.',
    },
    supportLink: {
      type: String,
      trim: true,
      default: '',
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true,
    },
    searchEnabled: {
      type: Boolean,
      default: true,
    },
    featuredEnabled: {
      type: Boolean,
      default: true,
    },
    bulkUploadEnabled: {
      type: Boolean,
      default: true,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      default: '⚠️ The bot is currently undergoing scheduled maintenance. Please check back in a few minutes!',
    },
    announcementText: {
      type: String,
      trim: true,
      default: '',
    },
    announcementStatus: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'inactive',
    },
  },
  {
    timestamps: true,
    collection: 'settings',
  }
);

// Method to get settings or initialize with defaults if none exists
settingSchema.statics.getSettings = async function (botId) {
  let query = {};
  if (botId) {
    query.botId = botId;
  }
  let settings = await this.findOne(query);
  if (!settings) {
    settings = await this.create(query);
  }
  return settings;
};

export const Setting = mongoose.model('Setting', settingSchema);
