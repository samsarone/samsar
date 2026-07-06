import { Schema, model } from 'mongoose';

const externalUserPaymentSchema = new Schema({
  externalPaymentId: { type: String, required: true, unique: true, index: true },
  internalUserId: { type: String, required: true, index: true },
  externalUserId: { type: Schema.Types.ObjectId, ref: 'ExternalUser', required: true, index: true },
  externalIdentityKey: { type: String, required: true, index: true },
  customerSubAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerSubAccount', default: null, index: true },
  customerSubAccountPublicId: { type: String, default: null, index: true },
  customerSubAccountExternalId: { type: String, default: null, index: true },
  checkoutSessionId: { type: String, default: null, index: true },
  paymentIntentId: { type: String, default: null, index: true },
  setupIntentId: { type: String, default: null, index: true },
  status: { type: String, default: 'pending' },
  creditsRequested: { type: Number, default: 0 },
  creditsApplied: { type: Number, default: 0 },
  amountCents: { type: Number, default: 0 },
  amountUsd: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  paymentType: { type: String, default: 'one_time' },
  responsePayload: { type: Object, default: {} },
  metadata: { type: Object, default: {} },
}, { timestamps: true, strict: false });

const ExternalUserPayment = model('ExternalUserPayment', externalUserPaymentSchema);

export default ExternalUserPayment;
