import { Schema, model } from 'mongoose';

const externalUserSchema = new Schema({
  internalUserId: { type: String, required: true, index: true },
  provider: { type: String, required: true, trim: true, lowercase: true },
  externalUserId: { type: String, required: true, trim: true },
  externalAppId: { type: String, default: null },
  externalCompanyId: { type: String, default: null },
  externalAccountId: { type: String, default: null },
  externalIdentityKey: { type: String, required: true, unique: true, index: true },
  email: { type: String, default: null },
  username: { type: String, default: null },
  displayName: { type: String, default: null },
  avatarUrl: { type: String, default: null },
  metadata: { type: Object, default: {} },
  generationCredits: { type: Number, default: 0 },
  externalApiKey: { type: String, default: null, index: true, unique: true, sparse: true },
  externalApiKeyCreatedAt: { type: Date, default: null },
  externalApiKeyLastUsedAt: { type: Date, default: null },
  totalRequests: { type: Number, default: 0 },
  totalCreditsUsed: { type: Number, default: 0 },
  totalCreditsRefunded: { type: Number, default: 0 },
  totalCreditsPurchased: { type: Number, default: 0 },
  lastRequestAt: { type: Date, default: null },
  lastPurchaseAt: { type: Date, default: null },
  lastActivityAt: { type: Date, default: null },
}, { timestamps: true, strict: false });

const ExternalUser = model('ExternalUser', externalUserSchema);

export default ExternalUser;
