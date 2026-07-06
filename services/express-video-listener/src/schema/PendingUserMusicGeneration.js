import { Schema, model } from 'mongoose';

const pendingUserMusicGenerationSchema = new Schema({
  sessionId: String,
  rowLocked: { type: Boolean, default: false },
}, { timestamps: true, strict: false });

const PendingUserMusicGeneration = model('PendingUserMusicGeneration', pendingUserMusicGenerationSchema);

export default PendingUserMusicGeneration;
