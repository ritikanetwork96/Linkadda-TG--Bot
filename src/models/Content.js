import mongoose from 'mongoose';

const contentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['video', 'photo', 'document', 'link', 'text'],
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      index: true,
    },
    storageKey: {
      type: String,
      trim: true,
      index: true,
    },
    storageBucket: {
      type: String,
      trim: true,
    },
    mimeType: {
      type: String,
      trim: true,
    },
    fileSize: {
      type: Number,
    },
    originalFileName: {
      type: String,
      trim: true,
    },
    telegramFileId: {
      type: String,
      trim: true,
    },
    adminTelegramFileId: {
      type: String,
      trim: true,
    },
    telegramFileUniqueId: {
      type: String,
      trim: true,
      index: true,
    },
    caption: {
      type: String,
      trim: true,
    },
    captionEntities: {
      type: Array,
      default: []
    },
    textEntities: {
      type: Array,
      default: []
    },
    replyMarkup: {
      type: mongoose.Schema.Types.Mixed,
    },
    url: {
      type: String,
      trim: true,
    },
    text: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isStartContent: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    fileHash: {
      type: String,
      index: true,
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true,
    },
    isDemo: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'contents',
  }
);

// Validation rules:
// - video/photo/document -> storageKey required
// - link -> url required
// - text -> text required
contentSchema.pre('validate', function (next) {
  if (['video', 'photo', 'document'].includes(this.type)) {
    if (!this.storageKey) {
      this.invalidate('storageKey', `storageKey is required for type "${this.type}"`);
    }
  } else if (this.type === 'link') {
    if (!this.url) {
      this.invalidate('url', 'url is required for type "link"');
    }
  } else if (this.type === 'text') {
    if (!this.text) {
      this.invalidate('text', 'text is required for type "text"');
    }
  }
  next();
});

export const Content = mongoose.model('Content', contentSchema);
