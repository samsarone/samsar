import { Schema, model } from 'mongoose';

const externalUserGenerationCreditTransactionSchema = new Schema({
  internalUserId: { type: String, required: true, index: true },
  externalUserId: { type: Schema.Types.ObjectId, ref: 'ExternalUser', required: true, index: true },
  externalIdentityKey: { type: String, default: null, index: true },
  externalProvider: { type: String, default: null, index: true },
  externalUserExternalId: { type: String, default: null, index: true },
  customerSubAccountId: { type: Schema.Types.ObjectId, ref: 'CustomerSubAccount', default: null, index: true },
  customerSubAccountPublicId: { type: String, default: null, index: true },
  customerSubAccountExternalId: { type: String, default: null, index: true },
  amount: { type: Number, required: true },
  direction: { type: String, enum: ['debit', 'credit'], required: true },
  source: { type: String, index: true },
  metadata: Schema.Types.Mixed,
  balanceAfter: Number,
}, { timestamps: true });

externalUserGenerationCreditTransactionSchema.index({ externalUserId: 1, createdAt: -1 });
externalUserGenerationCreditTransactionSchema.index({ internalUserId: 1, createdAt: -1 });
externalUserGenerationCreditTransactionSchema.index({ source: 1, createdAt: -1 });

const ExternalUserGenerationCreditTransaction = model(
  'ExternalUserGenerationCreditTransaction',
  externalUserGenerationCreditTransactionSchema,
);

export default ExternalUserGenerationCreditTransaction;
