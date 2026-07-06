import { Schema, model } from 'mongoose';

const embeddingRecordSchema = new Schema({
  templateId: { type: String, required: true, index: true },
  templateHash: { type: String, index: true },
  userId: { type: String, required: true, index: true },
  sourceId: { type: String, required: true, index: true },
  searchDoc: { type: String, required: true },
  structuredFilters: { type: Schema.Types.Mixed },
  raw: { type: Schema.Types.Mixed },
  embeddingModel: { type: String, default: 'text-embedding-3-large' },
  embedding: { type: [Number], required: true },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

embeddingRecordSchema.index({ templateId: 1, sourceId: 1 }, { unique: true });
embeddingRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const EmbeddingRecord = model('EmbeddingRecord', embeddingRecordSchema);

export default EmbeddingRecord;
