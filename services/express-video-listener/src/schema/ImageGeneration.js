import { Schema, model } from 'mongoose';

const imageGenerationSchema = new Schema({
  sessionId: String,
  videoSessionId: String,
  rowLocked: { type: Boolean, default: false },
}, { timestamps: true, strict: false });

const ImageGeneration = model('ImageGeneration', imageGenerationSchema);

export default ImageGeneration;
