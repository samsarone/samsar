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
  startImageDescription: String,
  initialStartImageSources: [String],
  fallbackStartImages: [{
    src: String,
    description: String,
    score: Number,
    rank: Number,
  }],
  attemptedFallbackStartImageSources: [String],
  promptSeedContext: { type: Object, default: null },
  userInferenceModel: String,
  selectedInferenceModelAuthorization: String,

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
  customFalStatusUrl: String,
  customFalResponseUrl: String,

  videoLink: String,  // video link for the video dubbing
  audioLink: String, // audio link for the video dubbing
  audioPrompt: String, // audio prompt for the video dubbing
  lipSyncPromptGenerated: { type: Boolean, default: false },
  lipSyncPromptSource: String,
  lipSyncPromptGeneratedAt: Date,
  lipSyncPromptSpeaker: String,
  lipSyncPromptAudioLayerId: String,

  isExpressGeneration: { type: Boolean, default: false },
  isVideoGPTGeneration: { type: Boolean, default: false },

  isAudioVideoGeneration: { type: Boolean, default: false },

  animationType: String,

  videoTone: { type: String, default: 'grounded' },

  isSecondaryExpressGeneration: { type: Boolean, default: false },


  requestSubmitAt: Date,
  nextAttemptAfter: Date,
  transientProviderErrorCount: { type: Number, default: 0 },
  mediaTunnelRefreshErrorCount: { type: Number, default: 0 },
  lastTransientProviderErrorAt: Date,
  lastTransientProviderErrorStatus: Number,
  lastTransientProviderErrorMessage: String,
  transientProviderErrorPhase: String,
  lastProviderPendingPollAt: Date,
  lastProviderFailureMessage: String,
  lastProviderFailureDetail: { type: Object, default: null },
  providerFailureDefinitive: { type: Boolean, default: false },
  submissionOutcomeUnknown: { type: Boolean, default: false },
  dockerVideoProvider: String,
  dockerVideoProviderOverride: String,
  dockerAdapterAttemptedProviders: [String],
  dockerAdapterFailoverCount: { type: Number, default: 0 },
  dockerAdapterFailoverHistory: [{
    fromProvider: String,
    toProvider: String,
    attemptedAt: Date,
    failureMessage: String,
  }],
  dockerAdapterFailoverAttempted: { type: Boolean, default: false },
  dockerAdapterFailoverAttemptedAt: Date,
  dockerAdapterFailoverFromProvider: String,
  dockerAdapterFailoverTriggerStatus: Number,
  dockerAdapterFailoverSucceeded: { type: Boolean, default: false },
  dockerAdapterFailoverSucceededAt: Date,
  dockerAdapterPrimaryPromoted: { type: Boolean, default: false },

  

}, { timestamps: true, strict: false });

// 3. Create a Model.
const AIVideoLayerGeneration = model('AIVideoLayerGeneration', aiVideoLayerGenerationSchema);

export default AIVideoLayerGeneration;
