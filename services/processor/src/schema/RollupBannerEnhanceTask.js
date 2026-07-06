import { Schema, model } from 'mongoose';

const rollupBannerEnhanceTaskSchema = new Schema({
  batchId: { type: String, index: true },
  userId: { type: String },
  status: { type: String, default: 'PENDING' },
  position: { type: Number },
  originalUrl: { type: String },
  enhancedUrl: { type: String },
  resolution: { type: String },
  aspectRatio: { type: String },
  dimensions: {
    width: Number,
    height: Number,
  },
  enhanceSessionId: { type: String },
  enhanceRequestId: { type: String },
  errorMessage: { type: String },
}, { timestamps: true });

const RollupBannerEnhanceTask = model('RollupBannerEnhanceTask', rollupBannerEnhanceTaskSchema);
export default RollupBannerEnhanceTask;
