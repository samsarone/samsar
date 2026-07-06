import { Schema, model } from 'mongoose';

const avatarVoiceoverTaskSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  status: { type: String, default: 'IMAGE_PENDING', index: true },
  stage: { type: String, default: 'IMAGE_GENERATION' },
  errorMessage: { type: String, default: '' },
  prompt: { type: String, default: '' },
  avatarImagePrompt: { type: String, default: '' },
  imageRequestId: { type: String, default: '' },
  imageStatus: { type: String, default: 'PENDING' },
  imageError: { type: String, default: '' },
  avatarImage: { type: String, default: '' },
  avatarImageUrl: { type: String, default: '' },
  avatarImageWidth: { type: Number, default: 0 },
  avatarImageHeight: { type: Number, default: 0 },
}, { timestamps: true, strict: false });

const AvatarVoiceoverTask = model('AvatarVoiceoverTask', avatarVoiceoverTaskSchema);

export default AvatarVoiceoverTask;
