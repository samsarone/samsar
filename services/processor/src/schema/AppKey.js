import { Schema, model } from 'mongoose';

const appKeySchema = new Schema({
  appKeyId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  appKeyHash: { type: String, required: true, unique: true, index: true },
  appKeyPrefix: { type: String, default: null },
  appKeyLast4: { type: String, default: null },
  appSecretHash: { type: String, required: true },
  status: { type: String, enum: ['active', 'revoked'], default: 'active', index: true },
  expiresAt: { type: Date, required: true, index: true },
  lastUsedAt: { type: Date, default: null },
  refreshedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  rotationCount: { type: Number, default: 0 },
  createdByAuthType: { type: String, default: null },
  metadata: { type: Object, default: {} },
}, { timestamps: true });

appKeySchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active',
      revokedAt: null,
    },
  },
);

const AppKey = model('AppKey', appKeySchema);

export default AppKey;
