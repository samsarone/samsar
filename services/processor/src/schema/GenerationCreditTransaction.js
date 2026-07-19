import { Schema, model } from 'mongoose';

const generationCreditTransactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  apiKeyId: { type: Schema.Types.ObjectId, default: null, index: true },
  amount: { type: Number, required: true },
  direction: { type: String, enum: ['debit', 'credit'], required: true },
  source: { type: String, index: true },
  idempotencyKey: { type: String, default: null },
  metadata: Schema.Types.Mixed,
  balanceAfter: Number,
}, { timestamps: true });

generationCreditTransactionSchema.index({ userId: 1, createdAt: -1 });
generationCreditTransactionSchema.index({ userId: 1, apiKeyId: 1, createdAt: -1 });
generationCreditTransactionSchema.index({ source: 1, createdAt: -1 });
generationCreditTransactionSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

const GenerationCreditTransaction = model('GenerationCreditTransaction', generationCreditTransactionSchema);

export default GenerationCreditTransaction;
