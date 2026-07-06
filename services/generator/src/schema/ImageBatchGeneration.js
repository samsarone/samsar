import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const imageBatchGenerationSchema = new Schema({

  layers: [
    {
      prompt: String,
      status: String, // INIT , PENDING, COMPLETED, CANCELLED, FAILED
      image: String,
      layerId: String,
      
    }
  ],
  userId: String,
  themeKeywords: String,

  sessionId: String,

  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // TTL in seconds (1 hour)
  }
}, { timestamps: true });

// 3. Create a Model.
const ImageBatchGeneration = model('ImageBatchGeneration', imageBatchGenerationSchema);
export default ImageBatchGeneration;


