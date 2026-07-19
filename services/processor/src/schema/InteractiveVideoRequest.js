import mongoose from 'mongoose';

const { Schema } = mongoose;

const interactiveVideoRequestSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, default: null },
  payloadHash: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  apiKeyUsage: { type: Schema.Types.Mixed, default: null },
  webhookUrl: { type: String, default: null },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'WAITING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    required: true,
    index: true,
  },
  stage: {
    type: String,
    enum: [
      'SINGULAR_NARRATIVE',
      'BRANCHED_NARRATIVE',
      'VIDEO_SESSION',
      'COMPLETED',
      'FAILED',
    ],
    default: 'SINGULAR_NARRATIVE',
    required: true,
  },
  singularNarrativeRequestId: {
    type: Schema.Types.ObjectId,
    ref: 'NarrativeRequest',
    default: null,
  },
  branchedNarrativeRequestId: {
    type: Schema.Types.ObjectId,
    ref: 'NarrativeRequest',
    default: null,
  },
  workerLeaseId: { type: String, default: null, index: true },
  workerLeaseExpiresAt: { type: Date, default: null, index: true },
  nextAttemptAt: { type: Date, default: null, index: true },
  processingAttempts: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  errorMessage: { type: String, default: null },
  errorCode: { type: String, default: null },
  errorStatus: { type: Number, default: null },
}, {
  timestamps: true,
  collection: 'interactive_video_requests',
});

interactiveVideoRequestSchema.index({ status: 1, nextAttemptAt: 1, workerLeaseExpiresAt: 1 });
interactiveVideoRequestSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    name: 'unique_interactive_video_idempotency_key',
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  },
);

const InteractiveVideoRequest = mongoose.models.InteractiveVideoRequest || mongoose.model(
  'InteractiveVideoRequest',
  interactiveVideoRequestSchema,
);

export default InteractiveVideoRequest;
