import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const audioGenerationSchema = new Schema({
  userId: String,
  sessionId: String,
  prompt: String,
  rowLocked: { type: Boolean, default: false },
  generationType: String, // speech or music
  isInstrumental: { type: Boolean, default: false },
  musicGenerationIds: [String],
  musicGenerationStatus: String,
  audioLayerId: String,
  speaker: String,
  speakerVoiceId: String,
  speakerLabel: String,
  speakerDetails: Object,
  languageCode: String,
  languageCodes: [String],
  model: String,
  generationId: String,
  duration: Number,
  status: { type: String, default: 'INIT' },
  generationId: String,
  secondsTotal: Number,
  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // 3600 seconds = 1 hour
  },
  numRetries: { type: Number, default: 0 },
  isStreamGenerationPending: { type: Boolean, default: false },

  ttsProvider: String,
  apiRequestId: String,
  
  requestTimeoutUntil: Date,
  
  speakerCharacterName: String,

  defaultSelected: { type: Boolean, default: false }, 
  isBackingTrack: { type: Boolean, default: false },

  instructions: { type: String, default: '' },
  generationMeta: Object,
  
  
}, { timestamps: true, strict: false });

// 3. Create a Model.
const AudioGeneration = model('AudioGeneration', audioGenerationSchema);

export default AudioGeneration;
