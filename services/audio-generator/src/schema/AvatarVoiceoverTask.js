import { Schema, model } from 'mongoose';

const avatarVoiceoverTaskSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  status: { type: String, default: 'IMAGE_PENDING', index: true },
  stage: { type: String, default: 'IMAGE_GENERATION' },
  errorMessage: { type: String, default: '' },
  hints: { type: [Object], default: [] },
  normalizedHintsText: { type: String, default: '' },
  normalizedHintsAssetPath: { type: String, default: '' },
  spokenScript: { type: String, default: '' },
  avatarSpeechGenerationId: { type: String, default: '' },
  avatarSpeechStatus: { type: String, default: '' },
  avatarSpeechAudioAssetPath: { type: String, default: '' },
  avatarSpeechAudioUrl: { type: String, default: '' },
  avatarSpeechDuration: { type: Number, default: 0 },
  avatarSpeechError: { type: String, default: '' },
  speechProvider: { type: String, default: '' },
  speechSpeaker: { type: String, default: '' },
  speechSpeakerName: { type: String, default: '' },
  speechSegments: { type: [Object], default: [] },
  speechTimelineSegments: { type: [Object], default: [] },
}, { timestamps: true, strict: false });

const AvatarVoiceoverTask = model('AvatarVoiceoverTask', avatarVoiceoverTaskSchema);

export default AvatarVoiceoverTask;
