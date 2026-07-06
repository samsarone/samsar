import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const generatedImageSchema = new Schema({
  url: String,
  description: String,
  prompt: String,
  sessionId: String,
  userId: String,
  generationType: String,
  model: String,
  aspectRatio: String,

}, { timestamps: true });

// 3. Create a Model.
const GeneratedImage = model('GeneratedImage', generatedImageSchema);

export default GeneratedImage;
