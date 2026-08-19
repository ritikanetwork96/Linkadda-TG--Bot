import mongoose from 'mongoose';

const mediaItemSchema = new mongoose.Schema({
  mediaType: { type: String, enum: ['photo', 'video', 'document'], required: true },
  telegramFileId: { type: String, required: true },
  fileUniqueId: { type: String },
  fileName: { type: String },
  mimeType: { type: String },
  size: { type: Number },
  sortOrder: { type: Number, default: 0 },
  caption: { type: String }
});

const mediaBundleSchema = new mongoose.Schema(
  {
    botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true, index: true },
    adminId: { type: Number, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    mediaItems: [mediaItemSchema],
    text: { type: String }, // common post text
    links: [
      {
        label: { type: String, required: true },
        url: { type: String, required: true },
        sortOrder: { type: Number, default: 0 }
      }
    ],
    buttons: [
      {
        text: { type: String, required: true },
        url: { type: String, required: true },
        sortOrder: { type: Number, default: 0 }
      }
    ],
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    packId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPack' },
    status: { type: String, enum: ['draft', 'publishing', 'published', 'failed'], default: 'draft', index: true },
    isDemo: { type: Boolean, default: false },
    protectContent: { type: Boolean, default: true },
    autoDeleteEnabled: { type: Boolean, default: false },
    autoDeleteAfter: { type: Number, default: 24 } // in hours
  },
  { timestamps: true }
);

export const MediaBundle = mongoose.model('MediaBundle', mediaBundleSchema);
