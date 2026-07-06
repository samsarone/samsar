import { Schema, model } from 'mongoose';

const generationCreditTransactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  amount: { type: Number, required: true },
  direction: { type: String, enum: ['debit', 'credit'], required: true },
  source: { type: String, index: true },
  metadata: Schema.Types.Mixed,
  balanceAfter: Number,
}, { timestamps: true });

generationCreditTransactionSchema.index({ userId: 1, createdAt: -1 });
generationCreditTransactionSchema.index({ source: 1, createdAt: -1 });

const GenerationCreditTransaction = model('GenerationCreditTransaction', generationCreditTransactionSchema);

export default GenerationCreditTransaction;
