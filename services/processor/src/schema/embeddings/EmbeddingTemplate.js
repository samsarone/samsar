import { Schema, model } from 'mongoose';

const structuredFieldSchema = new Schema({
  key: { type: String, required: true },
  type: { type: String, required: true },
  sampleValues: { type: [Schema.Types.Mixed], default: [] },
  stats: { type: Schema.Types.Mixed },
}, { _id: false });

const embeddingTemplateSchema = new Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String },
  hash: { type: String, index: true },
  hashLink: { type: String },
  structuredFields: { type: [structuredFieldSchema], default: [] },
  unstructuredFields: { type: [String], default: [] },
  fieldOptions: { type: Schema.Types.Mixed, default: {} },
  schemaFingerprint: { type: String },
  embeddingModel: { type: String, default: 'text-embedding-3-large' },
  vectorIndex: { type: String, default: 'embedding_vector_index' },
  recordCount: { type: Number, default: 0 },
  ttlMinutes: { type: Number, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

embeddingTemplateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const EmbeddingTemplate = model('EmbeddingTemplate', embeddingTemplateSchema);

export default EmbeddingTemplate;
