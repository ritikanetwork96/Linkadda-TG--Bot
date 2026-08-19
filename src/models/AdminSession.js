import mongoose from 'mongoose';

const adminSessionSchema = new mongoose.Schema(
  {
    adminTelegramId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    state: {
      type: String,
      default: 'IDLE',
      index: true,
    },
    currentSequenceId: String,
    currentBlockId: String,
    draft: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        type: 'text', // text, photo, video, document
        telegramFileId: '',
        fileUniqueId: '',
        caption: '',
        buttons: [], // array of { text, url }
        layout: '1', // '1' or '2' per row
      }),
    },
    packDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        name: '',
        description: '',
        selectedItems: [], // array of content IDs
      }),
    },
    categoryDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        name: '',
      }),
    },
    linkDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        status: 'idle',
        items: [],
        expiresAt: null,
        updatedAt: null
      }),
    },
    currentCategoryId: String,
    currentPackId: String,
    currentBundleId: String,
    tempButtonText: String,
    updatedAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // 24 hours expiry
    },
  },
  {
    timestamps: true,
    collection: 'admin_sessions',
  }
);

// Statics helper to easily get or create a session
adminSessionSchema.statics.getSession = async function (adminTelegramId) {
  let session = await this.findOne({ adminTelegramId });
  if (!session) {
    session = await this.create({
      adminTelegramId,
      draft: {
        type: 'text',
        telegramFileId: '',
        fileUniqueId: '',
        caption: '',
        buttons: [],
        layout: '1'
      },
      packDraft: {
        name: '',
        description: '',
        selectedItems: []
      },
      categoryDraft: {
        name: ''
      },
      linkDraft: {
        status: 'idle',
        items: [],
        expiresAt: null,
        updatedAt: null
      }
    });
  } else {
    if (!session.draft) {
      session.draft = {
        type: 'text',
        telegramFileId: '',
        fileUniqueId: '',
        caption: '',
        buttons: [],
        layout: '1'
      };
    }
    if (!session.packDraft) {
      session.packDraft = {
        name: '',
        description: '',
        selectedItems: []
      };
    }
    if (!session.categoryDraft) {
      session.categoryDraft = {
        name: ''
      };
    }
    if (!session.linkDraft) {
      session.linkDraft = {
        status: 'idle',
        items: [],
        expiresAt: null,
        updatedAt: null
      };
    }
  }
  return session;
};

export const AdminSession = mongoose.model('AdminSession', adminSessionSchema);
