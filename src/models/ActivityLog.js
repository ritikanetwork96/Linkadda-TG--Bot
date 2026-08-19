import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      index: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    collection: 'activity_logs',
  }
);

// Statics helper to easily write logs
activityLogSchema.statics.log = async function (action, adminId, status = 'success', metadata = {}) {
  try {
    await this.create({ action, adminId, status, metadata });
  } catch (error) {
    console.error('ActivityLog Error: Failed to record action:', error.message);
  }
};

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
