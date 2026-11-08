import { Schema, model } from 'mongoose';

const externalUserRequestSchema = new Schema({
  externalRequestId: { type: String, required: true, unique: true, index: true },
  internalUserId: { type: String, required: true, index: true },
  externalUserId: { type: Schema.Types.ObjectId, ref: 'ExternalUser', required: true, index: true },
  externalIdentityKey: { type: String, required: true, index: true },
  customerSubAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerSubAccount', default: null, index: true },
  customerSubAccountPublicId: { type: String, default: null, index: true },
  customerSubAccountExternalId: { type: String, default: null, index: true },
  routeKey: { type: String, required: true },
  upstreamRequestId: { type: String, default: null, index: true },
  upstreamSessionId: { type: String, default: null, index: true },
  status: { type: String, default: 'PENDING' },
  refundSettlement: { type: Schema.Types.Mixed, default: undefined },
  refundCeilingCredits: { type: Number, default: undefined },
  billingAccount: { type: Schema.Types.Mixed, default: undefined },
  creditsCharged: { type: Number, default: 0 },
  creditsRefunded: { type: Number, default: 0 },
  remainingCreditsSnapshot: { type: Number, default: null },
  webhookUrl: { type: String, default: null },
  resultUrl: { type: String, default: null },
  requestPayload: { type: Object, default: {} },
  responsePayload: { type: Object, default: {} },
  errorMessage: { type: String, default: null },
  metadata: { type: Object, default: {} },
}, { timestamps: true, strict: false });

externalUserRequestSchema.index({ 'refundSettlement.pendingOperation.id': 1 });

const ExternalUserRequest = model('ExternalUserRequest', externalUserRequestSchema);

export default ExternalUserRequest;
