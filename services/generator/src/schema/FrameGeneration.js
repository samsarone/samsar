import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const frameGenerationSchema = new Schema({
  sessionId: String,
  layerId: String,
  rowLocked: { type: Boolean, default: false },
  isVideoGenerationRequest: { type: Boolean, default: false },
  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // 3600 seconds = 1 hour
  }
}, { timestamps: true });

// 3. Create a Model.
const FrameGeneration = model('FrameGeneration', frameGenerationSchema);

export default FrameGeneration;
