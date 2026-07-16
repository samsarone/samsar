import { Schema, model } from 'mongoose';

const externalAssistantRequestSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  requestType: {
    type: String,
    enum: ['external_chat'],
    default: 'external_chat',
    required: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    index: true,
  },
  clientRequestId: { type: String, default: null, index: true },
  clientSessionId: { type: String, default: null, index: true },
  clientRequestKey: { type: String, default: null },
  payload: { type: Schema.Types.Mixed, default: null },
  response: { type: Schema.Types.Mixed, default: null },
  errorMessage: { type: String, default: null },
  errorCode: { type: String, default: null },
  errorStatus: { type: Number, default: null },
  creditsCharged: { type: Number, default: null },
  remainingCredits: { type: Number, default: null },
  startedAt: { type: Date, default: null },
  workerLeaseExpiresAt: { type: Date, default: null, index: true },
  processingAttempts: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  expireAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    expires: 0,
  },
}, { timestamps: true });

externalAssistantRequestSchema.index({ userId: 1, _id: 1 });
externalAssistantRequestSchema.index(
  { userId: 1, requestType: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string' } },
  },
);

const ExternalAssistantRequest = model(
  'ExternalAssistantRequest',
  externalAssistantRequestSchema,
);

export default ExternalAssistantRequest;
