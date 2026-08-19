import mongoose from 'mongoose';

const blockSchema = new mongoose.Schema({
  blockId: { type: String, required: true },
  type: {
    type: String,
    enum: ['TEXT', 'MEDIA', 'MEDIA_GROUP', 'PHOTO', 'VIDEO', 'DOCUMENT', 'LINKS', 'TEXT_WITH_BUTTONS'],
    required: true
  },
  sortOrder: { type: Number, default: 0 },
  content: { type: String }, // For text or description
  mediaItems: [
    {
      mediaType: { type: String, enum: ['photo', 'video', 'document'], required: true },
      telegramFileId: { type: String, required: true },
      fileUniqueId: { type: String },
      fileName: { type: String },
      mimeType: { type: String },
      size: { type: Number },
      sortOrder: { type: Number, default: 0 },
      caption: { type: String }
    }
  ],
  buttons: [
    {
      text: { type: String, required: true },
      url: { type: String, required: true },
      sortOrder: { type: Number, default: 0 }
    }
  ],
  settings: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const contentSequenceSchema = new mongoose.Schema(
  {
    botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true, index: true },
    publicCode: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'DISABLED', 'EXPIRED'], default: 'DRAFT', index: true },
    blocks: [blockSchema],
    settings: {
      expiryHours: { type: Number },
      protectContent: { type: Boolean, default: true },
      autoDeleteValue: { type: String, enum: ['OFF', '5m', '15m', '30m', '1h', '6h', '24h'], default: 'OFF' },
      allowRepeatAccess: { type: Boolean, default: true },
      categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
      tags: [{ type: String }]
    },
    createdBy: { type: Number },
    expiresAt: { type: Date }
  },
  { timestamps: true }
);

export const ContentSequence = mongoose.model('ContentSequence', contentSequenceSchema);
