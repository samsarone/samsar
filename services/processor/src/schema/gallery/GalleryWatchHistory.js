import { Schema } from 'mongoose';

const galleryWatchHistorySchema = new Schema(
  {
    viewerId: { type: String, required: true },
    publicationId: { type: String, required: true },
    viewCount: { type: Number, default: 0 },
    watchTimeMs: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    firstViewedAt: { type: Date, default: Date.now },
    lastViewedAt: { type: Date, default: Date.now },
    lastCountedAt: { type: Date, default: null },
    tags: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    creatorHandle: { type: String, default: null },
    format: { type: String, default: 'unknown' },
    source: { type: String, default: 'gallery' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'gallery_watch_history',
  },
);

galleryWatchHistorySchema.index({ viewerId: 1, publicationId: 1 }, { unique: true });
galleryWatchHistorySchema.index({ viewerId: 1, lastViewedAt: -1 });
galleryWatchHistorySchema.index({ publicationId: 1, lastViewedAt: -1 });

export default galleryWatchHistorySchema;
