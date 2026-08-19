import mongoose from 'mongoose';

const contentPackItemSchema = new mongoose.Schema({
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  captionOverride: {
    type: String,
    trim: true,
  },
  deliveryMode: {
    type: String,
    enum: ['normal', 'protected'],
    default: 'normal',
  },
  enabled: {
    type: Boolean,
    default: true,
  }
});

const contentPackSchema = new mongoose.Schema(
  {
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'DISABLED', 'EXPIRED', 'PENDING', 'published', 'expired', 'draft', 'cancelled'],
      default: 'ACTIVE',
      index: true,
    },
    mode: {
      type: String,
      enum: ['direct', 'link'],
      default: 'direct',
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      index: true,
    },
    replyMarkup: {
      type: mongoose.Schema.Types.Mixed,
    },
    items: [contentPackItemSchema],
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    publicCode: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
    publishedAt: {
      type: Date,
    },
    forwardDate: {
      type: Date,
    },
    sourceAdminId: {
      type: Number,
    },
    sourceMessageId: {
      type: Number,
    },
    sourceMessageIds: {
      type: [Number],
      default: [],
    },
    mediaGroupId: {
      type: String,
      index: true,
    },
    isDemo: {
      type: Boolean,
      default: false,
    },
    protectContent: {
      type: Boolean,
      default: true,
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    collection: 'content_packs',
  }
);

// Compound unique index for botId and publicCode
contentPackSchema.index({ botId: 1, publicCode: 1 }, { unique: true });
contentPackSchema.index({ createdAt: 1 });

export const ContentPack = mongoose.model('ContentPack', contentPackSchema);
