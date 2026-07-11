import { Schema } from 'mongoose';

const galleryRecommendationCacheSchema = new Schema(
  {
    cacheKey: { type: String, required: true, unique: true },
    publicationId: { type: String, required: true },
    viewerId: { type: String, default: null },
    format: { type: String, default: null },
    limit: { type: Number, required: true },
    excludeIds: { type: [String], default: [] },
    items: {
      type: [
        {
          _id: false,
          publicationId: { type: String, required: true },
          score: { type: Number, default: null },
        },
      ],
      default: [],
    },
    reason: { type: String, default: 'similar_to_current' },
    personalized: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'gallery_recommendation_cache',
  },
);

// Mongo/Cosmos removes expired entries automatically. Reads also check this field so
// the cache remains correct while the TTL monitor is between cleanup passes.
galleryRecommendationCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
galleryRecommendationCacheSchema.index({ publicationId: 1, expiresAt: 1 });

export default galleryRecommendationCacheSchema;
