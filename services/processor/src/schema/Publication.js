import mongoose, { Schema, model } from 'mongoose';


const commentSchema = new Schema(
  {
    publicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Publication',
      required: true,
    },
    text: { type: String, required: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    creatorHandle: {
      type: String,
      required: true,
    },
    likes: {
      count: { type: Number, default: 0 },
      likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    // Self reference for infinite replies
    replies: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
  },
  { timestamps: true }
);

commentSchema.index({ publicationId: 1, createdAt: -1 });

// Create a separate Comment model
const Comment = model('Comment', commentSchema);

const galleryClassificationSchema = new Schema(
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

const publicationSchema = new Schema(
  {
    sessionId: String,
    imageHash: String,
    videoURL: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    creatorHandle: String,
    slug: String,
    title: String,
    description: String,
    tags: [String],
    categories: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    classification: { type: galleryClassificationSchema, default: () => ({}) },
    aspectRatio: String,
    splashImage: { type: String, default: null },
    imageModel: { type: String, default: null },
    videoModel: { type: String, default: null },
    originalPrompt: { type: String, default: '' },
    sessionTranscript: {
      type: Schema.Types.Mixed,
      default: () => ({ scenes: [], sounds: [] }),
    },
    sessionLanguage: { type: String, default: null },
    language: { type: String, default: null },
    languageString: { type: String, default: null },
    hasSubtitles: { type: Boolean, default: null },
    has_subtitles: { type: Boolean, default: null },
    likes: {
      count: { type: Number, default: 0 },
      likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
    shares: { type: Number, default: 0 },
    views: {
      total: { type: Number, default: 0 },
      unique: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      watchTimeMs: { type: Number, default: 0 },
      averageWatchTimeMs: { type: Number, default: 0 },
      averageCompletionRate: { type: Number, default: 0 },
      lastViewedAt: { type: Date, default: null },
    },
    galleryMetadata: { type: Schema.Types.Mixed, default: {} },
    recommendation: {
      popularityScore: { type: Number, default: 0 },
      trendingScore: { type: Number, default: 0 },
      qualityScore: { type: Number, default: 0 },
      embeddingVersion: { type: String, default: null },
      lastIndexedAt: { type: Date, default: null },
      embeddingStatus: { type: String, default: 'pending' },
      embeddingLastAttemptAt: { type: Date, default: null },
      embeddingLeaseExpiresAt: { type: Date, default: null },
      embeddingError: { type: String, default: null },
      metadata: { type: Schema.Types.Mixed, default: {} },
    },
    // For publications, store an array of comment references
    comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],

    isModerationPending: { type: Boolean, default: false },
    isHidden: { type: Boolean, default: false },

    moderationReports: [
      {
        reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

publicationSchema.index({ 'views.total': -1, createdAt: -1 });
publicationSchema.index({ 'recommendation.popularityScore': -1, createdAt: -1 });
publicationSchema.index({ updatedAt: 1 });

const Publication = model('Publication', publicationSchema);

export { Comment, Publication };
