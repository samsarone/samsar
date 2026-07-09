import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const generatedMusicSchema = new Schema({
  url: String,
  description: String,
  prompt: String,
  sessionId: String,
  userId: String,
  title: String,
  tags: [String],
  lyric: String,
  duration: Number,
  volume: Number,

}, { timestamps: true });

// 3. Create a Model.
const GeneratedMusic = model('GeneratedMusic', generatedMusicSchema);

export default GeneratedMusic;
