import mongoose from 'mongoose';

const linkItemSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['photo', 'video', 'document', 'text'], 
    required: true 
  },
  mediaId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Content',
    default: null
  },
  text: { 
    type: String,
    default: ''
  },
  caption: { 
    type: String,
    default: ''
  },
  sortOrder: { 
    type: Number, 
    default: 0 
  }
});

const linkSchema = new mongoose.Schema(
  {
    token: { 
      type: String, 
      required: true, 
      unique: true, 
      index: true 
    },
    status: { 
      type: String, 
      enum: ['active', 'inactive', 'expired', 'deleted'], 
      default: 'active', 
      index: true 
    },
    items: [linkItemSchema],
    createdBy: { 
      type: String, 
      required: true 
    },
    expiresAt: { 
      type: Date, 
      default: null,
      index: true
    },
    autoDeleteSeconds: {
      type: Number,
      default: null
    },
    botId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bot',
      index: true
    },
  },
  { 
    timestamps: true,
    collection: 'links'
  }
);

export const Link = mongoose.model('Link', linkSchema);
