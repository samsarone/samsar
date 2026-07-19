import mongoose from 'mongoose';

const { Schema } = mongoose;

const narrativeRequestSchema = new Schema({
  userId: { type: String, required: true, index: true },
  requestType: {
    type: String,
    enum: ['create_single', 'create_branching'],
    default: 'create_single',
    required: true,
    index: true,
  },
  narrativeType: {
    type: String,
    enum: ['singular', 'branched'],
    default: 'singular',
    required: true,
    index: true,
  },
  sourceNarrativeRequestId: {
    type: Schema.Types.ObjectId,
    ref: 'NarrativeRequest',
    default: null,
    index: true,
  },
  interactiveVideoRequestId: {
    type: Schema.Types.ObjectId,
    ref: 'InteractiveVideoRequest',
    default: null,
    index: true,
  },
  sourceNarrativeSnapshot: { type: Schema.Types.Mixed, default: null },
  numLevels: {
    type: Number,
    default: null,
    min: 1,
    // Six levels already produce 127 complete movieResourceList nodes.
    max: 6,
    validate: {
      validator: (value) => value === null || value === undefined || Number.isSafeInteger(value),
      message: 'numLevels must be an integer.',
    },
  },
  branchingMeta: { type: Schema.Types.Mixed, default: null },
  branchingProgress: { type: Schema.Types.Mixed, default: null },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    required: true,
    index: true,
  },
  prompt: { type: String, required: true, maxlength: 4000 },
  inputPrompt: { type: String, required: true, maxlength: 4000 },
  duration: { type: Number, required: true, min: 10, max: 240 },
  totalDuration: { type: Number, required: true, min: 10, max: 240 },
  // Interactive branching needs at least one source scene per branch level,
  // plus a terminal scene after the final divergence point.
  minimumSceneCount: {
    type: Number,
    default: null,
    min: 2,
    max: 7,
    validate: {
      validator: (value) => value === null || value === undefined || Number.isSafeInteger(value),
      message: 'minimumSceneCount must be an integer.',
    },
  },
  inferenceModel: {
    type: String,
    enum: ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7'],
    required: true,
  },
  videoGenerationModel: { type: String, default: 'RUNWAYML' },
  videoTone: { type: String, default: 'grounded' },
  speakerOptions: { type: Schema.Types.Mixed, default: null },

  themeJson: { type: Schema.Types.Mixed, default: null },
  narrativeJson: { type: Schema.Types.Mixed, default: null },
  movieResourceList: { type: Schema.Types.Mixed, default: null },
  validation: { type: Schema.Types.Mixed, default: null },
  generationOutcome: {
    type: String,
    enum: ['PENDING', 'SUCCEEDED', 'FAILED'],
    default: 'PENDING',
  },
  generationFinishedAt: { type: Date, default: null },
  generationFailureMessage: { type: String, default: null },
  generationFailureCode: { type: String, default: null },
  generationFailureStatus: { type: Number, default: null },

  inferenceUsage: { type: Schema.Types.Mixed, default: null },
  inferenceReceipts: { type: [Schema.Types.Mixed], default: [] },
  billingSnapshot: { type: Schema.Types.Mixed, default: null },
  billingCalculatedAt: { type: Date, default: null },
  pricingMultiplier: { type: Number, default: 1.5 },
  underlyingCostUsd: { type: Number, default: 0 },
  underlyingCredits: { type: Number, default: 0 },
  creditsCharged: { type: Number, default: 0 },
  remainingCredits: { type: Number, default: null },
  billingStatus: {
    type: String,
    enum: ['PENDING', 'CHARGING', 'CHARGED', 'WAIVED', 'FAILED'],
    default: 'PENDING',
  },
  billingPolicy: {
    type: String,
    enum: ['standalone', 'included_in_interactive_video_rate'],
    default: 'standalone',
  },
  billingReason: { type: String, default: null },
  billingTransactionId: { type: Schema.Types.ObjectId, default: null },

  apiKeyId: { type: String, default: null, index: true },
  apiKeyUsage: { type: Schema.Types.Mixed, default: null },
  startedAt: { type: Date, default: null },
  // The partial unique index below serializes metered narrative work per user.
  // The exact token charge is only known after inference has completed.
  meteringSlotActive: { type: Boolean, default: false },
  workerLeaseId: { type: String, default: null, index: true },
  workerLeaseExpiresAt: { type: Date, default: null, index: true },
  processingAttempts: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
  errorCode: { type: String, default: null },
  errorStatus: { type: Number, default: null },
}, {
  timestamps: true,
  collection: 'narrative_requests',
});

narrativeRequestSchema.index({ userId: 1, _id: 1 });
narrativeRequestSchema.index({ status: 1, workerLeaseExpiresAt: 1 });
narrativeRequestSchema.index(
  { interactiveVideoRequestId: 1, requestType: 1 },
  {
    name: 'unique_interactive_video_narrative_stage',
    unique: true,
    partialFilterExpression: {
      interactiveVideoRequestId: { $type: 'objectId' },
    },
  },
);
narrativeRequestSchema.index(
  { userId: 1, meteringSlotActive: 1 },
  {
    name: 'unique_active_metered_narrative_per_user',
    unique: true,
    partialFilterExpression: { meteringSlotActive: true },
  },
);

const NarrativeRequest = mongoose.models.NarrativeRequest || mongoose.model(
  'NarrativeRequest',
  narrativeRequestSchema,
);

export default NarrativeRequest;
