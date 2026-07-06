import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const generatedAIVideoSchema = new Schema({
  url: String,
  remoteUrl: String,
  description: String,
  prompt: String,
  sessionId: String,
  layerId: String,
  userId: String,
  model: String,
  audioPrompt: String,
  duration: Number,
  generationType: { type: String, default: 'ai_video' },
  thumbnailPath: String,
  endThumbnailPath: String,
  thumbnailVideoPath: String,
  thumbnailVideoRemoteUrl: String,

}, { timestamps: true });

// 3. Create a Model.
const GeneratedAIVideo = model('GeneratedAIVideo', generatedAIVideoSchema);

export default GeneratedAIVideo;
