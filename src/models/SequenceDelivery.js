import mongoose from 'mongoose';

const sequenceDeliverySchema = new mongoose.Schema(
  {
    sequenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentSequence', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    publicCode: { type: String, required: true },
    status: { type: String, enum: ['processing', 'completed', 'failed'], default: 'processing', index: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    messageIds: [{ type: Number }],
    failedBlocks: [{ type: String }],
    errorDetails: { type: String },
    expiresAt: { type: Date, index: true }
  },
  { timestamps: true }
);

export const SequenceDelivery = mongoose.model('SequenceDelivery', sequenceDeliverySchema);
