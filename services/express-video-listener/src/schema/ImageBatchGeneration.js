import { Schema, model } from 'mongoose';

const imageBatchGenerationSchema = new Schema({
  sessionId: String,
}, { timestamps: true, strict: false });

const ImageBatchGeneration = model('ImageBatchGeneration', imageBatchGenerationSchema);

export default ImageBatchGeneration;
