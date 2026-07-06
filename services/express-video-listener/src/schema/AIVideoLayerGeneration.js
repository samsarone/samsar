import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const aiVideoLayerGenerationSchema = new Schema({
  sessionId: String,
  layerId: String,
  prompt: String,
  model: String,
  generationType: { type: String, default: 'generate' },
  status: { type: String, default: 'INIT' },
  startImage: String,
  endImage: String,

  useStartFrame: { type: Boolean, default: true },
  useEndFrame: { type: Boolean, default: true },
  combineLayers: { type: Boolean, default: false },


  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // 3600 seconds = 1 hour
  },
  numRetries: { type: Number, default: 0 },
  retryOnFail: { type: Boolean, default: false },
  rowLocked: { type: Boolean, default: false },

  aspectRatio: { type: String, default: '1:1' },

  clipLayerToAiVideo: { type: Boolean, default: false },

  usePromptOptimizer: { type: Boolean, default: false },
  generateAudio: { type: Boolean, default: false },

  duration: Number,

  userId: String,

  generationId: String,

  videoLink: String,  // video link for the video dubbing
  audioLink: String, // audio link for the video dubbing
  audioPrompt: String,
  
  isExpressGeneration: { type: Boolean, default: false },
  isVideoGPTGeneration: { type: Boolean, default: false },


  isAudioVideoGeneration: { type: Boolean, default: false },

  requestSoundEffects: { type: Boolean, default: false }, // use for sound effect types with omni models compatible with sound effects.

  animationType: String,

  
  audioDuration: Number,
  
}, { timestamps: true , strict: false });

// 3. Create a Model.
const AIVideoLayerGeneration = model('AIVideoLayerGeneration', aiVideoLayerGenerationSchema);

export default AIVideoLayerGeneration;
