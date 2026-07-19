import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const videoGenerationSchema = new Schema({
  videoSessionId: String,
  renderPathId: { type: String, default: null },
  renderPlanVersion: { type: Number, default: null },
  isPremium: { type: Boolean, default: false },
  rowLocked: { type: Boolean, default: false },
  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // TTL in seconds (1 hour)
  },
  numRetries: { type: Number, default: 0 },
}, { timestamps: true });

// 3. Create a Model.
const VideoGeneration = model('VideoGeneration', videoGenerationSchema);

export default VideoGeneration;
