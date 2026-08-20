import mongoose from 'mongoose';

const linkItemSchema = new mongoose.Schema({
  type: { type: String, enum: ['photo', 'video', 'document', 'text'], required: true },
  mediaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Content', default: null },
  text: { type: String, default: '' },
  caption: { type: String, default: '' },
  sortOrder: { type: Number, default: 0 }
});

const linkSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    linkNumber: { type: Number, default: null, index: true },
    status: { type: String, enum: ['active', 'inactive', 'expired', 'deleted'], default: 'active', index: true },
    items: [linkItemSchema],
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, default: null, index: true },
    autoDeleteSeconds: { type: Number, default: null },
    botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', index: true },
  },
  { timestamps: true, collection: 'links' }
);

/**
 * Generate next sequential token in L_N format (e.g., L_1, L_2, L_3...)
 */
linkSchema.statics.generateNextToken = async function(botId) {
  const query = botId ? { botId } : {};
  let attempts = 0;
  while (attempts < 10) {
    const lastLink = await this.findOne(query).sort({ linkNumber: -1 }).select('linkNumber');
    const nextNumber = (lastLink?.linkNumber || 0) + 1;
    const token = `L_${nextNumber}`;
    const exists = await this.findOne({ token });
    if (!exists) {
      return { token, linkNumber: nextNumber };
    }
    attempts++;
  }
  const fallback = `L_${Date.now()}`;
  return { token: fallback, linkNumber: null };
};

export const Link = mongoose.model('Link', linkSchema);
