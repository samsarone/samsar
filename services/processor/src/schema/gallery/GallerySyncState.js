import { Schema } from 'mongoose';

const gallerySyncStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    status: { type: String, default: 'idle' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastSuccessfulAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null },
    nextUpdateAt: { type: Date, default: null },
    sourceWatermarkAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
    indexedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'gallery_sync_state',
  },
);

export default gallerySyncStateSchema;
