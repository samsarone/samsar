import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const frameGenerationSchema = new Schema({
  sessionId: String,
  layerId: String,
  renderPathId: { type: String, default: null },
  renderPlanVersion: { type: Number, default: null },
  pathSequenceIndex: { type: Number, default: null },
  rowLocked: { type: Boolean, default: false },
  isVideoGenerationRequest: { type: Boolean, default: false },
  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // 3600 seconds = 1 hour
  },
  numRetries: { type: Number, default: 0 },
  isExpressFrameGenerationRequest: { type: Boolean, default: false },
}, { timestamps: true });

frameGenerationSchema.index({
  sessionId: 1,
  renderPathId: 1,
  layerId: 1,
  renderPlanVersion: 1,
  pathSequenceIndex: 1,
});

// 3. Create a Model.
const FrameGeneration = model('FrameGeneration', frameGenerationSchema);

export default FrameGeneration;
