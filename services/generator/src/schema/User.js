
import { Schema,model } from 'mongoose';

const CustomAdapters = new Schema({
  api_key: String,
  base_url: String,
  text_to_video: String,
  text_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  image_to_video: String,
  image_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_image: String,
  text_to_image_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_speech: String,
  text_to_speech_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_music: String,
  text_to_music_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_sound_effect: String,
  text_to_sound_effect_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
}, { _id: false, strict: false });

// 2. Create a Schema corresponding to the document interface.
const userSchema = new Schema({
  fid: String,
  userId: String,

  bio: String,
  custody: String,
  custody: String,
  displayName: String,
  message: String,
  nonce: String,
  pfpUrl: String,
  signature: String,
  state: String,
  username: String,
  verifications: Array,
  selectedInferenceModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  selectedAssistantModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  backingTrackModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  agentVideoModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  agentImageModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  agentSoundEffectModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' },
  custom_adapters: { type: CustomAdapters, default: null },

}, { timestamps: true, strict: false });

// 3. Create a Model.
export const User = model('User', userSchema);
