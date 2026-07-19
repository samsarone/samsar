import { Schema, model } from 'mongoose';

const publicationMetadataRequestSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: Schema.Types.ObjectId, ref: 'VideoSession', required: true, index: true },
  requestKeyHash: { type: String, required: true },
  payloadHash: { type: String, required: true },
  status: {
    type: String,
    enum: ['PROCESSING', 'BILLABLE', 'COMPLETED', 'FAILED'],
    default: 'PROCESSING',
    index: true,
  },
  workerLeaseId: { type: String, default: null },
  workerLeaseExpiresAt: { type: Date, default: null, index: true },
  attempts: { type: Number, default: 1 },
  defaultPathId: { type: String, required: true },
  originalPrompt: { type: String, default: '' },
  inferenceModel: { type: String, default: null },
  inferenceReceipt: { type: Schema.Types.Mixed, default: null },
  title: { type: String, default: null },
  description: { type: String, default: null },
  generationSucceeded: { type: Boolean, default: null },
  billing: { type: Schema.Types.Mixed, default: null },
  billingStatus: {
    type: String,
    enum: ['PENDING', 'CHARGING', 'CHARGED', 'FAILED'],
    default: 'PENDING',
  },
  billingLeaseExpiresAt: { type: Date, default: null },
  billingTransactionId: { type: Schema.Types.ObjectId, default: null },
  remainingCredits: { type: Number, default: null },
  errorCode: { type: String, default: null },
  errorMessage: { type: String, default: null },
  errorStatus: { type: Number, default: null },
}, { timestamps: true });

publicationMetadataRequestSchema.index(
  { userId: 1, requestKeyHash: 1 },
  { unique: true },
);

const PublicationMetadataRequest = model(
  'PublicationMetadataRequest',
  publicationMetadataRequestSchema,
);

export default PublicationMetadataRequest;
