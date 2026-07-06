import { Schema, model } from 'mongoose';

const customerSubAccountSchema = new Schema({
  customerSubAccountId: { type: String, required: true, unique: true, index: true },
  internalUserId: { type: String, required: true, index: true },
  externalCustomerId: { type: String, required: true, trim: true },
  externalAppId: { type: String, default: 'default', trim: true },
  name: { type: String, default: null },
  email: { type: String, default: null },
  status: { type: String, default: 'active', index: true },
  metadata: { type: Object, default: {} },
  generationCredits: { type: Number, default: null },
  totalCreditsAllocated: { type: Number, default: 0 },
  totalCreditsUsed: { type: Number, default: 0 },
  totalCreditsRefunded: { type: Number, default: 0 },
  lastCreditAllocationAt: { type: Date, default: null },
  internalApiKey: { type: String, default: null, index: true, unique: true, sparse: true },
  internalApiKeyCreatedAt: { type: Date, default: null },
  internalApiKeyExpiresAt: { type: Date, default: null, index: true },
  internalApiKeyLastUsedAt: { type: Date, default: null },
  internalApiKeyRotationDays: { type: Number, default: 30 },
  lastPulledAt: { type: Date, default: null },
  lastActivityAt: { type: Date, default: null },
}, { timestamps: true, strict: false });

customerSubAccountSchema.index(
  { internalUserId: 1, externalAppId: 1, externalCustomerId: 1 },
  { unique: true },
);
customerSubAccountSchema.index({ internalUserId: 1, customerSubAccountId: 1 });

const CustomerSubAccount = model('CustomerSubAccount', customerSubAccountSchema);

export default CustomerSubAccount;
