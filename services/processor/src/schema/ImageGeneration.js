import { Schema, model } from 'mongoose';

// 2. Create a Schema corresponding to the document interface.
const imageGenerationSchema = new Schema({
  editStatus: String,
  apiEditStatus: { type: String, default: "INIT" },
  sessionId: String,
  videoSessionId: String,
  layerId: String,
  image: String,
  image_urls: [String],
  imageUrls: [String],
  maskImage: String,
  rowLocked: Boolean,
  operationType: String, // 'GENERATE' | 'EDIT' | 'UPSCALE'
  prompt: String,
  originalRetryPrompt: String,
  originalImageGenerationPrompt: String,
  originalImageGenerationPromptSource: String,
  originalImagePrompt: String,
  sourcePrompt: String,
  originalPrompt: String,
  model: String,
  generationStatus: String,
  requestType: { type: String, default: 'APP' },
  guidanceScale: Number,
  apiGenerationStatus: { type: String, default: "INIT" },
  apiRequestId: String,
  submittedAdapter: String,
  submissionOutcomeUnknown: { type: Boolean, default: false },
  numInferenceSteps: Number,
  numImages: Number,
  strength: Number,
  imageStyle: String,
  isBaseGeneration: { type: Boolean, default: false },
  isBatchGeneration: { type: Boolean, default: false },
  retryCount: { type: Number, default: 0 },
  retryOnFailure: { type: Boolean, default: false },
  generationError: { type: String, default: null },
  lastFailureAt: { type: Date, default: null },
  lastFailureMessage: { type: String, default: null },
  lastFailureSource: { type: String, default: null },
  failureHistory: { type: [Object], default: [] },

  aspectRatio: { type: String, default: "1:1" },
  resolution: { type: String, default: '1k' },

  contentFilterRating: { type: Number, default: 3 },
  batchGenerationId: String,
  case_type: String,

  refilterImageGenerationsRequired: { type: Boolean, default: false },
  refilterImagePassNumber: { type: Number, default: 0 },
  imageFilterScoreRequired: { type: Boolean, default: false },

  expireAt: {
    type: Date,
    default: Date.now,
    expires: 3600 // TTL in seconds (1 hour)
  },




  // ImageGeneration schema additions (optional, default 0)
  failureRetryCount: { type: Number, default: 0 },     // blank/error retry
  filterRetryCount: { type: Number, default: 0 },     // refilter passes





}, { timestamps: true, strict: false });

// 3. Create a Model.
const ImageGeneration = model('ImageGeneration', imageGenerationSchema);
export default ImageGeneration;
