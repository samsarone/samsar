import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const pendingUserMusicGeneration = new Schema({
  sessionId: String,
  prompt: String,
  rowLocked: { type: Boolean, default: false },
  generationType: String, // speech or music
  musicGenerationIds: [String],
  userId: String,
}, { timestamps: true });

// 3. Create a Model.
const PendingUserMusicGeneration = model('PendingUserMusicGeneration', pendingUserMusicGeneration);

export default PendingUserMusicGeneration;
