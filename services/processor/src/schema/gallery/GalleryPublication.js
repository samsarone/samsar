import { Schema } from 'mongoose';

const classificationSchema = new Schema(
  {
    version: { type: String, default: null },
    status: { type: String, default: 'pending' },
    lastAttemptAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null },
    leaseExpiresAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false }
);

const galleryPublicationSchema = new Schema(
  {
    publicationId: { type: String, required: true },
    sessionId: { type: String, default: null },
    videoUrl: { type: String, required: true },
    posterUrl: { type: String, default: null },
    title: { type: String, default: 'Untitled Video' },
    description: { type: String, default: '' },
    originalPrompt: { type: String, default: '' },
    creatorHandle: { type: String, default: '' },
    createdBy: { type: String, default: null },
    tags: { type: [String], default: [] },
    categories: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    classification: { type: classificationSchema, default: () => ({}) },
    sessionTranscript: {
      type: Schema.Types.Mixed,
      default: () => ({ scenes: [], sounds: [] }),
    },
    aspectRatio: { type: String, default: null },
    format: {
      type: String,
      enum: ['landscape', 'portrait', 'square', 'unknown'],
      default: 'unknown',
    },
    contentLanguage: { type: String, default: null },
    imageModel: { type: String, default: null },
    videoModel: { type: String, default: null },
    searchText: { type: String, required: true },
    embeddingText: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, default: 'text-embedding-3-small' },
    embeddingFingerprint: { type: String, required: true },
    embeddingVersion: { type: String, default: 'gallery-v1' },
    metrics: {
      views: { type: Number, default: 0 },
      uniqueViews: { type: Number, default: 0 },
      completedViews: { type: Number, default: 0 },
      watchTimeMs: { type: Number, default: 0 },
      averageWatchTimeMs: { type: Number, default: 0 },
      averageCompletionRate: { type: Number, default: 0 },
      likes: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
    },
    popularityScore: { type: Number, default: 0 },
    trendingScore: { type: Number, default: 0 },
    qualityScore: { type: Number, default: 0 },
    sourceCreatedAt: { type: Date, default: null },
    sourceUpdatedAt: { type: Date, default: null },
    indexedAt: { type: Date, default: Date.now },
    lastEngagementAt: { type: Date, default: null },
    available: { type: Boolean, default: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'gallery_publications',
  },
);

galleryPublicationSchema.index({ publicationId: 1 }, { unique: true });
galleryPublicationSchema.index({ available: 1, popularityScore: -1 });
galleryPublicationSchema.index({ available: 1, trendingScore: -1 });
galleryPublicationSchema.index({ format: 1, available: 1, popularityScore: -1 });
galleryPublicationSchema.index({ categories: 1, available: 1, popularityScore: -1 });
galleryPublicationSchema.index({ topics: 1, available: 1, popularityScore: -1 });
galleryPublicationSchema.index({ 'classification.lastUpdatedAt': 1, available: 1 });
galleryPublicationSchema.index({ sourceUpdatedAt: 1 });
galleryPublicationSchema.index(
  { title: 'text', description: 'text', originalPrompt: 'text', tags: 'text', creatorHandle: 'text' },
  {
    name: 'gallery_text_search',
    // Cosmos DB accepts at most three custom text-index weights. The remaining
    // indexed fields retain MongoDB's default weight of 1.
    weights: { title: 10, description: 4, originalPrompt: 2 },
    // Publication language is stored as `contentLanguage`; reserve the driver's
    // conventional `language` field and use a separate override name as defense
    // in depth for Mongo-compatible text-index implementations.
    language_override: 'textIndexLanguage',
  },
);

export default galleryPublicationSchema;
