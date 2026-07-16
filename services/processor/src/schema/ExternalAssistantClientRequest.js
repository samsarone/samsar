import mongoose from 'mongoose';

const { Schema } = mongoose;

const externalAssistantClientRequestSchema = new Schema({
  clientRequestId: { type: String, required: true, unique: true, index: true },
  sessionId: { type: String, required: true, index: true },
  userId: { type: String, default: null, index: true },
  requestKey: { type: String, required: true },
  provider: { type: String, default: 'samsar', required: true },
  providerRequestId: { type: String, default: null, index: true },
  model: { type: String, default: null },
  status: {
    type: String,
    enum: ['PENDING', 'SUBMITTED', 'POLLING', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    index: true,
  },
  response: { type: Schema.Types.Mixed, default: null },
  errorMessage: { type: String, default: null },
  errorCode: { type: String, default: null },
  errorStatus: { type: Number, default: null },
  submittedAt: { type: Date, default: null },
  lastPolledAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

externalAssistantClientRequestSchema.index(
  { sessionId: 1, requestKey: 1, provider: 1 },
  { unique: true },
);

const ExternalAssistantClientRequest = mongoose.models.ExternalAssistantClientRequest || mongoose.model(
  'ExternalAssistantClientRequest',
  externalAssistantClientRequestSchema,
);

export default ExternalAssistantClientRequest;
