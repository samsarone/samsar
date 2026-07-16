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
  payload: { type: Schema.Types.Mixed, default: null },
  response: { type: Schema.Types.Mixed, default: null },
  errorMessage: { type: String, default: null },
  errorCode: { type: String, default: null },
  errorStatus: { type: Number, default: null },
  creditsCharged: { type: Number, default: null },
  remainingCredits: { type: Number, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expireAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    expires: 0,
  },
}, { timestamps: true });

externalAssistantRequestSchema.index({ userId: 1, _id: 1 });

const ExternalAssistantRequest = model(
  'ExternalAssistantRequest',
  externalAssistantRequestSchema,
);

export default ExternalAssistantRequest;
